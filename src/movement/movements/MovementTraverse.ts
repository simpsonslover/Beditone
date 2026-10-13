import { settings } from "../../Settings";
import { BetterBlockPos, blockCenter, PosSet } from "../../utils/BetterBlockPos";
import { Rotation, RotationUtils } from "../../utils/Rotation";
import { Blocks } from "../../world/Blocks";
import type { IBaritone } from "../../IBaritone";
import { COST_INF, SNEAK_ONE_BLOCK_COST, SPRINT_MULTIPLIER, WALK_ONE_BLOCK_COST, WALK_ONE_OVER_SOUL_SAND_COST } from "../ActionCosts";
import type { CalculationContext } from "../CalculationContext";
import { Movement, HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP } from "../Movement";
import { MovementHelper, PlaceResult } from "../MovementHelper";
import { Input, MovementState, MovementStatus, MovementTarget } from "../MovementState";
import { reachable, calculateBlockCenter } from "../../utils/Reachability";

export class MovementTraverse extends Movement {
    private wasTheBridgeBlockAlwaysThere = true;

    constructor(baritone: IBaritone | null, from: BetterBlockPos, to: BetterBlockPos) {
        super(baritone, from, to, [to.above(), to], to.below());
    }

    override reset(): void {
        super.reset();
        this.wasTheBridgeBlockAlwaysThere = true;
    }

    calculateCost(context: CalculationContext): number {
        return MovementTraverse.cost(context, this.src.x, this.src.y, this.src.z, this.dest.x, this.dest.z);
    }

    protected calculateValidPositions(): PosSet {
        return new PosSet([this.src, this.dest]);
    }

    static cost(context: CalculationContext, x: number, y: number, z: number, destX: number, destZ: number): number {
        const pb0 = context.get(destX, y + 1, destZ);
        const pb1 = context.get(destX, y, destZ);
        const destOn = context.get(destX, y - 1, destZ);
        const srcDown = context.get(x, y - 1, z);
        const standingOnABlock = MovementHelper.mustBeSolidToWalkOn(context, x, y - 1, z, srcDown);
        const frostWalker = standingOnABlock && !context.assumeWalkOnWater && MovementHelper.canUseFrostWalker(context, destOn);
        if (frostWalker || MovementHelper.canWalkOn(context, destX, y - 1, destZ, destOn)) {
            let WC = WALK_ONE_BLOCK_COST;
            let water = false;
            let sneaking = false;
            if (MovementHelper.isWater(pb0) || MovementHelper.isWater(pb1)) {
                WC = context.waterWalkSpeed;
                water = true;
            } else {
                if (Blocks.isSoulSand(destOn)) {
                    WC += (WALK_ONE_OVER_SOUL_SAND_COST - WALK_ONE_BLOCK_COST) / 2;
                } else if (frostWalker) {
                } else if (destOn.name === "water") {
                    WC += context.walkOnWaterOnePenalty;
                }
                if (Blocks.isSoulSand(srcDown)) {
                    WC += (WALK_ONE_OVER_SOUL_SAND_COST - WALK_ONE_BLOCK_COST) / 2;
                } else if (context.allowWalkOnMagmaBlocks && Blocks.isMagma(srcDown)) {
                    sneaking = true;
                    WC += (SNEAK_ONE_BLOCK_COST - WALK_ONE_BLOCK_COST) / 2;
                }
            }
            let hardness1 = MovementHelper.getMiningDurationTicks(context, destX, y, destZ, pb1, false);
            if (hardness1 >= COST_INF) {
                return COST_INF;
            }
            let hardness2 = MovementHelper.getMiningDurationTicks(context, destX, y + 1, destZ, pb0, true);
            if (hardness1 === 0 && hardness2 === 0) {
                if (!water && !sneaking && context.canSprint) {
                    WC *= SPRINT_MULTIPLIER;
                }
                return WC;
            }
            if (MovementHelper.isClimbable(srcDown)) {
                hardness1 *= 5;
                hardness2 *= 5;
            }
            return WC + hardness1 + hardness2;
        } else {
            if (MovementHelper.isClimbable(srcDown)) {
                return COST_INF;
            }
            if (MovementHelper.isReplaceable(destX, y - 1, destZ, destOn, context.bsi)) {
                const throughWater = MovementHelper.isWater(pb0) || MovementHelper.isWater(pb1);
                if (MovementHelper.isWater(destOn) && throughWater) {
                    return COST_INF;
                }
                const placeCost = context.costOfPlacingAt(destX, y - 1, destZ, destOn);
                if (placeCost >= COST_INF) {
                    return COST_INF;
                }
                const hardness1 = MovementHelper.getMiningDurationTicks(context, destX, y, destZ, pb1, false);
                if (hardness1 >= COST_INF) {
                    return COST_INF;
                }
                const hardness2 = MovementHelper.getMiningDurationTicks(context, destX, y + 1, destZ, pb0, true);
                let WC = throughWater ? context.waterWalkSpeed : WALK_ONE_BLOCK_COST;
                for (let i = 0; i < 5; i++) {
                    const d = HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP[i];
                    const againstX = destX + d.x;
                    const againstY = y - 1 + d.y;
                    const againstZ = destZ + d.z;
                    if (againstX === x && againstZ === z) {
                        continue;
                    }
                    if (MovementHelper.canPlaceAgainst(context, againstX, againstY, againstZ)) {
                        return WC + placeCost + hardness1 + hardness2;
                    }
                }
                if (Blocks.isSoulSand(srcDown) || (Blocks.isSlab(srcDown) && !Blocks.isDoubleSlab(srcDown))) {
                    return COST_INF;
                }
                if (!standingOnABlock) {
                    return COST_INF;
                }
                const blockSrc = context.get(x, y, z);
                if ((Blocks.isLilyPad(blockSrc) || Blocks.isCarpet(blockSrc)) && srcDown.hasFluid()) {
                    return COST_INF;
                }
                WC = WC * (SNEAK_ONE_BLOCK_COST / WALK_ONE_BLOCK_COST);
                return WC + placeCost + hardness1 + hardness2;
            }
            return COST_INF;
        }
    }

    override updateState(state: MovementState): MovementState {
        super.updateState(state);
        const ctx = this.ctx;
        const bsi = ctx.bsi();
        const pb0 = bsi.get(this.positionsToBreak[0]);
        const pb1 = bsi.get(this.positionsToBreak[1]);
        if (state.getStatus() !== MovementStatus.RUNNING) {
            if (!settings.walkWhileBreaking.value) {
                return state;
            }
            if (state.getStatus() !== MovementStatus.PREPPING) {
                return state;
            }
            if (MovementHelper.avoidWalkingInto(pb0)) {
                return state;
            }
            if (MovementHelper.avoidWalkingInto(pb1)) {
                return state;
            }
            const pos = ctx.player().position();
            const dist = Math.max(Math.abs(pos.x - (this.dest.x + 0.5)), Math.abs(pos.z - (this.dest.z + 0.5)));
            if (dist < 0.83) {
                return state;
            }
            const targetRot = state.getTarget().getRotation();
            if (!targetRot) {
                return state;
            }
            const yawToDest = RotationUtils.calcRotationFromVec3d(ctx.playerHead(), calculateBlockCenter(ctx, this.dest), ctx.playerRotations()).yaw;
            let pitchToBreak = targetRot.pitch;
            if (MovementHelper.isBlockNormalCube(pb0) || (Blocks.isAir(pb0) && (MovementHelper.isBlockNormalCube(pb1) || Blocks.isAir(pb1)))) {
                pitchToBreak = 26;
            }
            return state.setTarget(new MovementTarget(new Rotation(yawToDest, pitchToBreak), true)).setInput(Input.MOVE_FORWARD, true).setInput(Input.SPRINT, true);
        }

        state.setInput(Input.SNEAK, false);

        const fd = bsi.get(this.src.below());
        const ladder = MovementHelper.isClimbable(fd);

        if (settings.allowWalkOnMagmaBlocks.value && MovementHelper.steppingOnBlocks(ctx).some((b) => Blocks.isMagma(bsi.get(b)))) {
            state.setInput(Input.SNEAK, true);
        }

        if (!MovementHelper.openDoors(ctx, state, this.src, this.dest)) {
            return state;
        }

        if (Blocks.isFenceGate(pb0) || Blocks.isFenceGate(pb1)) {
            const blocked = !MovementHelper.isGatePassable(ctx, this.positionsToBreak[0], this.src.above())
                ? this.positionsToBreak[0]
                : !MovementHelper.isGatePassable(ctx, this.positionsToBreak[1], this.src)
                  ? this.positionsToBreak[1]
                  : null;
            if (blocked !== null) {
                const rotation = reachable(ctx, blocked);
                if (rotation) {
                    return state.setTarget(new MovementTarget(rotation, true)).setInput(Input.CLICK_RIGHT, true);
                }
            }
        }

        const isTheBridgeBlockThere = MovementHelper.canWalkOnCtx(ctx, this.positionToPlace!) || ladder || MovementHelper.canUseFrostWalkerCtx(ctx, this.positionToPlace!);
        const feet = ctx.playerFeet();
        if (feet.y !== this.dest.y && !ladder) {
            this.baritone.logDebug("Wrong Y coordinate");
            if (feet.y < this.dest.y) {
                return state.setInput(Input.JUMP, true);
            }
            return state;
        }

        if (isTheBridgeBlockThere) {
            if (feet.equals(this.dest)) {
                return state.setStatus(MovementStatus.SUCCESS);
            }
            const dir = this.getDirection();
            if (settings.overshootTraverse.value && (feet.equals(this.dest.offset(dir)) || feet.equals(this.dest.offset(dir).offset(dir)))) {
                return state.setStatus(MovementStatus.SUCCESS);
            }
            const low = bsi.get(this.src);
            const high = bsi.get(this.src.above());
            if (ctx.player().position().y > this.src.y + 0.1 && !ctx.player().onGround() && (MovementHelper.isClimbable(low) || MovementHelper.isClimbable(high))) {
                return state;
            }
            const into = this.dest.subtract(this.src).offset(this.dest);
            const intoBelow = bsi.get(into);
            const intoAbove = bsi.get(into.above());
            if (
                this.wasTheBridgeBlockAlwaysThere &&
                (!MovementHelper.isLiquidCtx(ctx, feet) || settings.sprintInWater.value) &&
                (!MovementHelper.avoidWalkingInto(intoBelow) || MovementHelper.isWater(intoBelow)) &&
                !MovementHelper.avoidWalkingInto(intoAbove)
            ) {
                state.setInput(Input.SPRINT, true);
            }

            const destDown = bsi.get(this.dest.below());
            if (feet.y !== this.dest.y && ladder && MovementHelper.isClimbable(destDown)) {
                state.setInput(Input.JUMP, true);
            }
            MovementHelper.moveTowards(ctx, state, this.positionsToBreak[0]);
            return state;
        } else {
            this.wasTheBridgeBlockAlwaysThere = false;
            const standingOn = bsi.get(feet.below());
            if (Blocks.isSoulSand(standingOn) || Blocks.isSlab(standingOn)) {
                const pos = ctx.player().position();
                const dist = Math.max(Math.abs(this.dest.x + 0.5 - pos.x), Math.abs(this.dest.z + 0.5 - pos.z));
                if (dist < 0.85) {
                    MovementHelper.moveTowards(ctx, state, this.dest);
                    return state.setInput(Input.MOVE_FORWARD, false).setInput(Input.MOVE_BACK, true);
                }
            }
            const pos = ctx.player().position();
            const dist1 = Math.max(Math.abs(pos.x - (this.dest.x + 0.5)), Math.abs(pos.z - (this.dest.z + 0.5)));
            const p = MovementHelper.attemptToPlaceABlock(state, this.baritone, this.dest.below(), false, !settings.assumeSafeWalk.value);
            if ((p === PlaceResult.READY_TO_PLACE || dist1 < 0.6) && !settings.assumeSafeWalk.value) {
                state.setInput(Input.SNEAK, true);
            }
            switch (p) {
                case PlaceResult.READY_TO_PLACE: {
                    if (ctx.player().isCrouching() || settings.assumeSafeWalk.value) {
                        state.setInput(Input.CLICK_RIGHT, true);
                    }
                    return state;
                }
                case PlaceResult.ATTEMPTING: {
                    if (dist1 > 0.83) {
                        const yaw = RotationUtils.calcRotationFromVec3d(ctx.playerHead(), blockCenter(this.dest), ctx.playerRotations()).yaw;
                        const r = state.getTarget().rotation;
                        if (r && Math.abs(r.yaw - yaw) < 0.1) {
                            return state.setInput(Input.MOVE_FORWARD, true);
                        }
                    } else if (state.getTarget().rotation && ctx.playerRotations().isReallyCloseTo(state.getTarget().rotation!)) {
                        return state.setInput(Input.CLICK_LEFT, true);
                    }
                    return state;
                }
                default:
                    break;
            }
            if (feet.equals(this.dest)) {
                const faceX = (this.dest.x + this.src.x + 1.0) * 0.5;
                const faceY = (this.dest.y + this.src.y - 1.0) * 0.5;
                const faceZ = (this.dest.z + this.src.z + 1.0) * 0.5;
                const goalLook = this.src.below();

                const backToFace = RotationUtils.calcRotationFromVec3d(ctx.playerHead(), { x: faceX, y: faceY, z: faceZ }, ctx.playerRotations());
                const pitch = backToFace.pitch;
                const dist2 = Math.max(Math.abs(pos.x - faceX), Math.abs(pos.z - faceZ));
                if (dist2 < 0.29) {
                    const yaw = RotationUtils.calcRotationFromVec3d(blockCenter(this.dest), ctx.playerHead(), ctx.playerRotations()).yaw;
                    state.setTarget(new MovementTarget(new Rotation(yaw, pitch), true));
                    state.setInput(Input.MOVE_BACK, true);
                } else {
                    state.setTarget(new MovementTarget(backToFace, true));
                }
                if (ctx.isLookingAt(goalLook)) {
                    return state.setInput(Input.CLICK_RIGHT, true);
                }
                if (ctx.playerRotations().isReallyCloseTo(state.getTarget().rotation!)) {
                    state.setInput(Input.CLICK_LEFT, true);
                }
                return state;
            }
            MovementHelper.moveTowardsWithSlightRotation(ctx, state, this.dest);
            return state;
        }
    }

    protected override safeToCancelState(state: MovementState): boolean {
        return state.getStatus() !== MovementStatus.RUNNING || MovementHelper.canWalkOnCtx(this.ctx, this.dest.below());
    }

    protected override prepared(state: MovementState): boolean {
        const feet = this.ctx.playerFeet();
        if (feet.equals(this.src) || feet.equals(this.src.below())) {
            const block = this.ctx.bsi().get(this.src.below());
            if (MovementHelper.isClimbable(block)) {
                state.setInput(Input.SNEAK, true);
            }
        }
        return super.prepared(state);
    }
}
