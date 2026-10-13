import { settings } from "../Settings";
import { Goal, GoalComposite, GoalXZ, GoalYLevel } from "../goals/Goal";
import { BetterBlockPos } from "../utils/BetterBlockPos";
import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";

enum Status {
    EXPLORED,
    NOT_EXPLORED,
    UNKNOWN,
}

interface ChunkFilter {
    isAlreadyExplored(chunkX: number, chunkZ: number): Status;
    countRemain(): number;
}

class GoalXZMaintainY extends GoalXZ {
    override heuristic(x: number, y: number, z: number): number {
        return super.heuristic(x, y, z) + GoalYLevel.calculate(settings.exploreMaintainY.value, y);
    }
}

export class ExploreProcess extends BaritoneProcess {
    private explorationOrigin: BetterBlockPos | null = null;
    private filter: ChunkFilter | null = null;
    private distanceCompleted = 0;

    isActive(): boolean {
        return this.explorationOrigin !== null;
    }

    explore(centerX: number, centerZ: number): void {
        this.explorationOrigin = new BetterBlockPos(centerX, 0, centerZ);
        this.distanceCompleted = 0;
    }

    applyChunkListFilter(positions: { x: number; z: number }[], invert: boolean): void {
        const inFilter = new Set(positions.map((p) => p.x + "," + p.z));
        const cache = this.calcBaseFilter();
        this.filter = {
            isAlreadyExplored: (cx, cz) => (inFilter.has(cx + "," + cz) !== invert ? Status.EXPLORED : Status.UNKNOWN),
            countRemain: () => {
                if (!invert) return Number.MAX_SAFE_INTEGER;
                let countRemain = 0;
                for (const p of positions) {
                    if (cache.isAlreadyExplored(p.x, p.z) !== Status.EXPLORED) {
                        countRemain++;
                        if (countRemain >= settings.exploreChunkSetMinimumSize.value) return countRemain;
                    }
                }
                return countRemain;
            },
        };
    }

    private calcBaseFilter(): ChunkFilter {
        const explored = this.baritone.getWorldData().explored;
        return {
            isAlreadyExplored: (cx, cz) => (explored.isCached(cx << 4, cz << 4) ? Status.EXPLORED : Status.NOT_EXPLORED),
            countRemain: () => Number.MAX_SAFE_INTEGER,
        };
    }

    calcFilter(): ChunkFilter {
        const base = this.calcBaseFilter();
        if (this.filter !== null) {
            const a = this.filter;
            return {
                isAlreadyExplored: (cx, cz) => (a.isAlreadyExplored(cx, cz) === Status.EXPLORED ? Status.EXPLORED : base.isAlreadyExplored(cx, cz)),
                countRemain: () => Math.min(a.countRemain(), base.countRemain()),
            };
        }
        return base;
    }

    onTick(calcFailed: boolean, _isSafeToCancel: boolean): PathingCommand | null {
        if (calcFailed) {
            this.logDirect("Failed");
            if (settings.notificationOnExploreFinished.value) {
                this.logNotification("Exploration failed", true);
            }
            this.onLostControl();
            return null;
        }
        const filter = this.calcFilter();
        if (!settings.disableCompletionCheck.value && filter.countRemain() === 0) {
            this.logDirect("Explored all chunks");
            if (settings.notificationOnExploreFinished.value) {
                this.logNotification("Explored all chunks", false);
            }
            this.onLostControl();
            return null;
        }
        const closestUncached = this.closestUncachedChunks(this.explorationOrigin!, filter);
        if (closestUncached === null) {
            this.logDebug("awaiting region load from disk");
            return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
        }
        return new PathingCommand(new GoalComposite(...closestUncached), PathingCommandType.FORCE_REVALIDATE_GOAL_AND_PATH);
    }

    private closestUncachedChunks(center: BetterBlockPos, filter: ChunkFilter): Goal[] | null {
        const chunkX = center.x >> 4;
        const chunkZ = center.z >> 4;
        let count = Math.min(filter.countRemain(), settings.exploreChunkSetMinimumSize.value);
        const centers: BetterBlockPos[] = [];
        const renderDistance = settings.worldExploringChunkOffset.value;
        for (let dist = this.distanceCompleted; ; dist++) {
            for (let dx = -dist; dx <= dist; dx++) {
                const zval = dist - Math.abs(dx);
                for (let mult = 0; mult < 2; mult++) {
                    const dz = (mult * 2 - 1) * zval;
                    const trueDist = Math.abs(dx) + Math.abs(dz);
                    if (trueDist !== dist) {
                        throw new Error(`Offset ${dx} ${dz} has distance ${trueDist}, expected ${dist}`);
                    }
                    const status = filter.isAlreadyExplored(chunkX + dx, chunkZ + dz);
                    if (status === Status.UNKNOWN) {
                        return null;
                    }
                    if (status === Status.EXPLORED) {
                        continue;
                    }
                    let centerX = ((chunkX + dx) << 4) + 8;
                    let centerZ = ((chunkZ + dz) << 4) + 8;
                    const offset = renderDistance << 4;
                    if (dx < 0) {
                        centerX -= offset;
                    } else {
                        centerX += offset;
                    }
                    if (dz < 0) {
                        centerZ -= offset;
                    } else {
                        centerZ += offset;
                    }
                    centers.push(new BetterBlockPos(centerX, 0, centerZ));
                }
            }
            if (dist % 10 === 0) {
                count = Math.min(filter.countRemain(), settings.exploreChunkSetMinimumSize.value);
            }
            if (centers.length >= count) {
                return centers.map((pos) => ExploreProcess.createGoal(pos.x, pos.z));
            }
            if (centers.length === 0) {
                this.distanceCompleted = dist + 1;
            }
        }
    }

    private static createGoal(x: number, z: number): Goal {
        if (settings.exploreMaintainY.value === -1) {
            return new GoalXZ(x, z);
        }
        return new GoalXZMaintainY(x, z);
    }

    onLostControl(): void {
        this.explorationOrigin = null;
    }

    displayName0(): string {
        return "Exploring around " + this.explorationOrigin + ", distance completed " + this.distanceCompleted;
    }
}
