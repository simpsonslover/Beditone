export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface Direction {
    readonly name: "down" | "up" | "north" | "south" | "west" | "east";
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly index: number;
}

function dir(name: Direction["name"], x: number, y: number, z: number, index: number): Direction {
    return Object.freeze({ name, x, y, z, index });
}

export const Directions = {
    DOWN: dir("down", 0, -1, 0, 0),
    UP: dir("up", 0, 1, 0, 1),
    NORTH: dir("north", 0, 0, -1, 2),
    SOUTH: dir("south", 0, 0, 1, 3),
    WEST: dir("west", -1, 0, 0, 4),
    EAST: dir("east", 1, 0, 0, 5),
} as const;

export const ALL_DIRECTIONS: readonly Direction[] = [Directions.DOWN, Directions.UP, Directions.NORTH, Directions.SOUTH, Directions.WEST, Directions.EAST];
export const HORIZONTALS: readonly Direction[] = [Directions.NORTH, Directions.SOUTH, Directions.WEST, Directions.EAST];
export const HORIZONTALS_2D: readonly Direction[] = [Directions.SOUTH, Directions.WEST, Directions.NORTH, Directions.EAST];

export function opposite(d: Direction): Direction {
    return ALL_DIRECTIONS[d.index ^ 1];
}

export function directionByName(name: string): Direction | undefined {
    return ALL_DIRECTIONS.find((d) => d.name === name.toLowerCase());
}

export class BetterBlockPos {
    static readonly ORIGIN = new BetterBlockPos(0, 0, 0);

    constructor(public readonly x: number, public readonly y: number, public readonly z: number) {}

    static of(v: Vec3): BetterBlockPos {
        return new BetterBlockPos(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z));
    }

    static longHash(x: number, y: number, z: number): number {
        return ((x & 0x1fffff) * 2097152 + (z & 0x1fffff)) * 1024 + ((y + 256) & 0x3ff);
    }

    hash(): number {
        return BetterBlockPos.longHash(this.x, this.y, this.z);
    }

    equals(o: { x: number; y: number; z: number } | null | undefined): boolean {
        return !!o && o.x === this.x && o.y === this.y && o.z === this.z;
    }

    above(amt = 1): BetterBlockPos {
        return amt === 0 ? this : new BetterBlockPos(this.x, this.y + amt, this.z);
    }

    below(amt = 1): BetterBlockPos {
        return amt === 0 ? this : new BetterBlockPos(this.x, this.y - amt, this.z);
    }

    north(amt = 1): BetterBlockPos {
        return amt === 0 ? this : new BetterBlockPos(this.x, this.y, this.z - amt);
    }

    south(amt = 1): BetterBlockPos {
        return amt === 0 ? this : new BetterBlockPos(this.x, this.y, this.z + amt);
    }

    east(amt = 1): BetterBlockPos {
        return amt === 0 ? this : new BetterBlockPos(this.x + amt, this.y, this.z);
    }

    west(amt = 1): BetterBlockPos {
        return amt === 0 ? this : new BetterBlockPos(this.x - amt, this.y, this.z);
    }

    relative(d: Direction, dist = 1): BetterBlockPos {
        return dist === 0 ? this : new BetterBlockPos(this.x + d.x * dist, this.y + d.y * dist, this.z + d.z * dist);
    }

    offset(dx: number | Vec3, dy?: number, dz?: number): BetterBlockPos {
        if (typeof dx === "object") {
            return new BetterBlockPos(this.x + dx.x, this.y + dx.y, this.z + dx.z);
        }
        return new BetterBlockPos(this.x + dx, this.y + (dy as number), this.z + (dz as number));
    }

    subtract(o: Vec3): BetterBlockPos {
        return new BetterBlockPos(this.x - o.x, this.y - o.y, this.z - o.z);
    }

    cross(o: Vec3): BetterBlockPos {
        return new BetterBlockPos(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x);
    }

    distSqr(o: Vec3): number {
        const dx = this.x - o.x;
        const dy = this.y - o.y;
        const dz = this.z - o.z;
        return dx * dx + dy * dy + dz * dz;
    }

    distanceTo(o: Vec3): number {
        return Math.sqrt(this.distSqr(o));
    }

    isZero(): boolean {
        return this.x === 0 && this.y === 0 && this.z === 0;
    }

    toString(): string {
        return `BetterBlockPos{x=${this.x},y=${this.y},z=${this.z}}`;
    }
}

export class PosSet {
    private readonly map = new Map<number, BetterBlockPos>();

    constructor(items?: Iterable<BetterBlockPos>) {
        if (items) {
            for (const p of items) this.add(p);
        }
    }

    add(p: BetterBlockPos): this {
        this.map.set(p.hash(), p);
        return this;
    }

    has(p: Vec3): boolean {
        return this.map.has(BetterBlockPos.longHash(p.x, p.y, p.z));
    }

    delete(p: Vec3): boolean {
        return this.map.delete(BetterBlockPos.longHash(p.x, p.y, p.z));
    }

    get size(): number {
        return this.map.size;
    }

    values(): IterableIterator<BetterBlockPos> {
        return this.map.values();
    }

    [Symbol.iterator](): IterableIterator<BetterBlockPos> {
        return this.map.values();
    }

    equals(o: PosSet): boolean {
        if (o.size !== this.size) return false;
        for (const k of this.map.keys()) {
            if (!o.map.has(k)) return false;
        }
        return true;
    }
}

export function listEquals(a: readonly BetterBlockPos[], b: readonly BetterBlockPos[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!a[i].equals(b[i])) return false;
    }
    return true;
}

export function indexOfPos(list: readonly BetterBlockPos[], p: Vec3 | null | undefined): number {
    if (!p) return -1;
    for (let i = 0; i < list.length; i++) {
        if (list[i].x === p.x && list[i].y === p.y && list[i].z === p.z) return i;
    }
    return -1;
}

export function vec(x: number, y: number, z: number): Vec3 {
    return { x, y, z };
}

export function blockCenter(p: Vec3): Vec3 {
    return { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
}
