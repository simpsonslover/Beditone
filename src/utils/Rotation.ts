import { BetterBlockPos, Vec3 } from "./BetterBlockPos";

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

const f32 = Math.fround;

export class Rotation {
    readonly yaw: number;
    readonly pitch: number;

    constructor(yaw: number, pitch: number) {
        if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
            throw new Error(`${yaw} ${pitch}`);
        }
        this.yaw = f32(yaw);
        this.pitch = f32(pitch);
    }

    getYaw(): number {
        return this.yaw;
    }

    getPitch(): number {
        return this.pitch;
    }

    add(o: Rotation): Rotation {
        return new Rotation(this.yaw + o.yaw, this.pitch + o.pitch);
    }

    subtract(o: Rotation): Rotation {
        return new Rotation(this.yaw - o.yaw, this.pitch - o.pitch);
    }

    clamp(): Rotation {
        return new Rotation(this.yaw, Rotation.clampPitch(this.pitch));
    }

    normalize(): Rotation {
        return new Rotation(Rotation.normalizeYaw(this.yaw), this.pitch);
    }

    normalizeAndClamp(): Rotation {
        return new Rotation(Rotation.normalizeYaw(this.yaw), Rotation.clampPitch(this.pitch));
    }

    withPitch(pitch: number): Rotation {
        return new Rotation(this.yaw, pitch);
    }

    isReallyCloseTo(o: Rotation): boolean {
        return this.yawIsReallyClose(o) && Math.abs(this.pitch - o.pitch) < 0.01;
    }

    yawIsReallyClose(o: Rotation): boolean {
        const yawDiff = Math.abs(Rotation.normalizeYaw(this.yaw) - Rotation.normalizeYaw(o.yaw));
        return yawDiff < 0.01 || yawDiff > 359.99;
    }

    static clampPitch(pitch: number): number {
        return Math.max(-90, Math.min(90, pitch));
    }

    static normalizeYaw(yaw: number): number {
        let newYaw = f32(yaw % 360);
        if (newYaw < -180) newYaw += 360;
        if (newYaw > 180) newYaw -= 360;
        return newYaw;
    }

    static yawDistanceFromOffset(yaw: number, offsetYaw: number): number {
        if ((yaw > 0 !== offsetYaw > 0) && ((yaw > 90 || yaw < -90) !== (offsetYaw > 90 || offsetYaw < -90))) {
            if (yaw < 0) {
                return 360 + (yaw - offsetYaw);
            }
            return 360 - (yaw - offsetYaw);
        }
        return yaw - offsetYaw;
    }

    toString(): string {
        return `Yaw: ${this.yaw}, Pitch: ${this.pitch}`;
    }
}

export const RotationUtils = {
    wrapAnglesToRelative(current: Rotation, target: Rotation): Rotation {
        if (current.yawIsReallyClose(target)) {
            return new Rotation(current.yaw, target.pitch);
        }
        return target.subtract(current).normalize().add(current);
    },

    calcRotationFromVec3d(orig: Vec3, dest: Vec3, current?: Rotation): Rotation {
        const dx = orig.x - dest.x;
        const dy = orig.y - dest.y;
        const dz = orig.z - dest.z;
        const yaw = Math.atan2(dx, -dz);
        const dist = Math.sqrt(dx * dx + dz * dz);
        const pitch = Math.atan2(dy, dist);
        const raw = new Rotation(yaw * RAD_TO_DEG, pitch * RAD_TO_DEG);
        return current ? RotationUtils.wrapAnglesToRelative(current, raw) : raw;
    },

    calcRotationFromCoords(orig: BetterBlockPos, dest: BetterBlockPos): Rotation {
        return RotationUtils.calcRotationFromVec3d(orig, dest);
    },

    calcLookDirectionFromRotation(rotation: Rotation): Vec3 {
        const flatZ = Math.cos(-rotation.yaw * DEG_TO_RAD - Math.PI);
        const flatX = Math.sin(-rotation.yaw * DEG_TO_RAD - Math.PI);
        const pitchBase = -Math.cos(-rotation.pitch * DEG_TO_RAD);
        const pitchHeight = Math.sin(-rotation.pitch * DEG_TO_RAD);
        return { x: flatX * pitchBase, y: pitchHeight, z: flatZ * pitchBase };
    },
};
