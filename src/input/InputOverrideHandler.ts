import { settings } from "../Settings";
import type { IBaritone } from "../IBaritone";
import { Input } from "../movement/MovementState";
import { Blocks } from "../world/Blocks";
import { BetterBlockPos } from "../utils/BetterBlockPos";
import type { IPlayerContext } from "../utils/IPlayerContext";

const INTERACTABLE = /(_door|fence_gate|trapdoor|chest|barrel|crafting_table|furnace|smoker|anvil|lever|_button|shulker_box|hopper|dispenser|dropper|enchanting_table|brewing_stand|loom|stonecutter|grindstone|cartography_table|smithing_table|bed)$/;

export class BlockBreakHelper {
    private static readonly BASE_BREAK_DELAY = 1;
    private wasHitting = false;
    private breakDelayTimer = 0;
    private hitting: BetterBlockPos | null = null;

    constructor(private readonly ctx: IPlayerContext) {}

    stopBreakingBlock(): void {
        if (this.wasHitting || this.hitting) {
            this.ctx.controller().stopBreaking();
            this.wasHitting = false;
            this.hitting = null;
        }
    }

    tick(isLeftClick: boolean): void {
        if (this.breakDelayTimer > 0) {
            this.breakDelayTimer--;
            return;
        }
        const trace = this.ctx.objectMouseOver();
        if (isLeftClick && trace !== null) {
            if (this.hitting !== null && this.hitting.equals(trace.pos)) {
            } else {
                if (this.hitting !== null) {
                    this.ctx.controller().stopBreaking();
                }
                this.ctx.controller().startBreaking(trace.pos, trace.direction);
                this.hitting = trace.pos;
            }
            const broken = Blocks.isAir(this.ctx.bsi().get(trace.pos)) || this.ctx.bsi().get(trace.pos).hasFluid();
            if (broken) {
                this.breakDelayTimer = settings.blockBreakSpeed.value - BlockBreakHelper.BASE_BREAK_DELAY;
                this.hitting = null;
            }
            this.wasHitting = !broken;
        } else {
            if (this.wasHitting || this.hitting) {
                this.ctx.controller().stopBreaking();
                this.hitting = null;
            }
            this.wasHitting = false;
        }
    }
}

export class BlockPlaceHelper {
    private static readonly BASE_PLACE_DELAY = 1;
    private rightClickTimer = 0;

    constructor(private readonly ctx: IPlayerContext) {}

    tick(rightClickRequested: boolean): void {
        if (this.rightClickTimer > 0) {
            this.rightClickTimer--;
            return;
        }
        const mouseOver = this.ctx.objectMouseOver();
        if (!rightClickRequested || mouseOver === null) {
            return;
        }
        this.rightClickTimer = settings.rightClickSpeed.value - BlockPlaceHelper.BASE_PLACE_DELAY;
        const ctx = this.ctx;
        const slot = ctx.player().selectedSlot();
        const held = ctx.player().inventory().items[slot];
        const target = ctx.bsi().get(mouseOver.pos);
        if (!ctx.player().isCrouching() && INTERACTABLE.test(target.name)) {
            if (ctx.controller().interactWithBlock(mouseOver.pos, mouseOver.direction)) {
                return;
            }
        }
        if (held && held.typeId === "minecraft:bucket") {
            if (ctx.controller().useItem(slot)) {
                return;
            }
        }
        const faceLocation = {
            x: mouseOver.location.x - mouseOver.pos.x,
            y: mouseOver.location.y - mouseOver.pos.y,
            z: mouseOver.location.z - mouseOver.pos.z,
        };
        if (ctx.controller().useItemOnBlock(slot, mouseOver.pos, mouseOver.direction, faceLocation)) {
            return;
        }
        if (held && held.amount > 0) {
            ctx.controller().useItem(slot);
        }
    }
}

export class InputOverrideHandler {
    private readonly inputForceStateMap = new Map<Input, boolean>();
    private readonly blockBreakHelper: BlockBreakHelper;
    private readonly blockPlaceHelper: BlockPlaceHelper;
    private readonly ctx: IPlayerContext;

    constructor(private readonly baritone: IBaritone) {
        this.ctx = baritone.getPlayerContext();
        this.blockBreakHelper = new BlockBreakHelper(this.ctx);
        this.blockPlaceHelper = new BlockPlaceHelper(this.ctx);
    }

    isInputForcedDown(input: Input | null): boolean {
        return input === null ? false : this.inputForceStateMap.get(input) ?? false;
    }

    setInputForceState(input: Input, forced: boolean): void {
        this.inputForceStateMap.set(input, forced);
    }

    clearAllKeys(): void {
        this.inputForceStateMap.clear();
    }

    onTick(): void {
        if (this.isInputForcedDown(Input.CLICK_LEFT)) {
            this.setInputForceState(Input.CLICK_RIGHT, false);
        }
        this.blockBreakHelper.tick(this.isInputForcedDown(Input.CLICK_LEFT));
        this.blockPlaceHelper.tick(this.isInputForcedDown(Input.CLICK_RIGHT));
    }

    applyMovement(): void {
        const forward = (this.isInputForcedDown(Input.MOVE_FORWARD) ? 1 : 0) - (this.isInputForcedDown(Input.MOVE_BACK) ? 1 : 0);
        const strafe = (this.isInputForcedDown(Input.MOVE_LEFT) ? 1 : 0) - (this.isInputForcedDown(Input.MOVE_RIGHT) ? 1 : 0);
        const pathingSprint = this.baritone.getPathingBehavior().wantsSprint();
        const sprint = pathingSprint !== null ? pathingSprint : this.isInputForcedDown(Input.SPRINT);
        this.ctx.controller().applyMovement(forward, strafe, this.isInputForcedDown(Input.JUMP), this.isInputForcedDown(Input.SNEAK), sprint && forward > 0);
    }

    getBlockBreakHelper(): BlockBreakHelper {
        return this.blockBreakHelper;
    }
}
