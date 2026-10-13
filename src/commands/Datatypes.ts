import { Goal, GoalBlock, GoalXZ, GoalYLevel } from "../goals/Goal";
import { BetterBlockPos, Direction, directionByName } from "../utils/BetterBlockPos";
import type { EntityInfo } from "../utils/IPlayerContext";
import { BlockOptionalMeta } from "../world/BlockOptionalMeta";
import { tagByName, Waypoint } from "../cache/WorldData";
import type { IBaritone } from "../IBaritone";
import { ArgConsumer, CommandInvalidTypeException } from "./Command";

const COORD = /^(~?)([+-]?(?:\d+(?:\.\d*)?|\.\d+)([kKmM]?)|)$/;

export function relativeCoordinate(args: ArgConsumer, origin: number): number {
    const s = args.getString();
    const m = COORD.exec(s);
    if (!m) {
        throw new Error("pattern doesn't match");
    }
    const isRelative = m[1] !== "";
    let offset = m[2] === "" ? 0 : parseFloat(m[2].replace(/[kKmM]/g, ""));
    if (m[2].toLowerCase().includes("k")) offset *= 1000;
    if (m[2].toLowerCase().includes("m")) offset *= 1000000;
    return isRelative ? origin + offset : offset;
}

export function isCoordinate(s: string): boolean {
    return COORD.test(s) && s !== "";
}

export function relativeGoalBlock(args: ArgConsumer, origin: BetterBlockPos): GoalBlock {
    return new GoalBlock(Math.floor(relativeCoordinate(args, origin.x)), Math.floor(relativeCoordinate(args, origin.y)), Math.floor(relativeCoordinate(args, origin.z)));
}

export function relativeGoalXZ(args: ArgConsumer, origin: BetterBlockPos): GoalXZ {
    return new GoalXZ(Math.floor(relativeCoordinate(args, origin.x)), Math.floor(relativeCoordinate(args, origin.z)));
}

export function relativeGoalYLevel(args: ArgConsumer, origin: BetterBlockPos): GoalYLevel {
    return new GoalYLevel(Math.floor(relativeCoordinate(args, origin.y)));
}

export function relativeGoal(args: ArgConsumer, origin: BetterBlockPos | null): Goal {
    const o = origin ?? BetterBlockPos.ORIGIN;
    if (args.hasExactly(3)) {
        const g = args.peekDatatypeOrNull((c) => relativeGoalBlock(c, o));
        if (g) return relativeGoalBlock(args, o);
    }
    if (args.hasExactly(2)) {
        const g = args.peekDatatypeOrNull((c) => relativeGoalXZ(c, o));
        if (g) return relativeGoalXZ(args, o);
    }
    if (args.hasExactly(1)) {
        const g = args.peekDatatypeOrNull((c) => relativeGoalYLevel(c, o));
        if (g) return relativeGoalYLevel(args, o);
    }
    if (args.hasAny()) {
        throw new CommandInvalidTypeException(args.peek(), "a valid goal (x y z, x z or y)");
    }
    return GoalBlock.of(o);
}

export function relativeBlockPos(args: ArgConsumer, origin: BetterBlockPos): BetterBlockPos {
    return new BetterBlockPos(Math.floor(relativeCoordinate(args, origin.x)), Math.floor(relativeCoordinate(args, origin.y)), Math.floor(relativeCoordinate(args, origin.z)));
}

export function forBlockOptionalMeta(args: ArgConsumer): BlockOptionalMeta {
    const arg = args.get();
    try {
        const bom = new BlockOptionalMeta(arg.value);
        if (!BlockOptionalMeta.isKnownBlock(bom.typeId)) {
            throw new Error("unknown block");
        }
        return bom;
    } catch {
        throw new CommandInvalidTypeException(arg, "a block", arg.value);
    }
}

export function itemById(args: ArgConsumer): string {
    const v = args.getString().toLowerCase();
    return v.includes(":") ? v : "minecraft:" + v;
}

export function forDirection(args: ArgConsumer): Direction {
    const arg = args.get();
    const d = directionByName(arg.value);
    if (!d) throw new CommandInvalidTypeException(arg, "a direction (north/south/east/west/up/down)", arg.value);
    return d;
}

export function forAxis(args: ArgConsumer): "x" | "y" | "z" {
    const arg = args.get();
    const v = arg.value.toLowerCase();
    if (v !== "x" && v !== "y" && v !== "z") throw new CommandInvalidTypeException(arg, "an axis (x/y/z)", arg.value);
    return v;
}

export function forWaypoints(baritone: IBaritone, args: ArgConsumer): Waypoint[] {
    const input = args.getString();
    const tag = tagByName(input);
    const collection = baritone.getWorldData().getWaypoints();
    const list = tag === null ? collection.getAllWaypoints().filter((w) => w.name.toLowerCase() === input.toLowerCase()) : collection.getByTag(tag);
    return list.sort((a, b) => b.creationTimestamp - a.creationTimestamp);
}

export function nearbyPlayer(baritone: IBaritone, args: ArgConsumer): EntityInfo {
    const arg = args.get();
    const p = baritone
        .getPlayerContext()
        .entities()
        .find((e) => e.isPlayer && e.name.toLowerCase() === arg.value.toLowerCase());
    if (!p) throw new CommandInvalidTypeException(arg, "a nearby player name", arg.value);
    return p;
}

export function entityClassById(args: ArgConsumer): string {
    const v = args.getString().toLowerCase();
    return v.includes(":") ? v : "minecraft:" + v;
}
