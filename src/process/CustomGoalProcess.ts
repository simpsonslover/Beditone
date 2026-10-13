import { settings } from "../Settings";
import type { Goal } from "../goals/Goal";
import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";

enum State {
    NONE,
    GOAL_SET,
    PATH_REQUESTED,
    EXECUTING,
}

export class CustomGoalProcess extends BaritoneProcess {
    private goal: Goal | null = null;
    private mostRecentGoal_: Goal | null = null;
    private state = State.NONE;

    setGoal(goal: Goal | null): void {
        this.goal = goal;
        this.mostRecentGoal_ = goal;
        if (this.state === State.NONE) {
            this.state = State.GOAL_SET;
        }
        if (this.state === State.EXECUTING) {
            this.state = State.PATH_REQUESTED;
        }
    }

    path(): void {
        this.state = State.PATH_REQUESTED;
    }

    setGoalAndPath(goal: Goal): void {
        this.setGoal(goal);
        this.path();
    }

    getGoal(): Goal | null {
        return this.goal;
    }

    mostRecentGoal(): Goal | null {
        return this.mostRecentGoal_;
    }

    isActive(): boolean {
        return this.state !== State.NONE;
    }

    onTick(calcFailed: boolean, _isSafeToCancel: boolean): PathingCommand | null {
        switch (this.state) {
            case State.GOAL_SET:
                return new PathingCommand(this.goal, PathingCommandType.CANCEL_AND_SET_GOAL);
            case State.PATH_REQUESTED: {
                const ret = new PathingCommand(this.goal, PathingCommandType.FORCE_REVALIDATE_GOAL_AND_PATH);
                this.state = State.EXECUTING;
                return ret;
            }
            case State.EXECUTING: {
                if (calcFailed) {
                    this.onLostControl();
                    return new PathingCommand(this.goal, PathingCommandType.CANCEL_AND_SET_GOAL);
                }
                const feet = this.ctx.playerFeet();
                const start = this.baritone.getPathingBehavior().pathStart();
                if (this.goal === null || (this.goal.isInGoal(feet.x, feet.y, feet.z) && this.goal.isInGoal(start.x, start.y, start.z))) {
                    this.onLostControl();
                    if (settings.notificationOnPathComplete.value) {
                        this.logNotification("Pathing complete", false);
                    }
                    return new PathingCommand(this.goal, PathingCommandType.CANCEL_AND_SET_GOAL);
                }
                return new PathingCommand(this.goal, PathingCommandType.SET_GOAL_AND_PATH);
            }
            default:
                throw new Error("Unexpected state " + this.state);
        }
    }

    onLostControl(): void {
        this.state = State.NONE;
        this.goal = null;
    }

    displayName0(): string {
        return "Custom Goal " + this.goal;
    }
}
