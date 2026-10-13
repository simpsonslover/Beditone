import { BetterBlockPos } from "../utils/BetterBlockPos";

export enum WaypointTag {
    HOME = "home",
    DEATH = "death",
    BED = "bed",
    USER = "user",
}

const TAG_NAMES: Record<WaypointTag, string[]> = {
    [WaypointTag.HOME]: ["home", "base"],
    [WaypointTag.DEATH]: ["death"],
    [WaypointTag.BED]: ["bed", "spawn"],
    [WaypointTag.USER]: ["user"],
};

export function tagByName(name: string): WaypointTag | null {
    for (const [tag, names] of Object.entries(TAG_NAMES)) {
        if (names.some((n) => n.toLowerCase() === name.toLowerCase())) {
            return tag as WaypointTag;
        }
    }
    return null;
}

export function allTagNames(): string[] {
    return Object.values(TAG_NAMES).flat();
}

export class Waypoint {
    constructor(readonly name: string, readonly tag: WaypointTag, readonly location: BetterBlockPos, readonly creationTimestamp: number = Date.now()) {}

    equals(o: Waypoint): boolean {
        return this.name === o.name && this.tag === o.tag && this.location.equals(o.location);
    }

    toString(): string {
        return `${this.name} ${this.location} ${new Date(this.creationTimestamp).toString()}`;
    }
}

export interface Storage {
    load(key: string): string | undefined;
    save(key: string, value: string): void;
}

export class WaypointCollection {
    private waypoints: Waypoint[] = [];

    constructor(private readonly storage: Storage, private readonly key: string) {
        const raw = storage.load(key);
        if (raw) {
            try {
                const arr = JSON.parse(raw) as [string, WaypointTag, number, number, number, number][];
                this.waypoints = arr.map(([n, t, x, y, z, ts]) => new Waypoint(n, t, new BetterBlockPos(x, y, z), ts));
            } catch {
                this.waypoints = [];
            }
        }
    }

    private persist(): void {
        this.storage.save(this.key, JSON.stringify(this.waypoints.map((w) => [w.name, w.tag, w.location.x, w.location.y, w.location.z, w.creationTimestamp])));
    }

    addWaypoint(waypoint: Waypoint): void {
        if (this.waypoints.some((w) => w.equals(waypoint))) return;
        this.waypoints.push(waypoint);
        this.persist();
    }

    removeWaypoint(waypoint: Waypoint): void {
        this.waypoints = this.waypoints.filter((w) => !(w.equals(waypoint) && w.creationTimestamp === waypoint.creationTimestamp));
        this.persist();
    }

    getMostRecentByTag(tag: WaypointTag): Waypoint | null {
        let best: Waypoint | null = null;
        for (const w of this.waypoints) {
            if (w.tag === tag && (best === null || w.creationTimestamp > best.creationTimestamp)) best = w;
        }
        return best;
    }

    getByTag(tag: WaypointTag): Waypoint[] {
        return this.waypoints.filter((w) => w.tag === tag);
    }

    getAllWaypoints(): Waypoint[] {
        return [...this.waypoints];
    }
}

export class ExploredChunks {
    private readonly seen = new Set<number>();

    static key(cx: number, cz: number): number {
        return (cx & 0x3fffff) * 4194304 + (cz & 0x3fffff);
    }

    mark(cx: number, cz: number): void {
        this.seen.add(ExploredChunks.key(cx, cz));
    }

    isCached(blockX: number, blockZ: number): boolean {
        return this.seen.has(ExploredChunks.key(blockX >> 4, blockZ >> 4));
    }

    size(): number {
        return this.seen.size;
    }
}

export class WorldData {
    readonly waypoints: WaypointCollection;
    readonly explored = new ExploredChunks();

    constructor(storage: Storage, ownerKey: string, readonly dimensionId: string) {
        this.waypoints = new WaypointCollection(storage, `beditone:wp:${ownerKey}:${dimensionId}`);
    }

    getWaypoints(): WaypointCollection {
        return this.waypoints;
    }
}
