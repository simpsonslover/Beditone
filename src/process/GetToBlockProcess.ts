import { settings } from "../Settings";
import { Goal, GoalBlock, GoalComposite, GoalGetToBlock, GoalRunAway, GoalTwoBlocks } from "../goals/Goal";
import { CalculationContext } from "../movement/CalculationContext";
import { MovementHelper } from "../movement/MovementHelper";
import { Input } from "../movement/MovementState";
import { BetterBlockPos } from "../utils/BetterBlockPos";
import { reachable } from "../utils/Reachability";
import { BlockOptionalMeta, BlockOptionalMetaLookup } from "../world/BlockOptionalMeta";
import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";
import { MineProcess } from "./MineProcess";

class GetToBlockCalculationContext extends CalculationContext {
    override breakCostMultiplierAt(): number {
        return 1;
    }
}

export class GoalRunAwayForever extends GoalRunAway {
    override isInGoal(): boolean {
        return false;
    }

    override heuristicAtGoal(): number {
        return -Infinity;
    }
}

export class GetToBlockProcess extends BaritoneProcess {
    private gettingTo: BlockOptionalMeta | null = null;
    private knownLocations: BetterBlockPos[] | null = null;
    private blacklist: BetterBlockPos[] = [];
    private start: BetterBlockPos | null = null;
    private tickCount = 0;
    private arrivalTickCount = 0;
    private rescanning = false;

    getToBlock(block: BlockOptionalMeta): void {
        this.onLostControl();
        this.gettingTo = block;
        this.start = this.ctx.playerFeet();
        this.blacklist = [];
        this.arrivalTickCount = 0;
        this.knownLocations = [];
        this.startRescan([]);
    }

    isActive(): boolean {
        return this.gettingTo !== null;
    }

    onTick(calcFailed: boolean, isSafeToCancel: boolean): PathingCommand {
        if (this.knownLocations === null) {
            this.knownLocations = [];
            this.startRescan([]);
        }
        if (this.knownLocations.length === 0) {
            if (this.rescanning) {
                return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
            }
            if (settings.exploreForBlocks.value && !calcFailed) {
                return new PathingCommand(
                    new GoalRunAwayForever(1, null, this.start!),
                    PathingCommandType.FORCE_REVALIDATE_GOAL_AND_PATH,
                );
            }
            this.logDirect("No known locations of " + this.gettingTo + ", canceling GetToBlock");
            if (isSafeToCancel) {
                this.onLostControl();
            }
            return new PathingCommand(null, PathingCommandType.CANCEL_AND_SET_GOAL);
        }
        const goal = new GoalComposite(...this.knownLocations.map((p) => this.createGoal(p)));
        if (calcFailed) {
            if (settings.blacklistClosestOnFailure.value) {
                this.logDirect("Unable to find any path to " + this.gettingTo + ", blacklisting presumably unreachable closest instances...");
                this.blacklistClosest();
                return this.onTick(false, isSafeToCancel);
            } else {
                this.logDirect("Unable to find any path to " + this.gettingTo + ", canceling GetToBlock");
                if (isSafeToCancel) {
                    this.onLostControl();
                }
                return new PathingCommand(goal, PathingCommandType.CANCEL_AND_SET_GOAL);
            }
        }
        const mineGoalUpdateInterval = settings.mineGoalUpdateInterval.value;
        if (mineGoalUpdateInterval !== 0 && this.tickCount++ % mineGoalUpdateInterval === 0) {
            this.startRescan([...this.knownLocations]);
        }
        const feet = this.ctx.playerFeet();
        const start = this.baritone.getPathingBehavior().pathStart();
        if (goal.isInGoal(feet.x, feet.y, feet.z) && goal.isInGoal(start.x, start.y, start.z) && isSafeToCancel) {
            if (this.rightClickOnArrival(this.gettingTo!.getBlock())) {
                if (this.rightClick()) {
                    this.onLostControl();
                    return new PathingCommand(null, PathingCommandType.CANCEL_AND_SET_GOAL);
                }
            } else {
                this.onLostControl();
                return new PathingCommand(null, PathingCommandType.CANCEL_AND_SET_GOAL);
            }
        }
        return new PathingCommand(goal, PathingCommandType.REVALIDATE_GOAL_AND_PATH);
    }

    blacklistClosest(): boolean {
        const known = this.knownLocations ?? [];
        const feet = this.ctx.playerFeet();
        const newBlacklist: BetterBlockPos[] = [];
        const closest = [...known].sort((a, b) => feet.distSqr(a) - feet.distSqr(b))[0];
        if (closest) newBlacklist.push(closest);
        outer: for (;;) {
            for (const k of known) {
                for (const b of newBlacklist) {
                    if (GetToBlockProcess.areAdjacent(k, b)) {
                        newBlacklist.push(k);
                        known.splice(known.indexOf(k), 1);
                        continue outer;
                    }
                }
            }
            break;
        }
        this.logDebug("Blacklisting unreachable locations " + newBlacklist.join(", "));
        this.blacklist.push(...newBlacklist);
        return newBlacklist.length > 0;
    }

    private static areAdjacent(posA: BetterBlockPos, posB: BetterBlockPos): boolean {
        const diffX = Math.abs(posA.x - posB.x);
        const diffY = Math.abs(posA.y - posB.y);
        const diffZ = Math.abs(posA.z - posB.z);
        return diffX + diffY + diffZ === 1;
    }

    onLostControl(): void {
        this.gettingTo = null;
        this.knownLocations = null;
        this.start = null;
        this.blacklist = [];
        this.baritone.getInputOverrideHandler().clearAllKeys();
    }

    displayName0(): string {
        if (!this.knownLocations || this.knownLocations.length === 0) {
            return "Exploring randomly to find " + this.gettingTo + ", no known locations";
        }
        return "Get To " + this.gettingTo + ", " + this.knownLocations.length + " known locations";
    }

    private startRescan(known: BetterBlockPos[]): void {
        if (this.rescanning) return;
        const target = this.gettingTo;
        if (target === null) return;
        this.rescanning = true;
        const self = this;
        const base = this.baritone.newCalculationContext();
        const context = new GetToBlockCalculationContext({
            world: base.world,
            toolSet: base.toolSet,
            hasThrowaway: base.hasThrowaway,
            hasWaterBucket: base.hasWaterBucket,
            canSprint: base.canSprint,
            frostWalker: base.frostWalker,
            waterSpeedMultiplier: 1,
            baritone: this.baritone,
        });
        const blacklistSnapshot = [...this.blacklist];
        this.baritone.runJob(
            (function* () {
                try {
                    const positions = yield* MineProcess.searchWorld(context, self.ctx, self.baritone.getBlockScanner(), new BlockOptionalMetaLookup(target), 64, known, blacklistSnapshot, []);
                    if (self.gettingTo !== target) {
                        return;
                    }
                    self.knownLocations = positions.filter((p) => !self.blacklist.some((b) => b.equals(p)));
                } finally {
                    self.rescanning = false;
                }
            })(),
        );
    }

    private createGoal(pos: BetterBlockPos): Goal {
        if (this.walkIntoInsteadOfAdjacent(this.gettingTo!.getBlock())) {
            return GoalTwoBlocks.of(pos);
        }
        if (this.blockOnTopMustBeRemoved(this.gettingTo!.getBlock()) && MovementHelper.isBlockNormalCube(this.ctx.bsi().get(pos.above()))) {
            return GoalBlock.of(pos.above());
        }
        return new GoalGetToBlock(pos);
    }

    private rightClick(): boolean {
        for (const pos of this.knownLocations!) {
            const r = reachable(this.ctx, pos, this.ctx.blockReachDistance());
            if (r) {
                this.baritone.getLookBehavior().updateTarget(r, true);
                const sel = this.ctx.getSelectedBlock();
                if (sel && this.knownLocations!.some((p) => p.equals(sel))) {
                    this.baritone.getInputOverrideHandler().setInputForceState(Input.CLICK_RIGHT, true);
                    if (this.arrivalTickCount++ > 1) {
                        return true;
                    }
                }
                if (this.arrivalTickCount++ > 20) {
                    this.logDirect("Right click timed out");
                    return true;
                }
                return false;
            }
        }
        this.logDirect("Arrived but failed to right click open");
        return true;
    }

    private walkIntoInsteadOfAdjacent(block: string): boolean {
        if (!settings.enterPortal.value) {
            return false;
        }
        return block === "minecraft:portal";
    }

    private rightClickOnArrival(block: string): boolean {
        if (!settings.rightClickContainerOnArrival.value) {
            return false;
        }
        return ["minecraft:crafting_table", "minecraft:furnace", "minecraft:lit_furnace", "minecraft:blast_furnace", "minecraft:ender_chest", "minecraft:chest", "minecraft:trapped_chest"].includes(block);
    }

    private blockOnTopMustBeRemoved(block: string): boolean {
        if (!this.rightClickOnArrival(block)) {
            return false;
        }
        return block === "minecraft:ender_chest" || block === "minecraft:chest" || block === "minecraft:trapped_chest";
    }
}
