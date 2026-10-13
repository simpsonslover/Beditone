import { settings } from "../../Settings";
import { BetterBlockPos, Direction, PosSet } from "../../utils/BetterBlockPos";
import type { BlockState } from "../../world/BlockState";
import { Blocks } from "../../world/Blocks";
import type { BlockStateInterface } from "../../world/BlockStateInterface";
import type { IBaritone } from "../../IBaritone";
import { CENTER_AFTER_FALL_COST, COST_INF, FALL_N_BLOCKS_COST, JUMP_ONE_BLOCK_COST, SNEAK_ONE_BLOCK_COST, SPRINT_MULTIPLIER, WALK_ONE_BLOCK_COST, WALK_ONE_OVER_SOUL_SAND_COST } from "../ActionCosts";
import type { CalculationContext } from "../CalculationContext";
import { Movement, MutableMoveResult } from "../Movement";
import { MovementHelper } from "../MovementHelper";
import { Input, MovementState, MovementStatus } from "../MovementState";

const SQRT_2 = Math.sqrt(2);

export class MovementDiagonal extends Movement {
    constructor(baritone: IBaritone | null, start: BetterBlockPos, dir1: Direction, dir2: Direction, dy: number) {
        const d1 = start.relative(dir1);
        const d2 = start.relative(dir2);
        const end = d1.relative(dir2).above(dy);
        super(baritone, start, end, [d1, d1.above(), d2, d2.above(), end, end.above()]);
    }

    protected override safeToCancelState(_state: MovementState): boolean {
        const ctx = this.ctx;
        const offset = 0.25;
        const pos = ctx.player().position();
        const x = pos.x;
        const y = pos.y - 1;
        const z = pos.z;
        if (ctx.playerFeet().equals(this.src)) {
            return true;
        }
        if (MovementHelper.canWalkOnCtx(ctx, new BetterBlockPos(this.src.x, this.src.y - 1, this.dest.z)) && MovementHelper.canWalkOnCtx(ctx, new BetterBlockPos(this.dest.x, this.src.y - 1, this.src.z))) {
            return true;
        }
        if (ctx.playerFeet().equals(new BetterBlockPos(this.src.x, this.src.y, this.dest.z)) || ctx.playerFeet().equals(new BetterBlockPos(this.dest.x, this.src.y, this.src.z))) {
            return (
                MovementHelper.canWalkOnCtx(ctx, BetterBlockPos.of({ x: x + offset, y, z: z + offset })) ||
                MovementHelper.canWalkOnCtx(ctx, BetterBlockPos.of({ x: x + offset, y, z: z - offset })) ||
                MovementHelper.canWalkOnCtx(ctx, BetterBlockPos.of({ x: x - offset, y, z: z + offset })) ||
                MovementHelper.canWalkOnCtx(ctx, BetterBlockPos.of({ x: x - offset, y, z: z - offset }))
            );
        }
        return true;
    }

    calculateCost(context: CalculationContext): number {
        const result = new MutableMoveResult();
        MovementDiagonal.cost(context, this.src.x, this.src.y, this.src.z, this.dest.x, this.dest.z, result);
        if (result.y !== this.dest.y) {
            return COST_INF;
        }
        return result.cost;
    }

    protected calculateValidPositions(): PosSet {
        const diagA = new BetterBlockPos(this.src.x, this.src.y, this.dest.z);
        const diagB = new BetterBlockPos(this.dest.x, this.src.y, this.src.z);
        if (this.dest.y < this.src.y) {
            return new PosSet([this.src, this.dest.above(), diagA, diagB, this.dest, diagA.below(), diagB.below()]);
        }
        if (this.dest.y > this.src.y) {
            return new PosSet([this.src, this.src.above(), diagA, diagB, this.dest, diagA.above(), diagB.above()]);
        }
        return new PosSet([this.src, this.dest, diagA, diagB]);
    }

    static cost(context: CalculationContext, x: number, y: number, z: number, destX: number, destZ: number, res: MutableMoveResult): void {
        const destIntoUpper = context.get(destX, y + 1, destZ);
        if (!MovementHelper.canWalkThrough(context, destX, y + 1, destZ, destIntoUpper)) {
            return;
        }
        const destInto = context.get(destX, y, destZ);
        let fromDown: BlockState;
        let ascend = false;
        let destWalkOn: BlockState;
        let descend = false;
        let frostWalker = false;
        let sneaking = false;
        if (!MovementHelper.canWalkThrough(context, destX, y, destZ, destInto)) {
            ascend = true;
            if (!context.allowDiagonalAscend || !MovementHelper.canWalkThrough(context, x, y + 2, z) || !MovementHelper.canWalkOn(context, destX, y, destZ, destInto) || !MovementHelper.canWalkThrough(context, destX, y + 2, destZ)) {
                return;
            }
            destWalkOn = destInto;
            fromDown = context.get(x, y - 1, z);
        } else {
            destWalkOn = context.get(destX, y - 1, destZ);
            fromDown = context.get(x, y - 1, z);
            const standingOnABlock = MovementHelper.mustBeSolidToWalkOn(context, x, y - 1, z, fromDown);
            frostWalker = standingOnABlock && MovementHelper.canUseFrostWalker(context, destWalkOn);
            if (!frostWalker && !MovementHelper.canWalkOn(context, destX, y - 1, destZ, destWalkOn)) {
                descend = true;
                if (!context.allowDiagonalDescend || !MovementHelper.canWalkOn(context, destX, y - 2, destZ) || !MovementHelper.canWalkThrough(context, destX, y - 1, destZ, destWalkOn)) {
                    return;
                }
            }
            frostWalker = frostWalker && !context.assumeWalkOnWater;
        }
        const startState = context.get(x, y, z);
        if (MovementDiagonal.isBlockingDoor(startState, x, z, destX, destZ) || MovementDiagonal.isBlockingDoor(ascend ? destIntoUpper : destInto, destX, destZ, x, y)) {
            return;
        }
        let multiplier = WALK_ONE_BLOCK_COST;
        if (Blocks.isSoulSand(destWalkOn)) {
            multiplier += (WALK_ONE_OVER_SOUL_SAND_COST - WALK_ONE_BLOCK_COST) / 2;
        } else if (context.allowWalkOnMagmaBlocks && Blocks.isMagma(destWalkOn)) {
            multiplier += (SNEAK_ONE_BLOCK_COST - WALK_ONE_BLOCK_COST) / 2;
            sneaking = true;
        } else if (frostWalker) {
        } else if (destWalkOn.name === "water") {
            multiplier += context.walkOnWaterOnePenalty * SQRT_2;
        }
        if (MovementHelper.isClimbable(fromDown)) {
            return;
        }
        if (Blocks.isSoulSand(fromDown)) {
            multiplier += (WALK_ONE_OVER_SOUL_SAND_COST - WALK_ONE_BLOCK_COST) / 2;
        } else if (context.allowWalkOnMagmaBlocks && Blocks.isMagma(fromDown)) {
            multiplier += (SNEAK_ONE_BLOCK_COST - WALK_ONE_BLOCK_COST) / 2;
            sneaking = true;
        }
        const cuttingOver1 = context.get(x, y - 1, destZ);
        if ((!context.allowWalkOnMagmaBlocks && Blocks.isMagma(cuttingOver1)) || MovementHelper.isLava(cuttingOver1)) {
            return;
        }
        const cuttingOver2 = context.get(destX, y - 1, z);
        if ((!context.allowWalkOnMagmaBlocks && Blocks.isMagma(cuttingOver2)) || MovementHelper.isLava(cuttingOver2)) {
            return;
        }
        let water = false;
        const startIn = startState;
        if (MovementHelper.isWater(startState) || MovementHelper.isWater(destInto)) {
            if (ascend) {
                return;
            }
            multiplier = context.waterWalkSpeed;
            water = true;
        }
        const pb0 = context.get(x, y, destZ);
        const pb2 = context.get(destX, y, z);
        if (ascend) {
            const ATop = MovementHelper.canWalkThrough(context, x, y + 2, destZ);
            const AMid = MovementHelper.canWalkThrough(context, x, y + 1, destZ);
            let ALow = MovementHelper.canWalkThrough(context, x, y, destZ, pb0);
            const BTop = MovementHelper.canWalkThrough(context, destX, y + 2, z);
            const BMid = MovementHelper.canWalkThrough(context, destX, y + 1, z);
            let BLow = MovementHelper.canWalkThrough(context, destX, y, z, pb2);
            ALow = ALow && !MovementDiagonal.isBlockingDoor(pb0, x, destZ, destX, z);
            BLow = BLow && !MovementDiagonal.isBlockingDoor(pb2, destX, z, x, destZ);
            if (
                (!(ATop && AMid && ALow) && !(BTop && BMid && BLow)) ||
                MovementHelper.avoidWalkingInto(pb0) ||
                MovementHelper.avoidWalkingInto(pb2) ||
                (ATop && AMid && MovementHelper.canWalkOn(context, x, y, destZ, pb0)) ||
                (BTop && BMid && MovementHelper.canWalkOn(context, destX, y, z, pb2)) ||
                (!ATop && AMid && ALow) ||
                (!BTop && BMid && BLow)
            ) {
                return;
            }
            res.cost = multiplier * SQRT_2 + JUMP_ONE_BLOCK_COST;
            res.x = destX;
            res.z = destZ;
            res.y = y + 1;
            return;
        }
        let optionA = MovementHelper.getMiningDurationTicks(context, x, y, destZ, pb0, false);
        let optionB = MovementHelper.getMiningDurationTicks(context, destX, y, z, pb2, false);
        optionA += MovementDiagonal.isBlockingDoor(pb0, x, destZ, destX, z) ? 1 : 0;
        optionB += MovementDiagonal.isBlockingDoor(pb2, destX, z, x, destZ) ? 1 : 0;
        if (optionA !== 0 && optionB !== 0) {
            return;
        }
        const pb1 = context.get(x, y + 1, destZ);
        optionA += MovementHelper.getMiningDurationTicks(context, x, y + 1, destZ, pb1, true);
        if (optionA !== 0 && optionB !== 0) {
            return;
        }
        const pb3 = context.get(destX, y + 1, z);
        if (optionA === 0 && ((MovementHelper.avoidWalkingInto(pb2) && pb2.name !== "water") || MovementHelper.avoidWalkingInto(pb3))) {
            return;
        }
        optionB += MovementHelper.getMiningDurationTicks(context, destX, y + 1, z, pb3, true);
        if (optionA !== 0 && optionB !== 0) {
            return;
        }
        if (optionB === 0 && ((MovementHelper.avoidWalkingInto(pb0) && pb0.name !== "water") || MovementHelper.avoidWalkingInto(pb1))) {
            return;
        }
        if (optionA !== 0 || optionB !== 0) {
            multiplier *= SQRT_2 - 0.001;
            if (MovementHelper.isClimbable(startIn)) {
                return;
            }
        } else {
            if (context.canSprint && !water && !sneaking) {
                multiplier *= SPRINT_MULTIPLIER;
            }
        }
        res.cost = multiplier * SQRT_2;
        if (descend) {
            res.cost += Math.max(FALL_N_BLOCKS_COST[1], CENTER_AFTER_FALL_COST);
            res.y = y - 1;
        } else {
            res.y = y;
        }
        res.x = destX;
        res.z = destZ;
    }

    override updateState(state: MovementState): MovementState {
        super.updateState(state);
        if (state.getStatus() !== MovementStatus.RUNNING) {
            return state;
        }
        const ctx = this.ctx;
        const src = this.src;
        const dest = this.dest;
        if (ctx.playerFeet().equals(dest)) {
            return state.setStatus(MovementStatus.SUCCESS);
        } else if (!this.playerInValidPosition() && !(MovementHelper.isLiquidCtx(ctx, src) && this.getValidPositions().has(ctx.playerFeet().above()))) {
            return state.setStatus(MovementStatus.UNREACHABLE);
        }
        const bsi = ctx.bsi();
        if (
            !MovementDiagonal.isBlockingDoor(bsi.get(new BetterBlockPos(src.x, src.y, dest.z)), src.x, dest.z, dest.x, src.z) &&
            (!MovementHelper.openDoors(ctx, state, src, new BetterBlockPos(src.x, src.y, dest.z)) || !MovementHelper.openDoors(ctx, state, new BetterBlockPos(src.x, dest.y, dest.z), dest))
        ) {
            return state;
        }
        if (
            !MovementDiagonal.isBlockingDoor(bsi.get(new BetterBlockPos(dest.x, src.y, src.z)), dest.x, src.z, src.x, dest.z) &&
            (!MovementHelper.openDoors(ctx, state, src, new BetterBlockPos(dest.x, src.y, src.z)) || !MovementHelper.openDoors(ctx, state, new BetterBlockPos(dest.x, dest.y, src.z), dest))
        ) {
            return state;
        }
        if (dest.y > src.y && ctx.player().position().y < src.y + 0.1 && ctx.player().horizontalCollision()) {
            state.setInput(Input.JUMP, true);
        }
        if (this.sprint()) {
            state.setInput(Input.SPRINT, true);
        }
        state.setInput(Input.SNEAK, settings.allowWalkOnMagmaBlocks.value && MovementHelper.steppingOnBlocks(ctx).some((b) => Blocks.isMagma(bsi.get(b))));
        MovementHelper.moveTowards(ctx, state, dest);
        return state;
    }

    private sprint(): boolean {
        if (MovementHelper.isLiquidCtx(this.ctx, this.ctx.playerFeet()) && !settings.sprintInWater.value) {
            return false;
        }
        for (let i = 0; i < 4; i++) {
            if (!MovementHelper.canWalkThroughCtx(this.ctx, this.positionsToBreak[i])) {
                return false;
            }
        }
        return true;
    }

    protected override prepared(_state: MovementState): boolean {
        return true;
    }

    override toBreak(bsi: BlockStateInterface): BetterBlockPos[] {
        if (this.toBreakCached !== null) {
            return this.toBreakCached;
        }
        const result: BetterBlockPos[] = [];
        for (let i = 4; i < 6; i++) {
            const p = this.positionsToBreak[i];
            if (!MovementHelper.canWalkThroughBsi(bsi, p.x, p.y, p.z)) {
                result.push(p);
            }
        }
        this.toBreakCached = result;
        return result;
    }

    override toWalkInto(bsi: BlockStateInterface): BetterBlockPos[] {
        const result: BetterBlockPos[] = [];
        for (let i = 0; i < 4; i++) {
            const p = this.positionsToBreak[i];
            if (!MovementHelper.canWalkThroughBsi(bsi, p.x, p.y, p.z)) {
                result.push(p);
            }
        }
        this.toWalkIntoCached = result;
        return result;
    }

    private static isBlockingDoor(state: BlockState, doorX: number, doorZ: number, otherX: number, otherZ: number): boolean {
        if (!Blocks.isDoor(state)) {
            return false;
        }
        const offset = Blocks.facing(state);
        const ox = offset.x;
        const oz = offset.z;
        let nbrX: number;
        let nbrZ: number;
        if (state.get("door_hinge_bit") !== true) {
            nbrX = doorX - ox + oz;
            nbrZ = doorZ - oz - ox;
        } else {
            nbrX = doorX - ox - oz;
            nbrZ = doorZ - oz + ox;
        }
        return nbrX === otherX && nbrZ === otherZ;
    }
}
