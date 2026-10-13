import { settings, maybeCensor } from "../Settings";
import { BetterBlockPos, Direction, Vec3 } from "../utils/BetterBlockPos";
import { FALL_N_BLOCKS_COST, JUMP_ONE_BLOCK_COST } from "../movement/ActionCosts";

export interface Goal {
    isInGoal(x: number, y: number, z: number): boolean;
    heuristic(x: number, y: number, z: number): number;
    heuristicAtGoal(): number;
    equals(o: Goal | null | undefined): boolean;
    toString(): string;
}

export interface GoalRenderPos {
    getGoalPos(): BetterBlockPos;
}

export function hasGoalPos(g: Goal): g is Goal & GoalRenderPos {
    return typeof (g as unknown as GoalRenderPos).getGoalPos === "function";
}

export function isInGoalPos(goal: Goal, pos: Vec3): boolean {
    return goal.isInGoal(pos.x, pos.y, pos.z);
}

export function goalsEqual(a: Goal | null | undefined, b: Goal | null | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.equals(b);
}

export abstract class AbstractGoal implements Goal {
    abstract isInGoal(x: number, y: number, z: number): boolean;
    abstract heuristic(x: number, y: number, z: number): number;

    heuristicAtGoal(): number {
        return 0;
    }

    isInGoalPos(pos: Vec3): boolean {
        return this.isInGoal(pos.x, pos.y, pos.z);
    }

    equals(o: Goal | null | undefined): boolean {
        return this === o;
    }
}

export class GoalYLevel extends AbstractGoal {
    constructor(readonly level: number) {
        super();
    }

    isInGoal(_x: number, y: number, _z: number): boolean {
        return y === this.level;
    }

    heuristic(_x: number, y: number, _z: number): number {
        return GoalYLevel.calculate(this.level, y);
    }

    static calculate(goalY: number, currentY: number): number {
        if (currentY > goalY) {
            return (FALL_N_BLOCKS_COST[2] / 2) * (currentY - goalY);
        }
        if (currentY < goalY) {
            return (goalY - currentY) * JUMP_ONE_BLOCK_COST;
        }
        return 0;
    }

    override equals(o: Goal | null | undefined): boolean {
        return o instanceof GoalYLevel && o.constructor === GoalYLevel && o.level === this.level;
    }

    override toString(): string {
        return `GoalYLevel{y=${maybeCensor(this.level)}}`;
    }
}

const SQRT_2 = Math.sqrt(2);

export class GoalXZ extends AbstractGoal {
    constructor(private readonly x: number, private readonly z: number) {
        super();
    }

    static fromPos(pos: BetterBlockPos): GoalXZ {
        return new GoalXZ(pos.x, pos.z);
    }

    isInGoal(x: number, _y: number, z: number): boolean {
        return x === this.x && z === this.z;
    }

    heuristic(x: number, _y: number, z: number): number {
        return GoalXZ.calculate(x - this.x, z - this.z);
    }

    override equals(o: Goal | null | undefined): boolean {
        return !!o && o.constructor === this.constructor && (o as GoalXZ).x === this.x && (o as GoalXZ).z === this.z;
    }

    override toString(): string {
        return `GoalXZ{x=${maybeCensor(this.x)},z=${maybeCensor(this.z)}}`;
    }

    static calculate(xDiff: number, zDiff: number): number {
        const x = Math.abs(xDiff);
        const z = Math.abs(zDiff);
        let straight: number;
        let diagonal: number;
        if (x < z) {
            straight = z - x;
            diagonal = x;
        } else {
            straight = x - z;
            diagonal = z;
        }
        diagonal *= SQRT_2;
        return (diagonal + straight) * settings.costHeuristic.value;
    }

    static fromDirection(origin: Vec3, yaw: number, distance: number): GoalXZ {
        const theta = (yaw * Math.PI) / 180;
        const x = origin.x - Math.sin(theta) * distance;
        const z = origin.z + Math.cos(theta) * distance;
        return new GoalXZ(Math.floor(x), Math.floor(z));
    }

    getX(): number {
        return this.x;
    }

    getZ(): number {
        return this.z;
    }
}

export class GoalBlock extends AbstractGoal implements GoalRenderPos {
    constructor(readonly x: number, readonly y: number, readonly z: number) {
        super();
    }

    static of(pos: Vec3): GoalBlock {
        return new GoalBlock(pos.x, pos.y, pos.z);
    }

    isInGoal(x: number, y: number, z: number): boolean {
        return x === this.x && y === this.y && z === this.z;
    }

    heuristic(x: number, y: number, z: number): number {
        return GoalBlock.calculate(x - this.x, y - this.y, z - this.z);
    }

    override equals(o: Goal | null | undefined): boolean {
        return !!o && o.constructor === this.constructor && (o as GoalBlock).x === this.x && (o as GoalBlock).y === this.y && (o as GoalBlock).z === this.z;
    }

    override toString(): string {
        return `GoalBlock{x=${maybeCensor(this.x)},y=${maybeCensor(this.y)},z=${maybeCensor(this.z)}}`;
    }

    getGoalPos(): BetterBlockPos {
        return new BetterBlockPos(this.x, this.y, this.z);
    }

    static calculate(xDiff: number, yDiff: number, zDiff: number): number {
        let heuristic = 0;
        heuristic += GoalYLevel.calculate(0, yDiff);
        heuristic += GoalXZ.calculate(xDiff, zDiff);
        return heuristic;
    }
}

export class GoalTwoBlocks extends AbstractGoal implements GoalRenderPos {
    constructor(readonly x: number, readonly y: number, readonly z: number) {
        super();
    }

    static of(pos: Vec3): GoalTwoBlocks {
        return new GoalTwoBlocks(pos.x, pos.y, pos.z);
    }

    isInGoal(x: number, y: number, z: number): boolean {
        return x === this.x && (y === this.y || y === this.y - 1) && z === this.z;
    }

    heuristic(x: number, y: number, z: number): number {
        const yDiff = y - this.y;
        return GoalBlock.calculate(x - this.x, yDiff < 0 ? yDiff + 1 : yDiff, z - this.z);
    }

    getGoalPos(): BetterBlockPos {
        return new BetterBlockPos(this.x, this.y, this.z);
    }

    override equals(o: Goal | null | undefined): boolean {
        return !!o && o.constructor === this.constructor && (o as GoalTwoBlocks).x === this.x && (o as GoalTwoBlocks).y === this.y && (o as GoalTwoBlocks).z === this.z;
    }

    override toString(): string {
        return `GoalTwoBlocks{x=${maybeCensor(this.x)},y=${maybeCensor(this.y)},z=${maybeCensor(this.z)}}`;
    }
}

export class GoalGetToBlock extends AbstractGoal implements GoalRenderPos {
    readonly x: number;
    readonly y: number;
    readonly z: number;

    constructor(pos: Vec3) {
        super();
        this.x = pos.x;
        this.y = pos.y;
        this.z = pos.z;
    }

    getGoalPos(): BetterBlockPos {
        return new BetterBlockPos(this.x, this.y, this.z);
    }

    isInGoal(x: number, y: number, z: number): boolean {
        const xDiff = x - this.x;
        const yDiff = y - this.y;
        const zDiff = z - this.z;
        return Math.abs(xDiff) + Math.abs(yDiff < 0 ? yDiff + 1 : yDiff) + Math.abs(zDiff) <= 1;
    }

    heuristic(x: number, y: number, z: number): number {
        const yDiff = y - this.y;
        return GoalBlock.calculate(x - this.x, yDiff < 0 ? yDiff + 1 : yDiff, z - this.z);
    }

    override equals(o: Goal | null | undefined): boolean {
        return !!o && o.constructor === this.constructor && (o as GoalGetToBlock).x === this.x && (o as GoalGetToBlock).y === this.y && (o as GoalGetToBlock).z === this.z;
    }

    override toString(): string {
        return `GoalGetToBlock{x=${maybeCensor(this.x)},y=${maybeCensor(this.y)},z=${maybeCensor(this.z)}}`;
    }
}

export class GoalNear extends AbstractGoal implements GoalRenderPos {
    private readonly x: number;
    private readonly y: number;
    private readonly z: number;
    private readonly rangeSq: number;

    constructor(pos: Vec3, range: number) {
        super();
        this.x = pos.x;
        this.y = pos.y;
        this.z = pos.z;
        this.rangeSq = range * range;
    }

    isInGoal(x: number, y: number, z: number): boolean {
        const xDiff = x - this.x;
        const yDiff = y - this.y;
        const zDiff = z - this.z;
        return xDiff * xDiff + yDiff * yDiff + zDiff * zDiff <= this.rangeSq;
    }

    heuristic(x: number, y: number, z: number): number {
        return GoalBlock.calculate(x - this.x, y - this.y, z - this.z);
    }

    override heuristicAtGoal(): number {
        const range = Math.ceil(Math.sqrt(this.rangeSq));
        const maybeAlwaysInside = new Set<number>();
        let minOutside = Infinity;
        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                for (let dz = -range; dz <= range; dz++) {
                    const h = this.heuristic(this.x + dx, this.y + dy, this.z + dz);
                    if (h < minOutside && this.isInGoal(this.x + dx, this.y + dy, this.z + dz)) {
                        maybeAlwaysInside.add(h);
                    } else {
                        minOutside = Math.min(minOutside, h);
                    }
                }
            }
        }
        let maxInside = -Infinity;
        for (const inside of maybeAlwaysInside) {
            if (inside < minOutside) {
                maxInside = Math.max(maxInside, inside);
            }
        }
        return maxInside;
    }

    getGoalPos(): BetterBlockPos {
        return new BetterBlockPos(this.x, this.y, this.z);
    }

    override equals(o: Goal | null | undefined): boolean {
        if (!o || o.constructor !== this.constructor) return false;
        const g = o as GoalNear;
        return g.x === this.x && g.y === this.y && g.z === this.z && g.rangeSq === this.rangeSq;
    }

    override toString(): string {
        return `GoalNear{x=${maybeCensor(this.x)}, y=${maybeCensor(this.y)}, z=${maybeCensor(this.z)}, rangeSq=${this.rangeSq}}`;
    }
}

export class GoalComposite extends AbstractGoal {
    private readonly goals_: Goal[];

    constructor(...goals: Goal[]) {
        super();
        this.goals_ = goals;
    }

    isInGoal(x: number, y: number, z: number): boolean {
        for (const goal of this.goals_) {
            if (goal.isInGoal(x, y, z)) {
                return true;
            }
        }
        return false;
    }

    heuristic(x: number, y: number, z: number): number {
        let min = Number.MAX_VALUE;
        for (const g of this.goals_) {
            min = Math.min(min, g.heuristic(x, y, z));
        }
        return min;
    }

    override heuristicAtGoal(): number {
        let min = Number.MAX_VALUE;
        for (const g of this.goals_) {
            min = Math.min(min, g.heuristicAtGoal());
        }
        return min;
    }

    override equals(o: Goal | null | undefined): boolean {
        if (this === o) return true;
        if (!o || o.constructor !== this.constructor) return false;
        const other = (o as GoalComposite).goals_;
        if (other.length !== this.goals_.length) return false;
        for (let i = 0; i < other.length; i++) {
            if (!goalsEqual(other[i], this.goals_[i])) return false;
        }
        return true;
    }

    override toString(): string {
        return "GoalComposite[" + this.goals_.map((g) => g.toString()).join(", ") + "]";
    }

    goals(): Goal[] {
        return this.goals_;
    }
}

export class GoalInverted extends AbstractGoal {
    constructor(readonly origin: Goal) {
        super();
    }

    isInGoal(): boolean {
        return false;
    }

    heuristic(x: number, y: number, z: number): number {
        return -this.origin.heuristic(x, y, z);
    }

    override heuristicAtGoal(): number {
        return -Infinity;
    }

    override equals(o: Goal | null | undefined): boolean {
        return !!o && o.constructor === this.constructor && goalsEqual((o as GoalInverted).origin, this.origin);
    }

    override toString(): string {
        return `GoalInverted{${this.origin.toString()}}`;
    }
}

export class GoalRunAway extends AbstractGoal {
    private readonly from: BetterBlockPos[];
    private readonly distanceSq: number;
    private readonly maintainY: number | null;

    constructor(distance: number, maintainY: number | null, ...from: BetterBlockPos[]) {
        super();
        if (from.length === 0) {
            throw new Error("Positions to run away from must not be empty");
        }
        this.from = from;
        this.distanceSq = Math.trunc(distance * distance);
        this.maintainY = maintainY;
    }

    isInGoal(x: number, y: number, z: number): boolean {
        if (this.maintainY !== null && this.maintainY !== y) {
            return false;
        }
        for (const p of this.from) {
            const diffX = x - p.x;
            const diffZ = z - p.z;
            const distSq = diffX * diffX + diffZ * diffZ;
            if (distSq < this.distanceSq) {
                return false;
            }
        }
        return true;
    }

    heuristic(x: number, y: number, z: number): number {
        let min = Number.MAX_VALUE;
        for (const p of this.from) {
            const h = GoalXZ.calculate(p.x - x, p.z - z);
            if (h < min) {
                min = h;
            }
        }
        min = -min;
        if (this.maintainY !== null) {
            min = min * 0.6 + GoalYLevel.calculate(this.maintainY, y) * 1.5;
        }
        return min;
    }

    override heuristicAtGoal(): number {
        const distance = Math.ceil(Math.sqrt(this.distanceSq));
        let minX = Number.MAX_SAFE_INTEGER;
        let minY = Number.MAX_SAFE_INTEGER;
        let minZ = Number.MAX_SAFE_INTEGER;
        let maxX = Number.MIN_SAFE_INTEGER;
        let maxY = Number.MIN_SAFE_INTEGER;
        let maxZ = Number.MIN_SAFE_INTEGER;
        for (const p of this.from) {
            minX = Math.min(minX, p.x - distance);
            minY = Math.min(minY, p.y - distance);
            minZ = Math.min(minZ, p.z - distance);
            maxX = Math.max(minX, p.x + distance);
            maxY = Math.max(minY, p.y + distance);
            maxZ = Math.max(minZ, p.z + distance);
        }
        const maybeAlwaysInside = new Set<number>();
        let minOutside = Infinity;
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const h = this.heuristic(x, y, z);
                    if (h < minOutside && this.isInGoal(x, y, z)) {
                        maybeAlwaysInside.add(h);
                    } else {
                        minOutside = Math.min(minOutside, h);
                    }
                }
            }
        }
        let maxInside = -Infinity;
        for (const inside of maybeAlwaysInside) {
            if (inside < minOutside) {
                maxInside = Math.max(maxInside, inside);
            }
        }
        return maxInside;
    }

    override equals(o: Goal | null | undefined): boolean {
        if (!o || o.constructor !== this.constructor) return false;
        const g = o as GoalRunAway;
        return g.distanceSq === this.distanceSq && g.maintainY === this.maintainY && g.from.length === this.from.length && g.from.every((p, i) => p.equals(this.from[i]));
    }

    override toString(): string {
        const list = "[" + this.from.map((p) => p.toString()).join(", ") + "]";
        if (this.maintainY !== null) {
            return `GoalRunAwayFromMaintainY y=${maybeCensor(this.maintainY)}, ${list}`;
        }
        return "GoalRunAwayFrom" + list;
    }
}

const SQRT_2_OVER_2 = Math.sqrt(2) / 2;

export class GoalAxis extends AbstractGoal {
    isInGoal(x: number, y: number, z: number): boolean {
        return y === settings.axisHeight.value && (x === 0 || z === 0 || Math.abs(x) === Math.abs(z));
    }

    heuristic(x0: number, y: number, z0: number): number {
        const x = Math.abs(x0);
        const z = Math.abs(z0);
        const shrt = Math.min(x, z);
        const lng = Math.max(x, z);
        const diff = lng - shrt;
        const flatAxisDistance = Math.min(x, Math.min(z, diff * SQRT_2_OVER_2));
        return flatAxisDistance * settings.costHeuristic.value + GoalYLevel.calculate(settings.axisHeight.value, y);
    }

    override equals(o: Goal | null | undefined): boolean {
        return !!o && o.constructor === GoalAxis;
    }

    override toString(): string {
        return "GoalAxis";
    }
}

export class GoalStrictDirection extends AbstractGoal {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly dx: number;
    readonly dz: number;

    constructor(origin: Vec3, direction: Direction) {
        super();
        this.x = origin.x;
        this.y = origin.y;
        this.z = origin.z;
        this.dx = direction.x;
        this.dz = direction.z;
        if (this.dx === 0 && this.dz === 0) {
            throw new Error(String(direction.name));
        }
    }

    isInGoal(): boolean {
        return false;
    }

    heuristic(x: number, y: number, z: number): number {
        const distanceFromStartInDesiredDirection = (x - this.x) * this.dx + (z - this.z) * this.dz;
        const distanceFromStartInIncorrectDirection = Math.abs((x - this.x) * this.dz) + Math.abs((z - this.z) * this.dx);
        const verticalDistanceFromStart = Math.abs(y - this.y);
        let heuristic = -distanceFromStartInDesiredDirection * 100;
        heuristic += distanceFromStartInIncorrectDirection * 1000;
        heuristic += verticalDistanceFromStart * 1000;
        return heuristic;
    }

    override heuristicAtGoal(): number {
        return -Infinity;
    }

    override equals(o: Goal | null | undefined): boolean {
        if (!o || o.constructor !== this.constructor) return false;
        const g = o as GoalStrictDirection;
        return g.x === this.x && g.y === this.y && g.z === this.z && g.dx === this.dx && g.dz === this.dz;
    }

    override toString(): string {
        return `GoalStrictDirection{x=${maybeCensor(this.x)}, y=${maybeCensor(this.y)}, z=${maybeCensor(this.z)}, dx=${maybeCensor(this.dx)}, dz=${maybeCensor(this.dz)}}`;
    }
}
