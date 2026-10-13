import { settings } from "../../Settings";
import { BetterBlockPos, HORIZONTALS_2D, PosSet } from "../../utils/BetterBlockPos";
import { Blocks } from "../../world/Blocks";
import type { IBaritone } from "../../IBaritone";
import { COST_INF, JUMP_ONE_BLOCK_COST, SNEAK_ONE_BLOCK_COST, WALK_ONE_BLOCK_COST, WALK_ONE_OVER_SOUL_SAND_COST } from "../ActionCosts";
import type { CalculationContext } from "../CalculationContext";
import { Movement, HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP } from "../Movement";
import { MovementHelper, PlaceResult } from "../MovementHelper";
import { Input, MovementState, MovementStatus } from "../MovementState";

export class MovementAscend extends Movement {
    private ticksWithoutPlacement = 0;

    constructor(baritone: IBaritone | null, src: BetterBlockPos, dest: BetterBlockPos) {
        super(baritone, src, dest, [dest, src.above(2), dest.above()], dest.below());
    }

    override reset(): void {
        super.reset();
        this.ticksWithoutPlacement = 0;
    }

    calculateCost(context: CalculationContext): number {
        return MovementAscend.cost(context, this.src.x, this.src.y, this.src.z, this.dest.x, this.dest.z);
    }

    protected calculateValidPositions(): PosSet {
        const prior = this.src.subtract(this.getDirection()).above();
        return new PosSet([this.src, this.src.above(), this.dest, prior, prior.above()]);
    }

    static cost(context: CalculationContext, x: number, y: number, z: number, destX: number, destZ: number): number {
        const toPlace = context.get(destX, y, destZ);
        let additionalPlacementCost = 0;
        if (!MovementHelper.canWalkOn(context, destX, y, destZ, toPlace)) {
            additionalPlacementCost = context.costOfPlacingAt(destX, y, destZ, toPlace);
            if (additionalPlacementCost >= COST_INF) {
                return COST_INF;
            }
            if (!MovementHelper.isReplaceable(destX, y, destZ, toPlace, context.bsi)) {
                return COST_INF;
            }
            let foundPlaceOption = false;
            for (let i = 0; i < 5; i++) {
                const d = HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP[i];
                const againstX = destX + d.x;
                const againstY = y + d.y;
                const againstZ = destZ + d.z;
                if (againstX === x && againstZ === z) {
                    continue;
                }
                if (MovementHelper.canPlaceAgainst(context, againstX, againstY, againstZ)) {
                    foundPlaceOption = true;
                    break;
                }
            }
            if (!foundPlaceOption) {
                return COST_INF;
            }
        }
        const srcUp2 = context.get(x, y + 2, z);
        if (Blocks.isFalling(context.get(x, y + 3, z)) && (MovementHelper.canWalkThrough(context, x, y + 1, z) || !Blocks.isFalling(srcUp2))) {
            return COST_INF;
        }
        const srcDown = context.get(x, y - 1, z);
        if (MovementHelper.isClimbable(srcDown)) {
            return COST_INF;
        }
        const jumpingFromBottomSlab = MovementHelper.isBottomSlab(srcDown);
        const jumpingToBottomSlab = MovementHelper.isBottomSlab(toPlace);
        if (jumpingFromBottomSlab && !jumpingToBottomSlab) {
            return COST_INF;
        }
        let walk: number;
        if (jumpingToBottomSlab) {
            if (jumpingFromBottomSlab) {
                walk = Math.max(JUMP_ONE_BLOCK_COST, WALK_ONE_BLOCK_COST);
                walk += context.jumpPenalty;
            } else {
                walk = WALK_ONE_BLOCK_COST;
            }
        } else {
            if (Blocks.isSoulSand(toPlace)) {
                walk = WALK_ONE_OVER_SOUL_SAND_COST;
            } else if (Blocks.isMagma(toPlace)) {
                walk = SNEAK_ONE_BLOCK_COST;
            } else {
                walk = Math.max(JUMP_ONE_BLOCK_COST, WALK_ONE_BLOCK_COST);
            }
            walk += context.jumpPenalty;
        }

        let totalCost = walk + additionalPlacementCost;
        totalCost += MovementHelper.getMiningDurationTicks(context, x, y + 2, z, srcUp2, false);
        if (totalCost >= COST_INF) {
            return COST_INF;
        }
        totalCost += MovementHelper.getMiningDurationTicks(context, destX, y + 1, destZ, undefined, false);
        if (totalCost >= COST_INF) {
            return COST_INF;
        }
        totalCost += MovementHelper.getMiningDurationTicks(context, destX, y + 2, destZ, undefined, true);
        return totalCost;
    }

    override updateState(state: MovementState): MovementState {
        const ctx = this.ctx;
        if (ctx.playerFeet().y < this.src.y) {
            return state.setStatus(MovementStatus.UNREACHABLE);
        }
        super.updateState(state);
        if (state.getStatus() !== MovementStatus.RUNNING) {
            return state;
        }

        const dir = this.getDirection();
        if (ctx.playerFeet().equals(this.dest) || ctx.playerFeet().equals(this.dest.offset(dir.below()))) {
            return state.setStatus(MovementStatus.SUCCESS);
        }

        if (!MovementHelper.openDoors(ctx, state, this.src.above(), this.dest)) {
            return state;
        }

        const bsi = ctx.bsi();
        const jumpingOnto = bsi.get(this.positionToPlace!);
        if (!MovementHelper.canWalkOnCtx(ctx, this.positionToPlace!, jumpingOnto)) {
            this.ticksWithoutPlacement++;
            if (MovementHelper.attemptToPlaceABlock(state, this.baritone, this.dest.below(), false, true) === PlaceResult.READY_TO_PLACE) {
                state.setInput(Input.SNEAK, true);
                if (ctx.player().isCrouching()) {
                    state.setInput(Input.CLICK_RIGHT, true);
                }
            }
            if (this.ticksWithoutPlacement > 10) {
                state.setInput(Input.MOVE_BACK, true);
            }

            return state;
        }
        MovementHelper.moveTowards(ctx, state, this.dest);
        state.setInput(Input.SNEAK, settings.allowWalkOnMagmaBlocks.value && Blocks.isMagma(jumpingOnto));
        if (MovementHelper.isBottomSlab(jumpingOnto) && !MovementHelper.isBottomSlab(bsi.get(this.src.below()))) {
            return state;
        }

        if (settings.assumeStep.value || ctx.playerFeet().equals(this.src.above())) {
            return state;
        }

        const xAxis = Math.abs(this.src.x - this.dest.x);
        const zAxis = Math.abs(this.src.z - this.dest.z);
        const pos = ctx.player().position();
        const flatDistToNext = xAxis * Math.abs(this.dest.x + 0.5 - pos.x) + zAxis * Math.abs(this.dest.z + 0.5 - pos.z);
        const sideDist = zAxis * Math.abs(this.dest.x + 0.5 - pos.x) + xAxis * Math.abs(this.dest.z + 0.5 - pos.z);

        const motion = ctx.player().deltaMovement();
        const lateralMotion = xAxis * motion.z + zAxis * motion.x;
        if (Math.abs(lateralMotion) > 0.1) {
            return state;
        }

        if (this.headBonkClear()) {
            return state.setInput(Input.JUMP, true);
        }

        if (flatDistToNext > 1.2 || sideDist > 0.2) {
            return state;
        }

        return state.setInput(Input.JUMP, true);
    }

    headBonkClear(): boolean {
        const startUp = this.src.above(2);
        for (let i = 0; i < 4; i++) {
            const check = startUp.relative(HORIZONTALS_2D[i]);
            if (!MovementHelper.canWalkThroughCtx(this.ctx, check)) {
                return false;
            }
        }
        return true;
    }

    protected override safeToCancelState(state: MovementState): boolean {
        return state.getStatus() !== MovementStatus.RUNNING || this.ticksWithoutPlacement === 0;
    }
}
