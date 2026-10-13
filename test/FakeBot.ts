import { Beditone } from "../src/Beditone";
import { BetterBlockPos, Direction, Directions, Vec3 } from "../src/utils/BetterBlockPos";
import { BlockHitResult, BotController, EntityInfo, InventoryView, IPlayer, IPlayerContext, ItemInfo, EMPTY_ITEM } from "../src/utils/IPlayerContext";
import { Rotation, RotationUtils, DEG_TO_RAD } from "../src/utils/Rotation";
import { BlockStateInterface } from "../src/world/BlockStateInterface";
import { AIR, BlockState } from "../src/world/BlockState";
import { MovementHelper } from "../src/movement/MovementHelper";
import type { Storage } from "../src/cache/WorldData";
import { MockWorld } from "./MockWorld";

export class FakeBot implements IPlayerContext, IPlayer, BotController {
    pos: Vec3;
    vel: Vec3 = { x: 0, y: 0, z: 0 };
    rot = new Rotation(0, 0);
    sneaking = false;
    sprinting = false;
    slot = 0;
    items: ItemInfo[] = new Array(36).fill(EMPTY_ITEM);
    messages: string[] = [];
    jobs: Generator<void, void, void>[] = [];
    breaking: BetterBlockPos | null = null;
    breakTicks = 0;
    baritone!: Beditone;

    constructor(readonly w: MockWorld, start: Vec3) {
        this.pos = { ...start };
    }

    static create(w: MockWorld, start: Vec3, items: [string, number][] = []): FakeBot {
        const bot = new FakeBot(w, start);
        items.forEach(([id, n], i) => (bot.items[i] = { typeId: id, amount: n, damage: 0, maxDamage: 0, enchantments: {} }));
        const mem = new Map<string, string>();
        const storage: Storage = { load: (k) => mem.get(k), save: (k, v) => void mem.set(k, v) };
        bot.baritone = new Beditone({
            ctx: bot,
            runJob: (job) => bot.jobs.push(job),
            scanner: {
                scanVolume: (minX, minY, minZ, maxX, maxY, maxZ, typeIds) => {
                    const out: BetterBlockPos[] = [];
                    for (let x = minX; x <= maxX; x++)
                        for (let y = Math.max(minY, 40); y <= Math.min(maxY, 90); y++)
                            for (let z = minZ; z <= maxZ; z++) if (typeIds.includes(w.getState(x, y, z).typeId)) out.push(new BetterBlockPos(x, y, z));
                    return out;
                },
            },
            storage,
            ownerKey: "tester",
            send: (m) => bot.messages.push(m.replace(/§./g, "")),
            notify: () => {},
            loadStructure: () => null,
            saveSettings: () => {},
            loadSettings: () => {},
            viewerLookingAt: () => null,
            botCommand: () => {},
        });
        return bot;
    }

    chat(msg: string): boolean {
        return this.baritone.onChat(msg);
    }

    tick(): void {
        for (const job of [...this.jobs]) {
            for (let i = 0; i < 200; i++) {
                if (job.next().done) {
                    this.jobs.splice(this.jobs.indexOf(job), 1);
                    break;
                }
            }
        }
        this.baritone.tick();
        this.physics();
        if (this.breaking) {
            if (++this.breakTicks >= 3) {
                this.w.set(this.breaking.x, this.breaking.y, this.breaking.z, AIR);
                this.breaking = null;
            }
        }
    }

    private solid(x: number, y: number, z: number): boolean {
        return !MovementHelper.canWalkThroughBsi(this.bsi(), Math.floor(x), Math.floor(y), Math.floor(z));
    }

    private input = { f: 0, s: 0, jump: false };

    private physics(): void {
        const speed = this.sneaking ? 0.065 : this.sprinting ? 0.28 : 0.215;
        const yaw = this.rot.yaw * DEG_TO_RAD;
        let wx = -Math.sin(yaw) * this.input.f + Math.cos(yaw) * this.input.s;
        let wz = Math.cos(yaw) * this.input.f + Math.sin(yaw) * this.input.s;
        const len = Math.hypot(wx, wz);
        if (len > 1) {
            wx /= len;
            wz /= len;
        }
        const onGround = this.onGround();
        if (this.input.jump && onGround) this.vel.y = 0.42;
        this.vel.y = onGround && this.vel.y <= 0 ? 0 : (this.vel.y - 0.08) * 0.98;
        const ny = this.pos.y + this.vel.y;
        if (this.vel.y < 0 && this.solid(this.pos.x, ny, this.pos.z)) {
            this.pos.y = Math.floor(ny) + 1;
            this.vel.y = 0;
        } else if (this.vel.y > 0 && this.solid(this.pos.x, ny + 1.8, this.pos.z)) {
            this.vel.y = 0;
        } else {
            this.pos.y = ny;
        }
        const nx = this.pos.x + wx * speed;
        const nz = this.pos.z + wz * speed;
        const blocked = (x: number, z: number) => this.solid(x, this.pos.y + 0.01, z) || this.solid(x, this.pos.y + 1.0, z) || this.solid(x, this.pos.y + 1.79, z);
        const wouldFall = (x: number, z: number) => this.sneaking && onGround && !this.solid(x, this.pos.y - 0.5, z);
        if (!blocked(nx, this.pos.z) && !wouldFall(nx, this.pos.z)) this.pos.x = nx;
        if (!blocked(this.pos.x, nz) && !wouldFall(this.pos.x, nz)) this.pos.z = nz;
        this.vel.x = wx * speed;
        this.vel.z = wz * speed;
    }

    controller(): BotController {
        return this;
    }
    player(): IPlayer {
        return this;
    }
    world(): MockWorld {
        return this.w;
    }
    bsi(): BlockStateInterface {
        return new BlockStateInterface(this.w);
    }
    playerFeet(): BetterBlockPos {
        return new BetterBlockPos(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1251), Math.floor(this.pos.z));
    }
    playerFeetAsVec(): Vec3 {
        return { ...this.pos };
    }
    playerHead(): Vec3 {
        return { x: this.pos.x, y: this.pos.y + this.eyeHeight(), z: this.pos.z };
    }
    playerMotion(): Vec3 {
        return this.vel;
    }
    playerRotations(): Rotation {
        return this.rot;
    }
    viewerPos(): BetterBlockPos {
        return BetterBlockPos.ORIGIN;
    }
    viewerYaw(): number {
        return 0;
    }
    objectMouseOver(): BlockHitResult | null {
        return this.rayTraceTowards(this.rot, 4.5, false);
    }
    getSelectedBlock(): BetterBlockPos | null {
        return this.objectMouseOver()?.pos ?? null;
    }
    isLookingAt(pos: Vec3): boolean {
        const s = this.getSelectedBlock();
        return s !== null && s.equals(pos);
    }
    entities(): EntityInfo[] {
        return [];
    }
    blockReachDistance(): number {
        return 4.5;
    }
    rayTraceTowards(rotation: Rotation, reach: number, wouldSneak: boolean): BlockHitResult | null {
        const start = { x: this.pos.x, y: this.pos.y + (wouldSneak ? 1.27 : 1.62), z: this.pos.z };
        const d = RotationUtils.calcLookDirectionFromRotation(rotation);
        let x = Math.floor(start.x);
        let y = Math.floor(start.y);
        let z = Math.floor(start.z);
        const stepX = Math.sign(d.x);
        const stepY = Math.sign(d.y);
        const stepZ = Math.sign(d.z);
        const tDelta = (v: number) => (v === 0 ? Infinity : Math.abs(1 / v));
        const tMaxOf = (s: number, v: number, c: number) => (v > 0 ? (c + 1 - s) / v : v < 0 ? (s - c) / -v : Infinity);
        let tMaxX = tMaxOf(start.x, d.x, x);
        let tMaxY = tMaxOf(start.y, d.y, y);
        let tMaxZ = tMaxOf(start.z, d.z, z);
        const dx = tDelta(d.x);
        const dy = tDelta(d.y);
        const dz = tDelta(d.z);
        let face: Direction = Directions.UP;
        let t = 0;
        while (t <= reach) {
            const s = this.w.getState(x, y, z);
            if (s !== AIR && !s.hasFluid()) {
                const loc = { x: start.x + d.x * t, y: start.y + d.y * t, z: start.z + d.z * t };
                return { pos: new BetterBlockPos(x, y, z), direction: face, location: loc };
            }
            if (tMaxX < tMaxY && tMaxX < tMaxZ) {
                x += stepX;
                t = tMaxX;
                tMaxX += dx;
                face = stepX > 0 ? Directions.WEST : Directions.EAST;
            } else if (tMaxY < tMaxZ) {
                y += stepY;
                t = tMaxY;
                tMaxY += dy;
                face = stepY > 0 ? Directions.DOWN : Directions.UP;
            } else {
                z += stepZ;
                t = tMaxZ;
                tMaxZ += dz;
                face = stepZ > 0 ? Directions.NORTH : Directions.SOUTH;
            }
        }
        return null;
    }
    peekRotation(rotation: Rotation): Rotation {
        return this.baritone.getLookBehavior().getAimProcessor().peekRotation(rotation);
    }

    id(): string {
        return "bot";
    }
    position(): Vec3 {
        return this.pos;
    }
    deltaMovement(): Vec3 {
        return this.vel;
    }
    onGround(): boolean {
        return this.vel.y <= 0 && this.solid(this.pos.x, this.pos.y - 0.01, this.pos.z) && this.pos.y - Math.floor(this.pos.y) < 0.01;
    }
    isInWater(): boolean {
        return MovementHelper.isWater(this.w.getState(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)));
    }
    isInLava(): boolean {
        return false;
    }
    isUnderWater(): boolean {
        return false;
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
    setSprinting(s: boolean): void {
        this.sprinting = s;
    }
    onClimbable(): boolean {
        return false;
    }
    horizontalCollision(): boolean {
        return false;
    }
    eyeHeight(): number {
        return this.sneaking ? 1.27 : 1.62;
    }
    sneakingEyeHeight(): number {
        return 1.27;
    }
    foodLevel(): number {
        return 20;
    }
    airSupply(): number {
        return 300;
    }
    maxAirSupply(): number {
        return 300;
    }
    effectAmplifier(): number | undefined {
        return undefined;
    }
    inventory(): InventoryView {
        return { items: this.items, offhand: EMPTY_ITEM };
    }
    selectedSlot(): number {
        return this.slot;
    }
    setSelectedSlot(slot: number): void {
        this.slot = slot;
    }
    isInWall(): boolean {
        return false;
    }
    isAlive(): boolean {
        return true;
    }
    speedAttribute(): number {
        return 0.1;
    }
    armorEnchantmentLevel(): number {
        return 0;
    }

    applyMovement(forward: number, strafe: number, jump: boolean, sneak: boolean, sprint: boolean): void {
        this.input = { f: forward, s: strafe, jump };
        this.sneaking = sneak;
        this.sprinting = sprint;
    }
    setRotation(rotation: Rotation): void {
        this.rot = rotation;
    }
    startBreaking(pos: BetterBlockPos): void {
        if (!this.breaking || !this.breaking.equals(pos)) {
            this.breaking = pos;
            this.breakTicks = 0;
        }
    }
    stopBreaking(): void {
        this.breaking = null;
    }
    useItemOnBlock(slot: number, pos: BetterBlockPos, face: Direction): boolean {
        const it = this.items[slot];
        if (!it || it.amount <= 0) return false;
        const target = pos.relative(face);
        if (this.w.getState(target.x, target.y, target.z) !== AIR) return false;
        this.w.set(target.x, target.y, target.z, BlockState.of(it.typeId));
        this.items[slot] = it.amount > 1 ? { ...it, amount: it.amount - 1 } : EMPTY_ITEM;
        return true;
    }
    interactWithBlock(): boolean {
        return false;
    }
    useItem(): boolean {
        return false;
    }
    swapSlots(a: number, b: number): void {
        const t = this.items[a];
        this.items[a] = this.items[b];
        this.items[b] = t;
    }
}
