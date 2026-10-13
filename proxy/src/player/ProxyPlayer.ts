import { BetterBlockPos, Direction, Directions, Vec3 } from "../../../src/utils/BetterBlockPos";
import { BlockHitResult, BotController, EMPTY_ITEM, EntityInfo, InventoryView, IPlayer, IPlayerContext, ItemInfo } from "../../../src/utils/IPlayerContext";
import { Rotation, RotationUtils, DEG_TO_RAD } from "../../../src/utils/Rotation";
import { BlockStateInterface } from "../../../src/world/BlockStateInterface";
import { AIR, BlockState } from "../../../src/world/BlockState";
import { Blocks } from "../../../src/world/Blocks";
import { ToolSet } from "../../../src/world/ToolSet";
import { MovementHelper, canBeReplaced } from "../../../src/movement/MovementHelper";
import { BLOCKS } from "../../../src/world/blockdata.generated";
import { settings } from "../../../src/Settings";
import type { ChunkStore } from "../world/ChunkStore";
import type { BlockPalette } from "../world/BlockPalette";
import type { Items, NetItem } from "./Items";
import type { MoveState } from "./Physics";

export const EYE_HEIGHT = 1.62;
const SNEAKING_EYE_HEIGHT = 1.27;

const FACE: Record<string, number> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };

export interface TrackedEntity {
    runtimeId: bigint;
    typeId: string;
    name: string;
    position: Vec3;
    isPlayer: boolean;
    onGround: boolean;
    itemTypeId?: string;
}

export interface Keys {
    forward: number;
    strafe: number;
    jump: boolean;
    sneak: boolean;
    sprint: boolean;
}

export interface Outgoing {
    keys: Keys;
    blockActions: { action: string; position: Vec3; face: number }[];
    transactions: object[];
    selectSlot: number | null;
}

const PASSIVE = new Set(
    "allay armadillo axolotl bat bee camel cat chicken cod cow donkey fox frog glow_squid goat horse llama mooshroom mule ocelot panda parrot pig polar_bear pufferfish rabbit salmon sheep sniffer squid strider tadpole trader_llama tropicalfish turtle villager wandering_trader wolf iron_golem snow_golem".split(
        " ",
    ),
);

export class ProxyPlayer implements IPlayerContext, IPlayer, BotController {
    runtimeId = 0n;
    pos: Vec3 = { x: 0, y: 0, z: 0 };
    delta: Vec3 = { x: 0, y: 0, z: 0 };
    cameraYaw = 0;
    cameraPitch = 0;
    gameMode = "survival";
    health = 20;
    hunger = 20;
    movementSpeed = 0.1;
    readonly effects = new Map<string, number>();
    readonly inv: (NetItem | null)[] = new Array(36).fill(null);
    readonly armor: (NetItem | null)[] = new Array(4).fill(null);
    offhandItem: NetItem | null = null;
    slot = 0;
    readonly entities_ = new Map<bigint, TrackedEntity>();
    simulating = false;
    move: MoveState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, onGround: true, horizontalCollision: false, jumpDelay: 0 };

    private virtualRot = new Rotation(0, 0);
    private sneaking = false;
    private sprinting = false;
    private lastMoveInput = false;
    private invCache: InventoryView | null = null;
    private aim: ((r: Rotation) => Rotation) | null = null;
    private breaking: { pos: BetterBlockPos; face: number; progress: number; started: boolean } | null = null;

    get isBreaking(): boolean {
        return this.breaking !== null;
    }
    out: Outgoing = ProxyPlayer.emptyOut();

    static emptyOut(): Outgoing {
        return { keys: { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }, blockActions: [], transactions: [], selectSlot: null };
    }

    constructor(
        public worldStore: ChunkStore,
        public palette: BlockPalette,
        readonly items: Items,
    ) {}

    setAim(aim: (r: Rotation) => Rotation): void {
        this.aim = aim;
    }

    beginTick(): void {
        this.invCache = null;
        this.out = ProxyPlayer.emptyOut();
    }

    syncRotationToCamera(): void {
        this.virtualRot = new Rotation(this.cameraYaw, this.cameraPitch);
    }

    get rotation(): Rotation {
        return this.virtualRot;
    }

    controller(): BotController {
        return this;
    }

    player(): IPlayer {
        return this;
    }

    world(): ChunkStore {
        return this.worldStore;
    }

    bsi(): BlockStateInterface {
        return new BlockStateInterface(this.worldStore);
    }

    playerFeet(): BetterBlockPos {
        const p = this.pos;
        const feet = new BetterBlockPos(Math.floor(p.x), Math.floor(p.y + 0.1251), Math.floor(p.z));
        if (Blocks.isSlab(this.worldStore.getState(feet.x, feet.y, feet.z))) {
            return feet.above();
        }
        return feet;
    }

    playerFeetAsVec(): Vec3 {
        return { ...this.pos };
    }

    playerHead(): Vec3 {
        return { x: this.pos.x, y: this.pos.y + this.eyeHeight(), z: this.pos.z };
    }

    playerMotion(): Vec3 {
        return this.delta;
    }

    playerRotations(): Rotation {
        return this.virtualRot;
    }

    viewerPos(): BetterBlockPos {
        return BetterBlockPos.of(this.pos);
    }

    viewerYaw(): number {
        return this.cameraYaw;
    }

    objectMouseOver(): BlockHitResult | null {
        return this.rayTraceTowards(this.virtualRot, this.blockReachDistance(), false);
    }

    getSelectedBlock(): BetterBlockPos | null {
        return this.objectMouseOver()?.pos ?? null;
    }

    isLookingAt(pos: Vec3): boolean {
        const s = this.getSelectedBlock();
        return s !== null && s.equals(pos);
    }

    entities(): EntityInfo[] {
        const out: EntityInfo[] = [];
        for (const e of this.entities_.values()) {
            const name = e.typeId.replace("minecraft:", "");
            out.push({
                id: String(e.runtimeId),
                typeId: e.typeId,
                name: e.name || name,
                position: e.position,
                isPlayer: e.isPlayer,
                isLiving: e.typeId !== "minecraft:item" && e.typeId !== "minecraft:xp_orb" && !e.typeId.includes("arrow"),
                onGround: e.onGround,
                itemTypeId: e.itemTypeId,
            });
        }
        return out;
    }

    blockReachDistance(): number {
        return settings.blockReachDistance.value;
    }

    rayTraceTowards(rotation: Rotation, reach: number, wouldSneak: boolean): BlockHitResult | null {
        const start = { x: this.pos.x, y: this.pos.y + (wouldSneak ? SNEAKING_EYE_HEIGHT : this.eyeHeight()), z: this.pos.z };
        const dir = RotationUtils.calcLookDirectionFromRotation(rotation);
        return this.raycast(start, dir, reach, false);
    }

    raycast(start: Vec3, dir: Vec3, reach: number, liquids: boolean): BlockHitResult | null {
        let x = Math.floor(start.x);
        let y = Math.floor(start.y);
        let z = Math.floor(start.z);
        const stepX = Math.sign(dir.x);
        const stepY = Math.sign(dir.y);
        const stepZ = Math.sign(dir.z);
        const tDelta = (d: number) => (d === 0 ? Infinity : Math.abs(1 / d));
        const tNext = (p: number, i: number, d: number) => (d > 0 ? (i + 1 - p) / d : d < 0 ? (p - i) / -d : Infinity);
        let tMaxX = tNext(start.x, x, dir.x);
        let tMaxY = tNext(start.y, y, dir.y);
        let tMaxZ = tNext(start.z, z, dir.z);
        const dX = tDelta(dir.x);
        const dY = tDelta(dir.y);
        const dZ = tDelta(dir.z);
        for (let i = 0; i < 64; i++) {
            const hit = this.hitBlock(x, y, z, start, dir, reach, liquids);
            if (hit) return hit;
            if (tMaxX < tMaxY && tMaxX < tMaxZ) {
                if (tMaxX > reach) return null;
                x += stepX;
                tMaxX += dX;
            } else if (tMaxY < tMaxZ) {
                if (tMaxY > reach) return null;
                y += stepY;
                tMaxY += dY;
            } else {
                if (tMaxZ > reach) return null;
                z += stepZ;
                tMaxZ += dZ;
            }
        }
        return null;
    }

    private hitBlock(bx: number, by: number, bz: number, o: Vec3, d: Vec3, reach: number, liquids: boolean): BlockHitResult | null {
        const state = this.worldStore.getState(bx, by, bz);
        if (state === AIR) return null;
        let boxes: readonly (readonly number[])[] = state.collision;
        if (state.fluid !== 0 && !state.waterlogged) {
            if (!liquids) return null;
            boxes = [[0, 0, 0, 1, 1, 1]];
        } else if (boxes.length === 0) {
            boxes = [[0, 0, 0, 1, 1, 1]];
        }
        let best: { t: number; face: Direction } | null = null;
        for (const b of boxes) {
            const r = rayBox(o, d, bx + b[0], by + b[1], bz + b[2], bx + b[3], by + b[4], bz + b[5]);
            if (r && r.t <= reach && (!best || r.t < best.t)) best = r;
        }
        if (!best) return null;
        return {
            pos: new BetterBlockPos(bx, by, bz),
            direction: best.face,
            location: { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t },
        };
    }

    peekRotation(rotation: Rotation): Rotation {
        return this.aim ? this.aim(rotation) : rotation;
    }

    id(): string {
        return String(this.runtimeId);
    }

    position(): Vec3 {
        return this.pos;
    }

    deltaMovement(): Vec3 {
        return this.delta;
    }

    private supportAt(x: number, y: number, z: number): boolean {
        for (const dx of [-0.299, 0.299]) {
            for (const dz of [-0.299, 0.299]) {
                const bx = Math.floor(x + dx);
                const bz = Math.floor(z + dz);
                const by = Math.floor(y - 0.01);
                const s = this.worldStore.getState(bx, by, bz);
                for (const b of s.collision) {
                    const top = by + b[4];
                    const inside = x + dx >= bx + b[0] && x + dx <= bx + b[3] && z + dz >= bz + b[2] && z + dz <= bz + b[5];
                    if (inside && Math.abs(y - top) < 0.03) return true;
                }
                const below = this.worldStore.getState(bx, by - 1, bz);
                for (const b of below.collision) {
                    if (b[4] > 1 && Math.abs(y - (by - 1 + b[4])) < 0.03) return true;
                }
            }
        }
        return false;
    }

    onGround(): boolean {
        if (this.simulating) return this.move.onGround;
        return this.delta.y <= 0.001 && this.supportAt(this.pos.x, this.pos.y, this.pos.z);
    }

    isInWater(): boolean {
        const p = this.pos;
        return MovementHelper.isWater(this.worldStore.getState(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z)));
    }

    isInLava(): boolean {
        const p = this.pos;
        return MovementHelper.isLava(this.worldStore.getState(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z)));
    }

    isUnderWater(): boolean {
        const h = this.playerHead();
        return MovementHelper.isWater(this.worldStore.getState(Math.floor(h.x), Math.floor(h.y), Math.floor(h.z)));
    }

    isSwimming(): boolean {
        return false;
    }

    isCrouching(): boolean {
        return this.sneaking;
    }

    isSprinting(): boolean {
        return this.sprinting;
    }

    setSprinting(sprinting: boolean): void {
        this.sprinting = sprinting;
    }

    onClimbable(): boolean {
        const f = this.playerFeet();
        return Blocks.isClimbable(this.worldStore.getState(f.x, f.y, f.z));
    }

    horizontalCollision(): boolean {
        if (this.simulating) return this.move.horizontalCollision;
        return this.lastMoveInput && Math.abs(this.delta.x) < 0.01 && Math.abs(this.delta.z) < 0.01;
    }

    eyeHeight(): number {
        return EYE_HEIGHT;
    }

    sneakingEyeHeight(): number {
        return SNEAKING_EYE_HEIGHT;
    }

    foodLevel(): number {
        return this.hunger;
    }

    airSupply(): number {
        return this.isUnderWater() ? 100 : 300;
    }

    maxAirSupply(): number {
        return 300;
    }

    effectAmplifier(effect: string): number | undefined {
        return this.effects.get(effect);
    }

    inventory(): InventoryView {
        if (this.invCache) return this.invCache;
        this.invCache = {
            items: this.inv.map((i) => (i ? this.items.info(i) : EMPTY_ITEM)),
            offhand: this.offhandItem ? this.items.info(this.offhandItem) : EMPTY_ITEM,
        };
        return this.invCache;
    }

    invalidateInventory(): void {
        this.invCache = null;
    }

    selectedSlot(): number {
        return this.slot;
    }

    setSelectedSlot(slot: number): void {
        if (this.slot !== slot) {
            this.slot = slot;
            this.out.selectSlot = slot;
        }
    }

    isInWall(): boolean {
        const h = this.playerHead();
        return MovementHelper.isBlockNormalCube(this.worldStore.getState(Math.floor(h.x), Math.floor(h.y), Math.floor(h.z)));
    }

    isAlive(): boolean {
        return this.health > 0;
    }

    speedAttribute(): number {
        return this.movementSpeed;
    }

    armorEnchantmentLevel(enchantment: string): number {
        let best = 0;
        for (const a of this.armor) if (a) best = Math.max(best, this.items.info(a).enchantments[enchantment] ?? 0);
        return best;
    }

    applyMovement(forward: number, strafe: number, jump: boolean, sneak: boolean, sprint: boolean): void {
        this.tickBreaking();
        this.sneaking = sneak;
        this.sprinting = sprint && forward > 0 && !sneak;
        this.lastMoveInput = forward !== 0 || strafe !== 0;
        this.out.keys = { forward, strafe, jump, sneak, sprint: this.sprinting };
    }

    setRotation(rotation: Rotation): void {
        this.virtualRot = rotation;
    }

    startBreaking(pos: BetterBlockPos, face: Direction): void {
        if (!this.breaking || !this.breaking.pos.equals(pos)) {
            if (this.breaking?.started) this.out.blockActions.push({ action: "abort_break", position: this.breaking.pos, face: this.breaking.face });
            this.breaking = { pos, face: FACE[face.name] ?? 1, progress: 0, started: false };
        }
    }

    stopBreaking(): void {
        if (this.breaking?.started) this.out.blockActions.push({ action: "abort_break", position: this.breaking.pos, face: this.breaking.face });
        this.breaking = null;
    }

    private tickBreaking(): void {
        const b = this.breaking;
        if (!b) return;
        const state = this.worldStore.getState(b.pos.x, b.pos.y, b.pos.z);
        if (state === AIR || state.hasFluid()) {
            this.breaking = null;
            return;
        }
        if (!b.started) {
            b.started = true;
            this.out.blockActions.push({ action: "start_break", position: b.pos, face: b.face });
        } else {
            this.out.blockActions.push({ action: "crack_break", position: b.pos, face: b.face });
        }
        const held = this.inventory().items[this.slot];
        let speed = this.gameMode === "creative" ? 1 : ToolSet.calculateSpeedVsBlock(held, state);
        const haste = this.effects.get("haste");
        if (haste !== undefined) speed *= 1 + (haste + 1) * 0.2;
        const fatigue = this.effects.get("mining_fatigue");
        if (fatigue !== undefined) speed *= Math.pow(0.3, Math.min(fatigue + 1, 4));
        if (this.isUnderWater()) speed /= 5;
        if (!this.onGround()) speed /= 5;
        if (speed <= 0) return;
        b.progress += speed;
        if (b.progress >= 1 + speed) {
            this.out.blockActions.push({ action: "predict_break", position: b.pos, face: b.face });
            this.worldStore.setState(b.pos.x, b.pos.y, b.pos.z, AIR);
            this.out.blockActions.push({ action: "stop_break", position: b.pos, face: b.face });
            this.breaking = null;
        }
    }

    private useTransaction(action: "click_block" | "click_air", slot: number, pos: Vec3, face: number, clickPos: Vec3, blockRuntimeId: number): object {
        const held = this.inv[slot];
        return {
            transaction: {
                legacy: { legacy_request_id: 0 },
                transaction_type: "item_use",
                actions: [],
                transaction_data: {
                    action_type: action,
                    trigger_type: "player_input",
                    block_position: { x: pos.x, y: pos.y, z: pos.z },
                    face,
                    hotbar_slot: slot,
                    hand: "main_hand",
                    held_item: held ?? this.items.empty(),
                    player_pos: this.playerHead(),
                    click_pos: clickPos,
                    block_runtime_id: blockRuntimeId,
                    client_prediction: "success",
                    client_cooldown_state: "off",
                },
            },
        };
    }

    useItemOnBlock(slot: number, pos: BetterBlockPos, face: Direction, faceLocation: Vec3): boolean {
        const state = this.worldStore.getState(pos.x, pos.y, pos.z);
        const click = { x: faceLocation.x - pos.x, y: faceLocation.y - pos.y, z: faceLocation.z - pos.z };
        this.out.transactions.push(this.useTransaction("click_block", slot, pos, FACE[face.name] ?? 1, click, this.palette.runtimeOf(state)));
        this.predictPlacement(slot, pos, face, state);
        return true;
    }

    private predictPlacement(slot: number, pos: BetterBlockPos, face: Direction, clicked: BlockState): void {
        if (this.move.onGround) return;
        const held = this.inventory().items[slot];
        if (!held || held.amount <= 0) return;
        const name = held.typeId.replace("minecraft:", "");
        if (!BLOCKS[name] || /(_door|_bed|^bed)$/.test(name)) return;
        const target = canBeReplaced(clicked) && !clicked.hasFluid() ? pos : pos.relative(face);
        if (!canBeReplaced(this.worldStore.getState(target.x, target.y, target.z))) return;
        this.worldStore.setState(target.x, target.y, target.z, BlockState.of(held.typeId));
    }

    interactWithBlock(pos: BetterBlockPos, face: Direction): boolean {
        return this.useItemOnBlock(this.slot, pos, face, { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
    }

    useItem(slot: number): boolean {
        this.out.transactions.push(this.useTransaction("click_air", slot, { x: 0, y: 0, z: 0 }, 255, { x: 0, y: 0, z: 0 }, 0));
        return true;
    }

    swapSlots(_inventorySlot: number, _hotbarSlot: number): void {
    }
}

function rayBox(o: Vec3, d: Vec3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { t: number; face: Direction } | null {
    let tmin = -Infinity;
    let tmax = Infinity;
    let face: Direction = Directions.UP;
    const axes: [number, number, number, number, Direction, Direction][] = [
        [o.x, d.x, x0, x1, Directions.WEST, Directions.EAST],
        [o.y, d.y, y0, y1, Directions.DOWN, Directions.UP],
        [o.z, d.z, z0, z1, Directions.NORTH, Directions.SOUTH],
    ];
    for (const [p, v, lo, hi, minFace, maxFace] of axes) {
        if (Math.abs(v) < 1e-12) {
            if (p < lo || p > hi) return null;
            continue;
        }
        let t1 = (lo - p) / v;
        let t2 = (hi - p) / v;
        let f = minFace;
        if (t1 > t2) {
            [t1, t2] = [t2, t1];
            f = maxFace;
        }
        if (t1 > tmin) {
            tmin = t1;
            face = f;
        }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    return { t: Math.max(0, tmin), face };
}

export function isHostile(typeId: string): boolean {
    const n = typeId.replace("minecraft:", "");
    return !PASSIVE.has(n) && n !== "player" && n !== "item" && n !== "xp_orb" && !n.includes("arrow");
}

export { BlockState };
