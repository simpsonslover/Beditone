import type { Goal } from "../goals/Goal";
import type { CalculationContext } from "../movement/CalculationContext";
import type { IBaritone } from "../IBaritone";

export enum PathingCommandType {
    SET_GOAL_AND_PATH = "SET_GOAL_AND_PATH",
    REQUEST_PAUSE = "REQUEST_PAUSE",
    CANCEL_AND_SET_GOAL = "CANCEL_AND_SET_GOAL",
    REVALIDATE_GOAL_AND_PATH = "REVALIDATE_GOAL_AND_PATH",
    FORCE_REVALIDATE_GOAL_AND_PATH = "FORCE_REVALIDATE_GOAL_AND_PATH",
    DEFER = "DEFER",
    SET_GOAL_AND_PAUSE = "SET_GOAL_AND_PAUSE",
}

export class PathingCommand {
    constructor(readonly goal: Goal | null, readonly commandType: PathingCommandType, readonly desiredCalcContext: CalculationContext | null = null) {}

    toString(): string {
        return this.commandType + " " + this.goal;
    }
}

export const DEFAULT_PRIORITY = -1;

export abstract class BaritoneProcess {
    constructor(protected readonly baritone: IBaritone) {}

    protected get ctx() {
        return this.baritone.getPlayerContext();
    }

    abstract isActive(): boolean;

    abstract onTick(calcFailed: boolean, isSafeToCancel: boolean): PathingCommand | null;

    isTemporary(): boolean {
        return false;
    }

    abstract onLostControl(): void;

    priority(): number {
        return DEFAULT_PRIORITY;
    }

    displayName(): string {
        if (!this.isActive()) {
            return "INACTIVE";
        }
        return this.displayName0();
    }

    abstract displayName0(): string;

    protected logDirect(msg: string): void {
        this.baritone.logDirect(msg);
    }

    protected logDebug(msg: string): void {
        this.baritone.logDebug(msg);
    }

    protected logNotification(msg: string, error: boolean): void {
        this.baritone.logNotification(msg, error);
    }
}
