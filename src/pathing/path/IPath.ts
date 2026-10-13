import { settings } from "../../Settings";
import type { Goal } from "../../goals/Goal";
import type { Movement } from "../../movement/Movement";
import { BetterBlockPos, PosSet } from "../../utils/BetterBlockPos";
import type { BlockStateInterface } from "../../world/BlockStateInterface";

export abstract class IPath {
    abstract movements(): readonly Movement[];
    abstract positions(): readonly BetterBlockPos[];
    abstract getGoal(): Goal;
    abstract getNumNodesConsidered(): number;

    postProcess(): IPath {
        throw new Error("UnsupportedOperation");
    }

    length(): number {
        return this.positions().length;
    }

    getSrc(): BetterBlockPos {
        return this.positions()[0];
    }

    getDest(): BetterBlockPos {
        const pos = this.positions();
        return pos[pos.length - 1];
    }

    ticksRemainingFrom(pathPosition: number): number {
        let sum = 0;
        const movements = this.movements();
        for (let i = pathPosition; i < movements.length; i++) {
            sum += movements[i].getCost();
        }
        return sum;
    }

    cutoffAtLoadedChunks(bsi: BlockStateInterface): IPath {
        if (!settings.cutoffAtLoadBoundary.value) {
            return this;
        }
        const positions = this.positions();
        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            if (!bsi.worldContainsLoadedChunk(pos.x, pos.z)) {
                return new CutoffPath(this, 0, i);
            }
        }
        return this;
    }

    staticCutoff(destination: Goal | null): IPath {
        const min = settings.pathCutoffMinimumLength.value;
        if (this.length() < min) {
            return this;
        }
        if (destination === null || destination.isInGoal(this.getDest().x, this.getDest().y, this.getDest().z)) {
            return this;
        }
        const factor = settings.pathCutoffFactor.value;
        const newLength = Math.trunc((this.length() - min) * factor) + min - 1;
        return new CutoffPath(this, 0, newLength);
    }

    sanityCheck(): void {
        const path = this.positions();
        const movements = this.movements();
        if (!this.getSrc().equals(path[0])) {
            throw new Error("Start node does not equal first path element");
        }
        if (!this.getDest().equals(path[path.length - 1])) {
            throw new Error("End node does not equal last path element");
        }
        if (path.length !== movements.length + 1) {
            throw new Error("Size of path array is unexpected");
        }
        const seenSoFar = new PosSet();
        for (let i = 0; i < path.length - 1; i++) {
            const src = path[i];
            const dest = path[i + 1];
            const movement = movements[i];
            if (!src.equals(movement.getSrc())) {
                throw new Error("Path source is not equal to the movement source");
            }
            if (!dest.equals(movement.getDest())) {
                throw new Error("Path destination is not equal to the movement destination");
            }
            if (seenSoFar.has(src)) {
                throw new Error("Path doubles back on itself, making a loop");
            }
            seenSoFar.add(src);
        }
    }
}

export class CutoffPath extends IPath {
    private readonly path: readonly BetterBlockPos[];
    private readonly movements_: readonly Movement[];
    private readonly numNodes: number;
    private readonly goal: Goal;

    constructor(prev: IPath, firstPositionToInclude: number, lastPositionToInclude: number) {
        super();
        this.path = prev.positions().slice(firstPositionToInclude, lastPositionToInclude + 1);
        this.movements_ = prev.movements().slice(firstPositionToInclude, lastPositionToInclude);
        this.numNodes = prev.getNumNodesConsidered();
        this.goal = prev.getGoal();
        this.sanityCheck();
    }

    getGoal(): Goal {
        return this.goal;
    }

    movements(): readonly Movement[] {
        return this.movements_;
    }

    positions(): readonly BetterBlockPos[] {
        return this.path;
    }

    getNumNodesConsidered(): number {
        return this.numNodes;
    }
}

export class SplicedPath extends IPath {
    private constructor(
        private readonly path: readonly BetterBlockPos[],
        private readonly movements_: readonly Movement[],
        private readonly numNodes: number,
        private readonly goal: Goal,
    ) {
        super();
        this.sanityCheck();
    }

    getGoal(): Goal {
        return this.goal;
    }

    movements(): readonly Movement[] {
        return this.movements_;
    }

    positions(): readonly BetterBlockPos[] {
        return this.path;
    }

    getNumNodesConsidered(): number {
        return this.numNodes;
    }

    override length(): number {
        return this.path.length;
    }

    static trySplice(first: IPath | null, second: IPath | null, allowOverlapCutoff: boolean): SplicedPath | null {
        if (second === null || first === null) {
            return null;
        }
        if (!first.getDest().equals(second.getSrc())) {
            return null;
        }
        const secondPos = new PosSet(second.positions());
        let firstPositionInSecond = -1;
        for (let i = 0; i < first.length() - 1; i++) {
            if (secondPos.has(first.positions()[i])) {
                firstPositionInSecond = i;
                break;
            }
        }
        if (firstPositionInSecond !== -1) {
            if (!allowOverlapCutoff) {
                return null;
            }
        } else {
            firstPositionInSecond = first.length() - 1;
        }
        const target = first.positions()[firstPositionInSecond];
        const positionInSecond = second.positions().findIndex((p) => p.equals(target));
        if (!allowOverlapCutoff && positionInSecond !== 0) {
            throw new Error("Paths to be spliced are overlapping incorrectly");
        }
        const positions: BetterBlockPos[] = [];
        const movements: Movement[] = [];
        positions.push(...first.positions().slice(0, firstPositionInSecond + 1));
        movements.push(...first.movements().slice(0, firstPositionInSecond));

        positions.push(...second.positions().slice(positionInSecond + 1, second.length()));
        movements.push(...second.movements().slice(positionInSecond, second.length() - 1));
        return new SplicedPath(positions, movements, first.getNumNodesConsidered() + second.getNumNodesConsidered(), first.getGoal());
    }
}
