import type { Goal } from "../../goals/Goal";
import { COST_INF } from "../../movement/ActionCosts";

export class PathNode {
    readonly estimatedCostToGoal: number;
    cost: number;
    combinedCost = 0;
    previous: PathNode | null = null;
    heapPosition = -1;
    favor = 0;

    constructor(readonly x: number, readonly y: number, readonly z: number, goal: Goal) {
        this.cost = COST_INF;
        this.estimatedCostToGoal = goal.heuristic(x, y, z);
        if (Number.isNaN(this.estimatedCostToGoal)) {
            throw new Error(`${goal} calculated implausible heuristic NaN at ${x} ${y} ${z}`);
        }
    }

    isOpen(): boolean {
        return this.heapPosition !== -1;
    }
}
