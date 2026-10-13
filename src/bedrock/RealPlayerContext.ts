import { BlockPermutation, EntityComponentTypes, GameMode, InputPermissionCategory, ItemStack, Player } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { settings } from "../Settings";
import { BetterBlockPos, Direction, Vec3 } from "../utils/BetterBlockPos";
import { Rotation, RotationUtils, DEG_TO_RAD } from "../utils/Rotation";
import { Blocks } from "../world/Blocks";
import { ToolSet } from "../world/ToolSet";
import { BLOCKS } from "../world/blockdata.generated";
import { canBeReplaced } from "../movement/MovementHelper";
import { BedrockPlayerContext } from "./BedrockPlayerContext";

const SPRINT_FACTOR = 1.3;
const SNEAK_FACTOR = 0.3;
const JUMP_VELOCITY = 0.42;
const LIQUID_JUMP = 0.04;
const KNOCKBACK_HORIZONTAL = 0.4;
const GROUND_FRICTION = 0.546;
const AIR_FRICTION = 0.91;
const GROUND_ACCEL = 0.1;
const AIR_ACCEL = 0.02;

const PLANTS: Record<string, string> = {
    "minecraft:wheat_seeds": "minecraft:wheat",
    "minecraft:carrot": "minecraft:carrots",
    "minecraft:potato": "minecraft:potatoes",
    "minecraft:beetroot_seeds": "minecraft:beetroot",
    "minecraft:melon_seeds": "minecraft:melon_stem",
    "minecraft:pumpkin_seeds": "minecraft:pumpkin_stem",
    "minecraft:nether_wart": "minecraft:nether_wart",
};

const TOGGLEABLE = /(_door|fence_gate|trapdoor)$/;

export class RealPlayerContext extends BedrockPlayerContext {
    private virtualRot: Rotation;
    private breaking: BetterBlockPos | null = null;
    private breakProgress = 0;
    private movementLocked = false;
    private sneaking = false;
    private sprinting = false;

    constructor(readonly player_: Player) {
        super(player_ as unknown as SimulatedPlayer, player_);
        const r = player_.getRotation();
        this.virtualRot = new Rotation(r.y, r.x);
    }

    override playerRotations(): Rotation {
        return this.virtualRot;
    }

    override viewerYaw(): number {
        return this.player_.getRotation().y;
    }

    override setRotation(rotation: Rotation): void {
        this.virtualRot = rotation;
        if (!settings.freeLook.value) {
            try {
                this.player_.setRotation({ x: rotation.pitch, y: rotation.yaw });
            } catch {
            }
        }
    }

    override isCrouching(): boolean {
        return this.sneaking;
    }

    override isSprinting(): boolean {
        return this.sprinting;
    }

    override setSprinting(sprinting: boolean): void {
        this.sprinting = sprinting;
    }

    setDriving(driving: boolean): void {
        if (driving === this.movementLocked) return;
        this.movementLocked = driving;
        try {
            this.player_.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, !driving);
        } catch {
        }
        if (!driving) {
            const r = this.player_.getRotation();
            this.virtualRot = new Rotation(r.y, r.x);
        }
    }

    private knockbackStep(v: Vec3, wx: number, wz: number, jump: boolean, sneak: boolean, inLiquid: boolean): void {
        const p = this.player_;
        const onGround = p.isOnGround;
        const friction = inLiquid ? 0.8 : onGround ? GROUND_FRICTION : AIR_FRICTION;
        let accel = inLiquid ? 0.02 : onGround ? GROUND_ACCEL : AIR_ACCEL;
        if (this.sprinting) accel *= SPRINT_FACTOR;
        if (sneak && !inLiquid) accel *= SNEAK_FACTOR;
        let dx = v.x * friction + wx * accel;
        let dz = v.z * friction + wz * accel;
        let dy: number;
        if (jump && inLiquid) {
            dy = v.y * 0.8 - 0.02 + LIQUID_JUMP;
        } else if (jump && onGround && v.y <= 0.01) {
            dy = JUMP_VELOCITY;
            if (this.sprinting) {
                const yaw = this.virtualRot.yaw * DEG_TO_RAD;
                dx += -Math.sin(yaw) * 0.2;
                dz += Math.cos(yaw) * 0.2;
            }
        } else if (onGround) {
            dy = v.y;
        } else {
            dy = inLiquid ? v.y * 0.8 - 0.02 : (v.y - 0.08) * 0.98;
        }
        try {
            const keep = friction * 0.5;
            p.applyKnockback({ x: (dx - v.x * keep) / KNOCKBACK_HORIZONTAL, z: (dz - v.z * keep) / KNOCKBACK_HORIZONTAL }, dy);
        } catch {
        }
    }

    override applyMovement(forward: number, strafe: number, jump: boolean, sneak: boolean, sprint: boolean): void {
        const p = this.player_;
        try {
            this.tickBreaking();
            this.sneaking = sneak;
            this.sprinting = sprint && forward > 0 && !sneak;
            try {
                if (p.isSneaking !== sneak) p.isSneaking = sneak;
            } catch {
            }
            if (sneak && !jump) {
                this.safeWalk();
            } else {
                this.lastSafe = null;
            }
            let wx = 0;
            let wz = 0;
            if (forward !== 0 || strafe !== 0) {
                const yaw = this.virtualRot.yaw * DEG_TO_RAD;
                wx = -Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
                wz = Math.cos(yaw) * forward + Math.sin(yaw) * strafe;
                const len = Math.sqrt(wx * wx + wz * wz);
                if (len > 1) {
                    wx /= len;
                    wz /= len;
                }
                if (sneak && !jump && p.isOnGround) {
                    const l = p.location;
                    if (!this.supported(l.x + Math.sign(wx) * 0.15, l.y, l.z)) wx = 0;
                    if (!this.supported(l.x, l.y, l.z + Math.sign(wz) * 0.15)) wz = 0;
                }
            }
            this.lastMoveInput = wx !== 0 || wz !== 0;
            const inLiquid = p.isInWater || this.isInLava();
            const v = p.getVelocity();
            if (this.lastMoveInput || jump) this.knockbackStep(v, wx, wz, jump, sneak, inLiquid);
        } catch {
        }
    }

    override startBreaking(pos: BetterBlockPos, _face: Direction): void {
        if (!this.breaking || !this.breaking.equals(pos)) {
            this.breaking = pos;
            this.breakProgress = 0;
        }
    }

    override stopBreaking(): void {
        this.breaking = null;
        this.breakProgress = 0;
    }

    private creative(): boolean {
        try {
            return this.player_.getGameMode() === GameMode.Creative;
        } catch {
            return false;
        }
    }

    private tickBreaking(): void {
        const pos = this.breaking;
        if (!pos) return;
        const state = this.world().getState(pos.x, pos.y, pos.z);
        if (Blocks.isAir(state) || state.hasFluid()) {
            this.breaking = null;
            return;
        }
        const held = this.inventory().items[this.selectedSlot()];
        let speed = this.creative() ? 1 : ToolSet.calculateSpeedVsBlock(held, state);
        const haste = this.effectAmplifier("haste");
        if (haste !== undefined) speed *= 1 + (haste + 1) * 0.2;
        if (!this.player_.isOnGround) speed /= 5;
        if (speed <= 0) return;
        this.breakProgress += speed;
        if (this.breakProgress < 1) return;
        try {
            this.player_.dimension.runCommand(`setblock ${pos.x} ${pos.y} ${pos.z} air destroy`);
        } catch {
            return;
        }
        if (!this.creative()) this.damageHeldItem();
        this.breaking = null;
        this.breakProgress = 0;
        this.invCache = null;
    }

    private damageHeldItem(): void {
        const container = this.player_.getComponent(EntityComponentTypes.Inventory)?.container;
        const slot = this.selectedSlot();
        const stack = container?.getItem(slot);
        if (!container || !stack) return;
        const d = stack.getComponent("minecraft:durability");
        if (!d) return;
        const unbreaking = stack.getComponent("minecraft:enchantable")?.getEnchantment("unbreaking")?.level ?? 0;
        if (unbreaking > 0 && Math.random() >= 1 / (unbreaking + 1)) return;
        if (d.damage + 1 >= d.maxDurability) {
            container.setItem(slot, undefined);
        } else {
            d.damage += 1;
            container.setItem(slot, stack);
        }
    }

    private consume(slot: number, replaceWith?: string): void {
        if (this.creative()) return;
        const container = this.player_.getComponent(EntityComponentTypes.Inventory)?.container;
        const stack = container?.getItem(slot);
        if (!container || !stack) return;
        if (replaceWith) {
            container.setItem(slot, new ItemStack(replaceWith, 1));
        } else if (stack.amount > 1) {
            stack.amount -= 1;
            container.setItem(slot, stack);
        } else {
            container.setItem(slot, undefined);
        }
        this.invCache = null;
    }

    private overlapsPlayer(pos: BetterBlockPos): boolean {
        const l = this.player_.location;
        return l.x + 0.3 > pos.x && l.x - 0.3 < pos.x + 1 && l.z + 0.3 > pos.z && l.z - 0.3 < pos.z + 1 && l.y < pos.y + 1 && l.y + 1.8 > pos.y;
    }

    override useItemOnBlock(slot: number, pos: BetterBlockPos, face: Direction, _faceLocation: Vec3): boolean {
        const held = this.inventory().items[slot];
        if (!held || held.amount <= 0) return false;
        const dim = this.player_.dimension;
        const clicked = this.world().getState(pos.x, pos.y, pos.z);
        const target = canBeReplaced(clicked) && !clicked.hasFluid() ? pos : pos.relative(face);
        const targetState = this.world().getState(target.x, target.y, target.z);
        try {
            if (held.typeId === "minecraft:water_bucket") {
                if (!canBeReplaced(targetState)) return false;
                dim.setBlockType(target, "minecraft:water");
                this.consume(slot, "minecraft:bucket");
                return true;
            }
            if (held.typeId === "minecraft:bone_meal") {
                const growth = clicked.get("growth");
                if (typeof growth !== "number" || growth >= 7) return false;
                const block = dim.getBlock(pos);
                block?.setPermutation(block.permutation.withState("growth" as never, Math.min(7, growth + 2 + Math.floor(Math.random() * 3)) as never));
                this.consume(slot);
                return true;
            }
            const crop = PLANTS[held.typeId];
            if (crop) {
                const soil = held.typeId === "minecraft:nether_wart" ? "soul_sand" : "farmland";
                if (face.name !== "up" || clicked.name !== soil || !Blocks.isAir(targetState)) return false;
                dim.setBlockType(target, crop);
                this.consume(slot);
                return true;
            }
            const name = held.typeId.replace("minecraft:", "");
            if (BLOCKS[name] === undefined) return false;
            if (/(_door|_bed|^bed)$/.test(name)) return false;
            if (!canBeReplaced(targetState) || this.overlapsPlayer(target)) return false;
            dim.setBlockPermutation(target, BlockPermutation.resolve(held.typeId));
            this.consume(slot);
            return true;
        } catch {
            return false;
        }
    }

    override interactWithBlock(pos: BetterBlockPos, _face: Direction): boolean {
        const state = this.world().getState(pos.x, pos.y, pos.z);
        if (!TOGGLEABLE.test(state.name) || state.name === "iron_door" || state.name === "iron_trapdoor") return false;
        try {
            const dim = this.player_.dimension;
            const open = state.get("open_bit") !== true;
            const toggle = (p: Vec3) => {
                const b = dim.getBlock(p);
                if (b && TOGGLEABLE.test(b.typeId)) b.setPermutation(b.permutation.withState("open_bit" as never, open as never));
            };
            toggle(pos);
            if (Blocks.isDoor(state)) {
                toggle(state.get("upper_block_bit") === true ? pos.below() : pos.above());
            }
            return true;
        } catch {
            return false;
        }
    }

    override useItem(slot: number): boolean {
        const held = this.inventory().items[slot];
        if (!held || held.typeId !== "minecraft:bucket") return false;
        const l = this.player_.location;
        const start = { x: l.x, y: l.y + this.eyeHeight(), z: l.z };
        const dir = RotationUtils.calcLookDirectionFromRotation(this.virtualRot);
        try {
            const hit = this.player_.dimension.getBlockFromRay(start, dir, { maxDistance: this.blockReachDistance(), includeLiquidBlocks: true, includePassableBlocks: true });
            if (!hit || hit.block.typeId !== "minecraft:water") return false;
            if (Number(hit.block.permutation.getState("liquid_depth" as never) ?? 0) !== 0) return false;
            hit.block.setType("minecraft:air");
            this.consume(slot, "minecraft:water_bucket");
            return true;
        } catch {
            return false;
        }
    }
}
