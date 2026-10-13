import { settings } from "../../Settings";
import { BetterBlockPos, Direction, PosSet } from "../../utils/BetterBlockPos";
import { Blocks } from "../../world/Blocks";
import type { BlockStateInterface } from "../../world/BlockStateInterface";
import type { IBaritone } from "../../IBaritone";
import { COST_INF, SPRINT_ONE_BLOCK_COST, WALK_ONE_BLOCK_COST } from "../ActionCosts";
import type { CalculationContext } from "../CalculationContext";
import { Movement, MutableMoveResult, HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP } from "../Movement";
import { MovementHelper, PlaceResult } from "../MovementHelper";
import { Input, MovementState, MovementStatus } from "../MovementState";

export class MovementParkour extends Movement {
    private readonly direction: Direction;
    private readonly dist: number;
    private readonly ascend: boolean;

    private constructor(baritone: IBaritone | null, src: BetterBlockPos, dist: number, dir: Direction, ascend: boolean) {
        super(baritone, src, src.relative(dir, dist).above(ascend ? 1 : 0), [], src.relative(dir, dist).below(ascend ? 0 : 1));
        this.direction = dir;
        this.dist = dist;
        this.ascend = ascend;
    }

    static create(context: CalculationContext, src: BetterBlockPos, direction: Direction): MovementParkour {
        const res = new MutableMoveResult();
        MovementParkour.cost(context, src.x, src.y, src.z, direction, res);
        const dist = Math.abs(res.x - src.x) + Math.abs(res.z - src.z);
        return new MovementParkour(context.getBaritone(), src, dist, direction, res.y > src.y);
    }

    static cost(context: CalculationContext, x: number, y: number, z: number, dir: Direction, res: MutableMoveResult): void {
        if (!context.allowParkour) {
            return;
        }
        if (!context.allowJumpAtBuildLimit && y >= context.maxY) {
            return;
        }
        const xDiff = dir.x;
        const zDiff = dir.z;
        if (!MovementHelper.fullyPassable(context, x + xDiff, y, z + zDiff)) {
            return;
        }
        const adj = context.get(x + xDiff, y - 1, z + zDiff);
        if (MovementHelper.canWalkOn(context, x + xDiff, y - 1, z + zDiff, adj)) {
            return;
        }
        if (MovementHelper.avoidWalkingInto(adj) && !MovementHelper.isWater(adj)) {
            return;
        }
        if (!MovementHelper.fullyPassable(context, x + xDiff, y + 1, z + zDiff)) {
            return;
        }
        if (!MovementHelper.fullyPassable(context, x + xDiff, y + 2, z + zDiff)) {
            return;
        }
        if (!MovementHelper.fullyPassable(context, x, y + 2, z)) {
            return;
        }
        const standingOn = context.get(x, y - 1, z);
        if (MovementHelper.isClimbable(standingOn) || Blocks.isStairs(standingOn) || MovementHelper.isBottomSlab(standingOn)) {
            return;
        }
        if (context.assumeWalkOnWater && standingOn.hasFluid()) {
            return;
        }
        if (context.get(x, y, z).hasFluid()) {
            return;
        }
        let maxJump: number;
        if (context.allowWalkOnMagmaBlocks && Blocks.isMagma(standingOn)) {
            maxJump = 2;
        } else if (Blocks.isSoulSand(standingOn)) {
            maxJump = 2;
        } else if (context.canSprint) {
            maxJump = 4;
        } else {
            maxJump = 3;
        }

        let verifiedMaxJump = 1;
        for (let i = 2; i <= maxJump; i++) {
            const destX = x + xDiff * i;
            const destZ = z + zDiff * i;

            if (!MovementHelper.fullyPassable(context, destX, y + 1, destZ)) {
                break;
            }
            if (!MovementHelper.fullyPassable(context, destX, y + 2, destZ)) {
                break;
            }

            const destInto = context.bsi.get0(destX, y, destZ);
            if (!MovementHelper.fullyPassable(context, destX, y, destZ, destInto)) {
                if (i <= 3 && context.allowParkourAscend && context.canSprint && MovementHelper.canWalkOn(context, destX, y, destZ, destInto) && MovementParkour.checkOvershootSafety(context.bsi, destX + xDiff, y + 1, destZ + zDiff)) {
                    res.x = destX;
                    res.y = y + 1;
                    res.z = destZ;
                    res.cost = i * SPRINT_ONE_BLOCK_COST + context.jumpPenalty;
                    return;
                }
                break;
            }

            const landingOn = context.bsi.get0(destX, y - 1, destZ);
            if ((!Blocks.isFarmland(landingOn) && MovementHelper.canWalkOn(context, destX, y - 1, destZ, landingOn)) || (Math.min(16, context.frostWalker + 2) >= i && MovementHelper.canUseFrostWalker(context, landingOn))) {
                if (MovementParkour.checkOvershootSafety(context.bsi, destX + xDiff, y, destZ + zDiff)) {
                    res.x = destX;
                    res.y = y;
                    res.z = destZ;
                    res.cost = MovementParkour.costFromJumpDistance(i) + context.jumpPenalty;
                    return;
                }
                break;
            }

            if (!MovementHelper.fullyPassable(context, destX, y + 3, destZ)) {
                break;
            }

            verifiedMaxJump = i;
        }

        if (!context.allowParkourPlace) {
            return;
        }
        for (let i = verifiedMaxJump; i > 1; i--) {
            const destX = x + i * xDiff;
            const destZ = z + i * zDiff;
            const toReplace = context.get(destX, y - 1, destZ);
            const placeCost = context.costOfPlacingAt(destX, y - 1, destZ, toReplace);
            if (placeCost >= COST_INF) {
                continue;
            }
            if (!MovementHelper.isReplaceable(destX, y - 1, destZ, toReplace, context.bsi)) {
                continue;
            }
            if (!MovementParkour.checkOvershootSafety(context.bsi, destX + xDiff, y, destZ + zDiff)) {
                continue;
            }
            for (let j = 0; j < 5; j++) {
                const d = HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP[j];
                const againstX = destX + d.x;
                const againstY = y - 1 + d.y;
                const againstZ = destZ + d.z;
                if (againstX === destX - xDiff && againstZ === destZ - zDiff) {
                    continue;
                }
                if (MovementHelper.canPlaceAgainst(context, againstX, againstY, againstZ)) {
                    res.x = destX;
                    res.y = y;
                    res.z = destZ;
                    res.cost = MovementParkour.costFromJumpDistance(i) + placeCost + context.jumpPenalty;
                    return;
                }
            }
        }
    }

    private static checkOvershootSafety(bsi: BlockStateInterface, x: number, y: number, z: number): boolean {
        return !MovementHelper.avoidWalkingInto(bsi.get0(x, y, z)) && !MovementHelper.avoidWalkingInto(bsi.get0(x, y + 1, z));
    }

    private static costFromJumpDistance(dist: number): number {
        switch (dist) {
            case 2:
                return WALK_ONE_BLOCK_COST * 2;
            case 3:
                return WALK_ONE_BLOCK_COST * 3;
            case 4:
                return SPRINT_ONE_BLOCK_COST * 4;
            default:
                throw new Error("LOL " + dist);
        }
    }

    calculateCost(context: CalculationContext): number {
        const res = new MutableMoveResult();
        MovementParkour.cost(context, this.src.x, this.src.y, this.src.z, this.direction, res);
        if (res.x !== this.dest.x || res.y !== this.dest.y || res.z !== this.dest.z) {
            return COST_INF;
        }
        return res.cost;
    }

    protected calculateValidPositions(): PosSet {
        const set = new PosSet();
        for (let i = 0; i <= this.dist; i++) {
            for (let y = 0; y < 2; y++) {
                set.add(this.src.relative(this.direction, i).above(y));
            }
        }
        return set;
    }

    protected override safeToCancelState(state: MovementState): boolean {
        return state.getStatus() !== MovementStatus.RUNNING;
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
            this.baritone.logDebug("sorry");
            return state.setStatus(MovementStatus.UNREACHABLE);
        }
        if (!MovementHelper.openDoors(ctx, state, src, src.relative(this.direction))) {
            return state;
        }
        if (this.dist >= 4 || this.ascend) {
            state.setInput(Input.SPRINT, true);
        }
        const bsi = ctx.bsi();
        if (settings.allowWalkOnMagmaBlocks.value && Blocks.isMagma(bsi.get(ctx.playerFeet().below()))) {
            state.setInput(Input.SNEAK, true);
        }
        MovementHelper.moveTowards(ctx, state, dest);
        if (ctx.playerFeet().equals(dest)) {
            const d = bsi.get(dest);
            if (d.name === "vine" || d.name === "ladder") {
                return state.setStatus(MovementStatus.SUCCESS);
            }
            if (ctx.player().position().y - ctx.playerFeet().y < 0.094) {
                state.setStatus(MovementStatus.SUCCESS);
            }
        } else if (!ctx.playerFeet().equals(src)) {
            if (ctx.playerFeet().equals(src.relative(this.direction)) || ctx.player().position().y - src.y > 0.0001) {
                if (
                    settings.allowPlace.value &&
                    this.baritone.getInventoryBehavior().hasGenericThrowaway() &&
                    !MovementHelper.canWalkOnCtx(ctx, dest.below()) &&
                    !ctx.player().onGround() &&
                    MovementHelper.attemptToPlaceABlock(state, this.baritone, dest.below(), true, false) === PlaceResult.READY_TO_PLACE
                ) {
                    state.setInput(Input.CLICK_RIGHT, true);
                }
                if (this.dist === 3 && !this.ascend) {
                    const pos = ctx.player().position();
                    const xDiff = src.x + 0.5 - pos.x;
                    const zDiff = src.z + 0.5 - pos.z;
                    const distFromStart = Math.max(Math.abs(xDiff), Math.abs(zDiff));
                    if (distFromStart < 0.7) {
                        return state;
                    }
                }

                state.setInput(Input.JUMP, true);
            } else if (!ctx.playerFeet().equals(dest.relative(this.direction, -1))) {
                state.setInput(Input.SPRINT, false);
                if (ctx.playerFeet().equals(src.relative(this.direction, -1))) {
                    MovementHelper.moveTowards(ctx, state, src);
                } else {
                    MovementHelper.moveTowards(ctx, state, src.relative(this.direction, -1));
                }
            }
        }
        return state;
    }
}
