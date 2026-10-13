import { settings } from "../../Settings";
import type { Goal } from "../../goals/Goal";
import { COST_INF } from "../../movement/ActionCosts";
import type { CalculationContext } from "../../movement/CalculationContext";
import { MutableMoveResult } from "../../movement/Movement";
import { ALL_MOVES } from "../../movement/Moves";
import { BetterBlockPos } from "../../utils/BetterBlockPos";
import type { IPath } from "../path/IPath";
import { BinaryHeapOpenSet } from "./BinaryHeapOpenSet";
import type { Favoring } from "./Favoring";
import { Path } from "./Path";
import { PathNode } from "./PathNode";

export enum PathCalculationResultType {
    SUCCESS_TO_GOAL = "SUCCESS_TO_GOAL",
    SUCCESS_SEGMENT = "SUCCESS_SEGMENT",
    FAILURE = "FAILURE",
    CANCELLATION = "CANCELLATION",
    EXCEPTION = "EXCEPTION",
}

export class PathCalculationResult {
    constructor(readonly type: PathCalculationResultType, readonly path: IPath | null = null) {}
}

export type SearchJob = Generator<void, PathCalculationResult, void>;

const COEFFICIENTS = [1.5, 2, 2.5, 3, 4, 5, 10];
const INVERSE_COEFFICIENTS = COEFFICIENTS.map((c) => 1 / c);
const MIN_DIST_PATH = 5;
const MIN_IMPROVEMENT = 0.01;
const SLICE_MS = 4;

const CELL_BITS_X = 4;
const CELL_BITS_Y = 3;
const CELL_BITS_Z = 4;
const CELL_SIZE = 1 << (CELL_BITS_X + CELL_BITS_Y + CELL_BITS_Z);

export class AStarPathFinder {
    readonly realStart: BetterBlockPos;
    private readonly cells = new Map<number, (PathNode | undefined)[]>();
    private prevCell: (PathNode | undefined)[] | null = null;
    private prevCellKey = -1;
    private numNodesCreated = 0;
    protected startNode: PathNode | null = null;
    protected mostRecentConsidered: PathNode | null = null;
    protected readonly bestSoFar: (PathNode | null)[] = new Array(COEFFICIENTS.length).fill(null);
    private isFinished_ = false;
    protected cancelRequested = false;
    numNodesConsidered = 0;
    numMovementsConsidered = 0;
    computeMs = 0;

    constructor(
        realStart: BetterBlockPos,
        readonly startX: number,
        readonly startY: number,
        readonly startZ: number,
        readonly goal: Goal,
        private readonly favoring: Favoring,
        private readonly context: CalculationContext,
    ) {
        this.realStart = realStart;
    }

    cancel(): void {
        this.cancelRequested = true;
    }

    *calculate(primaryTimeout: number, failureTimeout: number): SearchJob {
        if (this.isFinished_) {
            throw new Error("Path finder cannot be reused!");
        }
        this.cancelRequested = false;
        this.context.claimSearchCaches();
        try {
            const raw: IPath | null = yield* this.calculate0(primaryTimeout, failureTimeout);
            let path = raw ? raw.postProcess() : null;
            if (this.cancelRequested) {
                return new PathCalculationResult(PathCalculationResultType.CANCELLATION);
            }
            if (path === null) {
                return new PathCalculationResult(PathCalculationResultType.FAILURE);
            }
            let previousLength = path.length();
            path = path.cutoffAtLoadedChunks(this.context.bsi);
            if (path.length() < previousLength) {
                this.logDebug("Cutting off path at edge of loaded chunks");
                this.logDebug("Length decreased by " + (previousLength - path.length()));
            } else {
                this.logDebug("Path ends within loaded chunks");
            }
            previousLength = path.length();
            path = path.staticCutoff(this.goal);
            if (path.length() < previousLength) {
                this.logDebug("Static cutoff " + previousLength + " to " + path.length());
            }
            const dest = path.getDest();
            if (this.goal.isInGoal(dest.x, dest.y, dest.z)) {
                return new PathCalculationResult(PathCalculationResultType.SUCCESS_TO_GOAL, path);
            } else {
                return new PathCalculationResult(PathCalculationResultType.SUCCESS_SEGMENT, path);
            }
        } catch (e) {
            this.context.getBaritone()?.logDirect("Pathing exception: " + e);
            console.warn("[Beditone] pathing exception " + (e as Error)?.stack);
            return new PathCalculationResult(PathCalculationResultType.EXCEPTION);
        } finally {
            this.isFinished_ = true;
            this.context.releaseSearchCaches();
        }
    }

    private *calculate0(primaryTimeout: number, failureTimeout: number): Generator<void, IPath | null, void> {
        const calcContext = this.context;
        const minY = calcContext.minY;
        const maxY = calcContext.maxY;
        const startNode = this.getNodeAtPosition(this.startX, this.startY, this.startZ);
        this.startNode = startNode;
        startNode.cost = 0;
        startNode.combinedCost = startNode.estimatedCostToGoal;
        const openSet = new BinaryHeapOpenSet();
        openSet.insert(startNode);
        const bestHeuristicSoFar = new Array<number>(COEFFICIENTS.length);
        for (let i = 0; i < bestHeuristicSoFar.length; i++) {
            bestHeuristicSoFar[i] = startNode.estimatedCostToGoal;
            this.bestSoFar[i] = startNode;
        }
        const res = new MutableMoveResult();
        const worldBorder = calcContext.worldBorder;
        const wallStart = Date.now();
        const slowPath = settings.slowPath.value;
        if (slowPath) {
            this.logDebug(`slowPath is on, path timeout will be ${settings.slowPathTimeoutMS.value}ms instead of ${primaryTimeout}ms`);
        }
        const primaryTimeoutTime = slowPath ? settings.slowPathTimeoutMS.value : primaryTimeout;
        const failureTimeoutTime = slowPath ? settings.slowPathTimeoutMS.value : failureTimeout;
        const wallCap = settings.pathingWallClockCapMS.value;
        let failing = true;
        let numNodes = 0;
        let numMovementsConsidered = 0;
        let numEmptyChunk = 0;
        const isFavoring = !this.favoring.isEmpty();
        const timeCheckInterval = 1 << 6;
        const pathingMaxChunkBorderFetch = settings.pathingMaxChunkBorderFetch.value;
        const minimumImprovement = settings.minimumImprovementRepropagation.value ? MIN_IMPROVEMENT : 0;
        const allMoves = ALL_MOVES;
        let sliceStart = Date.now();
        while (!openSet.isEmpty() && numEmptyChunk < pathingMaxChunkBorderFetch && !this.cancelRequested) {
            if ((numNodes & (timeCheckInterval - 1)) === 0) {
                const now = Date.now();
                const slice = now - sliceStart;
                const used = this.computeMs + slice;
                if (used >= failureTimeoutTime || (!failing && used >= primaryTimeoutTime) || now - wallStart >= wallCap) {
                    this.computeMs = used;
                    break;
                }
                if (slowPath || slice >= SLICE_MS) {
                    this.computeMs = used;
                    if (slowPath) {
                        const wake = Date.now() + settings.slowPathTimeDelayMS.value;
                        while (Date.now() < wake && !this.cancelRequested) {
                            yield;
                        }
                    } else {
                        yield;
                    }
                    sliceStart = Date.now();
                    if (this.cancelRequested) break;
                    calcContext.onWorldTicked();
                }
            }
            const currentNode = openSet.removeLowest();
            this.mostRecentConsidered = currentNode;
            numNodes++;
            if (this.goal.isInGoal(currentNode.x, currentNode.y, currentNode.z)) {
                this.numNodesConsidered = numNodes;
                this.numMovementsConsidered = numMovementsConsidered;
                this.computeMs += Date.now() - sliceStart;
                this.logDebug(`Took ${Math.round(this.computeMs)}ms of search time, ${numMovementsConsidered} movements considered`);
                return new Path(this.realStart, startNode, currentNode, numNodes, this.goal, calcContext);
            }
            for (const moves of allMoves) {
                const newX = currentNode.x + moves.xOffset;
                const newZ = currentNode.z + moves.zOffset;
                if ((newX >> 4 !== currentNode.x >> 4 || newZ >> 4 !== currentNode.z >> 4) && !calcContext.isLoaded(newX, newZ)) {
                    if (!moves.dynamicXZ) {
                        numEmptyChunk++;
                    }
                    continue;
                }
                if (!moves.dynamicXZ && !worldBorder.entirelyContains(newX, newZ)) {
                    continue;
                }
                if (currentNode.y + moves.yOffset > maxY || currentNode.y + moves.yOffset < minY) {
                    continue;
                }
                res.reset();
                moves.apply(calcContext, currentNode.x, currentNode.y, currentNode.z, res);
                numMovementsConsidered++;
                let actionCost = res.cost;
                if (actionCost >= COST_INF) {
                    continue;
                }
                if (actionCost <= 0 || Number.isNaN(actionCost)) {
                    throw new Error(`${moves.name} from ${currentNode.x} ${currentNode.y} ${currentNode.z} calculated implausible cost ${actionCost}`);
                }
                if (moves.dynamicXZ && !worldBorder.entirelyContains(res.x, res.z)) {
                    continue;
                }
                if (!moves.dynamicXZ && (res.x !== newX || res.z !== newZ)) {
                    throw new Error(`${moves.name} from ${currentNode.x} ${currentNode.y} ${currentNode.z} ended at x z ${res.x} ${res.z} instead of ${newX} ${newZ}`);
                }
                if (!moves.dynamicY && res.y !== currentNode.y + moves.yOffset) {
                    throw new Error(`${moves.name} from ${currentNode.x} ${currentNode.y} ${currentNode.z} ended at y ${res.y} instead of ${currentNode.y + moves.yOffset}`);
                }
                const neighbor = this.getNodeAtPosition(res.x, res.y, res.z);
                if (isFavoring) {
                    if (neighbor.favor === 0) {
                        neighbor.favor = this.favoring.calculate(BetterBlockPos.longHash(res.x, res.y, res.z));
                    }
                    actionCost *= neighbor.favor;
                }
                const tentativeCost = currentNode.cost + actionCost;
                if (neighbor.cost - tentativeCost > minimumImprovement) {
                    neighbor.previous = currentNode;
                    neighbor.cost = tentativeCost;
                    neighbor.combinedCost = tentativeCost + neighbor.estimatedCostToGoal;
                    if (neighbor.isOpen()) {
                        openSet.update(neighbor);
                    } else {
                        openSet.insert(neighbor);
                    }
                    for (let i = 0; i < COEFFICIENTS.length; i++) {
                        const heuristic = neighbor.estimatedCostToGoal + neighbor.cost * INVERSE_COEFFICIENTS[i];
                        if (bestHeuristicSoFar[i] - heuristic > minimumImprovement) {
                            bestHeuristicSoFar[i] = heuristic;
                            this.bestSoFar[i] = neighbor;
                            if (failing && this.getDistFromStartSq(neighbor) > MIN_DIST_PATH * MIN_DIST_PATH) {
                                failing = false;
                            }
                        }
                    }
                }
            }
        }
        this.numNodesConsidered = numNodes;
        this.numMovementsConsidered = numMovementsConsidered;
        if (this.cancelRequested) {
            return null;
        }
        this.logDebug(`${numMovementsConsidered} movements considered, open set size ${openSet.size()}, node map size ${this.numNodesCreated}, ${numNodes} nodes in ${Math.round(this.computeMs)}ms of search time`);
        const result = this.bestSoFarPath(true, numNodes);
        if (result) {
            this.logDebug(`Took ${Math.round(this.computeMs)}ms, ${numMovementsConsidered} movements considered`);
        }
        return result;
    }

    protected getDistFromStartSq(n: PathNode): number {
        const xDiff = n.x - this.startX;
        const yDiff = n.y - this.startY;
        const zDiff = n.z - this.startZ;
        return xDiff * xDiff + yDiff * yDiff + zDiff * zDiff;
    }

    protected getNodeAtPosition(x: number, y: number, z: number): PathNode {
        const cellKey = (((x >> CELL_BITS_X) & 0x1ffff) * 131072 + ((z >> CELL_BITS_Z) & 0x1ffff)) * 256 + ((y >> CELL_BITS_Y) & 0xff);
        let cell: (PathNode | undefined)[];
        if (cellKey === this.prevCellKey && this.prevCell) {
            cell = this.prevCell;
        } else {
            let c = this.cells.get(cellKey);
            if (!c) {
                c = new Array(CELL_SIZE);
                this.cells.set(cellKey, c);
            }
            cell = c;
            this.prevCell = cell;
            this.prevCellKey = cellKey;
        }
        const index = ((y & ((1 << CELL_BITS_Y) - 1)) << (CELL_BITS_X + CELL_BITS_Z)) | ((z & ((1 << CELL_BITS_Z) - 1)) << CELL_BITS_X) | (x & ((1 << CELL_BITS_X) - 1));
        let node = cell[index];
        if (node === undefined) {
            node = new PathNode(x, y, z, this.goal);
            cell[index] = node;
            this.numNodesCreated++;
        }
        return node;
    }

    pathToMostRecentNodeConsidered(): IPath | null {
        const n = this.mostRecentConsidered;
        if (!n || !this.startNode) return null;
        return new Path(this.realStart, this.startNode, n, 0, this.goal, this.context);
    }

    bestPathSoFar(): IPath | null {
        return this.bestSoFarPath(false, 0);
    }

    protected bestSoFarPath(logInfo: boolean, numNodes: number): IPath | null {
        if (this.startNode === null) {
            return null;
        }
        let bestDist = 0;
        for (let i = 0; i < COEFFICIENTS.length; i++) {
            const best = this.bestSoFar[i];
            if (best === null) {
                continue;
            }
            const dist = this.getDistFromStartSq(best);
            if (dist > bestDist) {
                bestDist = dist;
            }
            if (dist > MIN_DIST_PATH * MIN_DIST_PATH) {
                if (logInfo) {
                    if (COEFFICIENTS[i] >= 3) {
                        this.logDebug("Warning: cost coefficient is greater than three! Probably means that the path I found is pretty terrible (like sneak-bridging for dozens of blocks). But I'm going to do it anyway, because yolo");
                    }
                    this.logDebug("Path goes for " + Math.sqrt(dist) + " blocks");
                    this.logDebug("A* cost coefficient " + COEFFICIENTS[i]);
                }
                return new Path(this.realStart, this.startNode, best, numNodes, this.goal, this.context);
            }
        }
        if (logInfo) {
            this.logDebug("Even with a cost coefficient of " + COEFFICIENTS[COEFFICIENTS.length - 1] + ", I couldn't get more than " + Math.sqrt(bestDist) + " blocks");
            this.logDebug("No path found =(");
            this.context.getBaritone()?.logNotification("No path found =(", true);
        }
        return null;
    }

    isFinished(): boolean {
        return this.isFinished_;
    }

    getGoal(): Goal {
        return this.goal;
    }

    getStart(): BetterBlockPos {
        return new BetterBlockPos(this.startX, this.startY, this.startZ);
    }

    private logDebug(msg: string): void {
        this.context.getBaritone()?.logDebug(msg);
    }
}

export function runToCompletion(job: SearchJob): PathCalculationResult {
    for (;;) {
        const r = job.next();
        if (r.done) return r.value;
    }
}
