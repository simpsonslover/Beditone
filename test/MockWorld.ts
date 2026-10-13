import { AIR, BlockState } from "../src/world/BlockState";
import type { WorldAccess } from "../src/world/BlockStateInterface";
import { BetterBlockPos } from "../src/utils/BetterBlockPos";
import { CalculationContext } from "../src/movement/CalculationContext";
import { ToolSet } from "../src/world/ToolSet";
import type { ItemInfo } from "../src/utils/IPlayerContext";
import { AStarPathFinder, PathCalculationResult, runToCompletion } from "../src/pathing/calc/AStarPathFinder";
import { Favoring } from "../src/pathing/calc/Favoring";
import type { Goal } from "../src/goals/Goal";

export const S = (id: string, states: Record<string, string | number | boolean> = {}) => BlockState.of(id, states);
export const STONE = S("stone");
export const DIRT = S("dirt");
export const GRASS = S("grass_block");
export const WATER = S("water", { liquid_depth: 0 });
export const LAVA = S("lava", { liquid_depth: 0 });
export const BEDROCK = S("bedrock");

export class MockWorld implements WorldAccess {
    readonly minY = -64;
    readonly maxY = 319;
    readonly dimensionId = "minecraft:overworld";
    private readonly blocks = new Map<number, BlockState>();
    reads = 0;

    constructor(private readonly radiusChunks = 8) {}

    isLoaded(x: number, z: number): boolean {
        return Math.abs(x >> 4) <= this.radiusChunks && Math.abs(z >> 4) <= this.radiusChunks;
    }

    getState(x: number, y: number, z: number): BlockState {
        this.reads++;
        if (!this.isLoaded(x, z)) return AIR;
        return this.blocks.get(BetterBlockPos.longHash(x, y, z)) ?? AIR;
    }

    set(x: number, y: number, z: number, s: BlockState): this {
        if (s === AIR) this.blocks.delete(BetterBlockPos.longHash(x, y, z));
        else this.blocks.set(BetterBlockPos.longHash(x, y, z), s);
        return this;
    }

    fill(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, s: BlockState): this {
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
            for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
                for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) this.set(x, y, z, s);
        return this;
    }

    static flat(r = 40): MockWorld {
        return new MockWorld().fill(-r, 60, -r, r, 63, r, STONE);
    }
}

const item = (typeId: string, amount = 1): ItemInfo => ({ typeId, amount, damage: 0, maxDamage: 0, enchantments: {} });

export interface Options {
    throwaway?: boolean;
    sprint?: boolean;
    waterBucket?: boolean;
    tools?: boolean;
}

export function context(world: WorldAccess, opts: Options = {}): CalculationContext {
    const hotbar = opts.tools === false ? [] : [item("minecraft:diamond_pickaxe"), item("minecraft:diamond_shovel"), item("minecraft:diamond_axe")];
    return new CalculationContext({
        world,
        toolSet: new ToolSet(hotbar),
        hasThrowaway: opts.throwaway ?? true,
        hasWaterBucket: opts.waterBucket ?? false,
        canSprint: opts.sprint ?? true,
        frostWalker: 0,
        waterSpeedMultiplier: 0,
        baritone: null,
    });
}

export function search(world: WorldAccess, start: BetterBlockPos, goal: Goal, opts: Options = {}, primary = 2000, failure = 4000): PathCalculationResult {
    const ctx = context(world, opts);
    const finder = new AStarPathFinder(start, start.x, start.y, start.z, goal, new Favoring(null, ctx), ctx);
    return runToCompletion(finder.calculate(primary, failure));
}
