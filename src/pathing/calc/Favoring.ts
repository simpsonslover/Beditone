import { settings } from "../../Settings";
import { BetterBlockPos } from "../../utils/BetterBlockPos";
import type { IPlayerContext } from "../../utils/IPlayerContext";
import type { CalculationContext } from "../../movement/CalculationContext";
import type { IPath } from "../path/IPath";

const HOSTILE = new Set(
    "zombie husk drowned skeleton stray bogged wither_skeleton spider cave_spider creeper witch slime magma_cube enderman blaze ghast phantom pillager vindicator evoker ravager vex guardian elder_guardian silverfish endermite hoglin zoglin piglin piglin_brute zombified_piglin warden breeze creaking"
        .split(" ")
        .map((s) => "minecraft:" + s),
);

export class Avoidance {
    private readonly radiusSq: number;

    constructor(private readonly centerX: number, private readonly centerY: number, private readonly centerZ: number, private readonly coefficient_: number, private readonly radius: number) {
        this.radiusSq = radius * radius;
    }

    coefficient(x: number, y: number, z: number): number {
        const xDiff = x - this.centerX;
        const yDiff = y - this.centerY;
        const zDiff = z - this.centerZ;
        return xDiff * xDiff + yDiff * yDiff + zDiff * zDiff <= this.radiusSq ? this.coefficient_ : 1.0;
    }

    static create(ctx: IPlayerContext, spawners: BetterBlockPos[] = []): Avoidance[] {
        if (!settings.avoidance.value) {
            return [];
        }
        const res: Avoidance[] = [];
        const mobSpawnerCoeff = settings.mobSpawnerAvoidanceCoefficient.value;
        const mobCoeff = settings.mobAvoidanceCoefficient.value;
        if (mobSpawnerCoeff !== 1.0) {
            for (const s of spawners) {
                res.push(new Avoidance(s.x, s.y, s.z, mobSpawnerCoeff, settings.mobSpawnerAvoidanceRadius.value));
            }
        }
        if (mobCoeff !== 1.0) {
            for (const e of ctx.entities()) {
                if (HOSTILE.has(e.typeId)) {
                    const p = BetterBlockPos.of(e.position);
                    res.push(new Avoidance(p.x, p.y, p.z, mobCoeff, settings.mobAvoidanceRadius.value));
                }
            }
        }
        return res;
    }

    applySpherical(map: Map<number, number>): void {
        const radius = this.radius;
        for (let x = -radius; x <= radius; x++) {
            for (let y = -radius; y <= radius; y++) {
                for (let z = -radius; z <= radius; z++) {
                    if (x * x + y * y + z * z <= radius * radius) {
                        const hash = BetterBlockPos.longHash(this.centerX + x, this.centerY + y, this.centerZ + z);
                        map.set(hash, (map.get(hash) ?? 1.0) * this.coefficient_);
                    }
                }
            }
        }
    }
}

export class Favoring {
    private readonly favorings = new Map<number, number>();

    constructor(previous: IPath | null, context: CalculationContext, avoidances: Avoidance[] = []) {
        const coeff = context.backtrackCostFavoringCoefficient;
        if (coeff !== 1 && previous !== null) {
            for (const pos of previous.positions()) {
                this.favorings.set(pos.hash(), coeff);
            }
        }
        for (const avoid of avoidances) {
            avoid.applySpherical(this.favorings);
        }
    }

    isEmpty(): boolean {
        return this.favorings.size === 0;
    }

    calculate(hash: number): number {
        return this.favorings.get(hash) ?? 1.0;
    }
}
