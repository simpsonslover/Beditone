import { settings } from "../Settings";
import type { IBaritone } from "../IBaritone";
import { Rotation } from "../utils/Rotation";
import type { IPlayerContext } from "../utils/IPlayerContext";

const SENSITIVITY = 0.5;

export class AimProcessor {
    private randomYawOffset = 0;
    private randomPitchOffset = 0;

    constructor(private readonly ctx: IPlayerContext, private prevOverride: Rotation | null = null) {}

    private getPrevRotation(): Rotation {
        return this.prevOverride ?? this.ctx.playerRotations();
    }

    peekRotation(rotation: Rotation): Rotation {
        const prev = this.getPrevRotation();
        let desiredYaw = rotation.yaw;
        let desiredPitch = rotation.pitch;
        if (desiredPitch === prev.pitch) {
            desiredPitch = AimProcessor.nudgeToLevel(desiredPitch);
        }
        desiredYaw += this.randomYawOffset;
        desiredPitch += this.randomPitchOffset;
        return new Rotation(AimProcessor.calculateMouseMove(prev.yaw, desiredYaw), AimProcessor.calculateMouseMove(prev.pitch, desiredPitch)).clamp();
    }

    tick(): void {
        this.randomYawOffset = (Math.random() - 0.5) * settings.randomLooking.value;
        this.randomPitchOffset = (Math.random() - 0.5) * settings.randomLooking.value;
        let random = Math.random() - 0.5;
        if (Math.abs(random) < 0.1) {
            random *= 4;
        }
        this.randomYawOffset += random * settings.randomLooking113.value;
    }

    nextRotation(rotation: Rotation): Rotation {
        const actual = this.peekRotation(rotation);
        this.tick();
        return actual;
    }

    fork(): AimProcessor {
        const f = new AimProcessor(this.ctx, this.getPrevRotation());
        f.randomYawOffset = this.randomYawOffset;
        f.randomPitchOffset = this.randomPitchOffset;
        return f;
    }

    private static nudgeToLevel(pitch: number): number {
        if (pitch < -20) {
            return pitch + 1;
        } else if (pitch > 10) {
            return pitch - 1;
        }
        return pitch;
    }

    private static calculateMouseMove(current: number, target: number): number {
        const delta = target - current;
        const deltaPx = AimProcessor.angleToMouse(delta);
        return current + AimProcessor.mouseToAngle(deltaPx);
    }

    private static angleToMouse(angleDelta: number): number {
        const minAngleChange = AimProcessor.mouseToAngle(1);
        return Math.round(angleDelta / minAngleChange);
    }

    private static mouseToAngle(mouseDelta: number): number {
        const f = SENSITIVITY * Math.fround(0.6) + Math.fround(0.2);
        return Math.fround(mouseDelta * f * f * f * 8.0) * 0.15;
    }
}

export class LookBehavior {
    private target: { rotation: Rotation; blockInteract: boolean } | null = null;
    private readonly processor: AimProcessor;
    private readonly smoothYawBuffer: number[] = [];
    private readonly smoothPitchBuffer: number[] = [];
    private readonly ctx: IPlayerContext;

    constructor(baritone: IBaritone) {
        this.ctx = baritone.getPlayerContext();
        this.processor = new AimProcessor(this.ctx);
    }

    updateTarget(rotation: Rotation, blockInteract: boolean): void {
        this.target = { rotation, blockInteract };
    }

    getAimProcessor(): AimProcessor {
        return this.processor;
    }

    onTick(): void {
        this.processor.tick();
    }

    onPlayerUpdate(): void {
        if (this.target === null) {
            return;
        }
        let actual = this.processor.peekRotation(this.target.rotation);
        this.smoothYawBuffer.push(this.target.rotation.yaw);
        while (this.smoothYawBuffer.length > settings.smoothLookTicks.value) this.smoothYawBuffer.shift();
        this.smoothPitchBuffer.push(this.target.rotation.pitch);
        while (this.smoothPitchBuffer.length > settings.smoothLookTicks.value) this.smoothPitchBuffer.shift();
        if (settings.smoothLook.value && !this.target.blockInteract) {
            const yaw = this.smoothYawBuffer.reduce((a, b) => a + b, 0) / this.smoothYawBuffer.length;
            actual = new Rotation(yaw, actual.pitch);
        }
        this.ctx.controller().setRotation(actual);
        this.target = null;
    }

    hasTarget(): boolean {
        return this.target !== null;
    }
}
