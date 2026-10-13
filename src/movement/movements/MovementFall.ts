import { BetterBlockPos, blockCenter, PosSet, Vec3 } from "../../utils/BetterBlockPos";
import { Rotation, RotationUtils } from "../../utils/Rotation";
import { Blocks } from "../../world/Blocks";
import type { IBaritone } from "../../IBaritone";
import { COST_INF } from "../ActionCosts";
import type { CalculationContext } from "../CalculationContext";
import { Movement, MutableMoveResult } from "../Movement";
import { MovementHelper } from "../MovementHelper";
import { Input, MovementState, MovementStatus, MovementTarget } from "../MovementState";
import { MovementDescend } from "./MovementDescend";

const WATER_BUCKET = "minecraft:water_bucket";
const EMPTY_BUCKET = "minecraft:bucket";

export class MovementFall extends Movement {
    constructor(baritone: IBaritone | null, src: BetterBlockPos, dest: BetterBlockPos) {
        super(baritone, src, dest, MovementFall.buildPositionsToBreak(src, dest));
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
        const set = new PosSet();
        set.add(this.src);
        for (let y = this.src.y - this.dest.y; y >= 0; y--) {
            set.add(this.dest.above(y));
        }
        return set;
    }

    private willPlaceBucket(): boolean {
        const context = this.baritone.newCalculationContext();
        const result = new MutableMoveResult();
        return MovementDescend.dynamicFallCost(context, this.src.x, this.src.y, this.src.z, this.dest.x, this.dest.z, 0, context.get(this.dest.x, this.src.y - 2, this.dest.z), result);
    }

    private findHotbar(item: string): number {
        const items = this.ctx.player().inventory().items;
        for (let i = 0; i < 9; i++) {
            if (items[i] && items[i].typeId === item && items[i].amount > 0) return i;
        }
        return -1;
    }

    override updateState(state: MovementState): MovementState {
        super.updateState(state);
        if (state.getStatus() !== MovementStatus.RUNNING) {
            return state;
        }
        const ctx = this.ctx;
        const bsi = ctx.bsi();
        const dest = this.dest;
        const src = this.src;
        const playerFeet = ctx.playerFeet();
        const toDest = RotationUtils.calcRotationFromVec3d(ctx.playerHead(), blockCenter(dest), ctx.playerRotations());
        let targetRotation: Rotation | null = null;
        const destState = bsi.get(dest);
        if (Blocks.isMagma(bsi.get(dest.below())) && MovementHelper.steppingOnBlocks(ctx).every((b) => MovementHelper.canWalkThroughCtx(ctx, b))) {
            state.setInput(Input.SNEAK, true);
        }
        const isWater = MovementHelper.isWater(destState);
        if (!isWater && this.willPlaceBucket() && !playerFeet.equals(dest)) {
            if (this.findHotbar(WATER_BUCKET) < 0 || ctx.world().dimensionId === "minecraft:nether") {
                return state.setStatus(MovementStatus.UNREACHABLE);
            }

            if (ctx.player().position().y - dest.y < ctx.blockReachDistance() && !ctx.player().onGround()) {
                ctx.player().setSelectedSlot(this.findHotbar(WATER_BUCKET));

                targetRotation = new Rotation(toDest.yaw, 90.0);

                if (ctx.isLookingAt(dest) || ctx.isLookingAt(dest.below())) {
                    state.setInput(Input.CLICK_RIGHT, true);
                }
            }
        }
        if (!MovementHelper.openDoors(ctx, state, src, new BetterBlockPos(dest.x, src.y, dest.z))) {
            return state;
        }
        if (targetRotation !== null) {
            state.setTarget(new MovementTarget(targetRotation, true));
        } else {
            state.setTarget(new MovementTarget(toDest, false));
        }
        if (playerFeet.equals(dest) && (ctx.player().position().y - playerFeet.y < 0.094 || isWater)) {
            if (isWater) {
                const empty = this.findHotbar(EMPTY_BUCKET);
                if (empty >= 0) {
                    ctx.player().setSelectedSlot(empty);
                    if (ctx.player().deltaMovement().y >= 0) {
                        return state.setInput(Input.CLICK_RIGHT, true);
                    } else {
                        return state;
                    }
                } else {
                    if (ctx.player().deltaMovement().y >= 0) {
                        return state.setStatus(MovementStatus.SUCCESS);
                    }
                }
            } else {
                return state.setStatus(MovementStatus.SUCCESS);
            }
        }
        const destCenter = blockCenter(dest);
        const pos = ctx.player().position();
        const motion = ctx.player().deltaMovement();
        if (Math.abs(pos.x + motion.x - destCenter.x) > 0.1 || Math.abs(pos.z + motion.z - destCenter.z) > 0.1) {
            if (!ctx.player().onGround() && Math.abs(motion.y) > 0.4) {
                state.setInput(Input.SNEAK, true);
            }
            state.setInput(Input.MOVE_FORWARD, true);
        }
        const avoidDir = this.avoid();
        let avoid: Vec3;
        if (avoidDir === null) {
            avoid = src.subtract(dest);
        } else {
            avoid = avoidDir;
            const dist = Math.abs(avoid.x * (destCenter.x - avoid.x / 2.0 - pos.x)) + Math.abs(avoid.z * (destCenter.z - avoid.z / 2.0 - pos.z));
            if (dist < 0.6) {
                state.setInput(Input.MOVE_FORWARD, true);
            } else if (!ctx.player().onGround()) {
                state.setInput(Input.SNEAK, false);
            }
        }
        if (targetRotation === null) {
            const destCenterOffset = { x: destCenter.x + 0.125 * avoid.x, y: destCenter.y, z: destCenter.z + 0.125 * avoid.z };
            state.setTarget(new MovementTarget(RotationUtils.calcRotationFromVec3d(ctx.playerHead(), destCenterOffset, ctx.playerRotations()), false));
        }
        return state;
    }

    private avoid(): Vec3 | null {
        const bsi = this.ctx.bsi();
        for (let i = 0; i < 15; i++) {
            const state = bsi.get(this.ctx.playerFeet().below(i));
            if (state.name === "ladder") {
                return Blocks.ladderFacing(state);
            }
        }
        return null;
    }

    protected override safeToCancelState(state: MovementState): boolean {
        return this.ctx.playerFeet().equals(this.src) || state.getStatus() !== MovementStatus.RUNNING;
    }

    private static buildPositionsToBreak(src: BetterBlockPos, dest: BetterBlockPos): BetterBlockPos[] {
        const diffX = src.x - dest.x;
        const diffZ = src.z - dest.z;
        const diffY = Math.abs(src.y - dest.y);
        const toBreak: BetterBlockPos[] = new Array(diffY + 2);
        for (let i = 0; i < toBreak.length; i++) {
            toBreak[i] = new BetterBlockPos(src.x - diffX, src.y + 1 - i, src.z - diffZ);
        }
        return toBreak;
    }

    protected override prepared(state: MovementState): boolean {
        if (state.getStatus() === MovementStatus.WAITING) {
            return true;
        }
        for (let i = 0; i < 4 && i < this.positionsToBreak.length; i++) {
            if (!MovementHelper.canWalkThroughCtx(this.ctx, this.positionsToBreak[i])) {
                return super.prepared(state);
            }
        }
        return true;
    }
}
