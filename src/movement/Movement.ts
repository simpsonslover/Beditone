import { settings } from "../Settings";
import { BetterBlockPos, blockCenter, PosSet } from "../utils/BetterBlockPos";
import type { IPlayerContext } from "../utils/IPlayerContext";
import { RotationUtils } from "../utils/Rotation";
import type { BlockStateInterface } from "../world/BlockStateInterface";
import type { IBaritone } from "../IBaritone";
import type { CalculationContext } from "./CalculationContext";
import { MovementHelper } from "./MovementHelper";
import { Input, isComplete, MovementState, MovementStatus, MovementTarget } from "./MovementState";
import { reachable } from "../utils/Reachability";

export { HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP } from "./MovementHelper";

export class MutableMoveResult {
    x = 0;
    y = 0;
    z = 0;
    cost = 1000000;

    reset(): void {
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.cost = 1000000;
    }
}

export abstract class Movement {
    protected readonly baritone: IBaritone;
    protected readonly ctx: IPlayerContext;
    private currentState = new MovementState().setStatus(MovementStatus.PREPPING);
    protected readonly src: BetterBlockPos;
    protected readonly dest: BetterBlockPos;
    protected readonly positionsToBreak: BetterBlockPos[];
    protected readonly positionToPlace: BetterBlockPos | null;
    private cost: number | null = null;
    toBreakCached: BetterBlockPos[] | null = null;
    toPlaceCached: BetterBlockPos[] | null = null;
    toWalkIntoCached: BetterBlockPos[] | null = null;
    private validPositionsCached: PosSet | null = null;
    private calculatedWhileLoaded_ = false;

    protected constructor(baritone: IBaritone | null, src: BetterBlockPos, dest: BetterBlockPos, toBreak: BetterBlockPos[], toPlace: BetterBlockPos | null = null) {
        this.baritone = baritone as IBaritone;
        this.ctx = baritone ? baritone.getPlayerContext() : (null as unknown as IPlayerContext);
        this.src = src;
        this.dest = dest;
        this.positionsToBreak = toBreak;
        this.positionToPlace = toPlace;
    }

    getCost(): number;
    getCost(context: CalculationContext): number;
    getCost(context?: CalculationContext): number {
        if (this.cost === null) {
            if (!context) throw new Error("cost not calculated yet");
            this.cost = this.calculateCost(context);
        }
        return this.cost;
    }

    abstract calculateCost(context: CalculationContext): number;

    recalculateCost(context: CalculationContext): number {
        this.cost = null;
        return this.getCost(context);
    }

    override(cost: number): void {
        this.cost = cost;
    }

    protected abstract calculateValidPositions(): PosSet;

    getValidPositions(): PosSet {
        if (this.validPositionsCached === null) {
            this.validPositionsCached = this.calculateValidPositions();
        }
        return this.validPositionsCached;
    }

    protected playerInValidPosition(): boolean {
        return this.getValidPositions().has(this.ctx.playerFeet()) || this.getValidPositions().has(this.baritone.getPathingBehavior().pathStart());
    }

    update(): MovementStatus {
        const ctx = this.ctx;
        this.currentState = this.updateState(this.currentState);
        if (MovementHelper.isLiquidCtx(ctx, ctx.playerFeet()) || ctx.player().isInWater()) {
            if (this.shouldSwim()) {
                this.currentState.setInput(Input.SPRINT, true);
                ctx.player().setSprinting(true);
                if (this.currentState.getStatus() === MovementStatus.RUNNING && ctx.player().isSwimming() && !ctx.player().onGround()) {
                    this.holdWaterline();
                } else if (!ctx.player().isSwimming() && ctx.player().onGround() && ctx.player().position().y < this.dest.y + 0.6) {
                    this.currentState.setInput(Input.JUMP, true);
                }
            } else {
                if (settings.allowSwimming.value && ctx.player().isSwimming()) {
                    this.currentState.setInput(Input.SPRINT, false);
                    ctx.player().setSprinting(false);
                }
                if (ctx.player().position().y < this.dest.y + 0.6) {
                    this.currentState.setInput(Input.JUMP, true);
                }
            }
        }
        if (ctx.player().isInWall()) {
            const sel = ctx.getSelectedBlock();
            if (sel) MovementHelper.switchToBestToolFor(ctx, ctx.bsi().get(sel));
            this.currentState.setInput(Input.CLICK_LEFT, true);
        }
        const rotation = this.currentState.getTarget().getRotation();
        if (rotation) {
            this.baritone.getLookBehavior().updateTarget(rotation, this.currentState.getTarget().hasToForceRotations());
        }
        this.baritone.getInputOverrideHandler().clearAllKeys();
        this.currentState.getInputStates().forEach((forced, input) => {
            this.baritone.getInputOverrideHandler().setInputForceState(input, forced);
        });
        this.currentState.getInputStates().clear();
        if (isComplete(this.currentState.getStatus())) {
            this.baritone.getInputOverrideHandler().clearAllKeys();
        }
        return this.currentState.getStatus();
    }

    private shouldSwim(): boolean {
        const p = this.ctx.player();
        if (!settings.allowSwimming.value || !p.isInWater() || !settings.allowSprint.value || p.foodLevel() <= 6) {
            return false;
        }
        if (this.currentState.getStatus() === MovementStatus.PREPPING) {
            return false;
        }
        if (!p.onGround()) {
            return true;
        }
        const air = p.airSupply();
        if (p.isUnderWater()) {
            return air >= 100;
        }
        return p.isSwimming() || air >= p.maxAirSupply();
    }

    private holdWaterline(): void {
        const feetY = this.ctx.player().position().y;
        const target = this.currentState.getTarget().getRotation();
        if (!target) return;
        const pitch = feetY < this.dest.y + 0.3 ? -20 : 0;
        this.currentState.setTarget(new MovementTarget(target.withPitch(pitch === this.ctx.playerRotations().pitch ? pitch + 0.0001 : pitch), false));
        this.currentState.setInput(Input.JUMP, true);
    }

    protected prepared(state: MovementState): boolean {
        if (state.getStatus() === MovementStatus.WAITING) {
            return true;
        }
        const ctx = this.ctx;
        let somethingInTheWay = false;
        for (const blockPos of this.positionsToBreak) {
            if (settings.pauseMiningForFallingBlocks.value && ctx.entities().some((e) => e.typeId === "minecraft:falling_block" && Math.floor(e.position.x) === blockPos.x && Math.floor(e.position.z) === blockPos.z && e.position.y >= blockPos.y && e.position.y < blockPos.y + 1.1)) {
                return false;
            }
            if (!MovementHelper.canWalkThroughCtx(ctx, blockPos)) {
                somethingInTheWay = true;
                MovementHelper.switchToBestToolFor(ctx, ctx.bsi().get(blockPos));
                const reach = reachable(ctx, blockPos, ctx.blockReachDistance());
                if (reach) {
                    state.setTarget(new MovementTarget(reach, true));
                    if (ctx.isLookingAt(blockPos) || ctx.playerRotations().isReallyCloseTo(reach)) {
                        state.setInput(Input.CLICK_LEFT, true);
                    }
                    return false;
                }
                state.setTarget(new MovementTarget(RotationUtils.calcRotationFromVec3d(ctx.playerHead(), blockCenter(blockPos), ctx.playerRotations()), true));
                state.setInput(Input.CLICK_LEFT, true);
                return false;
            }
        }
        if (somethingInTheWay) {
            state.setStatus(MovementStatus.UNREACHABLE);
            return true;
        }
        return true;
    }

    safeToCancel(): boolean {
        return this.safeToCancelState(this.currentState);
    }

    protected safeToCancelState(_currentState: MovementState): boolean {
        return true;
    }

    getSrc(): BetterBlockPos {
        return this.src;
    }

    getDest(): BetterBlockPos {
        return this.dest;
    }

    reset(): void {
        this.currentState = new MovementState().setStatus(MovementStatus.PREPPING);
    }

    updateState(state: MovementState): MovementState {
        if (!this.prepared(state)) {
            return state.setStatus(MovementStatus.PREPPING);
        } else if (state.getStatus() === MovementStatus.PREPPING) {
            state.setStatus(MovementStatus.WAITING);
        }
        if (state.getStatus() === MovementStatus.WAITING) {
            state.setStatus(MovementStatus.RUNNING);
        }
        return state;
    }

    getDirection(): BetterBlockPos {
        return this.dest.subtract(this.src);
    }

    checkLoadedChunk(context: CalculationContext): void {
        this.calculatedWhileLoaded_ = context.bsi.worldContainsLoadedChunk(this.dest.x, this.dest.z);
    }

    calculatedWhileLoaded(): boolean {
        return this.calculatedWhileLoaded_;
    }

    resetBlockCache(): void {
        this.toBreakCached = null;
        this.toPlaceCached = null;
        this.toWalkIntoCached = null;
    }

    toBreak(bsi: BlockStateInterface): BetterBlockPos[] {
        if (this.toBreakCached !== null) {
            return this.toBreakCached;
        }
        const result: BetterBlockPos[] = [];
        for (const p of this.positionsToBreak) {
            if (!MovementHelper.canWalkThroughBsi(bsi, p.x, p.y, p.z)) {
                result.push(p);
            }
        }
        this.toBreakCached = result;
        return result;
    }

    toPlace(bsi: BlockStateInterface): BetterBlockPos[] {
        if (this.toPlaceCached !== null) {
            return this.toPlaceCached;
        }
        const result: BetterBlockPos[] = [];
        const p = this.positionToPlace;
        if (p !== null && !MovementHelper.canWalkOnBsi(bsi, p.x, p.y, p.z)) {
            result.push(p);
        }
        this.toPlaceCached = result;
        return result;
    }

    toWalkInto(_bsi: BlockStateInterface): BetterBlockPos[] {
        if (this.toWalkIntoCached === null) {
            this.toWalkIntoCached = [];
        }
        return this.toWalkIntoCached;
    }

    toBreakAll(): BetterBlockPos[] {
        return this.positionsToBreak;
    }

    toString(): string {
        return `${this.constructor.name}{${this.src.x},${this.src.y},${this.src.z} -> ${this.dest.x},${this.dest.y},${this.dest.z}}`;
    }
}
