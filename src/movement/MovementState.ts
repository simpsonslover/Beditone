import { Rotation } from "../utils/Rotation";

export enum Input {
    MOVE_FORWARD = "MOVE_FORWARD",
    MOVE_BACK = "MOVE_BACK",
    MOVE_LEFT = "MOVE_LEFT",
    MOVE_RIGHT = "MOVE_RIGHT",
    CLICK_LEFT = "CLICK_LEFT",
    CLICK_RIGHT = "CLICK_RIGHT",
    JUMP = "JUMP",
    SNEAK = "SNEAK",
    SPRINT = "SPRINT",
}

export enum MovementStatus {
    PREPPING = "PREPPING",
    WAITING = "WAITING",
    RUNNING = "RUNNING",
    SUCCESS = "SUCCESS",
    UNREACHABLE = "UNREACHABLE",
    FAILED = "FAILED",
    CANCELED = "CANCELED",
}

export function isComplete(status: MovementStatus): boolean {
    return status === MovementStatus.SUCCESS || status === MovementStatus.UNREACHABLE || status === MovementStatus.FAILED || status === MovementStatus.CANCELED;
}

export class MovementTarget {
    constructor(public rotation: Rotation | null = null, private readonly forceRotations = false) {}

    getRotation(): Rotation | null {
        return this.rotation;
    }

    hasToForceRotations(): boolean {
        return this.forceRotations;
    }
}

export class MovementState {
    private status: MovementStatus = MovementStatus.PREPPING;
    private target = new MovementTarget();
    private readonly inputState = new Map<Input, boolean>();

    setStatus(status: MovementStatus): this {
        this.status = status;
        return this;
    }

    getStatus(): MovementStatus {
        return this.status;
    }

    getTarget(): MovementTarget {
        return this.target;
    }

    setTarget(target: MovementTarget): this {
        this.target = target;
        return this;
    }

    setInput(input: Input, forced: boolean): this {
        this.inputState.set(input, forced);
        return this;
    }

    getInputStates(): Map<Input, boolean> {
        return this.inputState;
    }
}
