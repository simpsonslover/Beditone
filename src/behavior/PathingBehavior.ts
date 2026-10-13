import { settings } from "../Settings";
import { Goal, GoalXZ, hasGoalPos, goalsEqual } from "../goals/Goal";
import type { IBaritone } from "../IBaritone";
import type { CalculationContext } from "../movement/CalculationContext";
import { MovementHelper } from "../movement/MovementHelper";
import { AStarPathFinder, PathCalculationResultType, SearchJob } from "../pathing/calc/AStarPathFinder";
import { Avoidance, Favoring } from "../pathing/calc/Favoring";
import type { IPath } from "../pathing/path/IPath";
import { PathExecutor } from "../pathing/path/PathExecutor";
import { BetterBlockPos, indexOfPos } from "../utils/BetterBlockPos";
import type { IPlayerContext } from "../utils/IPlayerContext";
import type { PathingCommand } from "../process/PathingCommand";

export enum PathEvent {
    CALC_STARTED = "CALC_STARTED",
    CALC_FINISHED_NOW_EXECUTING = "CALC_FINISHED_NOW_EXECUTING",
    CALC_FAILED = "CALC_FAILED",
    NEXT_SEGMENT_CALC_STARTED = "NEXT_SEGMENT_CALC_STARTED",
    NEXT_SEGMENT_CALC_FINISHED = "NEXT_SEGMENT_CALC_FINISHED",
    CONTINUING_ONTO_PLANNED_NEXT = "CONTINUING_ONTO_PLANNED_NEXT",
    SPLICING_ONTO_NEXT_EARLY = "SPLICING_ONTO_NEXT_EARLY",
    AT_GOAL = "AT_GOAL",
    PATH_FINISHED_NEXT_STILL_CALCULATING = "PATH_FINISHED_NEXT_STILL_CALCULATING",
    NEXT_CALC_FAILED = "NEXT_CALC_FAILED",
    DISCARD_NEXT = "DISCARD_NEXT",
    CANCELED = "CANCELED",
}

export type JobRunner = (job: Generator<void, void, void>) => void;

export class PathingBehavior {
    readonly ctx: IPlayerContext;
    private current: PathExecutor | null = null;
    private next: PathExecutor | null = null;
    private goal: Goal | null = null;
    private context: CalculationContext | null = null;
    private ticksElapsedSoFar = 0;
    private startPosition: BetterBlockPos | null = null;
    private safeToCancel = false;
    private pauseRequestedLastTick = false;
    private unpausedLastTick = false;
    private pausedThisTick = false;
    private cancelRequested = false;
    private calcFailedLastTick_ = false;
    private inProgress: AStarPathFinder | null = null;
    private expectedSegmentStart: BetterBlockPos | null = null;
    private toDispatch: PathEvent[] = [];

    constructor(readonly baritone: IBaritone, private readonly runJob: JobRunner) {
        this.ctx = baritone.getPlayerContext();
    }

    private queuePathEvent(event: PathEvent): void {
        this.toDispatch.push(event);
    }

    private dispatchEvents(): void {
        const curr = this.toDispatch;
        this.toDispatch = [];
        this.calcFailedLastTick_ = curr.includes(PathEvent.CALC_FAILED);
        for (const event of curr) {
            if (event !== PathEvent.CANCELED) this.baritone.logDebug("Path event: " + event);
        }
    }

    onTick(): void {
        this.dispatchEvents();
        this.expectedSegmentStart = this.pathStart();
        this.baritone.getPathingControlManager().preTick();
        this.tickPath();
        this.ticksElapsedSoFar++;
        this.dispatchEvents();
    }

    onTickOut(): void {
        this.dispatchEvents();
        this.secretInternalSegmentCancel();
        this.baritone.getPathingControlManager().cancelEverything();
    }

    wantsSprint(): boolean | null {
        if (this.isPathing()) {
            return this.current!.isSprinting();
        }
        return null;
    }

    private tickPath(): void {
        this.pausedThisTick = false;
        if (this.pauseRequestedLastTick && this.safeToCancel) {
            this.pauseRequestedLastTick = false;
            if (this.unpausedLastTick) {
                this.baritone.getInputOverrideHandler().clearAllKeys();
                this.baritone.getInputOverrideHandler().getBlockBreakHelper().stopBreakingBlock();
            }
            this.unpausedLastTick = false;
            this.pausedThisTick = true;
            return;
        }
        this.unpausedLastTick = true;
        if (this.cancelRequested) {
            this.cancelRequested = false;
            this.baritone.getInputOverrideHandler().clearAllKeys();
        }
        if (this.inProgress !== null) {
            const calcFrom = this.inProgress.getStart();
            const currentBest = this.inProgress.bestPathSoFar();
            const feet = this.ctx.playerFeet();
            if (
                (this.current === null || !this.current.getPath().getDest().equals(calcFrom)) &&
                !calcFrom.equals(feet) &&
                !calcFrom.equals(this.expectedSegmentStart) &&
                (currentBest === null || (indexOfPos(currentBest.positions(), feet) === -1 && indexOfPos(currentBest.positions(), this.expectedSegmentStart) === -1))
            ) {
                this.inProgress.cancel();
            }
        }
        if (this.current === null) {
            return;
        }
        this.safeToCancel = this.current.onTick();
        if (this.current.failed() || this.current.finished()) {
            this.current = null;
            const feet = this.ctx.playerFeet();
            if (this.goal === null || this.goal.isInGoal(feet.x, feet.y, feet.z)) {
                this.baritone.logDebug("All done. At " + this.goal);
                this.queuePathEvent(PathEvent.AT_GOAL);
                this.next = null;
                return;
            }
            if (this.next !== null && indexOfPos(this.next.getPath().positions(), feet) === -1 && indexOfPos(this.next.getPath().positions(), this.expectedSegmentStart) === -1) {
                this.baritone.logDebug("Discarding next path as it does not contain current position");
                this.queuePathEvent(PathEvent.DISCARD_NEXT);
                this.next = null;
            }
            if (this.next !== null) {
                this.baritone.logDebug("Continuing on to planned next path");
                this.queuePathEvent(PathEvent.CONTINUING_ONTO_PLANNED_NEXT);
                this.current = this.next;
                this.next = null;
                this.current.onTick();
                return;
            }
            if (this.inProgress !== null) {
                this.queuePathEvent(PathEvent.PATH_FINISHED_NEXT_STILL_CALCULATING);
                return;
            }
            this.queuePathEvent(PathEvent.CALC_STARTED);
            this.findPathInNewThread(this.expectedSegmentStart!, true, this.context!);
            return;
        }
        if (this.safeToCancel && this.next !== null && this.next.snipsnapifpossible()) {
            this.baritone.logDebug("Splicing into planned next path early...");
            this.queuePathEvent(PathEvent.SPLICING_ONTO_NEXT_EARLY);
            this.current = this.next;
            this.next = null;
            this.current.onTick();
            return;
        }
        if (settings.splicePath.value) {
            this.current = this.current.trySplice(this.next);
        }
        if (this.next !== null && this.current.getPath().getDest().equals(this.next.getPath().getDest())) {
            this.next = null;
        }
        if (this.inProgress !== null) {
            return;
        }
        if (this.next !== null) {
            return;
        }
        const dest = this.current.getPath().getDest();
        if (this.goal === null || this.goal.isInGoal(dest.x, dest.y, dest.z)) {
            return;
        }
        if (this.ticksRemainingInSegment(false)! < settings.planningTickLookahead.value) {
            this.baritone.logDebug("Path almost over. Planning ahead...");
            this.queuePathEvent(PathEvent.NEXT_SEGMENT_CALC_STARTED);
            this.findPathInNewThread(dest, false, this.context!);
        }
    }

    secretInternalSetGoal(goal: Goal | null): void {
        this.goal = goal;
    }

    secretInternalSetGoalAndPath(command: PathingCommand): boolean {
        this.secretInternalSetGoal(command.goal);
        this.context = command.desiredCalcContext ?? this.baritone.newCalculationContext();
        if (this.goal === null) {
            return false;
        }
        const feet = this.ctx.playerFeet();
        if (this.goal.isInGoal(feet.x, feet.y, feet.z)) {
            return false;
        }
        if (this.current !== null) {
            return false;
        }
        if (this.inProgress !== null) {
            return false;
        }
        this.queuePathEvent(PathEvent.CALC_STARTED);
        this.findPathInNewThread(this.expectedSegmentStart ?? this.pathStart(), true, this.context);
        return true;
    }

    getGoal(): Goal | null {
        return this.goal;
    }

    isPathing(): boolean {
        return this.hasPath() && !this.pausedThisTick;
    }

    hasPath(): boolean {
        return this.current !== null;
    }

    getCurrent(): PathExecutor | null {
        return this.current;
    }

    getNext(): PathExecutor | null {
        return this.next;
    }

    getInProgress(): AStarPathFinder | null {
        return this.inProgress;
    }

    getPath(): IPath | null {
        return this.current ? this.current.getPath() : null;
    }

    isSafeToCancel(): boolean {
        if (this.current === null) {
            return true;
        }
        return this.safeToCancel;
    }

    requestPause(): void {
        this.pauseRequestedLastTick = true;
    }

    cancelSegmentIfSafe(): boolean {
        if (this.isSafeToCancel()) {
            this.secretInternalSegmentCancel();
            return true;
        }
        return false;
    }

    cancelEverything(): boolean {
        const doIt = this.isSafeToCancel();
        if (doIt) {
            this.secretInternalSegmentCancel();
        }
        this.baritone.getPathingControlManager().cancelEverything();
        return doIt;
    }

    calcFailedLastTick(): boolean {
        return this.calcFailedLastTick_;
    }

    softCancelIfSafe(): void {
        this.inProgress?.cancel();
        if (!this.isSafeToCancel()) {
            return;
        }
        this.current = null;
        this.next = null;
        this.cancelRequested = true;
    }

    secretInternalSegmentCancel(): void {
        this.queuePathEvent(PathEvent.CANCELED);
        this.inProgress?.cancel();
        if (this.current !== null) {
            this.current = null;
            this.next = null;
            this.baritone.getInputOverrideHandler().clearAllKeys();
            this.baritone.getInputOverrideHandler().getBlockBreakHelper().stopBreakingBlock();
        }
    }

    forceCancel(): void {
        this.cancelEverything();
        this.secretInternalSegmentCancel();
        this.inProgress = null;
    }

    secretInternalGetCalculationContext(): CalculationContext {
        return this.context!;
    }

    ticksRemainingInSegment(includeCurrentMovement = true): number | null {
        const current = this.current;
        if (current === null) {
            return null;
        }
        const start = includeCurrentMovement ? current.getPosition() : current.getPosition() + 1;
        return current.getPath().ticksRemainingFrom(start);
    }

    estimatedTicksToGoal(): number | null {
        const currentPos = this.ctx.playerFeet();
        if (this.goal === null || this.startPosition === null) {
            return null;
        }
        if (this.goal.isInGoal(currentPos.x, currentPos.y, currentPos.z)) {
            this.resetEstimatedTicksToGoal(this.expectedSegmentStart);
            return 0.0;
        }
        if (this.ticksElapsedSoFar === 0) {
            return null;
        }
        const current = this.goal.heuristic(currentPos.x, currentPos.y, currentPos.z);
        const start = this.goal.heuristic(this.startPosition.x, this.startPosition.y, this.startPosition.z);
        if (current === start) {
            return null;
        }
        return (Math.abs(current - this.goal.heuristicAtGoal()) * this.ticksElapsedSoFar) / Math.abs(start - current);
    }

    private resetEstimatedTicksToGoal(start: BetterBlockPos | null): void {
        this.ticksElapsedSoFar = 0;
        this.startPosition = start;
    }

    pathStart(): BetterBlockPos {
        const ctx = this.ctx;
        const feet = ctx.playerFeet();
        if (!MovementHelper.canWalkOnCtx(ctx, feet.below())) {
            if (ctx.player().onGround()) {
                const pos = ctx.player().position();
                const playerX = pos.x;
                const playerZ = pos.z;
                const closest: BetterBlockPos[] = [];
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        closest.push(new BetterBlockPos(feet.x + dx, feet.y, feet.z + dz));
                    }
                }
                const d = (p: BetterBlockPos) => (p.x + 0.5 - playerX) * (p.x + 0.5 - playerX) + (p.z + 0.5 - playerZ) * (p.z + 0.5 - playerZ);
                closest.sort((a, b) => d(a) - d(b));
                for (let i = 0; i < 4; i++) {
                    const possibleSupport = closest[i];
                    const xDist = Math.abs(possibleSupport.x + 0.5 - playerX);
                    const zDist = Math.abs(possibleSupport.z + 0.5 - playerZ);
                    if (xDist > 0.8 && zDist > 0.8) {
                        continue;
                    }
                    if (MovementHelper.canWalkOnCtx(ctx, possibleSupport.below()) && MovementHelper.canWalkThroughCtx(ctx, possibleSupport) && MovementHelper.canWalkThroughCtx(ctx, possibleSupport.above())) {
                        return possibleSupport;
                    }
                }
            } else {
                if (MovementHelper.canWalkOnCtx(ctx, feet.below().below())) {
                    return feet.below();
                }
            }
        }
        return feet;
    }

    private findPathInNewThread(start: BetterBlockPos, talkAboutIt: boolean, context: CalculationContext): void {
        if (this.inProgress !== null) {
            throw new Error("Already doing it");
        }
        const goal = this.goal;
        if (goal === null) {
            this.baritone.logDebug("no goal");
            return;
        }
        let primaryTimeout: number;
        let failureTimeout: number;
        if (this.current === null) {
            primaryTimeout = settings.primaryTimeoutMS.value;
            failureTimeout = settings.failureTimeoutMS.value;
        } else {
            primaryTimeout = settings.planAheadPrimaryTimeoutMS.value;
            failureTimeout = settings.planAheadFailureTimeoutMS.value;
        }
        primaryTimeout *= settings.searchTimeMultiplier.value;
        failureTimeout *= settings.searchTimeMultiplier.value;
        const pathfinder = this.createPathfinder(start, goal, this.current === null ? null : this.current.getPath(), context);
        if (!goalsEqual(pathfinder.getGoal(), goal)) {
            this.baritone.logDebug("Simplifying " + goal.constructor.name + " to GoalXZ due to distance");
        }
        this.inProgress = pathfinder;
        if (talkAboutIt) {
            this.baritone.logDebug("Starting to search for path from " + start + " to " + goal);
        }
        const self = this;
        const job: SearchJob = pathfinder.calculate(primaryTimeout, failureTimeout);
        function* wrapper(): Generator<void, void, void> {
            let r = job.next();
            while (!r.done) {
                yield;
                r = job.next();
            }
            self.onCalculationFinished(pathfinder, r.value.type, r.value.path, start, goal!, talkAboutIt);
        }
        this.runJob(wrapper());
    }

    private onCalculationFinished(pathfinder: AStarPathFinder, type: PathCalculationResultType, path: IPath | null, start: BetterBlockPos, goal: Goal, talkAboutIt: boolean): void {
        if (this.inProgress !== pathfinder) {
            return;
        }
        const executor = path ? new PathExecutor(this, path) : null;
        if (this.current === null) {
            if (executor !== null) {
                if (indexOfPos(executor.getPath().positions(), this.expectedSegmentStart) !== -1) {
                    this.queuePathEvent(PathEvent.CALC_FINISHED_NOW_EXECUTING);
                    this.current = executor;
                    this.resetEstimatedTicksToGoal(start);
                } else {
                    this.baritone.logDebug("Warning: discarding orphan path segment with incorrect start");
                }
            } else {
                if (type !== PathCalculationResultType.CANCELLATION && type !== PathCalculationResultType.EXCEPTION) {
                    this.queuePathEvent(PathEvent.CALC_FAILED);
                }
            }
        } else {
            if (this.next === null) {
                if (executor !== null) {
                    if (executor.getPath().getSrc().equals(this.current.getPath().getDest())) {
                        this.queuePathEvent(PathEvent.NEXT_SEGMENT_CALC_FINISHED);
                        this.next = executor;
                    } else {
                        this.baritone.logDebug("Warning: discarding orphan next segment with incorrect start");
                    }
                } else {
                    this.queuePathEvent(PathEvent.NEXT_CALC_FAILED);
                }
            } else {
                this.baritone.logDirect("Warning: PathingBehavior illegal state! Discarding invalid path!");
            }
        }
        if (talkAboutIt && this.current !== null && this.current.getPath() !== null) {
            const d = this.current.getPath().getDest();
            if (goal.isInGoal(d.x, d.y, d.z)) {
                this.baritone.logDebug("Finished finding a path from " + start + " to " + goal + ". " + this.current.getPath().getNumNodesConsidered() + " nodes considered");
            } else {
                this.baritone.logDebug("Found path segment from " + start + " towards " + goal + ". " + this.current.getPath().getNumNodesConsidered() + " nodes considered");
            }
        }
        this.inProgress = null;
    }

    private createPathfinder(start: BetterBlockPos, goal: Goal, previous: IPath | null, context: CalculationContext): AStarPathFinder {
        let transformed = goal;
        if (settings.simplifyUnloadedYCoord.value && hasGoalPos(goal)) {
            const pos = goal.getGoalPos();
            if (!context.bsi.worldContainsLoadedChunk(pos.x, pos.z)) {
                transformed = new GoalXZ(pos.x, pos.z);
            }
        }
        const favoring = new Favoring(previous, context, Avoidance.create(this.ctx));
        const feet = this.ctx.playerFeet();
        let realStart = start;
        const sub = feet.subtract(realStart);
        if (feet.y === realStart.y && Math.abs(sub.x) <= 1 && Math.abs(sub.z) <= 1) {
            realStart = feet;
        }
        return new AStarPathFinder(realStart, start.x, start.y, start.z, transformed, favoring, context);
    }
}
