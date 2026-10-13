import { settings } from "../../Settings";
import { MovementHelper } from "../../movement/MovementHelper";
import { MovementAscend } from "../../movement/movements/MovementAscend";
import { MovementDescend } from "../../movement/movements/MovementDescend";
import { MovementDiagonal } from "../../movement/movements/MovementDiagonal";
import { MovementTraverse } from "../../movement/movements/MovementTraverse";
import { BetterBlockPos, Vec3 } from "../../utils/BetterBlockPos";
import type { IPlayerContext } from "../../utils/IPlayerContext";
import { Rotation } from "../../utils/Rotation";
import type { IPath } from "./IPath";

const GROUND_FRICTION = 0.6 * 0.91;
const AIR_FRICTION = 0.91;
const AIR_ACCEL = 0.026 * 0.98;
const JUMP_BOOST = 0.2;
const JUMP = 0.42;
const GRAVITY = 0.08;
const EPS = 1e-6;
const SAFE_FALL = 3;
const FLAT_PACE = 0.28;
const SLOW_PACE = 0.15;
const MAX_RUNWAY = 10;
export const MAX_TICKS = 40;
const MARGINS = [0.85, 1, 1.15];
const BRAKE_THEN_PUSH = -Infinity;

interface Landing {
    s: number;
    y: number;
    apex: number;
    v: number;
    ticks: number;
}

export class SprintJump {
    private readonly halfWidth: number;
    private originX = 0;
    private originZ = 0;
    private takeoffY = 0;
    private ux = 0;
    private uz = 0;
    private target = NaN;
    private apex = 0;
    private pushing = false;
    ticks = 0;

    constructor(readonly floors: number[], private readonly spacing: number, private readonly groundAccel: number) {
        this.halfWidth = 0.3 * spacing;
    }

    static plan(ctx: IPlayerContext, path: IPath, pathPosition: number): SprintJump | null {
        const player = ctx.player();
        const start = path.positions()[pathPosition];
        const dir = path.movements()[pathPosition].getDirection();
        const diagonal = dir.x !== 0 && dir.z !== 0;
        const pos = player.position();
        if (
            !player.onGround() ||
            !player.isSprinting() ||
            player.isInWater() ||
            player.isInLava() ||
            player.onClimbable() ||
            !ctx.playerFeet().equals(start) ||
            Math.abs(pos.y - start.y) > 1e-3 ||
            (diagonal && !settings.sprintJumpingDiagonals.value) ||
            player.effectAmplifier("jump_boost") !== undefined ||
            player.effectAmplifier("slow_falling") !== undefined ||
            player.effectAmplifier("levitation") !== undefined ||
            !SprintJump.solidFloor(ctx, start.below()) ||
            !SprintJump.clear(ctx, start.x, start.y, start.z, start.y + 3)
        ) {
            return null;
        }
        const floors: number[] = new Array(MAX_RUNWAY + 1).fill(0);
        let n = 1;
        for (let i = pathPosition; i < path.movements().length && n <= MAX_RUNWAY; i++, n++) {
            const m = path.movements()[i];
            const src = m.getSrc();
            const dest = m.getDest();
            const top = Math.max(dest.y + 2, start.y + 3);
            const walking = diagonal ? m instanceof MovementDiagonal && dest.y === src.y : m instanceof MovementTraverse || m instanceof MovementAscend || m instanceof MovementDescend;
            if (
                !walking ||
                dest.x - src.x !== dir.x ||
                dest.z - src.z !== dir.z ||
                m.toBreakCached === null ||
                m.toBreakCached.length !== 0 ||
                m.toPlaceCached === null ||
                m.toPlaceCached.length !== 0 ||
                !SprintJump.solidFloor(ctx, dest.below()) ||
                !SprintJump.clear(ctx, dest.x, dest.y, dest.z, top) ||
                (diagonal && !(SprintJump.side(ctx, src.x + dir.x, src.y, src.z, top) && SprintJump.side(ctx, src.x, src.y, src.z + dir.z, top)))
            ) {
                break;
            }
            floors[n] = dest.y - start.y;
        }
        const spacing = diagonal ? Math.sqrt(2) : 1;
        const jump = new SprintJump(floors.slice(0, n), spacing, player.speedAttribute() * 0.98);
        jump.originX = start.x + 0.5;
        jump.originZ = start.z + 0.5;
        jump.takeoffY = start.y;
        jump.ux = dir.x / spacing;
        jump.uz = dir.z / spacing;
        const rel = { x: pos.x - jump.originX, y: 0, z: pos.z - jump.originZ };
        const vel = player.deltaMovement();
        if (n < 3 || Math.abs(jump.across(rel)) > 0.2 || Math.abs(jump.across(vel)) > 0.08) {
            return null;
        }
        const target = jump.plan(jump.along(rel), jump.along(vel));
        if (target === null) {
            return null;
        }
        jump.target = target;
        return jump;
    }

    private static solidFloor(ctx: IPlayerContext, pos: BetterBlockPos): boolean {
        const state = ctx.bsi().get(pos);
        const n = state.name;
        if (n.includes("ice") || n === "slime" || n === "honey_block" || n === "soul_sand" || n === "magma") return false;
        return state.fullCube;
    }

    private static side(ctx: IPlayerContext, x: number, y: number, z: number, top: number): boolean {
        return SprintJump.solidFloor(ctx, new BetterBlockPos(x, y - 1, z)) && SprintJump.clear(ctx, x, y, z, top);
    }

    private static clear(ctx: IPlayerContext, x: number, y: number, z: number, top: number): boolean {
        for (let yy = y; yy <= top; yy++) {
            if (!MovementHelper.fullyPassableCtx(ctx, new BetterBlockPos(x, yy, z))) {
                return false;
            }
        }
        return true;
    }

    private along(v: Vec3): number {
        return v.x * this.ux + v.z * this.uz;
    }

    private across(v: Vec3): number {
        return v.z * this.ux - v.x * this.uz;
    }

    plan(s: number, v: number): number | null {
        const climb = this.stepUpAhead(0);
        const chained = climb ? this.choose(s, v, MARGINS, true) : null;
        return chained !== null || (climb && this.canHop(s, v, MARGINS, true, 1)) ? chained : this.choose(s, v, MARGINS, false);
    }

    private choose(s: number, v: number, margins: number[], chain: boolean): number | null {
        if (this.works(s, v, margins, NaN, chain)) {
            return NaN;
        }
        const full = this.jump(s, v, NaN);
        for (let k = this.floors.length - 1; k >= 1; k--) {
            if ((full === null || k * this.spacing <= full.s + this.spacing / 2) && this.works(s, v, margins, k * this.spacing, chain)) {
                return k * this.spacing;
            }
        }
        return null;
    }

    private works(s: number, v: number, margins: number[], target: number, chain: boolean): boolean {
        for (const margin of margins) {
            const l = this.jump(s, v * margin, target);
            if (!this.safe(l) || (!Number.isNaN(target) && l!.s - s < (l!.y < -EPS || chain ? SLOW_PACE : FLAT_PACE) * l!.ticks)) {
                return false;
            }
        }
        return !chain || this.chains(this.jump(s, v, target)!);
    }

    private chains(l: Landing): boolean {
        const cell = Math.round(l.s / this.spacing);
        if (!this.stepUpAhead(cell)) {
            return true;
        }
        const next = new Array<number>(this.floors.length - cell);
        for (let i = 0; i < next.length; i++) next[i] = this.floors[cell + i] - l.y;
        return new SprintJump(next, this.spacing, this.groundAccel).canHop(l.s - cell * this.spacing, l.v, [1], false, 0);
    }

    private canHop(s: number, v: number, margins: number[], chain: boolean, from: number): boolean {
        for (let wait = 0; wait <= 2 && this.highest(s) <= EPS; wait++) {
            if (wait >= from && this.choose(s, v, margins, chain) !== null) {
                return true;
            }
            s += v + this.groundAccel;
            v = (v + this.groundAccel) * GROUND_FRICTION;
        }
        return false;
    }

    private stepUpAhead(cell: number): boolean {
        for (let k = cell + 1; k < this.floors.length; k++) {
            if (this.floors[k] > this.floors[cell] + EPS) {
                return true;
            }
        }
        return false;
    }

    jump(s: number, v: number, target: number): Landing | null {
        return this.fly(s, v + JUMP_BOOST, 0, JUMP, 0, true, target);
    }

    private fly(s: number, v: number, y: number, vy: number, apex: number, jumping: boolean, target: number): Landing | null {
        let committed = false;
        for (let tick = 0; tick < MAX_TICKS; tick++) {
            const jumpTick = jumping && tick === 0;
            const throttle: number = jumpTick ? 0 : target === BRAKE_THEN_PUSH ? (tick === 0 ? -1 : 1) : this.throttle(s, v, y, vy, apex, target, committed);
            committed = throttle > 0;
            const disp = v + (jumpTick ? this.groundAccel : AIR_ACCEL * throttle);
            y += vy;
            apex = Math.max(apex, y);
            const landed = vy < 0 && y <= this.highest(s) + EPS;
            y = landed ? this.highest(s) : y;
            s += disp;
            if (this.highest(s) > y + EPS) {
                return null;
            }
            if (landed) {
                return { s, y, apex, v: disp * AIR_FRICTION, ticks: tick + 1 };
            }
            v = disp * (jumpTick ? GROUND_FRICTION : AIR_FRICTION);
            vy = (vy - GRAVITY) * 0.98;
        }
        return null;
    }

    private throttle(s: number, v: number, y: number, vy: number, apex: number, target: number, committed: boolean): number {
        if (Number.isNaN(target) || committed) {
            return 1;
        }
        const late = this.fly(s, v, y, vy, apex, false, BRAKE_THEN_PUSH);
        return late === null || late.s >= target ? -1 : 1;
    }

    safe(l: Landing | null): boolean {
        if (l === null || l.apex - l.y >= SAFE_FALL) {
            return false;
        }
        const cell = Math.round(l.s / this.spacing);
        return cell >= 0 && cell < this.floors.length && Math.abs(this.floors[cell] - l.y) < EPS && this.highest(l.s + Math.max(0, l.v) / (1 - GROUND_FRICTION)) !== Infinity;
    }

    private highest(s: number): number {
        let top = -Infinity;
        for (let k = Math.floor((s - this.halfWidth) / this.spacing - 0.5) + 1; k <= Math.ceil((s + this.halfWidth) / this.spacing + 0.5) - 1; k++) {
            if (k >= this.floors.length) {
                return Infinity;
            }
            top = Math.max(top, this.floors[Math.max(k, 0)]);
        }
        return top;
    }

    steer(ctx: IPlayerContext): Rotation {
        const p = ctx.player().position();
        const pos = { x: p.x - this.originX, y: p.y, z: p.z - this.originZ };
        const vel = ctx.player().deltaMovement();
        let throttle = 1;
        let accel = JUMP_BOOST + this.groundAccel;
        if (this.ticks++ > 0) {
            this.apex = Math.max(this.apex, pos.y - this.takeoffY);
            throttle = this.throttle(this.along(pos), this.along(vel), pos.y - this.takeoffY, vel.y, this.apex, this.target, this.pushing);
            this.pushing = throttle > 0;
            accel = AIR_ACCEL;
        }
        const side = Math.max(-0.5, Math.min(0.5, (-this.across(pos) * 0.3 - this.across(vel)) / accel));
        const forward = throttle * Math.sqrt(1 - side * side);
        const yaw = (Math.atan2(this.uz * forward + this.ux * side, this.ux * forward - this.uz * side) * 180) / Math.PI - 90;
        return new Rotation(yaw, ctx.playerRotations().pitch);
    }
}
