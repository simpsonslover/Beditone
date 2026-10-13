import { AIR, BlockState } from "../../../src/world/BlockState";
import type { WorldAccess } from "../../../src/world/BlockStateInterface";
import type { BlockScanner } from "../../../src/world/WorldScanner";
import { BetterBlockPos } from "../../../src/utils/BetterBlockPos";
import type { BlockPalette } from "./BlockPalette";

const SECTION = 4096;

class Section {
    readonly blocks: Uint16Array;
    readonly palette: BlockState[];

    constructor(blocks: Uint16Array, palette: BlockState[]) {
        this.blocks = blocks;
        this.palette = palette;
    }

    get(x: number, y: number, z: number): BlockState {
        return this.palette[this.blocks[(x << 8) | (z << 4) | y]];
    }

    set(x: number, y: number, z: number, state: BlockState): void {
        let i = this.palette.indexOf(state);
        if (i < 0) {
            i = this.palette.length;
            this.palette.push(state);
        }
        this.blocks[(x << 8) | (z << 4) | y] = i;
    }
}

class Column {
    readonly sections: (Section | null | undefined)[];

    constructor(count: number) {
        this.sections = new Array(count).fill(undefined);
    }
}

class Reader {
    pos = 0;
    constructor(readonly buf: Buffer) {}
    u8(): number {
        return this.buf[this.pos++];
    }
    i8(): number {
        const v = this.buf.readInt8(this.pos);
        this.pos++;
        return v;
    }
    u32(): number {
        const v = this.buf.readUInt32LE(this.pos);
        this.pos += 4;
        return v;
    }
    varint(): number {
        let result = 0;
        let shift = 0;
        for (;;) {
            const b = this.buf[this.pos++];
            result += (b & 0x7f) * 2 ** shift;
            if ((b & 0x80) === 0) return result;
            shift += 7;
        }
    }
    zigzag(): number {
        const v = this.varint();
        return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
    }
}

export class ChunkStore implements WorldAccess, BlockScanner {
    readonly minY: number;
    readonly maxY: number;
    private readonly minSection: number;
    private readonly columns = new Map<string, Column>();
    revision = 0;

    constructor(readonly dimensionId: string, private readonly palette: BlockPalette) {
        if (dimensionId === "minecraft:nether") {
            this.minY = 0;
            this.maxY = 127;
        } else if (dimensionId === "minecraft:the_end") {
            this.minY = 0;
            this.maxY = 255;
        } else {
            this.minY = -64;
            this.maxY = 319;
        }
        this.minSection = this.minY >> 4;
    }

    private key(cx: number, cz: number): string {
        return cx + "," + cz;
    }

    private column(cx: number, cz: number, create: boolean): Column | undefined {
        const k = this.key(cx, cz);
        let c = this.columns.get(k);
        if (!c && create) {
            c = new Column(((this.maxY + 1) >> 4) - this.minSection);
            this.columns.set(k, c);
        }
        return c;
    }

    clear(): void {
        this.columns.clear();
        this.revision++;
    }

    unload(cx: number, cz: number): void {
        this.columns.delete(this.key(cx, cz));
        this.revision++;
    }

    isLoaded(x: number, z: number): boolean {
        const c = this.columns.get(this.key(x >> 4, z >> 4));
        return c !== undefined && c.sections.some((s) => s !== undefined);
    }

    getState(x: number, y: number, z: number): BlockState {
        if (y < this.minY || y > this.maxY) return AIR;
        const c = this.columns.get(this.key(x >> 4, z >> 4));
        if (!c) return AIR;
        const s = c.sections[(y >> 4) - this.minSection];
        if (!s) return AIR;
        return s.get(x & 15, y & 15, z & 15);
    }

    setState(x: number, y: number, z: number, state: BlockState): void {
        if (y < this.minY || y > this.maxY) return;
        const c = this.column(x >> 4, z >> 4, true)!;
        const i = (y >> 4) - this.minSection;
        let s = c.sections[i];
        if (!s) {
            if (state === AIR && s === null) return;
            s = new Section(new Uint16Array(SECTION), [AIR]);
            c.sections[i] = s;
        }
        s.set(x & 15, y & 15, z & 15, state);
        this.revision++;
    }

    setRuntime(x: number, y: number, z: number, runtimeId: number, layer = 0): void {
        if (layer === 0) {
            this.setState(x, y, z, this.palette.state(runtimeId));
        } else if (layer === 1) {
            const base = this.getState(x, y, z);
            const water = this.palette.state(runtimeId).hasFluid();
            if (base.waterlogged !== water && base !== AIR) {
                this.setState(x, y, z, BlockState.of(base.typeId, base.states, water));
            }
        }
    }

    markAllAir(cx: number, sectionY: number, cz: number): void {
        const c = this.column(cx, cz, true)!;
        const i = sectionY - this.minSection;
        if (i >= 0 && i < c.sections.length) c.sections[i] = null;
        this.revision++;
    }

    decodeSubChunk(cx: number, sectionY: number, cz: number, payload: Buffer): void {
        const r = new Reader(payload);
        const version = r.u8();
        let storages = 1;
        if (version === 8 || version === 9) {
            storages = r.u8();
            if (version === 9) sectionY = r.i8();
        } else if (version !== 1) {
            throw new Error(`unsupported subchunk version ${version}`);
        }
        const layers: { blocks: Uint16Array; palette: BlockState[] }[] = [];
        for (let s = 0; s < storages; s++) {
            const header = r.u8();
            const bits = header >> 1;
            const blocks = new Uint16Array(SECTION);
            if (bits !== 0) {
                const perWord = Math.floor(32 / bits);
                const words = Math.ceil(SECTION / perWord);
                const mask = (1 << bits) - 1;
                let i = 0;
                for (let w = 0; w < words; w++) {
                    const word = r.u32();
                    for (let j = 0; j < perWord && i < SECTION; j++, i++) {
                        blocks[i] = (word >>> (j * bits)) & mask;
                    }
                }
            }
            const paletteSize = bits === 0 ? 1 : r.zigzag();
            const palette: BlockState[] = new Array(paletteSize);
            for (let p = 0; p < paletteSize; p++) palette[p] = this.palette.state(r.zigzag());
            layers.push({ blocks, palette });
        }
        const c = this.column(cx, cz, true)!;
        const index = sectionY - this.minSection;
        if (index < 0 || index >= c.sections.length) return;
        if (layers.length === 0) {
            c.sections[index] = null;
            this.revision++;
            return;
        }
        const base = layers[0];
        if (layers.length > 1) {
            const water = layers[1];
            if (water.palette.some((s) => s.hasFluid())) {
                const palette = base.palette.slice();
                const remap = new Map<string, number>();
                for (let i = 0; i < SECTION; i++) {
                    if (!water.palette[water.blocks[i]].hasFluid()) continue;
                    const st = palette[base.blocks[i]];
                    if (st === AIR || st.hasFluid() || st.waterlogged) continue;
                    const key = String(base.blocks[i]);
                    let idx = remap.get(key);
                    if (idx === undefined) {
                        idx = palette.length;
                        palette.push(BlockState.of(st.typeId, st.states, true));
                        remap.set(key, idx);
                    }
                    base.blocks[i] = idx;
                }
                base.palette = palette;
            }
        }
        c.sections[index] = new Section(base.blocks, base.palette);
        this.revision++;
    }

    decodeColumn(cx: number, cz: number, count: number, payload: Buffer): void {
        let offset = 0;
        for (let i = 0; i < count && offset < payload.length; i++) {
            const start = offset;
            offset = this.sectionLength(payload, offset);
            this.decodeSubChunk(cx, this.minSection + i, cz, payload.subarray(start, offset));
        }
    }

    private sectionLength(buf: Buffer, offset: number): number {
        const r = new Reader(buf);
        r.pos = offset;
        const version = r.u8();
        let storages = 1;
        if (version === 8 || version === 9) {
            storages = r.u8();
            if (version === 9) r.i8();
        }
        for (let s = 0; s < storages; s++) {
            const bits = r.u8() >> 1;
            if (bits !== 0) {
                const perWord = Math.floor(32 / bits);
                r.pos += Math.ceil(SECTION / perWord) * 4;
            }
            const paletteSize = bits === 0 ? 1 : r.zigzag();
            for (let p = 0; p < paletteSize; p++) r.zigzag();
        }
        return r.pos;
    }

    scanVolume(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, typeIds: string[]): BetterBlockPos[] | null {
        if (!this.isLoaded(minX, minZ)) return null;
        const want = new Set(typeIds.map((t) => (t.includes(":") ? t : "minecraft:" + t)));
        const out: BetterBlockPos[] = [];
        const y0 = Math.max(minY, this.minY);
        const y1 = Math.min(maxY, this.maxY);
        for (let sy = y0 >> 4; sy <= y1 >> 4; sy++) {
            const c = this.columns.get(this.key(minX >> 4, minZ >> 4));
            const s = c?.sections[sy - this.minSection];
            if (!s) continue;
            if (!s.palette.some((p) => want.has(p.typeId))) continue;
            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    for (let y = Math.max(y0, sy << 4); y <= Math.min(y1, (sy << 4) + 15); y++) {
                        if (want.has(s.get(x & 15, y & 15, z & 15).typeId)) out.push(new BetterBlockPos(x, y, z));
                    }
                }
            }
        }
        return out;
    }
}
