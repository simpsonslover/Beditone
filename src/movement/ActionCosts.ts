function velocity(ticks: number): number {
    return (Math.pow(0.98, ticks) - 1) * -3.92;
}

export function distanceToTicks(distance: number): number {
    if (distance === 0) {
        return 0;
    }
    let tmpDistance = distance;
    let tickCount = 0;
    for (;;) {
        const fallDistance = velocity(tickCount);
        if (tmpDistance <= fallDistance) {
            return tickCount + tmpDistance / fallDistance;
        }
        tmpDistance -= fallDistance;
        tickCount++;
    }
}

function generateFallNBlocksCost(): number[] {
    const costs = new Array<number>(4097);
    for (let i = 0; i < 4097; i++) {
        costs[i] = distanceToTicks(i);
    }
    return costs;
}

export const WALK_ONE_BLOCK_COST = 20 / 4.317;
export const WALK_ONE_IN_WATER_COST = 20 / 2.2;
export const SWIM_ONE_BLOCK_COST = 20 / 2.86;
export const WALK_ONE_OVER_SOUL_SAND_COST = WALK_ONE_BLOCK_COST * 2;
export const LADDER_UP_ONE_COST = 20 / 2.35;
export const LADDER_DOWN_ONE_COST = 20 / 3.0;
export const SNEAK_ONE_BLOCK_COST = 20 / 1.3;
export const SPRINT_ONE_BLOCK_COST = 20 / 5.612;
export const SPRINT_MULTIPLIER = SPRINT_ONE_BLOCK_COST / WALK_ONE_BLOCK_COST;
export const WALK_OFF_BLOCK_COST = WALK_ONE_BLOCK_COST * 0.8;
export const CENTER_AFTER_FALL_COST = WALK_ONE_BLOCK_COST - WALK_OFF_BLOCK_COST;
export const COST_INF = 1000000;
export const FALL_N_BLOCKS_COST = generateFallNBlocksCost();
export const FALL_1_25_BLOCKS_COST = distanceToTicks(1.25);
export const FALL_0_25_BLOCKS_COST = distanceToTicks(0.25);
export const JUMP_ONE_BLOCK_COST = FALL_1_25_BLOCKS_COST - FALL_0_25_BLOCKS_COST;
