import type { Goal } from "../../goals/Goal";
import type { CalculationContext } from "../../movement/CalculationContext";
import type { Movement } from "../../movement/Movement";
import { ALL_MOVES } from "../../movement/Moves";
import { BetterBlockPos } from "../../utils/BetterBlockPos";
import { CutoffPath, IPath } from "../path/IPath";
import { PathNode } from "./PathNode";

export class Path extends IPath {
    private readonly start: BetterBlockPos;
    private readonly end: BetterBlockPos;
    private readonly path: BetterBlockPos[];
    private readonly movements_: Movement[] = [];
    private readonly nodes: PathNode[];
    private verified = false;

    constructor(realStart: BetterBlockPos, start: PathNode, end: PathNode, private readonly numNodes: number, private readonly goal: Goal, private readonly context: CalculationContext) {
        super();
        this.end = new BetterBlockPos(end.x, end.y, end.z);
        let current: PathNode | null = end;
        const tempPath: BetterBlockPos[] = [];
        const tempNodes: PathNode[] = [];
        while (current !== null) {
            tempNodes.push(current);
            tempPath.push(new BetterBlockPos(current.x, current.y, current.z));
            current = current.previous;
        }
        const startNodePos = new BetterBlockPos(start.x, start.y, start.z);
        if (!realStart.equals(startNodePos) && start === end) {
            this.start = realStart;
            const fakeNode = new PathNode(realStart.x, realStart.y, realStart.z, goal);
            fakeNode.cost = 0;
            tempNodes.push(fakeNode);
            tempPath.push(realStart);
        } else {
            this.start = startNodePos;
        }
        this.path = tempPath.reverse();
        this.nodes = tempNodes.reverse();
    }

    getGoal(): Goal {
        return this.goal;
    }

    private assembleMovements(): boolean {
        if (this.path.length === 0 || this.movements_.length !== 0) {
            throw new Error("Path must not be empty");
        }
        for (let i = 0; i < this.path.length - 1; i++) {
            const cost = this.nodes[i + 1].cost - this.nodes[i].cost;
            const move = this.runBackwards(this.path[i], this.path[i + 1], cost);
            if (move === null) {
                return true;
            } else {
                this.movements_.push(move);
            }
        }
        return false;
    }

    private runBackwards(src: BetterBlockPos, dest: BetterBlockPos, cost: number): Movement | null {
        for (const moves of ALL_MOVES) {
            const move = moves.apply0(this.context, src);
            if (move.getDest().equals(dest)) {
                move.override(Math.min(move.calculateCost(this.context), cost));
                return move;
            }
        }
        this.context.getBaritone()?.logDebug(`Movement became impossible during calculation ${src} ${dest} ${dest.subtract(src)}`);
        return null;
    }

    override postProcess(): IPath {
        if (this.verified) {
            throw new Error("Path must not be verified twice");
        }
        this.verified = true;
        const failed = this.assembleMovements();
        this.movements_.forEach((m) => m.checkLoadedChunk(this.context));

        if (failed) {
            const res = new CutoffPath(this, 0, this.movements().length);
            if (res.movements().length !== this.movements_.length) {
                throw new Error("Path has wrong size after cutoff");
            }
            return res;
        }
        this.sanityCheck();
        return this;
    }

    movements(): readonly Movement[] {
        if (!this.verified) {
            throw new Error("Path not yet verified");
        }
        return this.movements_;
    }

    positions(): readonly BetterBlockPos[] {
        return this.path;
    }

    getNumNodesConsidered(): number {
        return this.numNodes;
    }

    override getSrc(): BetterBlockPos {
        return this.start;
    }

    override getDest(): BetterBlockPos {
        return this.end;
    }
}
