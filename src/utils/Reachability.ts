import { settings } from "../Settings";
import { Blocks } from "../world/Blocks";
import { BetterBlockPos, blockCenter, Vec3 } from "./BetterBlockPos";
import type { IPlayerContext } from "./IPlayerContext";
import { Rotation, RotationUtils } from "./Rotation";
import { inferSneakingEyePosition } from "../movement/MovementHelper";

const BLOCK_SIDE_MULTIPLIERS: Vec3[] = [
    { x: 0.5, y: 0, z: 0.5 },
    { x: 0.5, y: 1, z: 0.5 },
    { x: 0.5, y: 0.5, z: 0 },
    { x: 0.5, y: 0.5, z: 1 },
    { x: 0, y: 0.5, z: 0.5 },
    { x: 1, y: 0.5, z: 0.5 },
];

export function calculateBlockCenter(ctx: IPlayerContext, pos: Vec3): Vec3 {
    const b = ctx.bsi().get(pos);
    const bounds = b.bounds();
    if (!bounds) {
        return blockCenter(pos);
    }
    let yDiff = (bounds[1] + bounds[4]) / 2;
    if (Blocks.isFire(b)) {
        yDiff = 0;
    }
    return { x: pos.x + (bounds[0] + bounds[3]) / 2, y: pos.y + yDiff, z: pos.z + (bounds[2] + bounds[5]) / 2 };
}

export function distanceToCenter(pos: Vec3, x: number, y: number, z: number): number {
    const dx = pos.x + 0.5 - x;
    const dy = pos.y + 0.5 - y;
    const dz = pos.z + 0.5 - z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function entityDistanceToCenter(position: Vec3, pos: Vec3): number {
    return distanceToCenter(pos, position.x, position.y, position.z);
}

export function entityFlatDistanceToCenter(position: Vec3, pos: Vec3): number {
    return distanceToCenter(pos, position.x, pos.y + 0.5, position.z);
}

export function reachable(ctx: IPlayerContext, pos: BetterBlockPos, blockReachDistance = ctx.blockReachDistance(), wouldSneak = false): Rotation | null {
    if (settings.remainWithExistingLookDirection.value && ctx.isLookingAt(pos)) {
        const hypothetical = ctx.playerRotations().add(new Rotation(0, 0.0001));
        if (wouldSneak) {
            const result = ctx.rayTraceTowards(hypothetical, blockReachDistance, true);
            if (result && result.pos.equals(pos)) {
                return hypothetical;
            }
        } else {
            return hypothetical;
        }
    }
    let possibleRotation = reachableCenter(ctx, pos, blockReachDistance, wouldSneak);
    if (possibleRotation) {
        return possibleRotation;
    }
    const state = ctx.bsi().get(pos);
    const shape = state.bounds() ?? [0, 0, 0, 1, 1, 1];
    for (const sideOffset of BLOCK_SIDE_MULTIPLIERS) {
        const xDiff = shape[0] * sideOffset.x + shape[3] * (1 - sideOffset.x);
        const yDiff = shape[1] * sideOffset.y + shape[4] * (1 - sideOffset.y);
        const zDiff = shape[2] * sideOffset.z + shape[5] * (1 - sideOffset.z);
        possibleRotation = reachableOffset(ctx, pos, { x: pos.x + xDiff, y: pos.y + yDiff, z: pos.z + zDiff }, blockReachDistance, wouldSneak);
        if (possibleRotation) {
            return possibleRotation;
        }
    }
    return null;
}

export function reachableOffset(ctx: IPlayerContext, pos: BetterBlockPos, offsetPos: Vec3, blockReachDistance: number, wouldSneak: boolean): Rotation | null {
    const eyes = wouldSneak ? inferSneakingEyePosition(ctx) : ctx.playerHead();
    const rotation = RotationUtils.calcRotationFromVec3d(eyes, offsetPos, ctx.playerRotations());
    const actualRotation = ctx.peekRotation(rotation);
    const result = ctx.rayTraceTowards(actualRotation, blockReachDistance, wouldSneak);
    if (result) {
        if (result.pos.equals(pos)) {
            return rotation;
        }
        if (Blocks.isFire(ctx.bsi().get(pos)) && result.pos.equals(pos.below())) {
            return rotation;
        }
    }
    return null;
}

export function reachableCenter(ctx: IPlayerContext, pos: BetterBlockPos, blockReachDistance: number, wouldSneak: boolean): Rotation | null {
    return reachableOffset(ctx, pos, calculateBlockCenter(ctx, pos), blockReachDistance, wouldSneak);
}
