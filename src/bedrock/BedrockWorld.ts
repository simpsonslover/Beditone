import { BlockVolume, Dimension } from "@minecraft/server";
import { BLOCKS } from "../world/blockdata.generated";
import { AIR, BlockState } from "../world/BlockState";
import type { WorldAccess } from "../world/BlockStateInterface";
import type { BlockScanner } from "../world/WorldScanner";
import { BetterBlockPos } from "../utils/BetterBlockPos";

const STATEFUL = new Set(
    "water flowing_water lava flowing_lava wheat carrots potatoes beetroot nether_wart cocoa sweet_berry_bush reeds bamboo cactus snow_layer bed farmland redstone_ore lit_redstone_ore".split(" "),
);

function needsStates(name: string): boolean {
    const d = BLOCKS[name];
    return (d !== undefined && d[4] >= 0) || STATEFUL.has(name);
}

const statesCache = new Map<string, boolean>();

export class BedrockWorld implements WorldAccess, BlockScanner {
    readonly minY: number;
    readonly maxY: number;
    readonly dimensionId: string;

    constructor(readonly dimension: Dimension) {
        this.minY = dimension.heightRange.min;
        this.maxY = dimension.heightRange.max - 1;
        this.dimensionId = dimension.id;
    }

    isLoaded(x: number, z: number): boolean {
        try {
            return this.dimension.isChunkLoaded({ x, y: this.minY, z });
        } catch {
            return false;
        }
    }

    getState(x: number, y: number, z: number): BlockState {
        let block;
        try {
            block = this.dimension.getBlock({ x, y, z });
        } catch {
            return AIR;
        }
        if (!block) return AIR;
        const typeId = block.typeId;
        if (typeId === "minecraft:air") return AIR;
        const name = typeId.startsWith("minecraft:") ? typeId.substring(10) : typeId;
        let stateful = statesCache.get(name);
        if (stateful === undefined) {
            stateful = needsStates(name);
            statesCache.set(name, stateful);
        }
        const simple = BlockState.ofSimple(typeId);
        let waterlogged = false;
        if (!simple.fullCube && simple.fluid === 0) {
            try {
                waterlogged = block.isWaterlogged;
            } catch {
                waterlogged = false;
            }
        }
        if (!stateful) {
            return waterlogged ? BlockState.of(typeId, {}, true) : simple;
        }
        return BlockState.of(typeId, block.permutation.getAllStates(), waterlogged);
    }

    scanVolume(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, typeIds: string[]): BetterBlockPos[] | null {
        try {
            const list = this.dimension.getBlocks(new BlockVolume({ x: minX, y: minY, z: minZ }, { x: maxX, y: maxY, z: maxZ }), { includeTypes: typeIds }, false);
            const out: BetterBlockPos[] = [];
            for (const loc of list.getBlockLocationIterator()) {
                out.push(new BetterBlockPos(loc.x, loc.y, loc.z));
            }
            return out;
        } catch {
            return null;
        }
    }
}
