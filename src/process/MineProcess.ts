import { settings } from "../Settings";
import { Goal, GoalBlock, GoalComposite, GoalRunAway, GoalTwoBlocks } from "../goals/Goal";
import { COST_INF } from "../movement/ActionCosts";
import type { CalculationContext } from "../movement/CalculationContext";
import { MovementHelper } from "../movement/MovementHelper";
import { Input } from "../movement/MovementState";
import { BetterBlockPos, PosSet } from "../utils/BetterBlockPos";
import { isEmpty } from "../utils/IPlayerContext";
import type { IPlayerContext } from "../utils/IPlayerContext";
import { reachable } from "../utils/Reachability";
import { Blocks } from "../world/Blocks";
import { BlockOptionalMeta, BlockOptionalMetaLookup } from "../world/BlockOptionalMeta";
import { scanChunkRadius, BlockScanner } from "../world/WorldScanner";
import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";
import { GoalRunAwayForever } from "./GetToBlockProcess";

export class GoalThreeBlocks extends GoalTwoBlocks {
    override isInGoal(x: number, y: number, z: number): boolean {
        return x === this.x && (y === this.y || y === this.y - 1 || y === this.y - 2) && z === this.z;
    }

    override heuristic(x: number, y: number, z: number): number {
        const yDiff = y - this.y;
        return GoalBlock.calculate(x - this.x, yDiff < -1 ? yDiff + 2 : yDiff === -1 ? 0 : yDiff, z - this.z);
    }

    override toString(): string {
        return `GoalThreeBlocks{x=${this.x},y=${this.y},z=${this.z}}`;
    }
}

export class MineProcess extends BaritoneProcess {
    private filter: BlockOptionalMetaLookup | null = null;
    private knownOreLocations: BetterBlockPos[] = [];
    private blacklist: BetterBlockPos[] = [];
    private anticipatedDrops = new Map<number, [BetterBlockPos, number]>();
    private branchPoint: BetterBlockPos | null = null;
    private branchPointRunaway: GoalRunAway | null = null;
    private desiredQuantity = 0;
    private tickCount = 0;
    private rescanning = false;

    isActive(): boolean {
        return this.filter !== null;
    }

    onTick(calcFailed: boolean, isSafeToCancel: boolean): PathingCommand | null {
        if (this.desiredQuantity > 0) {
            const curr = this.ctx
                .player()
                .inventory()
                .items.filter((stack) => !isEmpty(stack) && this.filter!.hasItem(stack))
                .reduce((a, s) => a + s.amount, 0);
            if (curr >= this.desiredQuantity) {
                this.logDirect("Have " + curr + " valid items");
                this.cancel();
                return null;
            }
        }
        if (calcFailed) {
            if (this.knownOreLocations.length && settings.blacklistClosestOnFailure.value) {
                this.logDirect("Unable to find any path to " + this.filter + ", blacklisting presumably unreachable closest instance...");
                if (settings.notificationOnMineFail.value) {
                    this.logNotification("Unable to find any path to " + this.filter + ", blacklisting presumably unreachable closest instance...", true);
                }
                const feet = this.ctx.playerFeet();
                const closest = [...this.knownOreLocations].sort((a, b) => feet.distSqr(a) - feet.distSqr(b))[0];
                if (closest) this.blacklist.push(closest);
                this.knownOreLocations = this.knownOreLocations.filter((p) => !this.blacklist.some((b) => b.equals(p)));
            } else {
                this.logDirect("Unable to find any path to " + this.filter + ", canceling mine");
                if (settings.notificationOnMineFail.value) {
                    this.logNotification("Unable to find any path to " + this.filter + ", canceling mine", true);
                }
                this.cancel();
                return null;
            }
        }

        this.updateLoucaSystem();
        const mineGoalUpdateInterval = settings.mineGoalUpdateInterval.value;
        const curr = [...this.knownOreLocations];
        if (mineGoalUpdateInterval !== 0 && this.tickCount++ % mineGoalUpdateInterval === 0 && !settings.legitMine.value) {
            const context = this.baritone.newCalculationContext();
            this.startRescan(curr, context);
        }
        if (settings.legitMine.value) {
            if (!this.addNearby()) {
                this.cancel();
                return null;
            }
        }
        const feet = this.ctx.playerFeet();
        const bsi = this.ctx.bsi();
        const shaft = curr
            .filter((pos) => pos.x === feet.x && pos.z === feet.z)
            .filter((pos) => pos.y >= feet.y)
            .filter((pos) => !Blocks.isAir(bsi.get(pos)))
            .sort((a, b) => feet.above().distSqr(a) - feet.above().distSqr(b))[0];
        this.baritone.getInputOverrideHandler().clearAllKeys();
        if (shaft && this.ctx.player().onGround()) {
            const pos = shaft;
            const state = bsi.get(pos);
            if (!MovementHelper.avoidBreakingBsi(bsi, pos.x, pos.y, pos.z, state)) {
                const rot = reachable(this.ctx, pos);
                if (rot && isSafeToCancel) {
                    this.baritone.getLookBehavior().updateTarget(rot, true);
                    MovementHelper.switchToBestToolFor(this.ctx, state);
                    if (this.ctx.isLookingAt(pos) || this.ctx.playerRotations().isReallyCloseTo(rot)) {
                        this.baritone.getInputOverrideHandler().setInputForceState(Input.CLICK_LEFT, true);
                    }
                    return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
                }
            }
        }
        const command = this.updateGoal();
        if (command === null) {
            this.cancel();
            return null;
        }
        return command;
    }

    private cancel(): void {
        this.onLostControl();
    }

    private updateLoucaSystem(): void {
        const copy = new Map(this.anticipatedDrops);
        const sel = this.ctx.getSelectedBlock();
        if (sel && this.knownOreLocations.some((p) => p.equals(sel))) {
            copy.set(sel.hash(), [sel, Date.now() + settings.mineDropLoiterDurationMSThanksLouca.value]);
        }
        for (const [k, [, until]] of this.anticipatedDrops) {
            if (until < Date.now()) {
                copy.delete(k);
            }
        }
        this.anticipatedDrops = copy;
    }

    onLostControl(): void {
        this.mine(0, null);
    }

    displayName0(): string {
        return "Mine " + this.filter;
    }

    private updateGoal(): PathingCommand | null {
        const filter = this.filterFilter();
        if (filter === null) {
            return null;
        }
        const legit = settings.legitMine.value;
        const locs = this.knownOreLocations;
        if (locs.length) {
            const context = this.baritone.newCalculationContext();
            const locs2 = MineProcess.prune(context, this.ctx, [...locs], filter, settings.mineMaxOreLocationsCount.value, this.blacklist, this.droppedItemsScan());
            const goal = new GoalComposite(...locs2.map((loc) => this.coalesce(loc, locs2, context)));
            this.knownOreLocations = locs2;
            return new PathingCommand(goal, legit ? PathingCommandType.FORCE_REVALIDATE_GOAL_AND_PATH : PathingCommandType.REVALIDATE_GOAL_AND_PATH);
        }
        if (!legit && !settings.exploreForBlocks.value) {
            return null;
        }
        const y = settings.legitMineYLevel.value;
        if (this.branchPoint === null) {
            this.branchPoint = this.ctx.playerFeet();
        }
        if (this.branchPointRunaway === null) {
            this.branchPointRunaway = new GoalRunAwayForever(1, y, this.branchPoint);
        }
        return new PathingCommand(this.branchPointRunaway, PathingCommandType.REVALIDATE_GOAL_AND_PATH);
    }

    private startRescan(already: BetterBlockPos[], context: CalculationContext): void {
        if (this.rescanning) return;
        this.rescanning = true;
        const self = this;
        this.baritone.runJob(
            (function* () {
                try {
                    yield* self.rescan(already, context);
                } finally {
                    self.rescanning = false;
                }
            })(),
        );
    }

    private *rescan(already: BetterBlockPos[], context: CalculationContext): Generator<void, void, void> {
        const filter = this.filterFilter();
        if (filter === null) {
            return;
        }
        if (settings.legitMine.value) {
            return;
        }
        const dropped = this.droppedItemsScan();
        const locs = yield* MineProcess.searchWorld(context, this.ctx, this.baritone.getBlockScanner(), filter, settings.mineMaxOreLocationsCount.value, already, this.blacklist, dropped);
        locs.push(...dropped);
        if (this.filter === null) {
            return;
        }
        if (locs.length === 0 && !settings.exploreForBlocks.value) {
            this.logDirect("No locations for " + filter + " known, cancelling");
            if (settings.notificationOnMineFail.value) {
                this.logNotification("No locations for " + filter + " known, cancelling", true);
            }
            this.cancel();
            return;
        }
        this.knownOreLocations = locs;
    }

    private internalMiningGoal(pos: BetterBlockPos, context: CalculationContext, locs: BetterBlockPos[]): boolean {
        if (locs.some((p) => p.equals(pos))) {
            return true;
        }
        const state = context.bsi.get(pos);
        if (settings.internalMiningAirException.value && Blocks.isAir(state)) {
            return true;
        }
        return this.filter!.has(state) && MineProcess.plausibleToBreak(context, pos);
    }

    private coalesce(loc: BetterBlockPos, locs: BetterBlockPos[], context: CalculationContext): Goal {
        const assumeVerticalShaftMine = !Blocks.isFalling(this.ctx.bsi().get(loc.above()));
        if (!settings.forceInternalMining.value) {
            if (assumeVerticalShaftMine) {
                return new GoalThreeBlocks(loc.x, loc.y, loc.z);
            } else {
                return GoalTwoBlocks.of(loc);
            }
        }
        const upwardGoal = this.internalMiningGoal(loc.above(), context, locs);
        const downwardGoal = this.internalMiningGoal(loc.below(), context, locs);
        const doubleDownwardGoal = this.internalMiningGoal(loc.below(2), context, locs);
        if (upwardGoal === downwardGoal) {
            if (doubleDownwardGoal && assumeVerticalShaftMine) {
                return new GoalThreeBlocks(loc.x, loc.y, loc.z);
            } else {
                return GoalTwoBlocks.of(loc);
            }
        }
        if (upwardGoal) {
            return GoalBlock.of(loc);
        }
        if (doubleDownwardGoal && assumeVerticalShaftMine) {
            return GoalTwoBlocks.of(loc.below());
        }
        return GoalBlock.of(loc.below());
    }

    droppedItemsScan(): BetterBlockPos[] {
        if (!settings.mineScanDroppedItems.value) {
            return [];
        }
        const ret: BetterBlockPos[] = [];
        for (const entity of this.ctx.entities()) {
            if (entity.typeId === "minecraft:item" && entity.itemTypeId && this.filter && this.filter.hasItem({ typeId: entity.itemTypeId, amount: 1, damage: 0, maxDamage: 0, enchantments: {} })) {
                ret.push(BetterBlockPos.of(entity.position));
            }
        }
        for (const [pos] of this.anticipatedDrops.values()) ret.push(pos);
        return ret;
    }

    static *searchWorld(
        ctx: CalculationContext,
        pctx: IPlayerContext,
        scanner: BlockScanner,
        filter: BlockOptionalMetaLookup,
        max: number,
        alreadyKnown: BetterBlockPos[],
        blacklist: BetterBlockPos[],
        dropped: BetterBlockPos[],
    ): Generator<void, BetterBlockPos[], void> {
        let locs: BetterBlockPos[] = [];
        locs.push(...(yield* scanChunkRadius(pctx, scanner, filter, max, 10, 32)));
        locs.push(...alreadyKnown);
        return MineProcess.prune(ctx, pctx, locs, filter, max, blacklist, dropped);
    }

    private addNearby(): boolean {
        const dropped = this.droppedItemsScan();
        this.knownOreLocations.push(...dropped);
        const playerFeet = this.ctx.playerFeet();
        const bsi = this.ctx.bsi();

        const filter = this.filterFilter();
        if (filter === null) {
            return false;
        }

        const searchDist = 10;
        const fakedBlockReachDistance = 20;
        const alreadyKnown = new PosSet(this.knownOreLocations);
        for (let x = playerFeet.x - searchDist; x <= playerFeet.x + searchDist; x++) {
            for (let y = playerFeet.y - searchDist; y <= playerFeet.y + searchDist; y++) {
                for (let z = playerFeet.z - searchDist; z <= playerFeet.z + searchDist; z++) {
                    const pos = new BetterBlockPos(x, y, z);
                    if (filter.has(bsi.get0(x, y, z)) && !alreadyKnown.has(pos)) {
                        if ((settings.legitMineIncludeDiagonals.value && this.knownOreLocations.some((ore) => ore.distSqr(pos) <= 2)) || reachable(this.ctx, pos, fakedBlockReachDistance) !== null) {
                            this.knownOreLocations.push(pos);
                        }
                    }
                }
            }
        }
        this.knownOreLocations = MineProcess.prune(this.baritone.newCalculationContext(), this.ctx, this.knownOreLocations, filter, settings.mineMaxOreLocationsCount.value, this.blacklist, dropped);
        return true;
    }

    private static prune(ctx: CalculationContext, pctx: IPlayerContext, locs2: BetterBlockPos[], filter: BlockOptionalMetaLookup, max: number, blacklist: BetterBlockPos[], dropped: BetterBlockPos[]): BetterBlockPos[] {
        const droppedKept = dropped.filter((drop) => {
            for (const pos of locs2) {
                if (pos.distSqr(drop) <= 9 && filter.has(ctx.get(pos.x, pos.y, pos.z)) && MineProcess.plausibleToBreak(ctx, pos)) {
                    return false;
                }
            }
            return true;
        });
        const seen = new PosSet();
        const me = BetterBlockPos.of(pctx.player().position());
        const locs = locs2
            .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
            .filter((pos) => !ctx.bsi.worldContainsLoadedChunk(pos.x, pos.z) || filter.has(ctx.get(pos.x, pos.y, pos.z)) || droppedKept.some((d) => d.equals(pos)))
            .filter((pos) => MineProcess.plausibleToBreak(ctx, pos))
            .filter((pos) => (settings.allowOnlyExposedOres.value ? MineProcess.isNextToAir(ctx, pos) : true))
            .filter((pos) => pos.y >= settings.minYLevelWhileMining.value + ctx.minY)
            .filter((pos) => pos.y <= settings.maxYLevelWhileMining.value)
            .filter((pos) => !blacklist.some((b) => b.equals(pos)))
            .sort((a, b) => me.distSqr(a) - me.distSqr(b));
        if (locs.length > max) {
            return locs.slice(0, max);
        }
        return locs;
    }

    static isNextToAir(ctx: CalculationContext, pos: BetterBlockPos): boolean {
        const radius = settings.allowOnlyExposedOresDistance.value;
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= radius && MovementHelper.isTransparent(ctx.get(pos.x + dx, pos.y + dy, pos.z + dz))) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    static plausibleToBreak(ctx: CalculationContext, pos: BetterBlockPos): boolean {
        const state = ctx.bsi.get(pos);
        if (MovementHelper.getMiningDurationTicks(ctx, pos.x, pos.y, pos.z, state, true) >= COST_INF) {
            return false;
        }
        if (MovementHelper.avoidBreakingBsi(ctx.bsi, pos.x, pos.y, pos.z, state)) {
            return false;
        }
        return !(ctx.bsi.get(pos.above()).name === "bedrock" && ctx.bsi.get(pos.below()).name === "bedrock");
    }

    mineByName(quantity: number, ...blocks: string[]): void {
        this.mine(quantity, new BlockOptionalMetaLookup(...blocks));
    }

    mine(quantity: number, filter: BlockOptionalMetaLookup | null): void {
        this.filter = filter;
        if (this.filterFilter() === null) {
            this.filter = null;
        }
        this.desiredQuantity = quantity;
        this.knownOreLocations = [];
        this.blacklist = [];
        this.branchPoint = null;
        this.branchPointRunaway = null;
        this.anticipatedDrops = new Map();
        if (filter !== null) {
            this.startRescan([], this.baritone.newCalculationContext());
        }
    }

    mineBoms(quantity: number, boms: BlockOptionalMeta[]): void {
        this.mine(quantity, new BlockOptionalMetaLookup(...boms));
    }

    private filterFilter(): BlockOptionalMetaLookup | null {
        if (this.filter === null) {
            return null;
        }
        if (!settings.allowBreak.value) {
            const f = new BlockOptionalMetaLookup(...this.filter.blocks().filter((e) => settings.allowBreakAnyway.value.includes(e.getBlock())));
            if (f.blocks().length === 0) {
                this.logDirect("Unable to mine when allowBreak is false and target block is not in allowBreakAnyway!");
                return null;
            }
            return f;
        }
        return this.filter;
    }
}
