import { BetterBlockPos, Direction, Directions } from "../utils/BetterBlockPos";
import type { CalculationContext } from "./CalculationContext";
import { Movement, MutableMoveResult } from "./Movement";
import { MovementAscend } from "./movements/MovementAscend";
import { MovementDescend } from "./movements/MovementDescend";
import { MovementDiagonal } from "./movements/MovementDiagonal";
import { MovementDownward } from "./movements/MovementDownward";
import { MovementFall } from "./movements/MovementFall";
import { MovementParkour } from "./movements/MovementParkour";
import { MovementPillar } from "./movements/MovementPillar";
import { MovementTraverse } from "./movements/MovementTraverse";

export interface Moves {
    readonly name: string;
    readonly xOffset: number;
    readonly yOffset: number;
    readonly zOffset: number;
    readonly dynamicXZ: boolean;
    readonly dynamicY: boolean;
    apply0(context: CalculationContext, src: BetterBlockPos): Movement;
    apply(context: CalculationContext, x: number, y: number, z: number, result: MutableMoveResult): void;
}

function fixed(name: string, x: number, y: number, z: number, apply0: Moves["apply0"], cost: (c: CalculationContext, x: number, y: number, z: number) => number): Moves {
    return {
        name,
        xOffset: x,
        yOffset: y,
        zOffset: z,
        dynamicXZ: false,
        dynamicY: false,
        apply0,
        apply(context, px, py, pz, result) {
            result.x = px + x;
            result.y = py + y;
            result.z = pz + z;
            result.cost = cost(context, px, py, pz);
        },
    };
}

function descend(name: string, dx: number, dz: number): Moves {
    const m: Moves = {
        name,
        xOffset: dx,
        yOffset: -1,
        zOffset: dz,
        dynamicXZ: false,
        dynamicY: true,
        apply0(context, src) {
            const res = new MutableMoveResult();
            m.apply(context, src.x, src.y, src.z, res);
            if (res.y === src.y - 1) {
                return new MovementDescend(context.getBaritone(), src, new BetterBlockPos(res.x, res.y, res.z));
            } else {
                return new MovementFall(context.getBaritone(), src, new BetterBlockPos(res.x, res.y, res.z));
            }
        },
        apply(context, x, y, z, result) {
            MovementDescend.cost(context, x, y, z, x + dx, z + dz, result);
        },
    };
    return m;
}

function diagonal(name: string, dir1: Direction, dir2: Direction): Moves {
    const dx = dir1.x + dir2.x;
    const dz = dir1.z + dir2.z;
    const m: Moves = {
        name,
        xOffset: dx,
        yOffset: 0,
        zOffset: dz,
        dynamicXZ: false,
        dynamicY: true,
        apply0(context, src) {
            const res = new MutableMoveResult();
            m.apply(context, src.x, src.y, src.z, res);
            return new MovementDiagonal(context.getBaritone(), src, dir1, dir2, res.y - src.y);
        },
        apply(context, x, y, z, result) {
            MovementDiagonal.cost(context, x, y, z, x + dx, z + dz, result);
        },
    };
    return m;
}

function parkour(name: string, dir: Direction): Moves {
    return {
        name,
        xOffset: dir.x * 4,
        yOffset: 0,
        zOffset: dir.z * 4,
        dynamicXZ: true,
        dynamicY: true,
        apply0(context, src) {
            return MovementParkour.create(context, src, dir);
        },
        apply(context, x, y, z, result) {
            MovementParkour.cost(context, x, y, z, dir, result);
        },
    };
}

const N = Directions.NORTH;
const S = Directions.SOUTH;
const E = Directions.EAST;
const W = Directions.WEST;

export const ALL_MOVES: readonly Moves[] = [
    fixed("DOWNWARD", 0, -1, 0, (c, src) => new MovementDownward(c.getBaritone(), src, src.below()), (c, x, y, z) => MovementDownward.cost(c, x, y, z)),
    fixed("PILLAR", 0, +1, 0, (c, src) => new MovementPillar(c.getBaritone(), src, src.above()), (c, x, y, z) => MovementPillar.cost(c, x, y, z)),
    fixed("TRAVERSE_NORTH", 0, 0, -1, (c, src) => new MovementTraverse(c.getBaritone(), src, src.north()), (c, x, y, z) => MovementTraverse.cost(c, x, y, z, x, z - 1)),
    fixed("TRAVERSE_SOUTH", 0, 0, +1, (c, src) => new MovementTraverse(c.getBaritone(), src, src.south()), (c, x, y, z) => MovementTraverse.cost(c, x, y, z, x, z + 1)),
    fixed("TRAVERSE_EAST", +1, 0, 0, (c, src) => new MovementTraverse(c.getBaritone(), src, src.east()), (c, x, y, z) => MovementTraverse.cost(c, x, y, z, x + 1, z)),
    fixed("TRAVERSE_WEST", -1, 0, 0, (c, src) => new MovementTraverse(c.getBaritone(), src, src.west()), (c, x, y, z) => MovementTraverse.cost(c, x, y, z, x - 1, z)),
    fixed("ASCEND_NORTH", 0, +1, -1, (c, src) => new MovementAscend(c.getBaritone(), src, new BetterBlockPos(src.x, src.y + 1, src.z - 1)), (c, x, y, z) => MovementAscend.cost(c, x, y, z, x, z - 1)),
    fixed("ASCEND_SOUTH", 0, +1, +1, (c, src) => new MovementAscend(c.getBaritone(), src, new BetterBlockPos(src.x, src.y + 1, src.z + 1)), (c, x, y, z) => MovementAscend.cost(c, x, y, z, x, z + 1)),
    fixed("ASCEND_EAST", +1, +1, 0, (c, src) => new MovementAscend(c.getBaritone(), src, new BetterBlockPos(src.x + 1, src.y + 1, src.z)), (c, x, y, z) => MovementAscend.cost(c, x, y, z, x + 1, z)),
    fixed("ASCEND_WEST", -1, +1, 0, (c, src) => new MovementAscend(c.getBaritone(), src, new BetterBlockPos(src.x - 1, src.y + 1, src.z)), (c, x, y, z) => MovementAscend.cost(c, x, y, z, x - 1, z)),
    descend("DESCEND_EAST", +1, 0),
    descend("DESCEND_WEST", -1, 0),
    descend("DESCEND_NORTH", 0, -1),
    descend("DESCEND_SOUTH", 0, +1),
    diagonal("DIAGONAL_NORTHEAST", N, E),
    diagonal("DIAGONAL_NORTHWEST", N, W),
    diagonal("DIAGONAL_SOUTHEAST", S, E),
    diagonal("DIAGONAL_SOUTHWEST", S, W),
    parkour("PARKOUR_NORTH", N),
    parkour("PARKOUR_SOUTH", S),
    parkour("PARKOUR_EAST", E),
    parkour("PARKOUR_WEST", W),
];
