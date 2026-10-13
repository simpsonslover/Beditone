import { BetterBlockPos, Direction, Vec3 } from "./BetterBlockPos";
import { Rotation } from "./Rotation";
import type { BlockStateInterface, WorldAccess } from "../world/BlockStateInterface";

export interface ItemInfo {
    readonly typeId: string;
    readonly amount: number;
    readonly damage: number;
    readonly maxDamage: number;
    readonly enchantments: Readonly<Record<string, number>>;
}

export const EMPTY_ITEM: ItemInfo = Object.freeze({ typeId: "minecraft:air", amount: 0, damage: 0, maxDamage: 0, enchantments: Object.freeze({}) });

export function isEmpty(item: ItemInfo | undefined | null): boolean {
    return !item || item.amount <= 0 || item.typeId === "minecraft:air";
}

export interface InventoryView {
    readonly items: readonly ItemInfo[];
    readonly offhand: ItemInfo;
}

export interface BlockHitResult {
    readonly pos: BetterBlockPos;
    readonly direction: Direction;
    readonly location: Vec3;
}

export interface EntityInfo {
    readonly id: string;
    readonly typeId: string;
    readonly name: string;
    readonly position: Vec3;
    readonly isPlayer: boolean;
    readonly isLiving: boolean;
    readonly onGround: boolean;
    readonly itemTypeId?: string;
}

export interface IPlayer {
    id(): string;
    position(): Vec3;
    deltaMovement(): Vec3;
    onGround(): boolean;
    isInWater(): boolean;
    isInLava(): boolean;
    isUnderWater(): boolean;
    isSwimming(): boolean;
    isCrouching(): boolean;
    isSprinting(): boolean;
    setSprinting(sprinting: boolean): void;
    onClimbable(): boolean;
    horizontalCollision(): boolean;
    eyeHeight(): number;
    sneakingEyeHeight(): number;
    foodLevel(): number;
    airSupply(): number;
    maxAirSupply(): number;
    effectAmplifier(effect: string): number | undefined;
    inventory(): InventoryView;
    selectedSlot(): number;
    setSelectedSlot(slot: number): void;
    isInWall(): boolean;
    isAlive(): boolean;
    speedAttribute(): number;
    armorEnchantmentLevel(enchantment: string): number;
}

export interface BotController {
    applyMovement(forward: number, strafe: number, jump: boolean, sneak: boolean, sprint: boolean): void;
    setRotation(rotation: Rotation): void;
    startBreaking(pos: BetterBlockPos, face: Direction): void;
    stopBreaking(): void;
    useItemOnBlock(slot: number, pos: BetterBlockPos, face: Direction, faceLocation: Vec3): boolean;
    interactWithBlock(pos: BetterBlockPos, face: Direction): boolean;
    useItem(slot: number): boolean;
    swapSlots(inventorySlot: number, hotbarSlot: number): void;
}

export interface IPlayerContext {
    controller(): BotController;
    player(): IPlayer;
    world(): WorldAccess;
    bsi(): BlockStateInterface;
    playerFeet(): BetterBlockPos;
    playerFeetAsVec(): Vec3;
    playerHead(): Vec3;
    playerMotion(): Vec3;
    playerRotations(): Rotation;
    viewerPos(): BetterBlockPos;
    viewerYaw(): number;
    objectMouseOver(): BlockHitResult | null;
    getSelectedBlock(): BetterBlockPos | null;
    isLookingAt(pos: Vec3): boolean;
    entities(): EntityInfo[];
    blockReachDistance(): number;
    rayTraceTowards(rotation: Rotation, reach: number, wouldSneak: boolean): BlockHitResult | null;
    peekRotation(rotation: Rotation): Rotation;
}
