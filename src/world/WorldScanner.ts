import { BetterBlockPos } from "../utils/BetterBlockPos";
import type { IPlayerContext } from "../utils/IPlayerContext";
import type { BlockOptionalMetaLookup } from "./BlockOptionalMeta";

export interface BlockScanner {
    scanVolume(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, typeIds: string[]): BetterBlockPos[] | null;
}

export function getChunkRange(centerX: number, centerZ: number, chunkRadius: number): [number, number][] {
    const chunks: [number, number][] = [];
    chunks.push([centerX, centerZ]);
    for (let i = 1; i < chunkRadius; i++) {
        for (let j = 0; j <= i; j++) {
            chunks.push([centerX - j, centerZ - i]);
            if (j !== 0) {
                chunks.push([centerX + j, centerZ - i]);
                chunks.push([centerX - j, centerZ + i]);
            }
            chunks.push([centerX + j, centerZ + i]);
            if (j !== i) {
                chunks.push([centerX - i, centerZ - j]);
                chunks.push([centerX + i, centerZ - j]);
                if (j !== 0) {
                    chunks.push([centerX - i, centerZ + j]);
                    chunks.push([centerX + i, centerZ + j]);
                }
            }
        }
    }
    return chunks;
}

export function* scanChunkRadius(ctx: IPlayerContext, scanner: BlockScanner, filter: BlockOptionalMetaLookup, max: number, _yLevelThreshold: number, maxSearchRadius: number): Generator<void, BetterBlockPos[], void> {
    if (maxSearchRadius < 0) {
        throw new Error("chunkRange must be >= 0");
    }
    const feet = ctx.playerFeet();
    const world = ctx.world();
    const typeIds = filter.typeIds();
    const res: BetterBlockPos[] = [];
    const bsi = ctx.bsi();
    let start = Date.now();
    for (const [cx, cz] of getChunkRange(feet.x >> 4, feet.z >> 4, maxSearchRadius)) {
        if (!world.isLoaded(cx << 4, cz << 4)) {
            continue;
        }
        const found = scanner.scanVolume(cx << 4, world.minY, cz << 4, (cx << 4) + 15, world.maxY, (cz << 4) + 15, typeIds);
        if (found) {
            for (const p of found) {
                if (filter.has(bsi.get(p))) {
                    res.push(p);
                    if (max >= 0 && res.length >= max) {
                        return res;
                    }
                }
            }
        }
        if (Date.now() - start > 4) {
            yield;
            start = Date.now();
        }
    }
    return res;
}
