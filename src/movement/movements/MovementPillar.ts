import { BetterBlockPos, blockCenter, PosSet } from "../../utils/BetterBlockPos";
import { RotationUtils } from "../../utils/Rotation";
import { Blocks } from "../../world/Blocks";
import type { IBaritone } from "../../IBaritone";
import { COST_INF, JUMP_ONE_BLOCK_COST, LADDER_UP_ONE_COST } from "../ActionCosts";
import type { CalculationContext } from "../CalculationContext";
import { Movement } from "../Movement";
import { canBeReplaced, MovementHelper } from "../MovementHelper";
import { Input, MovementState, MovementStatus, MovementTarget } from "../MovementState";
import { reachable } from "../../utils/Reachability";

export class MovementPillar extends Movement {
    constructor(baritone: IBaritone | null, start: BetterBlockPos, end: BetterBlockPos) {
        super(baritone, start, end, [start.above(2)], start);
    }

    calculateCost(context: CalculationContext): number {
        return MovementPillar.cost(context, this.src.x, this.src.y, this.src.z);
    }

    protected calculateValidPositions(): PosSet {
        return new PosSet([this.src, this.dest]);
    }

    static cost(context: CalculationContext, x: number, y: number, z: number): number {
        const fromState = context.get(x, y, z);
        const ladder = MovementHelper.isClimbable(fromState);
        const fromDown = context.get(x, y - 1, z);
        if (!ladder) {
            if (MovementHelper.isClimbable(fromDown)) {
                return COST_INF;
            }
            if (Blocks.isBottomSlab(fromDown)) {
                return COST_INF;
            }
        }
        const toBreak = context.get(x, y + 2, z);
        if (Blocks.isFenceGate(toBreak)) {
            return COST_INF;
        }
        let srcUp = null;
        if (MovementHelper.isWater(toBreak) && MovementHelper.isWater(fromState)) {
            srcUp = context.get(x, y + 1, z);
            if (MovementHelper.isWater(srcUp)) {
                return LADDER_UP_ONE_COST;
            }
        }
        let placeCost = 0;
        if (!ladder) {
            placeCost = context.costOfPlacingAt(x, y, z, fromState);
            if (placeCost >= COST_INF) {
                return COST_INF;
            }
            if (Blocks.isAir(fromDown)) {
                placeCost += 0.1;
            }
        }
        if ((MovementHelper.isLiquid(fromState) && !MovementHelper.canPlaceAgainst(context, x, y - 1, z, fromDown)) || (MovementHelper.isLiquid(fromDown) && context.assumeWalkOnWater)) {
            return COST_INF;
        }
        if ((Blocks.isLilyPad(fromState) || Blocks.isCarpet(fromState)) && fromDown.hasFluid()) {
            return COST_INF;
        }
        let hardness = MovementHelper.getMiningDurationTicks(context, x, y + 2, z, toBreak, true);
        if (hardness >= COST_INF) {
            return COST_INF;
        }
        if (hardness !== 0) {
            if (MovementHelper.isClimbable(toBreak)) {
                hardness = 0;
            } else {
                const check = context.get(x, y + 3, z);
                if (Blocks.isFalling(check)) {
                    if (srcUp === null) {
                        srcUp = context.get(x, y + 1, z);
                    }
                    if (!Blocks.isFalling(toBreak) || !Blocks.isFalling(srcUp)) {
                        return COST_INF;
                    }
                }
            }
        }
        if (ladder) {
            return LADDER_UP_ONE_COST + hardness * 5;
        } else {
            return JUMP_ONE_BLOCK_COST + placeCost + context.jumpPenalty + hardness;
        }
    }

    override updateState(state: MovementState): MovementState {
        super.updateState(state);
        if (state.getStatus() !== MovementStatus.RUNNING) {
            return state;
        }
        const ctx = this.ctx;
        const src = this.src;
        const dest = this.dest;
        if (ctx.playerFeet().y < src.y) {
            return state.setStatus(MovementStatus.UNREACHABLE);
        }

        const bsi = ctx.bsi();
        const fromDown = bsi.get(src);
        if (MovementHelper.isWater(fromDown) && MovementHelper.isWaterCtx(ctx, dest)) {
            state.setTarget(new MovementTarget(RotationUtils.calcRotationFromVec3d(ctx.playerHead(), blockCenter(dest), ctx.playerRotations()), false));
            const destCenter = blockCenter(dest);
            const pos = ctx.player().position();
            if (Math.abs(pos.x - destCenter.x) > 0.2 || Math.abs(pos.z - destCenter.z) > 0.2) {
                state.setInput(Input.MOVE_FORWARD, true);
            }
            if (ctx.playerFeet().equals(dest)) {
                return state.setStatus(MovementStatus.SUCCESS);
            }
            return state;
        }
        const ladder = MovementHelper.isClimbable(fromDown);
        const rotation = RotationUtils.calcRotationFromVec3d(ctx.playerHead(), blockCenter(this.positionToPlace!), ctx.playerRotations());
        if (!ladder) {
            state.setTarget(new MovementTarget(ctx.playerRotations().withPitch(rotation.pitch), true));
        }

        let blockIsThere = MovementHelper.canWalkOnCtx(ctx, src) || ladder;
        if (ladder) {
            if (ctx.playerFeet().equals(dest)) {
                return state.setStatus(MovementStatus.SUCCESS);
            }
            MovementHelper.moveTowards(ctx, state, dest);
            state.setInput(Input.JUMP, true);
            return state;
        } else {
            if (!this.baritone.getInventoryBehavior().selectThrowawayForLocation(true, src.x, src.y, src.z)) {
                return state.setStatus(MovementStatus.UNREACHABLE);
            }

            state.setInput(Input.SNEAK, true);

            const pos = ctx.player().position();
            const motion = ctx.player().deltaMovement();
            const diffX = pos.x - (dest.x + 0.5);
            const diffZ = pos.z - (dest.z + 0.5);
            const dist = Math.sqrt(diffX * diffX + diffZ * diffZ);
            const flatMotion = Math.sqrt(motion.x * motion.x + motion.z * motion.z);
            if (dist > 0.17) {
                state.setInput(Input.MOVE_FORWARD, true);

                state.setTarget(new MovementTarget(rotation, true));
            } else if (flatMotion < 0.05) {
                state.setInput(Input.JUMP, pos.y < dest.y);
            }

            if (!blockIsThere) {
                const frState = bsi.get(src);
                if (!(Blocks.isAir(frState) || canBeReplaced(frState))) {
                    const rot = reachable(ctx, src, ctx.blockReachDistance());
                    if (rot) state.setTarget(new MovementTarget(rot, true));
                    state.setInput(Input.JUMP, false);
                    state.setInput(Input.CLICK_LEFT, true);
                    blockIsThere = false;
                } else if (ctx.player().isCrouching() && (ctx.isLookingAt(src.below()) || ctx.isLookingAt(src)) && pos.y > dest.y + 0.1) {
                    state.setInput(Input.CLICK_RIGHT, true);
                }
            }
        }

        if (ctx.playerFeet().equals(dest) && blockIsThere) {
            return state.setStatus(MovementStatus.SUCCESS);
        }

        return state;
    }

    protected override prepared(state: MovementState): boolean {
        const ctx = this.ctx;
        if (ctx.playerFeet().equals(this.src) || ctx.playerFeet().equals(this.src.below())) {
            const block = ctx.bsi().get(this.src.below());
            if (MovementHelper.isClimbable(block)) {
                state.setInput(Input.SNEAK, true);
            }
        }
        if (MovementHelper.isWaterCtx(ctx, this.dest.above())) {
            return true;
        }
        return super.prepared(state);
    }
}
