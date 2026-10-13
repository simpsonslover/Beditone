import type { Vec3 } from "../../../src/utils/BetterBlockPos";
import { DEG_TO_RAD } from "../../../src/utils/Rotation";
import { Blocks } from "../../../src/world/Blocks";
import type { ChunkStore } from "../world/ChunkStore";
import type { Keys } from "./ProxyPlayer";

const HALF_WIDTH = 0.3;
const HEIGHT = 1.8;
const STEP_HEIGHT = 0.5625;
const EPS = 1e-7;

const SLIPPERINESS: Record<string, number> = {
    ice: 0.98,
    packed_ice: 0.98,
    frosted_ice: 0.98,
    blue_ice: 0.989,
    slime: 0.8,
};

export interface MoveState {
    pos: Vec3;
    vel: Vec3;
    onGround: boolean;
    horizontalCollision: boolean;
    jumpDelay: number;
}

type Box = [number, number, number, number, number, number];

export class Physics {
    constructor(private readonly world: () => ChunkStore) {}

    private boxes(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box[] {
        const w = this.world();
        const out: Box[] = [];
        for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
            for (let y = Math.floor(y0) - 1; y <= Math.floor(y1); y++) {
                for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
                    for (const b of w.getState(x, y, z).collision) out.push([x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
                }
            }
        }
        return out;
    }

    private sweep(pos: Vec3, axis: 0 | 1 | 2, d: number): number {
        if (d === 0) return 0;
        const lo = [pos.x - HALF_WIDTH, pos.y, pos.z - HALF_WIDTH];
        const hi = [pos.x + HALF_WIDTH, pos.y + HEIGHT, pos.z + HALF_WIDTH];
        const qlo = lo.slice();
        const qhi = hi.slice();
        if (d > 0) qhi[axis] += d;
        else qlo[axis] += d;
        for (const b of this.boxes(qlo[0], qlo[1], qlo[2], qhi[0], qhi[1], qhi[2])) {
            let overlap = true;
            for (let a = 0; a < 3; a++) {
                if (a === axis) continue;
                if (hi[a] <= b[a] + EPS || lo[a] >= b[a + 3] - EPS) {
                    overlap = false;
                    break;
                }
            }
            if (!overlap) continue;
            if (d > 0 && hi[axis] <= b[axis] + EPS) d = Math.min(d, b[axis] - hi[axis]);
            else if (d < 0 && lo[axis] >= b[axis + 3] - EPS) d = Math.max(d, b[axis + 3] - lo[axis]);
        }
        if (axis === 0) pos.x += d;
        else if (axis === 1) pos.y += d;
        else pos.z += d;
        return d;
    }

    private supported(x: number, y: number, z: number): boolean {
        const test = { x, y, z };
        return this.sweep({ ...test }, 1, -0.6) > -0.6 + EPS;
    }

    private stateAt(x: number, y: number, z: number) {
        return this.world().getState(Math.floor(x), Math.floor(y), Math.floor(z));
    }

    private inLiquid(pos: Vec3): "water" | "lava" | null {
        const s = this.stateAt(pos.x, pos.y + 0.1, pos.z);
        if (!s.hasFluid()) return null;
        return s.name === "lava" || s.name === "flowing_lava" ? "lava" : "water";
    }

    step(s: MoveState, keys: Keys, yawDeg: number, speedAttribute: number): MoveState {
        const pos = { ...s.pos };
        const vel = { ...s.vel };
        let jumpDelay = Math.max(0, s.jumpDelay - 1);
        const liquid = this.inLiquid(pos);
        const climbing = Blocks.isClimbable(this.stateAt(pos.x, pos.y, pos.z));
        const below = this.stateAt(pos.x, pos.y - 0.5, pos.z);
        const slip = s.onGround ? (SLIPPERINESS[below.name] ?? 0.6) : 1;

        let forward = keys.forward;
        let strafe = keys.strafe;
        if (keys.sneak) {
            forward *= 0.3;
            strafe *= 0.3;
        }
        const len = Math.hypot(forward, strafe);
        if (len > 1) {
            forward /= len;
            strafe /= len;
        }
        const yaw = yawDeg * DEG_TO_RAD;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const sprint = keys.sprint && keys.forward > 0 && !keys.sneak;

        if (keys.jump) {
            if (liquid) {
                vel.y += 0.04;
            } else if (s.onGround && jumpDelay === 0) {
                vel.y = 0.42;
                if (sprint) {
                    vel.x += -sin * 0.2;
                    vel.z += cos * 0.2;
                }
                jumpDelay = 10;
            }
        } else {
            jumpDelay = 0;
        }

        let accel: number;
        if (liquid) accel = 0.02;
        else if (s.onGround) accel = speedAttribute * (sprint ? 1.3 : 1) * (0.21600002 / (slip * slip * slip));
        else accel = sprint ? 0.026 : 0.02;
        vel.x += (strafe * cos - forward * sin) * accel;
        vel.z += (forward * cos + strafe * sin) * accel;

        if (climbing) {
            vel.x = Math.max(-0.15, Math.min(0.15, vel.x));
            vel.z = Math.max(-0.15, Math.min(0.15, vel.z));
            vel.y = Math.max(vel.y, keys.sneak ? 0 : -0.15);
        }

        if (keys.sneak && s.onGround && !keys.jump) {
            if (!this.supported(pos.x + vel.x, pos.y, pos.z)) vel.x = 0;
            if (!this.supported(pos.x, pos.y, pos.z + vel.z)) vel.z = 0;
            if (!this.supported(pos.x + vel.x, pos.y, pos.z + vel.z)) vel.x = vel.z = 0;
        }

        const inside = this.boxes(pos.x - HALF_WIDTH, pos.y, pos.z - HALF_WIDTH, pos.x + HALF_WIDTH, pos.y + 0.5, pos.z + HALF_WIDTH).filter(
            (b) => b[0] < pos.x + HALF_WIDTH - EPS && b[3] > pos.x - HALF_WIDTH + EPS && b[2] < pos.z + HALF_WIDTH - EPS && b[5] > pos.z - HALF_WIDTH + EPS && b[1] < pos.y + 0.5 && b[4] > pos.y + EPS,
        );
        if (inside.length) {
            pos.y = Math.max(...inside.map((b) => b[4]));
            if (vel.y < 0) vel.y = 0;
        }

        const startY = pos.y;
        const dy = this.sweep(pos, 1, vel.y);
        const onGround = vel.y < 0 && dy > vel.y + EPS;
        const hitCeiling = vel.y > 0 && dy < vel.y - EPS;
        const before = { ...pos };
        const mx = this.sweep(pos, 0, vel.x);
        const mz = this.sweep(pos, 2, vel.z);
        let blockedX = Math.abs(mx - vel.x) > EPS;
        let blockedZ = Math.abs(mz - vel.z) > EPS;
        if ((blockedX || blockedZ) && (onGround || s.onGround)) {
            const tryPos = { ...before };
            const up = this.sweep(tryPos, 1, STEP_HEIGHT);
            const sx = this.sweep(tryPos, 0, vel.x);
            const sz = this.sweep(tryPos, 2, vel.z);
            this.sweep(tryPos, 1, -up);
            if (Math.hypot(sx, sz) > Math.hypot(mx, mz) + EPS) {
                pos.x = tryPos.x;
                pos.y = tryPos.y;
                pos.z = tryPos.z;
                blockedX = Math.abs(sx - vel.x) > EPS;
                blockedZ = Math.abs(sz - vel.z) > EPS;
            }
        }
        const horizontalCollision = blockedX || blockedZ;
        if (blockedX) vel.x = 0;
        if (blockedZ) vel.z = 0;
        if (onGround || hitCeiling) vel.y = 0;
        if (climbing && horizontalCollision && !keys.sneak) vel.y = 0.2;

        if (liquid) {
            vel.x *= 0.8;
            vel.y = vel.y * 0.8 - 0.02;
            vel.z *= 0.8;
        } else {
            const friction = onGround ? (SLIPPERINESS[this.stateAt(pos.x, pos.y - 0.5, pos.z).name] ?? 0.6) * 0.91 : 0.91;
            vel.y = (vel.y - 0.08) * 0.98;
            vel.x *= friction;
            vel.z *= friction;
        }
        void startY;
        return { pos, vel, onGround, horizontalCollision, jumpDelay };
    }
}
