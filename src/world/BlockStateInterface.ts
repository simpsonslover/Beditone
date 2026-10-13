import { AIR, BlockState } from "./BlockState";
import type { Vec3 } from "../utils/BetterBlockPos";

export interface WorldAccess {
    readonly minY: number;
    readonly maxY: number;
    readonly dimensionId: string;
    isLoaded(x: number, z: number): boolean;
    getState(x: number, y: number, z: number): BlockState;
}

export class BetterWorldBorder {
    private static readonly LIMIT = 29_999_984;

    entirelyContains(x: number, z: number): boolean {
        return Math.abs(x) < BetterWorldBorder.LIMIT && Math.abs(z) < BetterWorldBorder.LIMIT;
    }

    canPlaceAt(x: number, z: number): boolean {
        return this.entirelyContains(x, z);
    }
}

const CHUNK_KEY = (cx: number, cz: number) => (cx & 0x3fffff) * 4194304 + (cz & 0x3fffff);

export class BlockStateInterface {
    readonly worldBorder = new BetterWorldBorder();
    readonly minY: number;
    readonly maxY: number;
    private readonly height: number;
    private cache: Map<number, (BlockState | undefined)[]> | null = null;
    private loadedCache: Map<number, boolean> | null = null;
    private prevKey = -1;
    private prevChunk: (BlockState | undefined)[] | null = null;

    constructor(readonly world: WorldAccess) {
        this.minY = world.minY;
        this.maxY = world.maxY;
        this.height = world.maxY - world.minY + 1;
    }

    claimCache(): void {
        this.cache = new Map();
        this.loadedCache = new Map();
        this.prevKey = -1;
        this.prevChunk = null;
    }

    releaseCache(): void {
        this.cache = null;
        this.loadedCache = null;
        this.prevKey = -1;
        this.prevChunk = null;
    }

    get(pos: Vec3): BlockState {
        return this.get0(pos.x, pos.y, pos.z);
    }

    get0(x: number, y: number, z: number): BlockState {
        if (y < this.minY || y > this.maxY) {
            return AIR;
        }
        const cache = this.cache;
        if (!cache) {
            return this.world.getState(x, y, z);
        }
        const key = CHUNK_KEY(x >> 4, z >> 4);
        let chunk: (BlockState | undefined)[] | undefined;
        if (key === this.prevKey && this.prevChunk) {
            chunk = this.prevChunk;
        } else {
            chunk = cache.get(key);
            if (!chunk) {
                if (!this.isLoaded(x, z)) {
                    return AIR;
                }
                chunk = new Array(this.height * 256);
                cache.set(key, chunk);
            }
            this.prevKey = key;
            this.prevChunk = chunk;
        }
        const idx = ((y - this.minY) << 8) | ((z & 15) << 4) | (x & 15);
        let s = chunk[idx];
        if (s === undefined) {
            s = this.world.getState(x, y, z);
            chunk[idx] = s;
        }
        return s;
    }

    isLoaded(x: number, z: number): boolean {
        const lc = this.loadedCache;
        if (!lc) {
            return this.world.isLoaded(x, z);
        }
        const key = CHUNK_KEY(x >> 4, z >> 4);
        let v = lc.get(key);
        if (v === undefined) {
            v = this.world.isLoaded(x, z);
            lc.set(key, v);
        }
        return v;
    }

    worldContainsLoadedChunk(x: number, z: number): boolean {
        return this.isLoaded(x, z);
    }

    invalidate(x: number, z: number): void {
        if (!this.cache) return;
        const key = CHUNK_KEY(x >> 4, z >> 4);
        this.cache.delete(key);
        if (key === this.prevKey) {
            this.prevKey = -1;
            this.prevChunk = null;
        }
    }
}
