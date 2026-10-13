import { Beditone } from "../../src/Beditone";
import { settings, readAndApply, serializeModified } from "../../src/Settings";
import { CommandManager } from "../../src/commands/CommandManager";
import { PathingCommandType } from "../../src/process/PathingCommand";
import { BetterBlockPos, Vec3 } from "../../src/utils/BetterBlockPos";
import { RotationUtils } from "../../src/utils/Rotation";
import { AIR } from "../../src/world/BlockState";
import { PATH_PARTICLE, ParticleSink, PathRenderer } from "../../src/render/PathRenderer";
import type { Storage } from "../../src/cache/WorldData";
import fs from "node:fs";
import { BlockPalette } from "./world/BlockPalette";
import { ChunkStore } from "./world/ChunkStore";
import { Items, NetItem } from "./player/Items";
import { EYE_HEIGHT, Keys, ProxyPlayer } from "./player/ProxyPlayer";
import { Physics } from "./player/Physics";

const MOVEMENT_FLAGS = new Set(
    "up down left right up_left up_right down_left down_right jumping jump_down start_jumping auto_jumping_in_water jump_pressed_raw jump_released_raw jump_current_raw sneaking sneak_down start_sneaking stop_sneaking sneak_toggle_down persist_sneak sneak_pressed_raw sneak_released_raw sneak_current_raw sprinting sprint_down start_sprinting stop_sprinting".split(
        " ",
    ),
);

const DIMENSIONS: Record<string, string> = {
    overworld: "minecraft:overworld",
    nether: "minecraft:nether",
    end: "minecraft:the_end",
    "0": "minecraft:overworld",
    "1": "minecraft:nether",
    "2": "minecraft:the_end",
};

const DIMENSION_NUMBER: Record<string, number> = { "minecraft:overworld": 0, "minecraft:nether": 1, "minecraft:the_end": 2 };

const EFFECTS: Record<number, string> = {
    1: "speed",
    2: "slowness",
    3: "haste",
    4: "mining_fatigue",
    5: "strength",
    8: "jump_boost",
    13: "water_breathing",
    16: "night_vision",
    26: "conduit_power",
    27: "slow_falling",
};

const SUBCHUNK_REQUEST_MODE = 0xfffffffe;

export interface SessionIO {
    toClient(name: string, params: object): void;
    toServer(name: string, params: object): void;
    log(message: string): void;
}

class JobRunner {
    private readonly jobs: Generator<void, void, void>[] = [];
    private scheduled = false;

    add(job: Generator<void, void, void>): void {
        this.jobs.push(job);
        this.schedule();
    }

    private schedule(): void {
        if (this.scheduled || this.jobs.length === 0) return;
        this.scheduled = true;
        setImmediate(() => this.run());
    }

    private run(): void {
        this.scheduled = false;
        const end = performance.now() + 8;
        while (this.jobs.length && performance.now() < end) {
            const job = this.jobs[0];
            let done = false;
            try {
                for (let i = 0; i < 64; i++) {
                    if (job.next().done) {
                        done = true;
                        break;
                    }
                }
            } catch (e) {
                console.error("[Beditone] job failed:", e);
                done = true;
            }
            this.jobs.shift();
            if (!done) this.jobs.push(job);
        }
        this.schedule();
    }
}

export class Session {
    private palette: BlockPalette | null = null;
    readonly items: Items;
    private stores = new Map<string, ChunkStore>();
    player: ProxyPlayer | null = null;
    baritone: Beditone | null = null;
    private renderer: PathRenderer | null = null;
    private readonly jobs = new JobRunner();
    private readonly uniqueToRuntime = new Map<string, bigint>();
    private driving = false;
    corrections = 0;
    private ticks = 0;
    private wasAlive = true;
    private knownCommands = new Set<string>();

    constructor(
        readonly username: string,
        private readonly version: string,
        private readonly io: SessionIO,
        private readonly storage: Storage,
    ) {
        this.items = new Items(version);
    }

    private store(dimension: string): ChunkStore {
        let s = this.stores.get(dimension);
        if (!s) {
            s = new ChunkStore(dimension, this.palette!);
            this.stores.set(dimension, s);
        }
        return s;
    }

    send(message: string): void {
        this.io.toClient("text", { needs_translation: false, category: "message_only", type: "raw", message, xuid: "", platform_chat_id: "", has_filtered_message: false });
    }

    private start(params: { runtime_entity_id: bigint; player_position: Vec3; dimension: string; player_gamemode: string; block_network_ids_are_hashes: boolean; itemstates?: { name: string; runtime_id: number }[] }): void {
        this.palette = new BlockPalette(this.version, !!params.block_network_ids_are_hashes);
        this.stores.clear();
        if (params.itemstates?.length) this.items.loadRegistry(params.itemstates);
        const world = this.store(DIMENSIONS[String(params.dimension)] ?? "minecraft:overworld");
        const p = new ProxyPlayer(world, this.palette, this.items);
        p.runtimeId = BigInt(params.runtime_entity_id);
        p.pos = { x: params.player_position.x, y: params.player_position.y - EYE_HEIGHT, z: params.player_position.z };
        p.gameMode = String(params.player_gamemode);
        this.player = p;
        const storage = this.storage;
        const baritone = new Beditone({
            ctx: p,
            runJob: (job) => this.jobs.add(job),
            scanner: { scanVolume: (...a) => p.world().scanVolume(...a) },
            storage,
            ownerKey: this.username,
            send: (m) => this.send(m),
            notify: (m, error) => this.io.toClient("text", { needs_translation: false, category: "message_only", type: "tip", message: (error ? "§c" : "§a") + m, xuid: "", platform_chat_id: "", has_filtered_message: false }),
            loadStructure: () => null,
            saveSettings: () => storage.save("settings", serializeModified(settings)),
            loadSettings: () => {
                const text = storage.load("settings");
                if (text) readAndApply(settings, text);
            },
            viewerLookingAt: () => {
                const r = p.raycast(p.playerHead(), RotationUtils.calcLookDirectionFromRotation({ yaw: p.cameraYaw, pitch: p.cameraPitch } as never), 256, false);
                return r ? r.pos : null;
            },
            botCommand: () => this.send("§cThere's no bot in the proxy: Baritone drives you directly."),
        });
        p.setAim((r) => baritone.getLookBehavior().getAimProcessor().peekRotation(r));
        this.baritone = baritone;
        for (const c of baritone.getCommandManager().getAll()) for (const n of c.names) this.knownCommands.add(n);
        const io = this.io;
        const sink: ParticleSink = {
            isValid: true,
            get location() {
                return p.pos;
            },
            spawn(x, y, z, color) {
                const v = (n: string, val: number) => ({ name: n, value: { type: "float", value: val } });
                const molang = [{ name: "variable.color", value: { type: "member_array", value: [v(".r", color.r / 255), v(".g", color.g / 255), v(".b", color.b / 255)] } }];
                const dimension = DIMENSION_NUMBER[p.world().dimensionId] ?? 0;
                io.toClient("spawn_particle_effect", { dimension, entity_id: -1n, position: { x, y, z }, particle_name: PATH_PARTICLE, molang_variables: JSON.stringify(molang).replace(/"value":(-?\d+)\}/g, '"value":$1.0}') + "\n" });
            },
        };
        this.renderer = new PathRenderer(sink, baritone);
        this.io.log(`${this.username} joined; Baritone is ready (type ${settings.prefix.value}help in chat)`);
    }

    private isBaritoneMessage(msg: string): boolean {
        if (msg.startsWith(settings.prefix.value) && settings.prefixControl.value) return true;
        if (!(settings.chatControl.value || settings.chatControlAnyway.value)) return false;
        const [label, args] = CommandManager.expand(msg);
        if (label.trim() === "") return false;
        const lower = label.toLowerCase();
        if (args.length <= 1 && settings.byLowerName.has(lower)) return true;
        return this.knownCommands.has(lower);
    }

    onClientbound(name: string, params: any): boolean | void {
        if (name === "start_game") {
            this.start(params);
            return;
        }
        const p = this.player;
        if (!p) return;
        const world = p.world();
        switch (name) {
            case "item_registry":
                this.items.loadRegistry(params.itemstates);
                break;
            case "level_chunk": {
                const count = Number(params.sub_chunk_count);
                if (params.highest_subchunk_count !== undefined || count >= SUBCHUNK_REQUEST_MODE || params.cache_enabled) break;
                try {
                    world.decodeColumn(params.x, params.z, count, params.payload);
                } catch (e) {
                    this.io.log(`couldn't decode chunk ${params.x},${params.z}: ${(e as Error).message}`);
                }
                break;
            }
            case "subchunk": {
                const target = this.store(DIMENSIONS[String(params.dimension)] ?? world.dimensionId);
                const o = params.origin;
                for (const e of params.entries) {
                    const cx = o.x + e.dx;
                    const cy = o.y + e.dy;
                    const cz = o.z + e.dz;
                    if (e.result === "success_all_air") {
                        target.markAllAir(cx, cy, cz);
                    } else if (e.result === "success" && e.payload) {
                        try {
                            target.decodeSubChunk(cx, cy, cz, e.payload);
                        } catch (err) {
                            this.io.log(`couldn't decode subchunk ${cx},${cy},${cz}: ${(err as Error).message}`);
                        }
                    }
                }
                break;
            }
            case "update_block":
                world.setRuntime(params.position.x, params.position.y, params.position.z, params.block_runtime_id, params.layer);
                if (process.env.BEDITONE_TRACE) this.io.log(`update_block ${JSON.stringify(params.position)} -> ${this.palette?.state(params.block_runtime_id).typeId} layer ${params.layer}`);
                break;
            case "update_subchunk_blocks":
                for (const b of params.blocks) world.setRuntime(b.position.x, b.position.y, b.position.z, b.runtime_id, 0);
                for (const b of params.extra) world.setRuntime(b.position.x, b.position.y, b.position.z, b.runtime_id, 1);
                break;
            case "change_dimension": {
                const dim = DIMENSIONS[String(params.dimension)] ?? "minecraft:overworld";
                this.stores.delete(dim);
                p.worldStore = this.store(dim);
                p.pos = { x: params.position.x, y: params.position.y - EYE_HEIGHT, z: params.position.z };
                p.entities_.clear();
                this.baritone?.getPathingBehavior().cancelEverything();
                break;
            }
            case "move_player":
                if (BigInt(params.runtime_id) === p.runtimeId) {
                    p.pos = { x: params.position.x, y: params.position.y - EYE_HEIGHT, z: params.position.z };
                    if (p.simulating) p.move = { pos: { ...p.pos }, vel: { x: 0, y: 0, z: 0 }, onGround: params.on_ground, horizontalCollision: false, jumpDelay: 0 };
                } else {
                    this.moveEntity(BigInt(params.runtime_id), params.position, true, params.on_ground);
                }
                break;
            case "correct_player_move_prediction":
                if (p.simulating) {
                    const at = { x: params.position.x, y: params.position.y - EYE_HEIGHT, z: params.position.z };
                    this.rewind(BigInt(params.tick ?? 0), at, { x: params.delta.x, y: params.delta.y, z: params.delta.z }, params.on_ground);
                    this.corrections++;
                    return true;
                } else {
                    p.pos = { x: params.position.x, y: params.position.y - EYE_HEIGHT, z: params.position.z };
                }
                this.corrections++;
                break;
            case "set_health":
                p.health = params.health;
                break;
            case "respawn":
                if (params.state === 1 || params.state === 2) p.health = 20;
                break;
            case "set_player_game_type":
                p.gameMode = String(params.gamemode);
                break;
            case "update_attributes":
                if (BigInt(params.runtime_entity_id) !== p.runtimeId) break;
                for (const a of params.attributes) {
                    if (a.name === "minecraft:health") p.health = a.current;
                    else if (a.name === "minecraft:player.hunger") p.hunger = a.current;
                    else if (a.name === "minecraft:movement") {
                        let speed = a.current;
                        for (const m of a.modifiers ?? []) {
                            if (/sprint/i.test(m.name) && m.operation === 2) speed /= 1 + m.amount;
                        }
                        p.movementSpeed = speed;
                    }                }
                break;
            case "mob_effect": {
                if (BigInt(params.runtime_entity_id) !== p.runtimeId) break;
                const effect = EFFECTS[params.effect_id];
                if (!effect) break;
                if (params.event_id === "remove") p.effects.delete(effect);
                else p.effects.set(effect, params.amplifier);
                break;
            }
            case "inventory_content":
                if (params.window_id === "inventory") {
                    params.input.slice(0, 36).forEach((item: NetItem, i: number) => (p.inv[i] = item));
                } else if (params.window_id === "armor") {
                    params.input.slice(0, 4).forEach((item: NetItem, i: number) => (p.armor[i] = item));
                } else if (params.window_id === "offhand") {
                    p.offhandItem = params.input[0] ?? null;
                }
                p.invalidateInventory();
                break;
            case "inventory_slot":
                if (params.window_id === "inventory" && params.slot < 36) p.inv[params.slot] = params.item;
                else if (params.window_id === "armor" && params.slot < 4) p.armor[params.slot] = params.item;
                else if (params.window_id === "offhand") p.offhandItem = params.item;
                p.invalidateInventory();
                break;
            case "player_hotbar":
                if (params.select_slot) p.slot = params.selected_slot;
                break;
            case "add_player":
                this.addEntity(BigInt(params.runtime_id), String(params.unique_id), "minecraft:player", params.username, { x: params.position.x, y: params.position.y - EYE_HEIGHT, z: params.position.z });
                break;
            case "add_entity":
                this.addEntity(BigInt(params.runtime_id), String(params.unique_id), params.entity_type, "", params.position);
                break;
            case "add_item_entity": {
                const e = this.addEntity(BigInt(params.runtime_entity_id), String(params.entity_id_self), "minecraft:item", "", params.position);
                e.itemTypeId = this.items.name(params.item.network_id);
                break;
            }
            case "move_entity":
                this.moveEntity(BigInt(params.runtime_entity_id), params.position, false, (params.flags & 1) !== 0);
                break;
            case "move_entity_delta": {
                const e = p.entities_.get(BigInt(params.runtime_entity_id));
                if (!e) break;
                e.position = { x: params.x ?? e.position.x, y: params.y ?? e.position.y, z: params.z ?? e.position.z };
                if (e.isPlayer && params.y !== undefined) e.position.y -= EYE_HEIGHT;
                e.onGround = params.on_ground;
                break;
            }
            case "remove_entity": {
                const rid = this.uniqueToRuntime.get(String(params.entity_id_self));
                if (rid !== undefined) p.entities_.delete(rid);
                break;
            }
            case "take_item_entity":
                p.entities_.delete(BigInt(params.runtime_entity_id));
                break;
        }
    }

    private addEntity(runtimeId: bigint, uniqueId: string, typeId: string, name: string, position: Vec3) {
        const e = { runtimeId, typeId, name, position: { ...position }, isPlayer: typeId === "minecraft:player", onGround: true } as import("./player/ProxyPlayer").TrackedEntity;
        this.player!.entities_.set(runtimeId, e);
        this.uniqueToRuntime.set(uniqueId, runtimeId);
        return e;
    }

    private moveEntity(runtimeId: bigint, position: Vec3, eyeLevel: boolean, onGround: boolean): void {
        const e = this.player!.entities_.get(runtimeId);
        if (!e) return;
        e.position = { x: position.x, y: position.y - (eyeLevel ? EYE_HEIGHT : 0), z: position.z };
        e.onGround = onGround;
    }

    onServerbound(name: string, params: any): boolean {
        const p = this.player;
        const b = this.baritone;
        if (!p || !b) return false;
        switch (name) {
            case "text":
                if (params.type === "chat" && this.isBaritoneMessage(params.message)) {
                    try {
                        b.onChat(params.message);
                    } catch (e) {
                        this.send("§c" + (e as Error).message);
                    }
                    return true;
                }
                return false;
            case "mob_equipment":
                if (BigInt(params.runtime_entity_id) === p.runtimeId && params.window_id === "inventory") p.slot = params.selected_slot;
                return false;
            case "player_auth_input":
                this.tick(params);
                return false;
        }
        return false;
    }

    private tick(input: any): void {
        const p = this.player!;
        const b = this.baritone!;
        this.ticks++;
        p.beginTick();
        const gamePos = { x: input.position.x, y: input.position.y - EYE_HEIGHT, z: input.position.z };
        if (!p.simulating) {
            p.pos = gamePos;
            p.delta = { x: input.delta.x, y: input.delta.y, z: input.delta.z };
        }
        p.cameraYaw = input.yaw;
        p.cameraPitch = input.pitch;
        const alive = p.isAlive();
        if (!alive) {
            if (this.wasAlive) b.onDeath();
            this.wasAlive = false;
            this.setDriving(false);
            return;
        }
        this.wasAlive = true;
        try {
            b.tick();
        } catch (e) {
            this.io.log("tick failed: " + ((e as Error)?.stack ?? e));
        }
        const pcm = b.getPathingControlManager();
        const cmd = pcm.mostRecentCommand();
        const active = pcm.mostRecentInControl() !== null && cmd !== null && cmd.commandType !== PathingCommandType.REQUEST_PAUSE;
        this.setDriving(b.getPathingBehavior().isPathing() || active);
        const out = p.out;
        if (!this.driving) {
            p.syncRotationToCamera();
        } else {
            const r = p.rotation;
            input.yaw = r.yaw;
            input.pitch = r.pitch;
            input.head_yaw = r.yaw;
            const look = RotationUtils.calcLookDirectionFromRotation(r);
            input.camera_orientation = { x: look.x, y: look.y, z: look.z };
            input.interact_rotation = { x: r.pitch, z: r.yaw };
            this.pressKeys(input, out.keys);
            this.predict(input, out.keys, gamePos);
            if (out.blockActions.length || out.transactions.length || p.isBreaking) this.interactTicks = 10;
            else if (this.interactTicks > 0) this.interactTicks--;
            if (this.cameraForced()) this.turnCamera(input);
            else this.cameraSent = null;
            this.updateLocks();
        }
        if (out.blockActions.length) {
            const flags: string[] = Array.isArray(input.input_data) ? input.input_data : [];
            if (!flags.includes("block_action")) flags.push("block_action");
            input.input_data = flags;
            input.block_action = [...(input.block_action ?? []), ...out.blockActions.map((a) => ({ action: a.action, position: { x: a.position.x, y: a.position.y, z: a.position.z }, face: a.face }))];
        }
        if (out.selectSlot !== null) {
            this.io.toClient("player_hotbar", { selected_slot: out.selectSlot, window_id: "inventory", select_slot: true });
            this.io.toServer("mob_equipment", {
                runtime_entity_id: p.runtimeId,
                item: p.inv[out.selectSlot] ?? this.items.empty(),
                slot: out.selectSlot,
                selected_slot: out.selectSlot,
                window_id: "inventory",
            });
        }
        for (const t of out.transactions) this.io.toServer("inventory_transaction", t);
        if (process.env.BEDITONE_TRACE && this.driving) {
            const cur = b.getPathingBehavior().getCurrent();
            const m = cur ? String(cur.getPath().movements()[cur.getPosition()] ?? "none") : "none";
            const placed = out.transactions.map((t: any) => JSON.stringify(t.transaction.transaction_data.block_position) + "f" + t.transaction.transaction_data.face).join(" ");
            const pp = p.pos;
            this.io.log(
                `T ${input.tick} game=${gamePos.x.toFixed(2)},${gamePos.y.toFixed(2)},${gamePos.z.toFixed(2)} sim=${pp.x.toFixed(2)},${pp.y.toFixed(2)},${pp.z.toFixed(2)} g=${p.move.onGround} ` +
                    `keys=${JSON.stringify(out.keys).replace(/"|false|true/g, (x) => (x === '"' ? "" : x === "true" ? "1" : "0"))} rot=${p.rotation.yaw.toFixed(0)}/${p.rotation.pitch.toFixed(0)} ${m.replace(/Movement/, "")} ${placed ? "place " + placed : ""} ${out.blockActions.map((a) => a.action).join(",")}`,
            );
        }
        if (this.ticks % Math.max(1, settings.renderIntervalTicks.value) === 0) {
            try {
                this.renderer?.render();
            } catch (e) {
                this.io.log("render failed: " + e);
            }
        }
    }

    private readonly physics = new Physics(() => this.player!.world());

    private predict(input: any, keys: Keys, gamePos: Vec3): void {
        const p = this.player!;
        if (!p.simulating) {
            p.simulating = true;
            p.move = { pos: { ...gamePos }, vel: { x: input.delta.x, y: input.delta.y, z: input.delta.z }, onGround: p.onGround(), horizontalCollision: false, jumpDelay: 0 };
        }
        const before = p.move.pos;
        const next = this.physics.step(p.move, keys, p.rotation.yaw, p.movementSpeed);
        p.move = next;
        const tick = BigInt(input.tick ?? 0);
        this.history.push({ tick, keys, yaw: p.rotation.yaw, after: next });
        if (this.history.length > 100) this.history.shift();
        p.pos = next.pos;
        p.delta = { x: next.pos.x - before.x, y: next.pos.y - before.y, z: next.pos.z - before.z };
        input.position = { x: next.pos.x, y: next.pos.y + EYE_HEIGHT, z: next.pos.z };
        input.delta = p.delta;
        const off = Math.hypot(gamePos.x - before.x, gamePos.y - before.y, gamePos.z - before.z);
        if (off > 3) {
            this.io.toClient("move_player", { runtime_id: Number(p.runtimeId), position: input.position, pitch: p.cameraPitch, yaw: p.cameraYaw, head_yaw: p.cameraYaw, mode: "teleport", on_ground: next.onGround, ridden_runtime_id: 0, teleport: { cause: "unknown", source_entity_type: 0 }, tick: BigInt(input.tick ?? 0) });
        } else if (settings.proxyPredictMotion.value) {
            const k = settings.proxyCatchUp.value;
            const v = {
                x: p.delta.x + (before.x - gamePos.x) * k,
                y: p.delta.y + (before.y - gamePos.y) * k,
                z: p.delta.z + (before.z - gamePos.z) * k,
            };
            const t = BigInt(input.tick ?? 0);
            const mode = settings.proxyMotionTick.value;
            this.io.toClient("set_entity_motion", { runtime_entity_id: p.runtimeId, velocity: v, tick: mode === "zero" ? 0n : mode === "current" ? t : t + 1n });
            this.recordMotion(t, gamePos, before, p.delta, v);
        }
    }

    private motionLog: string[] = [];
    private lastGamePos: Vec3 | null = null;
    private lastLogAt = 0;

    private recordMotion(tick: bigint, gamePos: Vec3, simPos: Vec3, simStep: Vec3, sent: Vec3): void {
        const now = Date.now();
        const g = this.lastGamePos;
        const step = g ? Math.hypot(gamePos.x - g.x, gamePos.z - g.z) : 0;
        this.lastGamePos = { ...gamePos };
        const f = (n: number) => n.toFixed(3);
        this.motionLog.push(
            `${tick} +${now - this.lastLogAt}ms gameStep=${f(step)} simStep=${f(Math.hypot(simStep.x, simStep.z))} gap=${f(Math.hypot(simPos.x - gamePos.x, simPos.z - gamePos.z))} sent=${f(Math.hypot(sent.x, sent.z))} y=${f(gamePos.y)}/${f(simPos.y)}`,
        );
        this.lastLogAt = now;
        if (this.motionLog.length > 600) this.motionLog.shift();
    }

    private saveMotionLog(): void {
        if (!this.motionLog.length) return;
        try {
            fs.mkdirSync("beditone-data", { recursive: true });
            const head = `motion while Baritone drove you (newest last). settings: proxyMotionTick=${settings.proxyMotionTick.value} proxyCatchUp=${settings.proxyCatchUp.value} proxyPredictMotion=${settings.proxyPredictMotion.value}\n`;
            fs.writeFileSync("beditone-data/motion-log.txt", head + this.motionLog.join("\n") + "\n");
        } catch {
        }
        this.lastGamePos = null;
    }

    private history: { tick: bigint; keys: Keys; yaw: number; after: import("./player/Physics").MoveState }[] = [];

    private rewind(tick: bigint, pos: Vec3, vel: Vec3, onGround: boolean): void {
        const p = this.player!;
        const i = this.history.findIndex((h) => h.tick === tick);
        if (i < 0 && process.env.BEDITONE_DEBUG) this.io.log(`correction for tick ${tick} not in history (${this.history[0]?.tick}..${this.history[this.history.length - 1]?.tick}, ${this.history.length} entries)`);
        if (i >= 0 && process.env.BEDITONE_DEBUG) {
            const h = this.history[i];
            const e = { x: pos.x - h.after.pos.x, y: pos.y - h.after.pos.y, z: pos.z - h.after.pos.z };
            this.io.log(`correction at tick ${tick}: server-predicted = ${e.x.toFixed(3)} ${e.y.toFixed(3)} ${e.z.toFixed(3)} keys=${JSON.stringify(h.keys)} yaw=${h.yaw.toFixed(0)} ground=${h.after.onGround}/${onGround}`);
        }
        let state = { pos: { ...pos }, vel: { ...vel }, onGround, horizontalCollision: false, jumpDelay: i >= 0 ? this.history[i].after.jumpDelay : 0 };
        if (i >= 0) {
            this.history[i].after = state;
            for (let j = i + 1; j < this.history.length; j++) {
                state = this.physics.step(state, this.history[j].keys, this.history[j].yaw, p.movementSpeed);
                this.history[j].after = state;
            }
        }
        p.move = state;
        p.pos = state.pos;
    }

    private lastKeys: Keys = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

    private pressKeys(input: any, keys: Keys): void {
        const prev = this.lastKeys;
        const flags = new Set<string>((Array.isArray(input.input_data) ? input.input_data : []).filter((f: string) => !MOVEMENT_FLAGS.has(f)));
        if (keys.forward > 0) flags.add("up");
        if (keys.forward < 0) flags.add("down");
        if (keys.strafe > 0) flags.add("left");
        if (keys.strafe < 0) flags.add("right");
        if (keys.jump) {
            flags.add("jumping").add("jump_down").add("jump_current_raw");
            if (!prev.jump) flags.add("start_jumping").add("jump_pressed_raw");
        } else if (prev.jump) {
            flags.add("jump_released_raw");
        }
        if (keys.sneak) {
            flags.add("sneaking").add("sneak_down").add("sneak_current_raw");
            if (!prev.sneak) flags.add("start_sneaking").add("sneak_pressed_raw");
        } else if (prev.sneak) {
            flags.add("stop_sneaking").add("sneak_released_raw");
        }
        if (keys.sprint) {
            flags.add("sprinting").add("sprint_down");
            if (!prev.sprint) flags.add("start_sprinting");
        } else if (prev.sprint) {
            flags.add("stop_sprinting");
        }
        input.input_data = [...flags];
        const mv = { x: keys.strafe, z: keys.forward };
        const len = Math.hypot(mv.x, mv.z);
        if (len > 1) {
            mv.x /= len;
            mv.z /= len;
        }
        input.move_vector = mv;
        input.analogue_move_vector = mv;
        input.raw_move_vector = mv;
        this.lastKeys = keys;
    }

    private locks = "";

    private updateLocks(): void {
        const locks = this.driving ? { move: true, jump: true, sneak: true, rotation: this.cameraForced() } : {};
        const key = JSON.stringify(locks);
        if (key === this.locks) return;
        this.locks = key;
        this.io.toClient("update_client_input_locks", { locks });
    }

    private cameraSent: { yaw: number; pitch: number } | null = null;
    private interactTicks = 0;

    private cameraForced(): boolean {
        return this.driving && (!settings.freeLook.value || (settings.proxyCameraWhenNeeded.value && this.interactTicks > 0));
    }

    private turnCamera(input: any): void {
        const p = this.player!;
        const r = p.rotation;
        const last = this.cameraSent;
        if (last && Math.abs(last.yaw - r.yaw) < 0.5 && Math.abs(last.pitch - r.pitch) < 0.5) return;
        this.cameraSent = { yaw: r.yaw, pitch: r.pitch };
        const mode = settings.proxyCameraPacket.value === "teleport" ? "teleport" : "rotation";
        this.io.toClient("move_player", {
            runtime_id: Number(p.runtimeId),
            position: { x: p.pos.x, y: p.pos.y + EYE_HEIGHT, z: p.pos.z },
            pitch: r.pitch,
            yaw: r.yaw,
            head_yaw: r.yaw,
            mode,
            on_ground: p.move.onGround,
            ridden_runtime_id: 0,
            teleport: mode === "teleport" ? { cause: "unknown", source_entity_type: 0 } : undefined,
            tick: BigInt(input.tick ?? 0),
        });
    }

    private setDriving(driving: boolean): void {
        if (driving === this.driving) return;
        this.driving = driving;
        if (!driving) {
            this.saveMotionLog();
            this.cameraSent = null;
            this.lastKeys = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
            const p = this.player;
            if (p?.simulating) {
                p.simulating = false;
                this.history = [];
                const at = p.move.pos;
                this.io.toClient("move_player", { runtime_id: Number(p.runtimeId), position: { x: at.x, y: at.y + EYE_HEIGHT, z: at.z }, pitch: p.cameraPitch, yaw: p.cameraYaw, head_yaw: p.cameraYaw, mode: "teleport", on_ground: p.move.onGround, ridden_runtime_id: 0, teleport: { cause: "unknown", source_entity_type: 0 }, tick: 0n });
            }
        }
        this.updateLocks();
    }

    close(): void {
        this.baritone?.getPathingBehavior().forceCancel();
    }

    describe(): string {
        const p = this.player;
        const b = this.baritone;
        if (!p || !b) return `${this.username}: joining`;
        const pb = b.getPathingBehavior();
        const cur = pb.getCurrent();
        const proc = b.getPathingControlManager().mostRecentInControl();
        const here = p.playerFeet();
        const below = p.world().getState(here.x, here.y - 1, here.z);
        return (
            `${this.username}: at ${p.pos.x.toFixed(2)} ${p.pos.y.toFixed(2)} ${p.pos.z.toFixed(2)} feet=${here} on=${below === AIR ? "air" : below.typeId} ground=${p.onGround()} ` +
            `driving=${this.driving} proc=${proc ? proc.displayName() : "none"} goal=${pb.getGoal()} path=${cur ? `${cur.getPosition()}/${cur.getPath().length()}` : "none"} ` +
            `calculating=${pb.getInProgress() !== null} corrections=${this.corrections} unknownBlocks=${this.palette?.unknown.size ?? 0}`
        );
    }

    lookingAt(pos: BetterBlockPos): string {
        return this.player?.world().getState(pos.x, pos.y, pos.z).typeId ?? "?";
    }
}
