import { settings } from "../Settings";
import type { IBaritone } from "../IBaritone";
import { BlockState } from "../world/BlockState";
import { ToolSet } from "../world/ToolSet";
import { isEmpty, ItemInfo } from "../utils/IPlayerContext";
import type { IPlayerContext } from "../utils/IPlayerContext";

const STONE = BlockState.of("minecraft:stone");

export class InventoryBehavior {
    private ticksSinceLastInventoryMove = 0;
    private lastTickRequestedMove: [number, number] | null = null;
    private readonly ctx: IPlayerContext;

    constructor(private readonly baritone: IBaritone) {
        this.ctx = baritone.getPlayerContext();
    }

    onTick(): void {
        if (!settings.allowInventory.value) {
            return;
        }
        this.ticksSinceLastInventoryMove++;
        if (this.baritone.getPathingBehavior().isPathing()) {
            if (this.firstValidThrowaway() >= 9) {
                this.requestSwapWithHotBar(this.firstValidThrowaway(), 8);
            }
            const pick = this.bestToolAgainst(STONE, "_pickaxe");
            if (pick >= 9) {
                this.requestSwapWithHotBar(pick, 0);
            }
        }
        if (this.lastTickRequestedMove !== null) {
            this.baritone.logDebug("Remembering to move " + this.lastTickRequestedMove[0] + " " + this.lastTickRequestedMove[1] + " from a previous tick");
            this.requestSwapWithHotBar(this.lastTickRequestedMove[0], this.lastTickRequestedMove[1]);
        }
    }

    attemptToPutOnHotbar(inMainInvy: number, disallowedHotbar: (slot: number) => boolean): boolean {
        const destination = this.getTempHotbarSlot(disallowedHotbar);
        if (destination !== null) {
            if (!this.requestSwapWithHotBar(inMainInvy, destination)) {
                return false;
            }
        }
        return true;
    }

    getTempHotbarSlot(disallowedHotbar: (slot: number) => boolean): number | null {
        const items = this.ctx.player().inventory().items;
        let candidates: number[] = [];
        for (let i = 1; i < 8; i++) {
            if (isEmpty(items[i]) && !disallowedHotbar(i)) {
                candidates.push(i);
            }
        }
        if (candidates.length === 0) {
            candidates = [];
            for (let i = 1; i < 8; i++) {
                if (!disallowedHotbar(i)) {
                    candidates.push(i);
                }
            }
        }
        if (candidates.length === 0) {
            return null;
        }
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    private requestSwapWithHotBar(inInventory: number, inHotbar: number): boolean {
        this.lastTickRequestedMove = [inInventory, inHotbar];
        if (this.ticksSinceLastInventoryMove < settings.ticksBetweenInventoryMoves.value) {
            this.baritone.logDebug("Inventory move requested but delaying " + this.ticksSinceLastInventoryMove + " " + settings.ticksBetweenInventoryMoves.value);
            return false;
        }
        if (settings.inventoryMoveOnlyIfStationary.value && !this.baritone.getInventoryPauserProcess().stationaryForInventoryMove()) {
            this.baritone.logDebug("Inventory move requested but delaying until stationary");
            return false;
        }
        this.ctx.controller().swapSlots(inInventory, inHotbar);
        this.ticksSinceLastInventoryMove = 0;
        this.lastTickRequestedMove = null;
        return true;
    }

    private firstValidThrowaway(): number {
        const invy = this.ctx.player().inventory().items;
        for (let i = 0; i < invy.length; i++) {
            if (!isEmpty(invy[i]) && settings.acceptableThrowawayItems.value.includes(invy[i].typeId)) {
                return i;
            }
        }
        return -1;
    }

    private bestToolAgainst(against: BlockState, suffix: string): number {
        const invy = this.ctx.player().inventory().items;
        let bestInd = -1;
        let bestSpeed = -1;
        for (let i = 0; i < invy.length; i++) {
            const stack = invy[i];
            if (isEmpty(stack)) {
                continue;
            }
            if (settings.itemSaver.value && stack.damage + settings.itemSaverThreshold.value >= stack.maxDamage && stack.maxDamage > 1) {
                continue;
            }
            if (stack.typeId.endsWith(suffix)) {
                const speed = ToolSet.calculateSpeedVsBlock(stack, against);
                if (speed > bestSpeed) {
                    bestSpeed = speed;
                    bestInd = i;
                }
            }
        }
        return bestInd;
    }

    hasGenericThrowaway(): boolean {
        for (const item of settings.acceptableThrowawayItems.value) {
            if (this.throwaway(false, (stack) => item === stack.typeId)) {
                return true;
            }
        }
        return false;
    }

    selectThrowawayForLocation(select: boolean, x: number, y: number, z: number): boolean {
        const maybe = this.baritone.getBuilderProcess().placeAt(x, y, z, this.ctx.bsi().get0(x, y, z));
        if (maybe !== null && this.throwaway(select, (stack) => stack.typeId === maybe.typeId)) {
            return true;
        }
        for (const item of settings.acceptableThrowawayItems.value) {
            if (this.throwaway(select, (stack) => item === stack.typeId)) {
                return true;
            }
        }
        return false;
    }

    throwaway(select: boolean, desired: (stack: ItemInfo) => boolean, allowInventory = settings.allowInventory.value): boolean {
        const p = this.ctx.player();
        const inv = p.inventory().items;
        for (let i = 0; i < 9; i++) {
            const item = inv[i];
            if (!isEmpty(item) && desired(item)) {
                if (select) {
                    p.setSelectedSlot(i);
                }
                return true;
            }
        }
        const off = p.inventory().offhand;
        if (!isEmpty(off) && desired(off)) {
            for (let i = 0; i < 9; i++) {
                const item = inv[i];
                if (isEmpty(item) || item.typeId.endsWith("_pickaxe")) {
                    if (select) {
                        p.setSelectedSlot(i);
                    }
                    return true;
                }
            }
        }
        if (allowInventory) {
            for (let i = 9; i < 36; i++) {
                if (!isEmpty(inv[i]) && desired(inv[i])) {
                    if (select) {
                        this.requestSwapWithHotBar(i, 7);
                        p.setSelectedSlot(7);
                    }
                    return true;
                }
            }
        }
        return false;
    }
}
