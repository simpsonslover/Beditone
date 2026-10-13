import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";

export class InventoryPauserProcess extends BaritoneProcess {
    private pauseRequestedLastTick = false;
    private safeToCancelLastTick = false;
    private ticksOfStationary = 0;

    isActive(): boolean {
        return this.ctx.player().isAlive();
    }

    private motion(): number {
        const m = this.ctx.player().deltaMovement();
        return Math.sqrt(m.x * m.x + m.z * m.z);
    }

    private stationaryNow(): boolean {
        return this.motion() < 0.00001;
    }

    stationaryForInventoryMove(): boolean {
        this.pauseRequestedLastTick = true;
        return this.safeToCancelLastTick && this.ticksOfStationary > 1;
    }

    onTick(_calcFailed: boolean, isSafeToCancel: boolean): PathingCommand {
        this.safeToCancelLastTick = isSafeToCancel;
        if (this.pauseRequestedLastTick) {
            this.pauseRequestedLastTick = false;
            if (this.stationaryNow()) {
                this.ticksOfStationary++;
            }
            return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
        }
        this.ticksOfStationary = 0;
        return new PathingCommand(null, PathingCommandType.DEFER);
    }

    onLostControl(): void {}

    displayName0(): string {
        return "inventory pauser";
    }

    override priority(): number {
        return 5.1;
    }

    override isTemporary(): boolean {
        return true;
    }
}
