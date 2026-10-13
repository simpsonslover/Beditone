import { settings } from "../Settings";
import { AIR, BlockState, Fluid } from "../world/BlockState";
import { Blocks } from "../world/Blocks";
import type { BlockStateInterface } from "../world/BlockStateInterface";
import { BetterBlockPos, blockCenter, Direction, Directions, opposite, Vec3, ALL_DIRECTIONS } from "../utils/BetterBlockPos";
import { Rotation, RotationUtils, DEG_TO_RAD } from "../utils/Rotation";
import type { IPlayerContext } from "../utils/IPlayerContext";
import type { CalculationContext } from "./CalculationContext";
import { COST_INF } from "./ActionCosts";
import { Input, MovementState, MovementStatus, MovementTarget } from "./MovementState";
import type { IBaritone } from "../IBaritone";
import { ToolSet } from "../world/ToolSet";
import { reachable, calculateBlockCenter } from "../utils/Reachability";

export const enum Ternary {
    YES,
    MAYBE,
    NO,
}

export const HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP: readonly Direction[] = [
    Directions.NORTH,
    Directions.SOUTH,
    Directions.EAST,
    Directions.WEST,
    Directions.DOWN,
];

export enum PlaceResult {
    READY_TO_PLACE = "READY_TO_PLACE",
    ATTEMPTING = "ATTEMPTING",
    NO_OPTION = "NO_OPTION",
}

export function isPathfindableLand(state: BlockState): boolean {
    if (state.collisionEmpty()) return true;
    if (state.name === "ladder") return true;
    const b = state.bounds();
    return b !== null && b[4] <= 0.1875;
}

export function canBeReplaced(state: BlockState): boolean {
    if (Blocks.isSnowLayer(state)) return Blocks.snowLayers(state) === 1;
    return Blocks.isReplaceableName(state);
}

export const MovementHelper = {
    avoidBreaking(context: CalculationContext, x: number, y: number, z: number, state: BlockState): boolean {
        const bsi = context.bsi;
        return (
            !bsi.worldBorder.canPlaceAt(x, z) ||
            context.precomputedData.neverBreak(state) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x, y + 1, z, true) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x + 1, y, z, false) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x - 1, y, z, false) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x, y, z + 1, false) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x, y, z - 1, false)
        );
    },

    avoidBreakingBsi(bsi: BlockStateInterface, x: number, y: number, z: number, state: BlockState): boolean {
        if (!bsi.worldBorder.canPlaceAt(x, z)) {
            return true;
        }
        return (
            settings.blocksToDisallowBreaking.value.includes(state.typeId) ||
            state.name === "ice" ||
            Blocks.isInfested(state) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x, y + 1, z, true) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x + 1, y, z, false) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x - 1, y, z, false) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x, y, z + 1, false) ||
            MovementHelper.avoidAdjacentBreaking(bsi, x, y, z - 1, false)
        );
    },

    avoidAdjacentBreaking(bsi: BlockStateInterface, x: number, y: number, z: number, directlyAbove: boolean): boolean {
        const state = bsi.get0(x, y, z);
        if (!directlyAbove && Blocks.isFalling(state) && settings.avoidUpdatingFallingBlocks.value && isFree(bsi.get0(x, y - 1, z))) {
            return true;
        }
        if (Blocks.isLiquidBlock(state)) {
            if (directlyAbove || settings.strictLiquidCheck.value) {
                return true;
            }
            if (Number(state.get("liquid_depth") ?? 0) === 0) {
                return true;
            }
            return !Blocks.isLiquidBlock(bsi.get0(x, y - 1, z));
        }
        return state.hasFluid();
    },

    canWalkThrough(context: CalculationContext, x: number, y: number, z: number, state?: BlockState): boolean {
        return context.precomputedData.canWalkThrough(context.bsi, x, y, z, state ?? context.get(x, y, z));
    },

    canWalkThroughBsi(bsi: BlockStateInterface, x: number, y: number, z: number, state?: BlockState): boolean {
        state = state ?? bsi.get0(x, y, z);
        const t = MovementHelper.canWalkThroughBlockState(state);
        if (t === Ternary.YES) return true;
        if (t === Ternary.NO) return false;
        return MovementHelper.canWalkThroughPosition(bsi, x, y, z, state);
    },

    canWalkThroughCtx(ctx: IPlayerContext, pos: Vec3): boolean {
        return MovementHelper.canWalkThroughBsi(ctx.bsi(), pos.x, pos.y, pos.z);
    },

    canWalkThroughBlockState(state: BlockState): Ternary {
        if (Blocks.isAir(state)) {
            return Ternary.YES;
        }
        if (
            Blocks.isFire(state) ||
            state.name === "web" ||
            state.name === "end_portal" ||
            state.name === "cocoa" ||
            Blocks.isSkull(state) ||
            state.name === "bubble_column" ||
            Blocks.isShulkerBox(state) ||
            Blocks.isSlab(state) ||
            Blocks.isTrapdoor(state) ||
            state.name === "honey_block" ||
            state.name === "end_rod" ||
            state.name === "sweet_berry_bush" ||
            Blocks.isPointedDripstone(state) ||
            Blocks.isAmethystCluster(state) ||
            Blocks.isAzalea(state)
        ) {
            return Ternary.NO;
        }
        if (state.name === "big_dripleaf") {
            return Ternary.NO;
        }
        if (state.name === "powder_snow") {
            return Ternary.NO;
        }
        if (settings.blocksToAvoid.value.includes(state.typeId)) {
            return Ternary.NO;
        }
        if (Blocks.isDoor(state)) {
            return Blocks.isWoodenDoor(state) ? Ternary.YES : Ternary.NO;
        }
        if (Blocks.isFenceGate(state)) {
            return Ternary.YES;
        }
        if (Blocks.isCarpet(state)) {
            return Ternary.MAYBE;
        }
        if (Blocks.isSnowLayer(state)) {
            return Ternary.MAYBE;
        }
        if (state.hasFluid()) {
            if (state.fluidAmount !== 8) {
                return Ternary.NO;
            }
            return Ternary.MAYBE;
        }
        if (Blocks.isCauldron(state)) {
            return Ternary.NO;
        }
        return isPathfindableLand(state) ? Ternary.YES : Ternary.NO;
    },

    canWalkThroughPosition(bsi: BlockStateInterface, x: number, y: number, z: number, state: BlockState): boolean {
        if (Blocks.isCarpet(state)) {
            return MovementHelper.canWalkOnBsi(bsi, x, y - 1, z);
        }
        if (Blocks.isSnowLayer(state)) {
            if (!bsi.worldContainsLoadedChunk(x, z)) {
                return true;
            }
            if (Blocks.snowLayers(state) >= 3) {
                return false;
            }
            return MovementHelper.canWalkOnBsi(bsi, x, y - 1, z);
        }
        if (state.hasFluid()) {
            if (MovementHelper.isFlowing(x, y, z, state, bsi)) {
                return false;
            }
            if (settings.assumeWalkOnWater.value) {
                return false;
            }
            const up = bsi.get0(x, y + 1, z);
            if (up.hasFluid() || Blocks.isLilyPad(up)) {
                return false;
            }
            return state.fluid === Fluid.WATER;
        }
        return isPathfindableLand(state);
    },

    fullyPassableBlockState(state: BlockState): Ternary {
        if (Blocks.isAir(state)) {
            return Ternary.YES;
        }
        if (
            Blocks.isFire(state) ||
            state.name === "trip_wire" ||
            state.name === "web" ||
            state.name === "vine" ||
            state.name === "ladder" ||
            state.name === "cocoa" ||
            Blocks.isAzalea(state) ||
            Blocks.isDoor(state) ||
            Blocks.isFenceGate(state) ||
            Blocks.isSnowLayer(state) ||
            state.hasFluid() ||
            Blocks.isTrapdoor(state) ||
            state.name === "end_portal" ||
            Blocks.isSkull(state) ||
            Blocks.isShulkerBox(state)
        ) {
            return Ternary.NO;
        }
        return isPathfindableLand(state) ? Ternary.YES : Ternary.NO;
    },

    fullyPassable(context: CalculationContext, x: number, y: number, z: number, state?: BlockState): boolean {
        return context.precomputedData.fullyPassable(context.bsi, x, y, z, state ?? context.get(x, y, z));
    },

    fullyPassableCtx(ctx: IPlayerContext, pos: Vec3): boolean {
        const state = ctx.bsi().get(pos);
        const t = MovementHelper.fullyPassableBlockState(state);
        if (t === Ternary.YES) return true;
        if (t === Ternary.NO) return false;
        return isPathfindableLand(state);
    },

    fullyPassablePosition(_bsi: BlockStateInterface, _x: number, _y: number, _z: number, state: BlockState): boolean {
        return isPathfindableLand(state);
    },

    isReplaceable(x: number, y: number, z: number, state: BlockState, bsi: BlockStateInterface): boolean {
        if (Blocks.isAir(state)) {
            return true;
        }
        if (Blocks.isSnowLayer(state)) {
            if (!bsi.worldContainsLoadedChunk(x, z)) {
                return true;
            }
            return Blocks.snowLayers(state) === 1;
        }
        if (state.name === "large_fern" || state.name === "tall_grass") {
            return true;
        }
        return canBeReplaced(state);
    },

    isDoorPassable(state: BlockState, side: Direction): boolean {
        const open = Blocks.isOpen(state);
        const closedFacing = Blocks.facing(state);
        const leftHinge = state.get("door_hinge_bit") !== true;
        const openFacing = leftHinge ? clockWise(closedFacing) : counterClockWise(closedFacing);
        return side !== (open ? openFacing : closedFacing);
    },

    isGatePassable(ctx: IPlayerContext, gatePos: BetterBlockPos, playerPos: BetterBlockPos): boolean {
        if (playerPos.equals(gatePos)) {
            return false;
        }
        const state = ctx.bsi().get(gatePos);
        if (!Blocks.isFenceGate(state)) {
            return true;
        }
        return Blocks.isOpen(state);
    },

    avoidWalkingInto(state: BlockState): boolean {
        return (
            state.hasFluid() ||
            (Blocks.isMagma(state) && !settings.allowWalkOnMagmaBlocks.value) ||
            state.name === "cactus" ||
            state.name === "sweet_berry_bush" ||
            Blocks.isFire(state) ||
            state.name === "end_portal" ||
            state.name === "web" ||
            state.name === "bubble_column"
        );
    },

    canWalkOnBsi(bsi: BlockStateInterface, x: number, y: number, z: number, state?: BlockState): boolean {
        state = state ?? bsi.get0(x, y, z);
        const t = MovementHelper.canWalkOnBlockState(state);
        if (t === Ternary.YES) return true;
        if (t === Ternary.NO) return false;
        return MovementHelper.canWalkOnPosition(bsi, x, y, z, state);
    },

    canWalkOnBlockState(state: BlockState): Ternary {
        if (
            MovementHelper.isBlockNormalCube(state) &&
            (!Blocks.isMagma(state) || settings.allowWalkOnMagmaBlocks.value) &&
            state.name !== "bubble_column" &&
            state.name !== "honey_block"
        ) {
            return Ternary.YES;
        }
        if (Blocks.isAzalea(state)) {
            return Ternary.YES;
        }
        if (state.name === "ladder" || (Blocks.isClimbable(state) && settings.allowVines.value)) {
            return Ternary.YES;
        }
        if (Blocks.isFarmland(state) || Blocks.isDirtPath(state) || Blocks.isSoulSand(state)) {
            return Ternary.YES;
        }
        if (Blocks.isChest(state)) {
            return Ternary.YES;
        }
        if (Blocks.isGlass(state)) {
            return Ternary.YES;
        }
        if (Blocks.isStairs(state)) {
            return Ternary.YES;
        }
        if (MovementHelper.isWater(state)) {
            return Ternary.MAYBE;
        }
        if (MovementHelper.isLava(state) && settings.assumeWalkOnLava.value) {
            return Ternary.MAYBE;
        }
        if (Blocks.isSlab(state) || Blocks.isDoubleSlab(state)) {
            if (!settings.allowWalkOnBottomSlab.value) {
                if (!Blocks.isBottomSlab(state)) {
                    return Ternary.YES;
                }
                return Ternary.NO;
            }
            return Ternary.YES;
        }
        return Ternary.NO;
    },

    canWalkOnPosition(bsi: BlockStateInterface, x: number, y: number, z: number, state: BlockState): boolean {
        if (MovementHelper.isWater(state)) {
            const upState = bsi.get0(x, y + 1, z);
            if (Blocks.isLilyPad(upState) || Blocks.isCarpet(upState)) {
                return true;
            }
            if (MovementHelper.isFlowing(x, y, z, state, bsi) || (upState.fluid === Fluid.WATER && isFlowingFluidType(upState))) {
                return MovementHelper.isWater(upState) && !settings.assumeWalkOnWater.value;
            }
            return MovementHelper.isWater(upState) !== settings.assumeWalkOnWater.value;
        }
        if (MovementHelper.isLava(state) && !MovementHelper.isFlowing(x, y, z, state, bsi) && settings.assumeWalkOnLava.value) {
            return true;
        }
        return false;
    },

    canWalkOn(context: CalculationContext, x: number, y: number, z: number, state?: BlockState): boolean {
        return context.precomputedData.canWalkOn(context.bsi, x, y, z, state ?? context.get(x, y, z));
    },

    canWalkOnCtx(ctx: IPlayerContext, pos: Vec3, state?: BlockState): boolean {
        const bsi = ctx.bsi();
        return MovementHelper.canWalkOnBsi(bsi, pos.x, pos.y, pos.z, state ?? bsi.get(pos));
    },

    canUseFrostWalker(context: CalculationContext, state: BlockState): boolean {
        return context.frostWalker !== 0 && state.name === "water" && Number(state.get("liquid_depth") ?? 0) === 0 && !state.waterlogged;
    },

    canUseFrostWalkerCtx(ctx: IPlayerContext, pos: Vec3): boolean {
        const hasFrostWalker = ctx.player().armorEnchantmentLevel("frost_walker");
        const state = ctx.bsi().get(pos);
        return hasFrostWalker > 0 && state.name === "water" && Number(state.get("liquid_depth") ?? 0) === 0 && !state.waterlogged;
    },

    mustBeSolidToWalkOn(context: CalculationContext, x: number, y: number, z: number, state: BlockState): boolean {
        if (Blocks.isClimbable(state)) {
            return false;
        }
        if (state.hasFluid()) {
            if (Blocks.isSlab(state)) {
                if (!Blocks.isBottomSlab(state)) {
                    return true;
                }
            } else if (Blocks.isStairs(state)) {
                if (state.get("upside_down_bit") === true) {
                    return true;
                }
            } else if (Blocks.isTrapdoor(state)) {
                if (!Blocks.isOpen(state) && state.get("upside_down_bit") === true) {
                    return true;
                }
            } else if (Blocks.isScaffolding(state)) {
                return true;
            } else if (Blocks.isLeaves(state)) {
                return true;
            }
            if (context.assumeWalkOnWater) {
                return false;
            }
            const blockAbove = context.get(x, y + 1, z);
            if (Blocks.isLiquidBlock(blockAbove)) {
                return false;
            }
        }
        return true;
    },

    canPlaceAgainst(context: CalculationContext, x: number, y: number, z: number, state?: BlockState): boolean {
        return context.bsi.worldBorder.canPlaceAt(x, z) && context.precomputedData.canPlaceAgainst(state ?? context.get(x, y, z));
    },

    canPlaceAgainstBsi(bsi: BlockStateInterface, x: number, y: number, z: number, state?: BlockState): boolean {
        if (!bsi.worldBorder.canPlaceAt(x, z)) {
            return false;
        }
        state = state ?? bsi.get0(x, y, z);
        return MovementHelper.isBlockNormalCube(state) || Blocks.isGlass(state);
    },

    canPlaceAgainstCtx(ctx: IPlayerContext, pos: Vec3): boolean {
        return MovementHelper.canPlaceAgainstBsi(ctx.bsi(), pos.x, pos.y, pos.z);
    },

    isClimbable(state: BlockState): boolean {
        return Blocks.isClimbable(state);
    },

    getMiningDurationTicks(context: CalculationContext, x: number, y: number, z: number, state: BlockState | undefined, includeFalling: boolean): number {
        state = state ?? context.get(x, y, z);
        const cache = includeFalling ? context.miningCacheFalling : context.miningCache;
        if (!cache) {
            return MovementHelper.getMiningDurationTicks0(context, x, y, z, state, includeFalling);
        }
        const key = BetterBlockPos.longHash(x, y, z);
        const hit = cache.get(key);
        if (hit !== undefined) {
            return hit;
        }
        const result = MovementHelper.getMiningDurationTicks0(context, x, y, z, state, includeFalling);
        cache.set(key, result);
        return result;
    },

    getMiningDurationTicks0(context: CalculationContext, x: number, y: number, z: number, state: BlockState, includeFalling: boolean): number {
        if (!MovementHelper.canWalkThrough(context, x, y, z, state)) {
            if (state.hasFluid()) {
                return COST_INF;
            }
            const mult = context.breakCostMultiplierAt(x, y, z, state);
            if (mult >= COST_INF) {
                return COST_INF;
            }
            if (MovementHelper.avoidBreaking(context, x, y, z, state)) {
                return COST_INF;
            }
            const strVsBlock = context.toolSet.getStrVsBlock(state);
            if (strVsBlock <= 0) {
                return COST_INF;
            }
            let result = 1 / strVsBlock;
            result += context.breakBlockAdditionalCost;
            result *= mult;
            if (includeFalling) {
                const above = context.get(x, y + 1, z);
                if (Blocks.isFalling(above)) {
                    result += MovementHelper.getMiningDurationTicks(context, x, y + 1, z, above, true);
                }
            }
            return result;
        }
        return 0;
    },

    isBottomSlab(state: BlockState): boolean {
        return Blocks.isBottomSlab(state);
    },

    switchToBestToolFor(ctx: IPlayerContext, b: BlockState, ts?: ToolSet, preferSilkTouch = settings.preferSilkTouch.value): void {
        if (settings.autoTool.value && !settings.assumeExternalAutoTool.value) {
            const toolSet = ts ?? new ToolSet(ctx.player().inventory().items.slice(0, 9));
            ctx.player().setSelectedSlot(toolSet.getBestSlot(b, preferSilkTouch));
        }
    },

    moveTowards(ctx: IPlayerContext, state: MovementState, pos: Vec3): void {
        state
            .setTarget(new MovementTarget(RotationUtils.calcRotationFromVec3d(ctx.playerHead(), blockCenter(pos), ctx.playerRotations()).withPitch(ctx.playerRotations().pitch), false))
            .setInput(Input.MOVE_FORWARD, true);
    },

    moveTowardsWithoutRotation(ctx: IPlayerContext, state: MovementState, idealYaw: number): void {
        const yaw = ctx.playerRotations().yaw;
        const options = movementOptions(Math.sin(yaw * DEG_TO_RAD), Math.cos(yaw * DEG_TO_RAD), settings.allowSprint.value);
        const ix = Math.sin(idealYaw * DEG_TO_RAD);
        const iz = Math.cos(idealYaw * DEG_TO_RAD);
        let best = options[0];
        let bestD = Infinity;
        for (const o of options) {
            const d = Math.abs(o.motionX - ix) + Math.abs(o.motionZ - iz);
            if (d < bestD) {
                bestD = d;
                best = o;
            }
        }
        state.setInput(best.input1, true);
        if (best.input2) state.setInput(best.input2, true);
    },

    moveTowardsWithSlightRotation(ctx: IPlayerContext, state: MovementState, dest: Vec3): void {
        const idealYaw = RotationUtils.calcRotationFromVec3d(ctx.playerHead(), blockCenter(dest), ctx.playerRotations()).yaw;
        const distance = Rotation.yawDistanceFromOffset(ctx.playerRotations().yaw, idealYaw) % 45;
        const newYaw = distance > 0 ? (distance > 22.5 ? distance - 45 : distance) : distance < -22.5 ? distance + 45 : distance;
        state.setTarget(new MovementTarget(new Rotation(ctx.playerRotations().yaw - newYaw, ctx.playerRotations().pitch), true));
        MovementHelper.moveTowardsWithoutRotation(ctx, state, idealYaw);
    },

    isWater(state: BlockState): boolean {
        return state.fluid === Fluid.WATER;
    },

    isWaterCtx(ctx: IPlayerContext, pos: Vec3): boolean {
        return MovementHelper.isWater(ctx.bsi().get(pos));
    },

    isLava(state: BlockState): boolean {
        return state.fluid === Fluid.LAVA;
    },

    isLiquidCtx(ctx: IPlayerContext, pos: Vec3): boolean {
        return ctx.bsi().get(pos).hasFluid();
    },

    isLiquid(state: BlockState): boolean {
        return state.hasFluid();
    },

    possiblyFlowing(state: BlockState): boolean {
        return state.hasFluid() && state.fluidAmount !== 8;
    },

    isFlowing(x: number, y: number, z: number, state: BlockState, bsi: BlockStateInterface): boolean {
        if (!state.hasFluid()) {
            return false;
        }
        if (state.fluidAmount !== 8) {
            return true;
        }
        return (
            MovementHelper.possiblyFlowing(bsi.get0(x + 1, y, z)) ||
            MovementHelper.possiblyFlowing(bsi.get0(x - 1, y, z)) ||
            MovementHelper.possiblyFlowing(bsi.get0(x, y, z + 1)) ||
            MovementHelper.possiblyFlowing(bsi.get0(x, y, z - 1))
        );
    },

    isBlockNormalCube(state: BlockState): boolean {
        if (
            Blocks.isBambooStalk(state) ||
            Blocks.isMovingPiston(state) ||
            Blocks.isScaffolding(state) ||
            Blocks.isShulkerBox(state) ||
            Blocks.isPointedDripstone(state) ||
            Blocks.isAmethystCluster(state)
        ) {
            return false;
        }
        return state.fullCube;
    },

    openDoors(ctx: IPlayerContext, state: MovementState, from: BetterBlockPos, to: BetterBlockPos): boolean {
        const direction = ALL_DIRECTIONS.find((d) => from.relative(d).equals(to));
        if (!direction) return true;
        for (const pos of [from, to, from.above(), to.above()]) {
            const side = pos.equals(to) || pos.equals(to.above()) ? direction : opposite(direction);
            const door = ctx.bsi().get(pos);
            if (Blocks.isWoodenDoor(door) && !MovementHelper.isDoorPassable(door, side)) {
                state.setTarget(new MovementTarget(RotationUtils.calcRotationFromVec3d(ctx.playerHead(), calculateBlockCenter(ctx, pos), ctx.playerRotations()), true)).setInput(Input.CLICK_RIGHT, true);
                return false;
            }
        }
        return true;
    },

    attemptToPlaceABlock(state: MovementState, baritone: IBaritone, placeAt: BetterBlockPos, preferDown: boolean, wouldSneak: boolean): PlaceResult {
        const ctx = baritone.getPlayerContext();
        const direct = reachable(ctx, placeAt, ctx.blockReachDistance(), wouldSneak);
        let found = false;
        if (direct) {
            state.setTarget(new MovementTarget(direct, true));
            found = true;
        }
        for (let i = 0; i < 5; i++) {
            const against1 = placeAt.relative(HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP[i]);
            if (MovementHelper.canPlaceAgainstCtx(ctx, against1)) {
                if (!baritone.getInventoryBehavior().selectThrowawayForLocation(false, placeAt.x, placeAt.y, placeAt.z)) {
                    baritone.logDebug("bb pls get me some blocks. dirt, netherrack, cobble");
                    state.setStatus(MovementStatus.UNREACHABLE);
                    return PlaceResult.NO_OPTION;
                }
                const faceX = (placeAt.x + against1.x + 1.0) * 0.5;
                const faceY = (placeAt.y + against1.y + 0.5) * 0.5;
                const faceZ = (placeAt.z + against1.z + 1.0) * 0.5;
                const eyes = wouldSneak ? inferSneakingEyePosition(ctx) : ctx.playerHead();
                const place = RotationUtils.calcRotationFromVec3d(eyes, { x: faceX, y: faceY, z: faceZ }, ctx.playerRotations());
                const actual = baritone.getLookBehavior().getAimProcessor().peekRotation(place);
                const res = ctx.rayTraceTowards(actual, ctx.blockReachDistance(), wouldSneak);
                if (res && res.pos.equals(against1) && res.pos.relative(res.direction).equals(placeAt)) {
                    state.setTarget(new MovementTarget(place, true));
                    found = true;
                    if (!preferDown) {
                        break;
                    }
                }
            }
        }
        const selectedBlock = ctx.getSelectedBlock();
        if (selectedBlock) {
            const side = ctx.objectMouseOver()!.direction;
            if (selectedBlock.equals(placeAt) || (MovementHelper.canPlaceAgainstCtx(ctx, selectedBlock) && selectedBlock.relative(side).equals(placeAt))) {
                if (wouldSneak) {
                    state.setInput(Input.SNEAK, true);
                }
                baritone.getInventoryBehavior().selectThrowawayForLocation(true, placeAt.x, placeAt.y, placeAt.z);
                return PlaceResult.READY_TO_PLACE;
            }
        }
        if (found) {
            if (wouldSneak) {
                state.setInput(Input.SNEAK, true);
            }
            baritone.getInventoryBehavior().selectThrowawayForLocation(true, placeAt.x, placeAt.y, placeAt.z);
            return PlaceResult.ATTEMPTING;
        }
        return PlaceResult.NO_OPTION;
    },

    isTransparent(state: BlockState): boolean {
        return Blocks.isAir(state) || state.name === "lava" || state.name === "water";
    },

    steppingOnBlocks(ctx: IPlayerContext): BetterBlockPos[] {
        const blocks: BetterBlockPos[] = [];
        const p = ctx.player().position();
        const bx = Math.floor(p.x);
        const by = Math.floor(p.y);
        const bz = Math.floor(p.z);
        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                const minX = bx + x;
                const minZ = bz + z;
                if (p.x + 0.3 > minX && p.x - 0.3 < minX + 1 && p.z + 0.3 > minZ && p.z - 0.3 < minZ + 1) {
                    blocks.push(new BetterBlockPos(bx + x, by - 1, bz + z));
                }
            }
        }
        return blocks;
    },
};

export function inferSneakingEyePosition(ctx: IPlayerContext): Vec3 {
    const p = ctx.player().position();
    return { x: p.x, y: p.y + ctx.player().sneakingEyeHeight(), z: p.z };
}

export function isFlowingFluidType(state: BlockState): boolean {
    return state.hasFluid() && !state.waterlogged && Number(state.get("liquid_depth") ?? 0) !== 0;
}

function isFree(state: BlockState): boolean {
    return Blocks.isAir(state) || Blocks.isFire(state) || state.hasFluid() || canBeReplaced(state);
}

function clockWise(d: Direction): Direction {
    switch (d) {
        case Directions.NORTH:
            return Directions.EAST;
        case Directions.EAST:
            return Directions.SOUTH;
        case Directions.SOUTH:
            return Directions.WEST;
        default:
            return Directions.NORTH;
    }
}

function counterClockWise(d: Direction): Direction {
    switch (d) {
        case Directions.NORTH:
            return Directions.WEST;
        case Directions.WEST:
            return Directions.SOUTH;
        case Directions.SOUTH:
            return Directions.EAST;
        default:
            return Directions.NORTH;
    }
}

interface MovementOption {
    input1: Input;
    input2?: Input;
    motionX: number;
    motionZ: number;
}

function movementOptions(motionX: number, motionZ: number, canSprint: boolean): MovementOption[] {
    const SPRINT = 1.3;
    const fx = canSprint ? motionX * SPRINT : motionX;
    const fz = canSprint ? motionZ * SPRINT : motionZ;
    return [
        { input1: Input.MOVE_FORWARD, motionX: fx, motionZ: fz },
        { input1: Input.MOVE_BACK, motionX: -motionX, motionZ: -motionZ },
        { input1: Input.MOVE_LEFT, motionX: -motionZ, motionZ: motionX },
        { input1: Input.MOVE_RIGHT, motionX: motionZ, motionZ: -motionX },
        { input1: Input.MOVE_FORWARD, input2: Input.MOVE_LEFT, motionX: fx - motionZ, motionZ: fz + motionX },
        { input1: Input.MOVE_FORWARD, input2: Input.MOVE_RIGHT, motionX: fx + motionZ, motionZ: fz - motionX },
        { input1: Input.MOVE_BACK, input2: Input.MOVE_LEFT, motionX: -motionX - motionZ, motionZ: -motionZ + motionX },
        { input1: Input.MOVE_BACK, input2: Input.MOVE_RIGHT, motionX: -motionX + motionZ, motionZ: -motionZ - motionX },
    ];
}

export { AIR };
