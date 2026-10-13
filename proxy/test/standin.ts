import fs from "node:fs";
import { createRequire } from "node:module";
import { BlockPalette } from "../src/world/BlockPalette";
import { ChunkStore } from "../src/world/ChunkStore";

const require = createRequire(import.meta.url);
const { createClient, Client } = require("bedrock-protocol");
const http = require("node:http");
const { SignalStructure, SignalType } = require("nethernet/src/signalling");
const { attachIdentity } = require("nethernet/src/identity");

const [host, portStr, username, cmdFile] = process.argv.slice(2);
const port = Number(portStr);
const EYE = 1.62;
const W = 0.3;
const H = 1.8;
const STEP = 0.5625;

function post(path: string, body: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host, port, path, method: "POST", headers: { "Content-Type": "application/sdp", "Content-Length": Buffer.byteLength(body) } }, (res: any) => {
            let data = "";
            res.on("data", (d: string) => (data += d));
            res.on("end", () => resolve({ status: res.statusCode, body: data }));
        });
        req.on("error", reject);
        req.end(body);
    });
}

const origInit = Client.prototype.init;
Client.prototype.init = function (this: any) {
    if (this.options.transport === "nethernet") {
        this.prependOnceListener("connect_allowed", () => {
            const nn = this.connection.nethernet;
            const cands: string[] = [];
            nn.signalHandler = (signal: any) => {
                if (signal.type === SignalType.CandidateAdd) return void cands.push(signal.data);
                if (signal.type !== SignalType.ConnectRequest) return;
                setTimeout(async () => {
                    if (!this.multiplayerToken) this.createClientChain(null, true);
                    let sdp = attachIdentity(signal.data, { privateKey: this.ecdhKeyPair.privateKey, token: this.multiplayerToken });
                    sdp = sdp.replace(/(\r?\n)*$/, "\r\n") + cands.map((c) => "a=" + c + "\r\n").join("");
                    const r = await post(`/v1/join/${nn.connectionId}`, sdp);
                    if (r.status !== 200 || !r.body.startsWith("v=")) return console.log("[standin] signaling refused:", r.status, r.body);
                    nn.handleSignal(new SignalStructure(SignalType.ConnectResponse, nn.connectionId, r.body));
                }, 300);
            };
        });
    }
    return origInit.call(this);
};

const client = createClient({ host, port, offline: true, username, version: "1.26.51", transport: process.env.STANDIN_TRANSPORT ?? "nethernet", skipPing: true, nethernet: { networkId: 1n } });

let world: ChunkStore | null = null;
let rid = 0n;
let pos = { x: 0, y: 0, z: 0 };
let vel = { x: 0, y: 0, z: 0 };
let onGround = false;
let tick = 0n;
let tickBase = { tick: 0n, at: 0 };
let spawned = false;
let motionThisTick: { x: number; y: number; z: number } | null = null;
let motions = 0;
let lastStep = 0;
const jerk = { n: 0, sum: 0, max: 0, dist: 0 };
setInterval(() => {
    if (jerk.n) console.log(`[standin] smoothness: ${jerk.n} moving ticks, ${jerk.dist.toFixed(1)} blocks, mean step change ${(jerk.sum / jerk.n).toFixed(3)}, max ${jerk.max.toFixed(3)}`);
}, 10000);
let ackTeleport = false;
let locks = 0;

client.on("start_game", (p: any) => {
    world = new ChunkStore("minecraft:overworld", new BlockPalette("1.26.51", !!p.block_network_ids_are_hashes));
    rid = BigInt(p.runtime_entity_id);
    pos = { x: p.player_position.x, y: p.player_position.y - EYE, z: p.player_position.z };
    tick = BigInt(p.current_tick ?? 0);
    tickBase = { tick, at: Date.now() };
});
client.on("level_chunk", (p: any) => {
    if (process.env.STANDIN_DEBUG && seen.level_chunk < 3) console.log("[standin] level_chunk", p.x, p.z, "count", p.sub_chunk_count, "highest", p.highest_subchunk_count, "cache", p.cache_enabled, "payload", p.payload?.length);
    if (!world) return;
    const count = Number(p.sub_chunk_count);
    if (p.highest_subchunk_count !== undefined || count >= 0xfffffffe) {
        const requests = [];
        const highest = p.highest_subchunk_count ?? 24;
        for (let i = 0; i < highest; i++) requests.push({ dx: 0, dy: i, dz: 0 });
        client.queue("subchunk_request", { dimension: 0, origin: { x: p.x, y: -4, z: p.z }, requests });
    } else {
        world.decodeColumn(p.x, p.z, count, p.payload);
    }
});
client.on("subchunk", (p: any) => {
    if (process.env.STANDIN_DEBUG && (seen.subchunk ?? 0) < 3) console.log("[standin] subchunk origin", JSON.stringify(p.origin), "entries", JSON.stringify(p.entries.map((e: any) => [e.dx, e.dy, e.dz, e.result, e.payload?.length])));
    for (const e of p.entries) {
        const cx = p.origin.x + e.dx;
        const cy = p.origin.y + e.dy;
        const cz = p.origin.z + e.dz;
        if (e.result === "success_all_air") world?.markAllAir(cx, cy, cz);
        else if (e.result === "success" && e.payload) world?.decodeSubChunk(cx, cy, cz, e.payload);
    }
});
client.on("update_block", (p: any) => world?.setRuntime(p.position.x, p.position.y, p.position.z, p.block_runtime_id, p.layer));
client.on("update_subchunk_blocks", (p: any) => {
    for (const b of p.blocks) world?.setRuntime(b.position.x, b.position.y, b.position.z, b.runtime_id, 0);
    for (const b of p.extra) world?.setRuntime(b.position.x, b.position.y, b.position.z, b.runtime_id, 1);
});
let rotLogged = 0;
let cameraTurns = 0;
setInterval(() => {
    if (cameraTurns) console.log(`[standin] camera turned ${cameraTurns} times`);
}, 10000);
client.on("move_player", (p: any) => {
    if (BigInt(p.runtime_id) !== rid) return;
    if (process.env.STANDIN_ROT && rotLogged++ < 6) console.log("[standin] move_player", JSON.stringify(p, (k, v) => (typeof v === "bigint" ? String(v) : v)));
    if (p.mode === "rotation") {
        cameraTurns++;
        return;
    }
    pos = { x: p.position.x, y: p.position.y - EYE, z: p.position.z };
    vel = { x: 0, y: 0, z: 0 };
    if (p.mode === "teleport" || p.mode === "reset") ackTeleport = true;
});
client.on("correct_player_move_prediction", (p: any) => {
    pos = { x: p.position.x, y: p.position.y - EYE, z: p.position.z };
    console.log("[standin] server corrected us to", pos.x.toFixed(2), pos.y.toFixed(2), pos.z.toFixed(2));
});
client.on("set_entity_motion", (p: any) => {
    if (BigInt(p.runtime_entity_id) !== rid) return;
    motionThisTick = { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z };
    motions++;
});
client.on("update_client_input_locks", (p: any) => {
    locks = p.locks._value ?? 0;
    console.log("[standin] input locks:", locks ? "movement locked" : "unlocked");
});
client.on("text", (p: any) => {
    if (p.message) console.log("[chat] " + String(p.message).replace(/§./g, ""));
});
const seen: Record<string, number> = {};
client.on("packet", (des: any) => {
    const n = des.data.name;
    seen[n] = (seen[n] || 0) + 1;
});
if (process.env.STANDIN_DEBUG) setTimeout(() => console.log("[standin] packets:", JSON.stringify(seen)), 10000);
if (process.env.STANDIN_ROT) setInterval(() => console.log("[standin] packets:", JSON.stringify(seen)), 4000);
client.on("respawn", (p: any) => {
    if (process.env.STANDIN_DEBUG) console.log("[standin] respawn", JSON.stringify(p, (k, v) => (typeof v === "bigint" ? String(v) : v)));
    if (p.state === 1) {
        client.queue("respawn", { position: p.position, state: 2, runtime_entity_id: rid });
        pos = { x: p.position.x, y: p.position.y - EYE, z: p.position.z };
        ackTeleport = true;
    }
});
let particlesLogged = 0;
const colors: Record<string, number> = {};
if (process.env.STANDIN_PARTICLES) setInterval(() => console.log("[standin] particle colors (r,g,b: count)", JSON.stringify(colors)), 5000);
client.on("spawn_particle_effect", (p: any) => {
    if (!process.env.STANDIN_PARTICLES) return;
    if (particlesLogged++ === 0) console.log("[standin] particle packet", JSON.stringify(p, (k, v) => (typeof v === "bigint" ? String(v) : v)));
    const c = (String(p.molang_variables).match(/"value":([0-9.]+)/g) ?? []).map((m: string) => Number(m.split(":")[1]).toFixed(2)).join(",");
    colors[c] = (colors[c] ?? 0) + 1;
});
const otherRot: Record<string, number> = {};
for (const n of ["set_entity_motion", "camera_instruction", "move_entity", "move_entity_delta", "set_entity_data", "update_abilities", "camera_aim_assist"]) {
    client.on(n, (p: any) => {
        if (!process.env.STANDIN_ROT) return;
        if ((otherRot[n] = (otherRot[n] ?? 0) + 1) <= 2) console.log("[standin] " + n, JSON.stringify(p, (k, v) => (typeof v === "bigint" ? String(v) : v)).slice(0, 300));
    });
}
client.on("kick", (p: any) => console.log("[standin] kicked:", p.message || p.reason));
client.on("error", (e: Error) => console.log("[standin] error:", e.message));

function boxes(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[][] {
    const out: number[][] = [];
    if (!world) return out;
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++)
        for (let y = Math.floor(y0) - 1; y <= Math.floor(y1); y++)
            for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
                for (const b of world.getState(x, y, z).collision) out.push([x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
            }
    return out;
}

function sweep(axis: 0 | 1 | 2, d: number): number {
    if (d === 0) return 0;
    const lo = [pos.x - W, pos.y, pos.z - W];
    const hi = [pos.x + W, pos.y + H, pos.z + W];
    const qlo = lo.slice();
    const qhi = hi.slice();
    if (d > 0) qhi[axis] += d;
    else qlo[axis] += d;
    for (const b of boxes(qlo[0], qlo[1], qlo[2], qhi[0], qhi[1], qhi[2])) {
        let overlap = true;
        for (const a of [0, 1, 2]) {
            if (a === axis) continue;
            if (hi[a] <= b[a] + 1e-7 || lo[a] >= b[a + 3] - 1e-7) overlap = false;
        }
        if (!overlap) continue;
        if (d > 0 && hi[axis] <= b[axis] + 1e-7) d = Math.min(d, b[axis] - hi[axis]);
        if (d < 0 && lo[axis] >= b[axis + 3] - 1e-7) d = Math.max(d, b[axis + 3] - lo[axis]);
    }
    if (axis === 0) pos.x += d;
    else if (axis === 1) pos.y += d;
    else pos.z += d;
    return d;
}

function inWater(): boolean {
    return !!world?.getState(Math.floor(pos.x), Math.floor(pos.y + 0.1), Math.floor(pos.z)).hasFluid();
}

function physicsTick(): { x: number; y: number; z: number } {
    const start = { ...pos };
    if (process.env.STANDIN_WALK && tick % 200n > 100n) motionThisTick = { x: 0, y: vel.y, z: 0.2 };
    if (motionThisTick) {
        vel = motionThisTick;
        motionThisTick = null;
    }
    const water = inWater();
    const dy = sweep(1, vel.y);
    const wasGround = onGround;
    onGround = vel.y < 0 && dy > vel.y;
    if (dy !== vel.y) vel.y = 0;
    const before = { ...pos };
    const mx = sweep(0, vel.x);
    const mz = sweep(2, vel.z);
    if ((mx !== vel.x || mz !== vel.z) && (onGround || wasGround)) {
        const saved = { ...pos };
        pos = { ...before };
        const up = sweep(1, STEP);
        const sx = sweep(0, vel.x);
        const sz = sweep(2, vel.z);
        sweep(1, -up);
        if (Math.abs(sx) + Math.abs(sz) <= Math.abs(mx) + Math.abs(mz) + 1e-6) pos = saved;
    }
    if (pos.x - before.x !== vel.x) vel.x = 0;
    if (pos.z - before.z !== vel.z) vel.z = 0;
    if (water) {
        vel = { x: vel.x * 0.8, y: vel.y * 0.8 - 0.02, z: vel.z * 0.8 };
    } else {
        const f = onGround ? 0.546 : 0.91;
        vel = { x: vel.x * f, y: (vel.y - 0.08) * 0.98, z: vel.z * f };
    }
    return { x: pos.x - start.x, y: pos.y - start.y, z: pos.z - start.z };
}

function predictionSync(): void {
    client.queue("client_movement_prediction_sync", {
        data_flags: BigInt(process.env.STANDIN_FLAGS ?? "0"),
        bounding_box: { scale: 1, width: 0.6, height: 1.8 },
        movement_speed: 0.1,
        underwater_movement_speed: 0.02,
        lava_movement_speed: 0.02,
        jump_strength: 0.42,
        health: 20,
        hunger: 20,
        unknown_attribute_1: 0,
        unknown_attribute_2: 0,
        unknown_attribute_3: 0,
        entity_runtime_id: rid,
        is_flying: false,
    });
}
client.on("spawn", () => {
    spawned = true;
    if (process.env.STANDIN_SYNC) setInterval(predictionSync, 1000);
    {
        client.queue("serverbound_loading_screen", { type: 1 });
        client.queue("serverbound_loading_screen", { type: 2 });
    }
    console.log(`[standin] ${username} spawned at`, pos.x.toFixed(2), pos.y.toFixed(2), pos.z.toFixed(2));
});

setInterval(() => {
    if (!spawned || !world) return;
    tick = tickBase.tick + BigInt(Math.floor((Date.now() - tickBase.at) / 50));
    if (!world.isLoaded(Math.floor(pos.x), Math.floor(pos.z))) return;
    if (pos.y > 30000) {
        for (let y = world.maxY; y >= world.minY; y--) {
            if (world.getState(Math.floor(pos.x), y, Math.floor(pos.z)).collision.length) {
                pos.y = y + 1;
                break;
            }
        }
        if (pos.y > 30000) return;
    }
    const delta = physicsTick();
    const step = Math.hypot(delta.x, delta.z);
    if (step > 0.01 || lastStep > 0.01) {
        jerk.n++;
        jerk.sum += Math.abs(step - lastStep);
        jerk.max = Math.max(jerk.max, Math.abs(step - lastStep));
        jerk.dist += step;
    }
    lastStep = step;
    const holdW = !!process.env.STANDIN_INPUT && tick % 200n > 100n;
    const mvEnv = (process.env.STANDIN_MV ?? "0,1").split(",").map(Number);
    const mv = holdW ? { x: mvEnv[0], z: mvEnv[1] } : { x: 0, z: 0 };
    const yaw = Number(process.env.STANDIN_YAW ?? 0);
    client.write("player_auth_input", {
        pitch: 0,
        yaw,
        position: { x: pos.x, y: pos.y + EYE, z: pos.z },
        move_vector: mv,
        head_yaw: yaw,
        input_data: [...(holdW ? (process.env.STANDIN_KEYS ?? "up").split(",").filter((k) => !(k.startsWith("start_") && process.env.STANDIN_START_ONCE && tick % 200n !== 101n)) : []), ...(ackTeleport ? ["handled_teleport"] : []), ...(process.env.STANDIN_EXTRA ? process.env.STANDIN_EXTRA.split(",") : [])],
        input_mode: "mouse",
        play_mode: "normal",
        interaction_model: "crosshair",
        interact_rotation: { x: 0, z: 0 },
        tick,
        delta,
        analogue_move_vector: mv,
        camera_orientation: { x: 0, y: 0, z: 1 },
        raw_move_vector: mv,
    });
    ackTeleport = false;
}, 50);

setInterval(() => {
    if (spawned) console.log(`[standin] at ${pos.x.toFixed(2)} ${pos.y.toFixed(2)} ${pos.z.toFixed(2)} ground=${onGround} motions=${motions}`);
}, 2000);

let sent = 0;
if (cmdFile) {
    fs.writeFileSync(cmdFile, "");
    setInterval(() => {
        const lines = fs.readFileSync(cmdFile, "utf8").split("\n");
        while (sent < lines.length - 1) {
            const line = lines[sent++].trim();
            if (!line || !spawned) continue;
            console.log("[standin] > " + line);
            client.queue("text", { needs_translation: false, category: "authored", type: "chat", source_name: username, message: line, xuid: "", platform_chat_id: "", has_filtered_message: false });
        }
    }, 200);
}
