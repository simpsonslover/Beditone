import { settings } from "../Settings";
import type { Goal } from "../goals/Goal";
import { goalsEqual } from "../goals/Goal";
import type { IBaritone } from "../IBaritone";
import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";

export class PathingControlManager {
    private readonly processes = new Set<BaritoneProcess>();
    private readonly active: BaritoneProcess[] = [];
    private inControlLastTick: BaritoneProcess | null = null;
    private inControlThisTick: BaritoneProcess | null = null;
    private command: PathingCommand | null = null;

    constructor(private readonly baritone: IBaritone) {}

    registerProcess(process: BaritoneProcess): void {
        process.onLostControl();
        this.processes.add(process);
    }

    cancelEverything(): void {
        this.inControlLastTick = null;
        this.inControlThisTick = null;
        this.command = null;
        this.active.length = 0;
        for (const proc of this.processes) {
            proc.onLostControl();
            if (proc.isActive() && !proc.isTemporary()) {
                throw new Error(proc.displayName() + " stayed active after being cancelled");
            }
        }
    }

    mostRecentInControl(): BaritoneProcess | null {
        return this.inControlThisTick;
    }

    mostRecentCommand(): PathingCommand | null {
        return this.command;
    }

    preTick(): void {
        this.inControlLastTick = this.inControlThisTick;
        this.inControlThisTick = null;
        const p = this.baritone.getPathingBehavior();
        this.command = this.executeProcesses();
        if (this.command === null) {
            p.cancelSegmentIfSafe();
            p.secretInternalSetGoal(null);
            return;
        }
        if (this.inControlThisTick !== this.inControlLastTick && this.command.commandType !== PathingCommandType.REQUEST_PAUSE && this.inControlLastTick !== null && !this.inControlLastTick.isTemporary()) {
            p.cancelSegmentIfSafe();
        }
        switch (this.command.commandType) {
            case PathingCommandType.SET_GOAL_AND_PAUSE:
                p.secretInternalSetGoalAndPath(this.command);
                p.requestPause();
                break;
            case PathingCommandType.REQUEST_PAUSE:
                p.requestPause();
                break;
            case PathingCommandType.CANCEL_AND_SET_GOAL:
                p.secretInternalSetGoal(this.command.goal);
                p.cancelSegmentIfSafe();
                break;
            case PathingCommandType.FORCE_REVALIDATE_GOAL_AND_PATH:
            case PathingCommandType.REVALIDATE_GOAL_AND_PATH:
                if (!p.isPathing() && p.getInProgress() === null) {
                    p.secretInternalSetGoalAndPath(this.command);
                }
                break;
            case PathingCommandType.SET_GOAL_AND_PATH:
                if (this.command.goal !== null) {
                    p.secretInternalSetGoalAndPath(this.command);
                }
                break;
            default:
                throw new Error("Unexpected command type " + this.command.commandType);
        }
    }

    postTick(): void {
        if (this.command === null) {
            return;
        }
        const p = this.baritone.getPathingBehavior();
        switch (this.command.commandType) {
            case PathingCommandType.FORCE_REVALIDATE_GOAL_AND_PATH:
                if (this.command.goal === null || this.forceRevalidate(this.command.goal) || this.revalidateGoal(this.command.goal)) {
                    p.softCancelIfSafe();
                }
                p.secretInternalSetGoalAndPath(this.command);
                break;
            case PathingCommandType.REVALIDATE_GOAL_AND_PATH:
                if (settings.cancelOnGoalInvalidation.value && (this.command.goal === null || this.revalidateGoal(this.command.goal))) {
                    p.softCancelIfSafe();
                }
                p.secretInternalSetGoalAndPath(this.command);
                break;
            default:
        }
    }

    forceRevalidate(newGoal: Goal): boolean {
        const current = this.baritone.getPathingBehavior().getCurrent();
        if (current !== null) {
            const d = current.getPath().getDest();
            if (newGoal.isInGoal(d.x, d.y, d.z)) {
                return false;
            }
            return !goalsEqual(newGoal, current.getPath().getGoal());
        }
        return false;
    }

    revalidateGoal(newGoal: Goal): boolean {
        const current = this.baritone.getPathingBehavior().getCurrent();
        if (current !== null) {
            const intended = current.getPath().getGoal();
            const end = current.getPath().getDest();
            if (intended.isInGoal(end.x, end.y, end.z) && !newGoal.isInGoal(end.x, end.y, end.z)) {
                return true;
            }
        }
        return false;
    }

    executeProcesses(): PathingCommand | null {
        for (const process of this.processes) {
            if (process.isActive()) {
                if (!this.active.includes(process)) {
                    this.active.unshift(process);
                }
            } else {
                const i = this.active.indexOf(process);
                if (i >= 0) this.active.splice(i, 1);
            }
        }
        this.active.sort((a, b) => b.priority() - a.priority());

        for (let i = 0; i < this.active.length; i++) {
            const proc = this.active[i];
            const exec = proc.onTick(proc === this.inControlLastTick && this.baritone.getPathingBehavior().calcFailedLastTick(), this.baritone.getPathingBehavior().isSafeToCancel());
            if (exec === null) {
                if (proc.isActive()) {
                    throw new Error(proc.displayName() + " actively returned null PathingCommand");
                }
            } else if (exec.commandType !== PathingCommandType.DEFER) {
                this.inControlThisTick = proc;
                if (!proc.isTemporary()) {
                    for (let j = i + 1; j < this.active.length; j++) {
                        this.active[j].onLostControl();
                    }
                }
                return exec;
            }
        }
        return null;
    }
}
