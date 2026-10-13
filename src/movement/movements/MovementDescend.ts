import { settings } from "../../Settings";
import { BetterBlockPos, PosSet } from "../../utils/BetterBlockPos";
import { RotationUtils } from "../../utils/Rotation";
import type { BlockState } from "../../world/BlockState";
import { Blocks } from "../../world/Blocks";
import type { IBaritone } from "../../IBaritone";
import { CENTER_AFTER_FALL_COST, COST_INF, FALL_N_BLOCKS_COST, LADDER_DOWN_ONE_COST, WALK_OFF_BLOCK_COST, WALK_ONE_BLOCK_COST, WALK_ONE_OVER_SOUL_SAND_COST } from "../ActionCosts";
import type { CalculationContext } from "../CalculationContext";
import { Movement, MutableMoveResult } from "../Movement";
import { MovementHelper } from "../MovementHelper";
import { Input, MovementState, MovementStatus, MovementTarget } from "../MovementState";

export class MovementDescend extends Movement {
    private numTicks = 0;
    forceSafeMode_ = false;

    constructor(baritone: IBaritone | null, start: BetterBlockPos, end: BetterBlockPos) {
        super(baritone, start, end, [end.above(2), end.above(), end], end.below());
    }

    override reset(): void {
        super.reset();
        this.numTicks = 0;
        this.forceSafeMode_ = false;
    }

    forceSafeMode(): void {
        this.forceSafeMode_ = true;
    }

    calculateCost(context: CalculationContext): number {
        const result = new MutableMoveResult();
        MovementDescend.cost(context, this.src.x, this.src.y, this.src.z, this.dest.x, this.dest.z, result);
        if (result.y !== this.dest.y) {
            return COST_INF;
        }
        return result.cost;
    }

    protected calculateValidPositions(): PosSet {
        return new PosSet([this.src, this.dest.above(), this.dest]);
    }

    static cost(context: CalculationContext, x: number, y: number, z: number, destX: number, destZ: number, res: MutableMoveResult): void {
        let totalCost = 0;
        const destDown = context.get(destX, y - 1, destZ);
        totalCost += MovementHelper.getMiningDurationTicks(context, destX, y - 1, destZ, destDown, false);
        if (totalCost >= COST_INF) {
            return;
        }
        totalCost += MovementHelper.getMiningDurationTicks(context, destX, y, destZ, undefined, false);
        if (totalCost >= COST_INF) {
            return;
        }
        totalCost += MovementHelper.getMiningDurationTicks(context, destX, y + 1, destZ, undefined, true);
        if (totalCost >= COST_INF) {
            return;
        }

        const fromDown = context.get(x, y - 1, z);
        if (MovementHelper.isClimbable(fromDown)) {
            return;
        }

        const below = context.get(destX, y - 2, destZ);
        if (!MovementHelper.canWalkOn(context, destX, y - 2, destZ, below)) {
            MovementDescend.dynamicFallCost(context, x, y, z, destX, destZ, totalCost, below, res);
            return;
        }

        if (destDown.name === "ladder" || destDown.name === "vine") {
            return;
        }
        if (MovementHelper.canUseFrostWalker(context, destDown)) {
            return;
        }

        let walk = WALK_OFF_BLOCK_COST;
        if (Blocks.isSoulSand(fromDown)) {
            walk *= WALK_ONE_OVER_SOUL_SAND_COST / WALK_ONE_BLOCK_COST;
        }
        totalCost += walk + Math.max(FALL_N_BLOCKS_COST[1], CENTER_AFTER_FALL_COST);
        res.x = destX;
        res.y = y - 1;
        res.z = destZ;
        res.cost = totalCost;
    }

    static dynamicFallCost(context: CalculationContext, x: number, y: number, z: number, destX: number, destZ: number, frontBreak: number, below: BlockState, res: MutableMoveResult): boolean {
        if (frontBreak !== 0 && Blocks.isFalling(context.get(destX, y + 2, destZ))) {
            return false;
        }
        if (!MovementHelper.canWalkThrough(context, destX, y - 2, destZ, below)) {
            return false;
        }
        let costSoFar = 0;
        let effectiveStartHeight = y;
        for (let fallHeight = 3; ; fallHeight++) {
            const newY = y - fallHeight;
            if (newY < context.minY) {
                return false;
            }
            const reachedMinimum = fallHeight >= context.minFallHeight;
            const ontoBlock = context.get(destX, newY, destZ);
            const unprotectedFallHeight = fallHeight - (y - effectiveStartHeight);
            const tentativeCost = WALK_OFF_BLOCK_COST + FALL_N_BLOCKS_COST[unprotectedFallHeight] + frontBreak + costSoFar;
            if (reachedMinimum && MovementHelper.isWater(ontoBlock)) {
                if (!MovementHelper.canWalkThrough(context, destX, newY, destZ, ontoBlock)) {
                    return false;
                }
                if (context.assumeWalkOnWater) {
                    return false;
                }
                if (MovementHelper.isFlowing(destX, newY, destZ, ontoBlock, context.bsi)) {
                    return false;
                }
                if (!MovementHelper.canWalkOn(context, destX, newY - 1, destZ)) {
                    return false;
                }
                res.x = destX;
                res.y = newY;
                res.z = destZ;
                res.cost = tentativeCost;
                return false;
            }
            if (reachedMinimum && context.allowFallIntoLava && MovementHelper.isLava(ontoBlock)) {
                res.x = destX;
                res.y = newY;
                res.z = destZ;
                res.cost = tentativeCost;
                return false;
            }
            if (unprotectedFallHeight <= 11 && MovementHelper.isClimbable(ontoBlock)) {
                costSoFar += FALL_N_BLOCKS_COST[unprotectedFallHeight - 1];
                costSoFar += LADDER_DOWN_ONE_COST;
                effectiveStartHeight = newY;
                continue;
            }
            if (MovementHelper.canWalkThrough(context, destX, newY, destZ, ontoBlock)) {
                continue;
            }
            if (!MovementHelper.canWalkOn(context, destX, newY, destZ, ontoBlock)) {
                return false;
            }
            if (MovementHelper.isBottomSlab(ontoBlock)) {
                return false;
            }
            if (reachedMinimum && unprotectedFallHeight <= context.maxFallHeightNoWater + 1) {
                res.x = destX;
                res.y = newY + 1;
                res.z = destZ;
                res.cost = tentativeCost;
                return false;
            }
            if (reachedMinimum && context.hasWaterBucket && unprotectedFallHeight <= context.maxFallHeightBucket + 1) {
                res.x = destX;
                res.y = newY + 1;
                res.z = destZ;
                res.cost = tentativeCost + context.placeBucketCost();
                return true;
            } else {
                return false;
            }
        }
    }

    override updateState(state: MovementState): MovementState {
        super.updateState(state);
        if (state.getStatus() !== MovementStatus.RUNNING) {
            return state;
        }
        const ctx = this.ctx;
        const playerFeet = ctx.playerFeet();
        const fakeDest = new BetterBlockPos(this.dest.x * 2 - this.src.x, this.dest.y, this.dest.z * 2 - this.src.z);
        if ((playerFeet.equals(this.dest) || playerFeet.equals(fakeDest)) && (MovementHelper.isLiquidCtx(ctx, this.dest) || ctx.player().position().y - this.dest.y < 0.5)) {
            return state.setStatus(MovementStatus.SUCCESS);
        }
        if (!MovementHelper.openDoors(ctx, state, this.src, this.dest.above())) {
            return state;
        }
        if (this.safeMode()) {
            const destX = (this.src.x + 0.5) * 0.17 + (this.dest.x + 0.5) * 0.83;
            const destZ = (this.src.z + 0.5) * 0.17 + (this.dest.z + 0.5) * 0.83;
            state
                .setTarget(new MovementTarget(RotationUtils.calcRotationFromVec3d(ctx.playerHead(), { x: destX, y: this.dest.y, z: destZ }, ctx.playerRotations()).withPitch(ctx.playerRotations().pitch), false))
                .setInput(Input.MOVE_FORWARD, true);
            return state;
        }
        const pos = ctx.player().position();
        const diffX = pos.x - (this.dest.x + 0.5);
        const diffZ = pos.z - (this.dest.z + 0.5);
        const ab = Math.sqrt(diffX * diffX + diffZ * diffZ);
        const x = pos.x - (this.src.x + 0.5);
        const z = pos.z - (this.src.z + 0.5);
        const fromStart = Math.sqrt(x * x + z * z);
        state.setInput(Input.SNEAK, settings.allowWalkOnMagmaBlocks.value && Blocks.isMagma(ctx.bsi().get(BetterBlockPos.of(pos).below())));
        if (!playerFeet.equals(this.dest) || ab > 0.25) {
            if (this.numTicks++ < 20 && fromStart < 1.25) {
                MovementHelper.moveTowards(ctx, state, fakeDest);
            } else {
                MovementHelper.moveTowards(ctx, state, this.dest);
            }
        }
        return state;
    }

    safeMode(): boolean {
        if (this.forceSafeMode_) {
            return true;
        }
        const into = this.dest.subtract(this.src.below()).offset(this.dest);
        if (this.skipToAscend()) {
            return true;
        }
        const bsi = this.ctx.bsi();
        for (let y = 0; y <= 2; y++) {
            if (MovementHelper.avoidWalkingInto(bsi.get(into.above(y)))) {
                return true;
            }
        }
        return false;
    }

    skipToAscend(): boolean {
        const into = this.dest.subtract(this.src.below()).offset(this.dest);
        return !MovementHelper.canWalkThroughCtx(this.ctx, into) && MovementHelper.canWalkThroughCtx(this.ctx, into.above()) && MovementHelper.canWalkThroughCtx(this.ctx, into.above(2));
    }
}
