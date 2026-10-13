import { AIR, BlockState } from "../world/BlockState";
import { Blocks } from "../world/Blocks";
import { BlockOptionalMeta, BlockOptionalMetaLookup } from "../world/BlockOptionalMeta";
import type { Selection } from "../selection/SelectionManager";
import type { Vec3 } from "../utils/BetterBlockPos";

export interface ISchematic {
    inSchematic(x: number, y: number, z: number, currentState: BlockState): boolean;
    desiredState(x: number, y: number, z: number, current: BlockState, approxPlaceable: BlockState[]): BlockState;
    reset(): void;
    widthX(): number;
    heightY(): number;
    lengthZ(): number;
}

export interface IStaticSchematic extends ISchematic {
    getDirect(x: number, y: number, z: number): BlockState;
    getColumn(x: number, z: number): BlockState[];
}

export abstract class AbstractSchematic implements ISchematic {
    constructor(protected x = 0, protected y = 0, protected z = 0) {}

    inSchematic(x: number, y: number, z: number, _currentState: BlockState): boolean {
        return x >= 0 && x < this.widthX() && y >= 0 && y < this.heightY() && z >= 0 && z < this.lengthZ();
    }

    abstract desiredState(x: number, y: number, z: number, current: BlockState, approxPlaceable: BlockState[]): BlockState;

    reset(): void {}

    widthX(): number {
        return this.x;
    }

    heightY(): number {
        return this.y;
    }

    lengthZ(): number {
        return this.z;
    }
}

export class StaticSchematic extends AbstractSchematic implements IStaticSchematic {
    constructor(protected readonly states: BlockState[][][], private readonly name = "schematic") {
        super();
        const empty = states.length === 0 || states[0].length === 0 || states[0][0].length === 0;
        this.x = empty ? 0 : states.length;
        this.z = empty ? 0 : states[0].length;
        this.y = empty ? 0 : states[0][0].length;
    }

    desiredState(x: number, y: number, z: number): BlockState {
        return this.states[x][z][y];
    }

    getDirect(x: number, y: number, z: number): BlockState {
        return this.states[x][z][y];
    }

    getColumn(x: number, z: number): BlockState[] {
        return this.states[x][z];
    }

    override toString(): string {
        return this.name;
    }
}

export class FillSchematic extends AbstractSchematic {
    constructor(x: number, y: number, z: number, private readonly bom: BlockOptionalMeta) {
        super(x, y, z);
    }

    getBom(): BlockOptionalMeta {
        return this.bom;
    }

    desiredState(_x: number, _y: number, _z: number, current: BlockState, approxPlaceable: BlockState[]): BlockState {
        if (this.bom.matches(current)) {
            return current;
        }
        for (const placeable of approxPlaceable) {
            if (this.bom.matches(placeable)) {
                return placeable;
            }
        }
        return BlockState.of(this.bom.typeId, this.bom.properties);
    }
}

export abstract class MaskSchematic extends AbstractSchematic {
    constructor(private readonly schematic: ISchematic) {
        super(schematic.widthX(), schematic.heightY(), schematic.lengthZ());
    }

    protected abstract partOfMask(x: number, y: number, z: number, currentState: BlockState): boolean;

    override inSchematic(x: number, y: number, z: number, currentState: BlockState): boolean {
        return this.schematic.inSchematic(x, y, z, currentState) && this.partOfMask(x, y, z, currentState);
    }

    desiredState(x: number, y: number, z: number, current: BlockState, approxPlaceable: BlockState[]): BlockState {
        return this.schematic.desiredState(x, y, z, current, approxPlaceable);
    }

    override reset(): void {
        this.schematic.reset();
    }

    static create(schematic: ISchematic, fn: (x: number, y: number, z: number, current: BlockState) => boolean): MaskSchematic {
        return new (class extends MaskSchematic {
            protected partOfMask(x: number, y: number, z: number, currentState: BlockState): boolean {
                return fn(x, y, z, currentState);
            }
        })(schematic);
    }
}

export class WallsSchematic extends MaskSchematic {
    protected partOfMask(x: number, _y: number, z: number): boolean {
        return x === 0 || z === 0 || x === this.widthX() - 1 || z === this.lengthZ() - 1;
    }
}

export class ShellSchematic extends MaskSchematic {
    protected partOfMask(x: number, y: number, z: number): boolean {
        return x === 0 || y === 0 || z === 0 || x === this.widthX() - 1 || y === this.heightY() - 1 || z === this.lengthZ() - 1;
    }
}

export class ReplaceSchematic extends MaskSchematic {
    private cache = new Map<number, boolean>();

    constructor(schematic: ISchematic, private readonly filter: BlockOptionalMetaLookup) {
        super(schematic);
    }

    override reset(): void {
        this.cache = new Map();
        super.reset();
    }

    protected partOfMask(x: number, y: number, z: number, currentState: BlockState): boolean {
        const key = (x * this.heightY() + y) * this.lengthZ() + z;
        let v = this.cache.get(key);
        if (v === undefined) {
            v = this.filter.has(currentState);
            this.cache.set(key, v);
        }
        return v;
    }
}

export function sphereMask(widthX: number, heightY: number, lengthZ: number, filled: boolean): (x: number, y: number, z: number) => boolean {
    const centerX = widthX / 2.0;
    const centerY = heightY / 2.0;
    const centerZ = lengthZ / 2.0;
    const radiusSqX = centerX * centerX;
    const radiusSqY = centerY * centerY;
    const radiusSqZ = centerZ * centerZ;
    const outside = (dx: number, dy: number, dz: number) => (dx * dx) / radiusSqX + (dy * dy) / radiusSqY + (dz * dz) / radiusSqZ > 1;
    return (x, y, z) => {
        const dx = Math.abs(x + 0.5 - centerX);
        const dy = Math.abs(y + 0.5 - centerY);
        const dz = Math.abs(z + 0.5 - centerZ);
        if (outside(dx, dy, dz)) {
            return false;
        }
        return filled || outside(dx + 1, dy, dz) || outside(dx, dy + 1, dz) || outside(dx, dy, dz + 1);
    };
}

export function cylinderMask(widthX: number, heightY: number, lengthZ: number, filled: boolean, alignment: "x" | "y" | "z"): (x: number, y: number, z: number) => boolean {
    const getA = (x: number, y: number) => (alignment === "x" ? y : x);
    const getB = (y: number, z: number) => (alignment === "z" ? y : z);
    const centerA = getA(widthX, heightY) / 2.0;
    const centerB = getB(heightY, lengthZ) / 2.0;
    const radiusSqA = (centerA - 1) * (centerA - 1);
    const radiusSqB = (centerB - 1) * (centerB - 1);
    const outside = (da: number, db: number) => (da * da) / radiusSqA + (db * db) / radiusSqB > 1;
    return (x, y, z) => {
        const da = Math.abs(getA(x, y) + 0.5 - centerA);
        const db = Math.abs(getB(y, z) + 0.5 - centerB);
        if (outside(da, db)) {
            return false;
        }
        return filled || outside(da + 1, db) || outside(da, db + 1);
    };
}

export function computeMask(w: number, h: number, l: number, fn: (x: number, y: number, z: number) => boolean): (x: number, y: number, z: number) => boolean {
    const grid = new Uint8Array(w * h * l);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < l; z++) grid[(x * h + y) * l + z] = fn(x, y, z) ? 1 : 0;
    return (x, y, z) => grid[(x * h + y) * l + z] === 1;
}

interface CompositeSchematicEntry {
    schematic: ISchematic;
    x: number;
    y: number;
    z: number;
}

export class CompositeSchematic extends AbstractSchematic {
    private readonly schematics: CompositeSchematicEntry[] = [];

    put(extra: ISchematic, x: number, y: number, z: number): void {
        this.schematics.push({ schematic: extra, x, y, z });
        for (const entry of this.schematics) {
            this.x = Math.max(this.x, entry.x + entry.schematic.widthX());
            this.y = Math.max(this.y, entry.y + entry.schematic.heightY());
            this.z = Math.max(this.z, entry.z + entry.schematic.lengthZ());
        }
    }

    private getSchematic(x: number, y: number, z: number, currentState: BlockState): CompositeSchematicEntry | null {
        for (const entry of this.schematics) {
            if (x >= entry.x && y >= entry.y && z >= entry.z && entry.schematic.inSchematic(x - entry.x, y - entry.y, z - entry.z, currentState)) {
                return entry;
            }
        }
        return null;
    }

    override inSchematic(x: number, y: number, z: number, currentState: BlockState): boolean {
        const entry = this.getSchematic(x, y, z, currentState);
        return entry !== null && entry.schematic.inSchematic(x - entry.x, y - entry.y, z - entry.z, currentState);
    }

    desiredState(x: number, y: number, z: number, current: BlockState, approxPlaceable: BlockState[]): BlockState {
        const entry = this.getSchematic(x, y, z, current);
        if (entry === null) {
            throw new Error("couldn't find schematic for this position");
        }
        return entry.schematic.desiredState(x - entry.x, y - entry.y, z - entry.z, current, approxPlaceable);
    }

    override reset(): void {
        for (const entry of this.schematics) {
            entry.schematic.reset();
        }
    }
}

export class SubstituteSchematic extends AbstractSchematic {
    constructor(private readonly schematic: ISchematic, private readonly substitutions: Map<string, string[]>) {
        super(schematic.widthX(), schematic.heightY(), schematic.lengthZ());
    }

    override inSchematic(x: number, y: number, z: number, currentState: BlockState): boolean {
        return this.schematic.inSchematic(x, y, z, currentState);
    }

    desiredState(x: number, y: number, z: number, current: BlockState, approxPlaceable: BlockState[]): BlockState {
        const desired = this.schematic.desiredState(x, y, z, current, approxPlaceable);
        const substitutes = this.substitutions.get(desired.typeId);
        if (!substitutes) {
            return desired;
        }
        if (substitutes.includes(current.typeId) && !Blocks.isAir(current)) {
            return BlockState.of(current.typeId, desired.states);
        }
        for (const substitute of substitutes) {
            if (substitute === "minecraft:air") {
                return Blocks.isAir(current) ? current : AIR;
            }
            for (const placeable of approxPlaceable) {
                if (substitute === placeable.typeId) {
                    return BlockState.of(placeable.typeId, desired.states);
                }
            }
        }
        return BlockState.of(substitutes[0]);
    }
}

export class RotatedSchematic extends AbstractSchematic {
    constructor(private readonly schematic: ISchematic, private readonly rotation: string) {
        super();
        const swap = rotation === "CLOCKWISE_90" || rotation === "COUNTERCLOCKWISE_90";
        this.x = swap ? schematic.lengthZ() : schematic.widthX();
        this.y = schematic.heightY();
        this.z = swap ? schematic.widthX() : schematic.lengthZ();
    }

    private src(x: number, z: number): [number, number] {
        const w = this.schematic.widthX();
        const l = this.schematic.lengthZ();
        switch (this.rotation) {
            case "CLOCKWISE_90":
                return [z, l - 1 - x];
            case "CLOCKWISE_180":
                return [w - 1 - x, l - 1 - z];
            case "COUNTERCLOCKWISE_90":
                return [w - 1 - z, x];
            default:
                return [x, z];
        }
    }

    override inSchematic(x: number, y: number, z: number, current: BlockState): boolean {
        const [sx, sz] = this.src(x, z);
        return this.schematic.inSchematic(sx, y, sz, current);
    }

    desiredState(x: number, y: number, z: number, current: BlockState, approxPlaceable: BlockState[]): BlockState {
        const [sx, sz] = this.src(x, z);
        return this.schematic.desiredState(sx, y, sz, current, approxPlaceable);
    }

    override reset(): void {
        this.schematic.reset();
    }
}

export class MirroredSchematic extends AbstractSchematic {
    constructor(private readonly schematic: ISchematic, private readonly mirror: string) {
        super(schematic.widthX(), schematic.heightY(), schematic.lengthZ());
    }

    private src(x: number, z: number): [number, number] {
        if (this.mirror === "FRONT_BACK") return [this.x - 1 - x, z];
        if (this.mirror === "LEFT_RIGHT") return [x, this.z - 1 - z];
        return [x, z];
    }

    override inSchematic(x: number, y: number, z: number, current: BlockState): boolean {
        const [sx, sz] = this.src(x, z);
        return this.schematic.inSchematic(sx, y, sz, current);
    }

    desiredState(x: number, y: number, z: number, current: BlockState, approxPlaceable: BlockState[]): BlockState {
        const [sx, sz] = this.src(x, z);
        return this.schematic.desiredState(sx, y, sz, current, approxPlaceable);
    }

    override reset(): void {
        this.schematic.reset();
    }
}

export class MapArtSchematic extends MaskSchematic {
    private readonly heightMap: number[][];

    constructor(schematic: IStaticSchematic) {
        super(schematic);
        this.heightMap = [];
        for (let x = 0; x < schematic.widthX(); x++) {
            this.heightMap.push([]);
            for (let z = 0; z < schematic.lengthZ(); z++) {
                const column = schematic.getColumn(x, z);
                let lowest = Number.MAX_SAFE_INTEGER;
                for (let y = column.length - 1; y >= 0; y--) {
                    if (!Blocks.isAir(column[y])) {
                        lowest = y;
                        break;
                    }
                }
                this.heightMap[x].push(lowest);
            }
        }
    }

    protected partOfMask(x: number, y: number, z: number): boolean {
        return y >= this.heightMap[x][z];
    }
}

export class SelectionSchematic extends MaskSchematic {
    private readonly boxes: [Vec3, Vec3][];

    constructor(schematic: ISchematic, origin: Vec3, selections: Selection[]) {
        super(schematic);
        this.boxes = selections.map((s) => [
            { x: s.min().x - origin.x, y: s.min().y - origin.y, z: s.min().z - origin.z },
            { x: s.max().x - origin.x, y: s.max().y - origin.y, z: s.max().z - origin.z },
        ]);
    }

    protected partOfMask(x: number, y: number, z: number): boolean {
        for (const [min, max] of this.boxes) {
            if (x >= min.x && y >= min.y && z >= min.z && x <= max.x && y <= max.y && z <= max.z) {
                return true;
            }
        }
        return false;
    }
}
