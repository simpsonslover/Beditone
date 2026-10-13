import { settings } from "../Settings";
import { MovementHelper, PlaceResult } from "../movement/MovementHelper";
import { Input, MovementState } from "../movement/MovementState";
import { BetterBlockPos } from "../utils/BetterBlockPos";
import { BlockState } from "../world/BlockState";
import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";

const DIRT = BlockState.of("minecraft:dirt");

export class BackfillProcess extends BaritoneProcess {
    blocksToReplace = new Map<number, [BetterBlockPos, BlockState]>();

    isActive(): boolean {
        if (!this.ctx.player().isAlive()) {
            return false;
        }
        if (!settings.backfill.value) {
            return false;
        }
        if (settings.allowParkour.value) {
            this.logDirect("Backfill cannot be used with allowParkour true");
            settings.backfill.value = false;
            return false;
        }
        const bsi = this.ctx.bsi();
        for (const [key, [pos]] of [...this.blocksToReplace.entries()]) {
            if (!bsi.isLoaded(pos.x, pos.z) || bsi.get(pos).typeId !== "minecraft:air") {
                this.blocksToReplace.delete(key);
            }
        }
        this.amIBreakingABlockHMMMMMMM();
        this.baritone.getInputOverrideHandler().clearAllKeys();

        return this.toFillIn().length > 0;
    }

    onTick(_calcFailed: boolean, isSafeToCancel: boolean): PathingCommand {
        if (!isSafeToCancel) {
            return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
        }
        this.baritone.getInputOverrideHandler().clearAllKeys();
        for (const toPlace of this.toFillIn()) {
            const fake = new MovementState();
            switch (MovementHelper.attemptToPlaceABlock(fake, this.baritone, toPlace, false, false)) {
                case PlaceResult.NO_OPTION:
                    continue;
                case PlaceResult.READY_TO_PLACE:
                    this.baritone.getInputOverrideHandler().setInputForceState(Input.CLICK_RIGHT, true);
                    return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
                case PlaceResult.ATTEMPTING:
                    this.baritone.getLookBehavior().updateTarget(fake.getTarget().getRotation()!, true);
                    return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
                default:
                    throw new Error();
            }
        }
        return new PathingCommand(null, PathingCommandType.DEFER);
    }

    private amIBreakingABlockHMMMMMMM(): void {
        const sel = this.ctx.getSelectedBlock();
        if (!sel || !this.baritone.getPathingBehavior().isPathing()) {
            return;
        }
        this.blocksToReplace.set(sel.hash(), [sel, this.ctx.bsi().get(sel)]);
    }

    toFillIn(): BetterBlockPos[] {
        const bsi = this.ctx.bsi();
        const feet = this.ctx.playerFeet();
        return [...this.blocksToReplace.values()]
            .map(([pos]) => pos)
            .filter((pos) => bsi.get(pos).typeId === "minecraft:air")
            .filter((pos) => this.baritone.getBuilderProcess().placementPlausible(pos, DIRT))
            .filter((pos) => !this.partOfCurrentMovement(pos))
            .sort((a, b) => feet.distSqr(b) - feet.distSqr(a));
    }

    private partOfCurrentMovement(pos: BetterBlockPos): boolean {
        const exec = this.baritone.getPathingBehavior().getCurrent();
        if (exec === null || exec.finished() || exec.failed()) {
            return false;
        }
        const movement = exec.getPath().movements()[exec.getPosition()];
        return movement.toBreakAll().some((p) => p.equals(pos));
    }

    onLostControl(): void {
        if (this.blocksToReplace.size) {
            this.blocksToReplace.clear();
        }
    }

    displayName0(): string {
        return "Backfill";
    }

    override isTemporary(): boolean {
        return true;
    }

    override priority(): number {
        return 5;
    }
}
