import { Direction as BDirection, Entity, EntityComponentTypes, EquipmentSlot, ItemStack, Player } from "@minecraft/server";
import { LookDuration } from "@minecraft/server-gametest";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { settings } from "../Settings";
import { BetterBlockPos, Direction, Directions, Vec3 } from "../utils/BetterBlockPos";
import { EMPTY_ITEM, BlockHitResult, BotController, EntityInfo, InventoryView, IPlayer, IPlayerContext, ItemInfo } from "../utils/IPlayerContext";
import { Rotation, RotationUtils, DEG_TO_RAD } from "../utils/Rotation";
import { BlockStateInterface } from "../world/BlockStateInterface";
import { Blocks } from "../world/Blocks";
import { MovementHelper } from "../movement/MovementHelper";
import { BedrockWorld } from "./BedrockWorld";

const TO_BEDROCK_DIR: Record<Direction["name"], BDirection> = {
    down: BDirection.Down,
    up: BDirection.Up,
    north: BDirection.North,
    south: BDirection.South,
    west: BDirection.West,
    east: BDirection.East,
};

const FROM_BEDROCK_DIR: Record<string, Direction> = {
    Down: Directions.DOWN,
    Up: Directions.UP,
    North: Directions.NORTH,
    South: Directions.SOUTH,
    West: Directions.WEST,
    East: Directions.EAST,
};

const SNEAKING_EYE_HEIGHT = 1.27;

function itemInfo(stack: ItemStack | undefined): ItemInfo {
    if (!stack) return EMPTY_ITEM;
    let damage = 0;
    let maxDamage = 0;
    const enchantments: Record<string, number> = {};
    try {
        const d = stack.getComponent("minecraft:durability");
        if (d) {
            damage = d.damage;
            maxDamage = d.maxDurability;
        }
    } catch {
    }
    try {
        const e = stack.getComponent("minecraft:enchantable");
        if (e) {
            for (const en of e.getEnchantments()) {
                enchantments[en.type.id.replace("minecraft:", "")] = en.level;
            }
        }
    } catch {
    }
    return { typeId: stack.typeId, amount: stack.amount, damage, maxDamage, enchantments };
}

export class BedrockPlayerContext implements IPlayerContext, IPlayer, BotController {
    private readonly worlds = new Map<string, BedrockWorld>();
    protected invCache: InventoryView | null = null;
    private entityCache: EntityInfo[] | null = null;
    protected lastMoveInput = false;
    private aim: ((r: Rotation) => Rotation) | null = null;

    constructor(readonly sim: SimulatedPlayer, readonly owner: Player) {}

    setAim(aim: (r: Rotation) => Rotation): void {
        this.aim = aim;
    }

    newTick(): void {
        this.invCache = null;
        this.entityCache = null;
    }

    controller(): BotController {
        return this;
    }

    player(): IPlayer {
        return this;
    }

    world(): BedrockWorld {
        const dim = this.sim.dimension;
        let w = this.worlds.get(dim.id);
        if (!w) {
            w = new BedrockWorld(dim);
            this.worlds.set(dim.id, w);
        }
        return w;
    }

    bsi(): BlockStateInterface {
        return new BlockStateInterface(this.world());
    }

    playerFeet(): BetterBlockPos {
        const p = this.sim.location;
        const feet = new BetterBlockPos(Math.floor(p.x), Math.floor(p.y + 0.1251), Math.floor(p.z));
        if (Blocks.isSlab(this.world().getState(feet.x, feet.y, feet.z))) {
            return feet.above();
        }
        return feet;
    }

    playerFeetAsVec(): Vec3 {
        const p = this.sim.location;
        return { x: p.x, y: p.y, z: p.z };
    }

    playerHead(): Vec3 {
        const p = this.sim.location;
        return { x: p.x, y: p.y + this.eyeHeight(), z: p.z };
    }

    playerMotion(): Vec3 {
        return this.sim.getVelocity();
    }

    playerRotations(): Rotation {
        const r = this.sim.getRotation();
        return new Rotation(r.y, r.x);
    }

    viewerPos(): BetterBlockPos {
        return BetterBlockPos.of(this.owner.location);
    }

    viewerYaw(): number {
        return this.owner.getRotation().y;
    }

    objectMouseOver(): BlockHitResult | null {
        return this.rayTraceTowards(this.playerRotations(), this.blockReachDistance(), false);
    }

    getSelectedBlock(): BetterBlockPos | null {
        const r = this.objectMouseOver();
        return r ? r.pos : null;
    }

    isLookingAt(pos: Vec3): boolean {
        const s = this.getSelectedBlock();
        return s !== null && s.equals(pos);
    }

    entities(): EntityInfo[] {
        if (this.entityCache) return this.entityCache;
        let list: Entity[] = [];
        try {
            list = this.sim.dimension.getEntities({ location: this.sim.location, maxDistance: 128 });
        } catch {
            list = [];
        }
        const out: EntityInfo[] = [];
        for (const e of list) {
            if (!e.isValid) continue;
            let itemTypeId: string | undefined;
            if (e.typeId === "minecraft:item") {
                try {
                    itemTypeId = e.getComponent("minecraft:item")?.itemStack.typeId;
                } catch {
                    itemTypeId = undefined;
                }
            }
            let living = false;
            try {
                living = !!e.getComponent(EntityComponentTypes.Health);
            } catch {
                living = false;
            }
            const isPlayer = e.typeId === "minecraft:player";
            out.push({
                id: e.id,
                typeId: e.typeId,
                name: isPlayer ? (e as Player).name : e.nameTag || e.typeId.replace("minecraft:", ""),
                position: { x: e.location.x, y: e.location.y, z: e.location.z },
                isPlayer,
                isLiving: living,
                onGround: e.isOnGround,
                itemTypeId,
            });
        }
        this.entityCache = out;
        return out;
    }

    blockReachDistance(): number {
        return settings.blockReachDistance.value;
    }

    rayTraceTowards(rotation: Rotation, reach: number, wouldSneak: boolean): BlockHitResult | null {
        const p = this.sim.location;
        const start = { x: p.x, y: p.y + (wouldSneak ? SNEAKING_EYE_HEIGHT : this.eyeHeight()), z: p.z };
        const dir = RotationUtils.calcLookDirectionFromRotation(rotation);
        try {
            const hit = this.sim.dimension.getBlockFromRay(start, dir, { maxDistance: reach, includeLiquidBlocks: false, includePassableBlocks: true });
            if (!hit) return null;
            const b = hit.block.location;
            return {
                pos: new BetterBlockPos(b.x, b.y, b.z),
                direction: FROM_BEDROCK_DIR[hit.face] ?? Directions.UP,
                location: { x: b.x + hit.faceLocation.x, y: b.y + hit.faceLocation.y, z: b.z + hit.faceLocation.z },
            };
        } catch {
            return null;
        }
    }

    peekRotation(rotation: Rotation): Rotation {
        return this.aim ? this.aim(rotation) : rotation;
    }

    id(): string {
        return this.sim.id;
    }

    position(): Vec3 {
        return this.sim.location;
    }

    deltaMovement(): Vec3 {
        return this.sim.getVelocity();
    }

    onGround(): boolean {
        return this.sim.isOnGround;
    }

    isInWater(): boolean {
        return this.sim.isInWater;
    }

    isInLava(): boolean {
        const p = this.sim.location;
        return MovementHelper.isLava(this.world().getState(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
    }

    isUnderWater(): boolean {
        const h = this.playerHead();
        return MovementHelper.isWater(this.world().getState(Math.floor(h.x), Math.floor(h.y), Math.floor(h.z)));
    }

    isSwimming(): boolean {
        return this.sim.isSwimming;
    }

    isCrouching(): boolean {
        return this.sim.isSneaking;
    }

    isSprinting(): boolean {
        return this.sim.isSprinting;
    }

    setSprinting(sprinting: boolean): void {
        try {
            this.sim.isSprinting = sprinting;
        } catch {
        }
    }

    onClimbable(): boolean {
        const f = this.playerFeet();
        return Blocks.isClimbable(this.world().getState(f.x, f.y, f.z));
    }

    horizontalCollision(): boolean {
        const v = this.sim.getVelocity();
        return this.lastMoveInput && Math.abs(v.x) < 0.01 && Math.abs(v.z) < 0.01;
    }

    eyeHeight(): number {
        try {
            return this.sim.getHeadLocation().y - this.sim.location.y;
        } catch {
            return 1.62;
        }
    }

    sneakingEyeHeight(): number {
        return SNEAKING_EYE_HEIGHT;
    }

    foodLevel(): number {
        try {
            return this.sim.getComponent(EntityComponentTypes.Hunger)?.currentValue ?? 20;
        } catch {
            return 20;
        }
    }

    airSupply(): number {
        return this.isUnderWater() ? 100 : 300;
    }

    maxAirSupply(): number {
        return 300;
    }

    effectAmplifier(effect: string): number | undefined {
        try {
            return this.sim.getEffect(effect)?.amplifier;
        } catch {
            return undefined;
        }
    }

    inventory(): InventoryView {
        if (this.invCache) return this.invCache;
        const items: ItemInfo[] = new Array(36).fill(EMPTY_ITEM);
        let offhand = EMPTY_ITEM;
        try {
            const container = this.sim.getComponent(EntityComponentTypes.Inventory)?.container;
            if (container) {
                for (let i = 0; i < Math.min(36, container.size); i++) {
                    items[i] = itemInfo(container.getItem(i));
                }
            }
            offhand = itemInfo(this.sim.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Offhand));
        } catch {
        }
        this.invCache = { items, offhand };
        return this.invCache;
    }

    selectedSlot(): number {
        return this.sim.selectedSlotIndex;
    }

    setSelectedSlot(slot: number): void {
        if (this.sim.selectedSlotIndex !== slot) {
            this.sim.selectedSlotIndex = slot;
        }
    }

    isInWall(): boolean {
        const h = this.playerHead();
        const s = this.world().getState(Math.floor(h.x), Math.floor(h.y), Math.floor(h.z));
        return MovementHelper.isBlockNormalCube(s);
    }

    isAlive(): boolean {
        try {
            return this.sim.isValid && (this.sim.getComponent(EntityComponentTypes.Health)?.currentValue ?? 1) > 0;
        } catch {
            return false;
        }
    }

    speedAttribute(): number {
        try {
            return this.sim.getComponent(EntityComponentTypes.Movement)?.currentValue ?? 0.1;
        } catch {
            return 0.1;
        }
    }

    armorEnchantmentLevel(enchantment: string): number {
        let best = 0;
        try {
            const eq = this.sim.getComponent(EntityComponentTypes.Equippable);
            for (const slot of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
                best = Math.max(best, itemInfo(eq?.getEquipment(slot)).enchantments[enchantment] ?? 0);
            }
        } catch {
        }
        return best;
    }

    applyMovement(forward: number, strafe: number, jump: boolean, sneak: boolean, sprint: boolean): void {
        const sim = this.sim;
        try {
            if (sim.isSneaking !== sneak) sim.isSneaking = sneak;
            if (sim.isSprinting !== sprint) sim.isSprinting = sprint;
            if (sneak && !jump) {
                this.safeWalk();
            } else {
                this.lastSafe = null;
            }
            let wx = 0;
            let wz = 0;
            if (forward !== 0 || strafe !== 0) {
                const yaw = sim.getRotation().y * DEG_TO_RAD;
                wx = -Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
                wz = Math.cos(yaw) * forward + Math.sin(yaw) * strafe;
                const len = Math.sqrt(wx * wx + wz * wz);
                if (len > 1) {
                    wx /= len;
                    wz /= len;
                }
                if (sneak && !jump && sim.isOnGround) {
                    const p = sim.location;
                    const look = 0.15;
                    if (!this.supported(p.x + Math.sign(wx) * look, p.y, p.z)) wx = 0;
                    if (!this.supported(p.x, p.y, p.z + Math.sign(wz) * look)) wz = 0;
                }
            }
            this.lastMoveInput = wx !== 0 || wz !== 0;
            if (this.lastMoveInput) {
                sim.move(wx, wz, 1);
            } else {
                sim.stopMoving();
            }
            if (jump) {
                if (sim.isInWater || this.isInLava()) {
                    sim.applyImpulse({ x: 0, y: 0.04, z: 0 });
                } else {
                    sim.jump();
                }
            }
        } catch {
        }
    }

    protected lastSafe: Vec3 | null = null;

    protected supported(x: number, y: number, z: number): boolean {
        const w = this.world();
        const by = Math.floor(y - 0.01);
        for (const dx of [-0.299, 0.299]) {
            for (const dz of [-0.299, 0.299]) {
                if (!w.getState(Math.floor(x + dx), by, Math.floor(z + dz)).collisionEmpty()) return true;
            }
        }
        return false;
    }

    protected safeWalk(): void {
        const sim = this.sim;
        const p = sim.location;
        if (sim.isOnGround && this.supported(p.x, p.y, p.z)) {
            this.lastSafe = { x: p.x, y: p.y, z: p.z };
            return;
        }
        const s = this.lastSafe;
        if (s && p.y > s.y - 1 && Math.abs(p.x - s.x) < 1 && Math.abs(p.z - s.z) < 1) {
            sim.teleport(s, { dimension: sim.dimension, keepVelocity: false });
        }
    }

    setRotation(rotation: Rotation): void {
        try {
            const head = this.playerHead();
            const d = RotationUtils.calcLookDirectionFromRotation(rotation);
            this.sim.lookAtLocation({ x: head.x + d.x * 64, y: head.y + d.y * 64, z: head.z + d.z * 64 }, LookDuration.Instant);
        } catch {
        }
    }

    startBreaking(pos: BetterBlockPos, face: Direction): void {
        try {
            this.sim.breakBlock(pos, TO_BEDROCK_DIR[face.name]);
        } catch {
        }
    }

    stopBreaking(): void {
        try {
            this.sim.stopBreakingBlock();
        } catch {
        }
    }

    useItemOnBlock(slot: number, pos: BetterBlockPos, face: Direction, faceLocation: Vec3): boolean {
        try {
            const ok = this.sim.useItemInSlotOnBlock(slot, pos, TO_BEDROCK_DIR[face.name], faceLocation);
            this.invCache = null;
            return ok;
        } catch {
            return false;
        }
    }

    interactWithBlock(pos: BetterBlockPos, face: Direction): boolean {
        try {
            return this.sim.interactWithBlock(pos, TO_BEDROCK_DIR[face.name]);
        } catch {
            return false;
        }
    }

    useItem(slot: number): boolean {
        try {
            const held = this.inventory().items[slot];
            if (held && held.typeId === "minecraft:bucket") {
                const p = this.sim.location;
                const start = { x: p.x, y: p.y + this.eyeHeight(), z: p.z };
                const dir = RotationUtils.calcLookDirectionFromRotation(this.playerRotations());
                const hit = this.sim.dimension.getBlockFromRay(start, dir, { maxDistance: this.blockReachDistance(), includeLiquidBlocks: true, includePassableBlocks: true });
                if (hit && hit.block.isLiquid) {
                    const ok = this.sim.useItemInSlotOnBlock(slot, hit.block.location, BDirection.Up);
                    this.invCache = null;
                    return ok;
                }
            }
            const ok = this.sim.useItemInSlot(slot);
            this.invCache = null;
            return ok;
        } catch {
            return false;
        }
    }

    swapSlots(inventorySlot: number, hotbarSlot: number): void {
        try {
            const container = this.sim.getComponent(EntityComponentTypes.Inventory)?.container;
            container?.swapItems(inventorySlot, hotbarSlot, container);
            this.invCache = null;
        } catch {
        }
    }
}
