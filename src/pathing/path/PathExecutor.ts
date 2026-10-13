import { settings } from "../../Settings";
import type { PathingBehavior } from "../../behavior/PathingBehavior";
import { COST_INF } from "../../movement/ActionCosts";
import type { Movement } from "../../movement/Movement";
import { MovementHelper } from "../../movement/MovementHelper";
import { Input, MovementState, MovementStatus } from "../../movement/MovementState";
import { MovementAscend } from "../../movement/movements/MovementAscend";
import { MovementDescend } from "../../movement/movements/MovementDescend";
import { MovementDiagonal } from "../../movement/movements/MovementDiagonal";
import { MovementFall } from "../../movement/movements/MovementFall";
import { MovementParkour } from "../../movement/movements/MovementParkour";
import { MovementTraverse } from "../../movement/movements/MovementTraverse";
import { BetterBlockPos, indexOfPos, PosSet, Vec3 } from "../../utils/BetterBlockPos";
import type { IPlayerContext } from "../../utils/IPlayerContext";
import { RotationUtils } from "../../utils/Rotation";
import { entityDistanceToCenter, entityFlatDistanceToCenter } from "../../utils/Reachability";
import { CutoffPath, IPath, SplicedPath } from "./IPath";
import { MAX_TICKS, SprintJump } from "./SprintJump";

const MAX_MAX_DIST_FROM_PATH = 3;
const MAX_DIST_FROM_PATH = 2;
const MAX_TICKS_AWAY = 200;

export class PathExecutor {
    private readonly path: IPath;
    private pathPosition = 0;
    private ticksAway = 0;
    private ticksOnCurrent = 0;
    private currentMovementOriginalCostEstimate: number | null = null;
    private costEstimateIndex: number | null = null;
    private failed_ = false;
    private recalcBP = true;
    private toBreak_ = new PosSet();
    private toPlace_ = new PosSet();
    private toWalkInto_ = new PosSet();
    private readonly ctx: IPlayerContext;
    private sprintNextTick = false;
    private flight: SprintJump | null = null;

    constructor(private readonly behavior: PathingBehavior, path: IPath) {
        this.ctx = behavior.ctx;
        this.path = path;
        this.pathPosition = 0;
    }

    private movement(i: number): Movement {
        return this.path.movements()[i];
    }

    private get baritone() {
        return this.behavior.baritone;
    }

    private logDebug(msg: string): void {
        this.baritone.logDebug(msg);
    }

    onTick(): boolean {
        if (this.flight !== null && this.fly()) {
            return false;
        }
        if (this.pathPosition === this.path.length() - 1) {
            this.pathPosition++;
        }
        if (this.pathPosition >= this.path.length()) {
            return true;
        }
        const movement = this.movement(this.pathPosition);
        const whereAmI = this.ctx.playerFeet();
        if (!movement.getValidPositions().has(whereAmI)) {
            for (let i = 0; i < this.pathPosition && i < this.path.length(); i++) {
                if (this.movement(i).getValidPositions().has(whereAmI)) {
                    const previousPos = this.pathPosition;
                    this.pathPosition = i;
                    for (let j = this.pathPosition; j <= previousPos; j++) {
                        this.movement(j).reset();
                    }
                    this.onChangeInPathPosition();
                    this.onTick();
                    return false;
                }
            }
            for (let i = this.pathPosition + 3; i < this.path.length() - 1; i++) {
                if (this.movement(i).getValidPositions().has(whereAmI)) {
                    if (i - this.pathPosition > 2) {
                        this.logDebug("Skipping forward " + (i - this.pathPosition) + " steps, to " + i);
                    }
                    this.pathPosition = i - 1;
                    this.onChangeInPathPosition();
                    this.onTick();
                    return false;
                }
            }
        }
        const status = this.closestPathPos(this.path);
        if (this.possiblyOffPath(status, MAX_DIST_FROM_PATH)) {
            this.ticksAway++;
            this.logDebug("FAR AWAY FROM PATH FOR " + this.ticksAway + " TICKS. Current distance: " + status[0] + ". Threshold: " + MAX_DIST_FROM_PATH);
            if (this.ticksAway > MAX_TICKS_AWAY) {
                this.logDebug("Too far away from path for too long, cancelling path");
                this.cancel();
                return false;
            }
        } else {
            this.ticksAway = 0;
        }
        if (this.possiblyOffPath(status, MAX_MAX_DIST_FROM_PATH)) {
            this.logDebug("too far from path");
            this.cancel();
            return false;
        }
        const bsi = this.ctx.bsi();
        const movements = this.path.movements();
        for (let i = this.pathPosition - 10; i < this.pathPosition + 10; i++) {
            if (i < 0 || i >= movements.length) {
                continue;
            }
            const m = movements[i];
            const prevBreak = m.toBreak(bsi);
            const prevPlace = m.toPlace(bsi);
            const prevWalkInto = m.toWalkInto(bsi);
            m.resetBlockCache();
            if (!samePositions(prevBreak, m.toBreak(bsi))) {
                this.recalcBP = true;
            }
            if (!samePositions(prevPlace, m.toPlace(bsi))) {
                this.recalcBP = true;
            }
            if (!samePositions(prevWalkInto, m.toWalkInto(bsi))) {
                this.recalcBP = true;
            }
        }
        if (this.recalcBP) {
            const newBreak = new PosSet();
            const newPlace = new PosSet();
            const newWalkInto = new PosSet();
            for (let i = this.pathPosition; i < movements.length; i++) {
                const m = movements[i];
                m.toBreak(bsi).forEach((p) => newBreak.add(p));
                m.toPlace(bsi).forEach((p) => newPlace.add(p));
                m.toWalkInto(bsi).forEach((p) => newWalkInto.add(p));
            }
            this.toBreak_ = newBreak;
            this.toPlace_ = newPlace;
            this.toWalkInto_ = newWalkInto;
            this.recalcBP = false;
        }
        if (this.pathPosition < movements.length - 1) {
            const next = movements[this.pathPosition + 1];
            if (!bsi.worldContainsLoadedChunk(next.getDest().x, next.getDest().z)) {
                this.logDebug("Pausing since destination is at edge of loaded chunks");
                this.clearKeys();
                return true;
            }
        }
        const canCancel = movement.safeToCancel();
        if (this.costEstimateIndex === null || this.costEstimateIndex !== this.pathPosition) {
            this.costEstimateIndex = this.pathPosition;
            this.currentMovementOriginalCostEstimate = movement.getCost();
            for (let i = 1; i < settings.costVerificationLookahead.value && this.pathPosition + i < this.path.length() - 1; i++) {
                if (this.movement(this.pathPosition + i).calculateCost(this.behavior.secretInternalGetCalculationContext()) >= COST_INF && canCancel) {
                    this.logDebug("Something has changed in the world and a future movement has become impossible. Cancelling.");
                    this.cancel();
                    return true;
                }
            }
        }
        const currentCost = movement.recalculateCost(this.behavior.secretInternalGetCalculationContext());
        if (currentCost >= COST_INF && canCancel) {
            this.logDebug("Something has changed in the world and this movement has become impossible. Cancelling.");
            this.cancel();
            return true;
        }
        if (!movement.calculatedWhileLoaded() && currentCost - this.currentMovementOriginalCostEstimate! > settings.maxCostIncrease.value && canCancel) {
            this.logDebug("Original cost " + this.currentMovementOriginalCostEstimate + " current cost " + currentCost + ". Cancelling.");
            this.cancel();
            return true;
        }
        if (this.shouldPause()) {
            this.logDebug("Pausing since current best path is a backtrack");
            this.clearKeys();
            return true;
        }
        const movementStatus = movement.update();
        if (movementStatus === MovementStatus.UNREACHABLE || movementStatus === MovementStatus.FAILED) {
            this.logDebug("Movement returns status " + movementStatus);
            this.cancel();
            return true;
        }
        if (movementStatus === MovementStatus.SUCCESS) {
            this.pathPosition++;
            this.onChangeInPathPosition();
            this.onTick();
            return true;
        } else {
            this.sprintNextTick = this.shouldSprintNextTick();
            if (!this.sprintNextTick) {
                this.ctx.player().setSprinting(false);
            }
            this.ticksOnCurrent++;
            if (this.ticksOnCurrent > this.currentMovementOriginalCostEstimate! + settings.movementTimeoutTicks.value) {
                this.logDebug("This movement has taken too long (" + this.ticksOnCurrent + " ticks, expected " + this.currentMovementOriginalCostEstimate + "). Cancelling.");
                this.cancel();
                return true;
            }
        }
        return canCancel && this.flight === null;
    }

    private closestPathPos(path: IPath): [number, BetterBlockPos | null] {
        let best = -1;
        let bestPos: BetterBlockPos | null = null;
        const position = this.ctx.player().position();
        for (const movement of path.movements()) {
            for (const pos of movement.getValidPositions()) {
                const dist = entityDistanceToCenter(position, pos);
                if (dist < best || best === -1) {
                    best = dist;
                    bestPos = pos;
                }
            }
        }
        return [best, bestPos];
    }

    private shouldPause(): boolean {
        const current = this.behavior.getInProgress();
        if (!current) {
            return false;
        }
        const ctx = this.ctx;
        if (!ctx.player().onGround()) {
            return false;
        }
        if (!MovementHelper.canWalkOnCtx(ctx, ctx.playerFeet().below())) {
            return false;
        }
        if (!MovementHelper.canWalkThroughCtx(ctx, ctx.playerFeet()) || !MovementHelper.canWalkThroughCtx(ctx, ctx.playerFeet().above())) {
            return false;
        }
        if (!this.movement(this.pathPosition).safeToCancel()) {
            return false;
        }
        const currentBest = current.bestPathSoFar();
        if (!currentBest) {
            return false;
        }
        let positions = currentBest.positions();
        if (positions.length < 3) {
            return false;
        }
        positions = positions.slice(1);
        return indexOfPos(positions, ctx.playerFeet()) !== -1;
    }

    private possiblyOffPath(status: [number, BetterBlockPos | null], leniency: number): boolean {
        const distanceFromPath = status[0];
        if (distanceFromPath > leniency) {
            if (this.movement(this.pathPosition) instanceof MovementFall) {
                const fallDest = this.path.positions()[this.pathPosition + 1];
                return entityFlatDistanceToCenter(this.ctx.player().position(), fallDest) >= leniency;
            } else {
                return true;
            }
        } else {
            return false;
        }
    }

    snipsnapifpossible(): boolean {
        const ctx = this.ctx;
        if (!ctx.player().onGround() && !ctx.bsi().get(ctx.playerFeet()).hasFluid()) {
            return false;
        } else {
            if (ctx.player().deltaMovement().y < -0.1) {
                return false;
            }
        }
        const index = indexOfPos(this.path.positions(), ctx.playerFeet());
        if (index === -1) {
            return false;
        }
        this.pathPosition = index;
        this.clearKeys();
        return true;
    }

    private shouldSprintNextTick(): boolean {
        const input = this.baritone.getInputOverrideHandler();
        const ctx = this.ctx;
        const requested = input.isInputForcedDown(Input.SPRINT);

        input.setInputForceState(Input.SPRINT, false);

        if (!settings.allowSprint.value || ctx.player().foodLevel() <= 6) {
            return false;
        }
        const current = this.movement(this.pathPosition);

        if (settings.sprintJumping.value && !input.isInputForcedDown(Input.SNEAK) && (this.flight = SprintJump.plan(ctx, this.path, this.pathPosition)) !== null) {
            this.steer(true);
            return true;
        }

        if (current instanceof MovementTraverse && this.pathPosition < this.path.length() - 3) {
            const next = this.movement(this.pathPosition + 1);
            if (next instanceof MovementAscend && PathExecutor.sprintableAscend(ctx, current, next, this.movement(this.pathPosition + 2))) {
                if (PathExecutor.skipNow(ctx, current)) {
                    this.logDebug("Skipping traverse to straight ascend");
                    this.pathPosition++;
                    this.onChangeInPathPosition();
                    this.onTick();
                    input.setInputForceState(Input.JUMP, true);
                    return true;
                } else {
                    this.logDebug("Too far to the side to safely sprint ascend");
                }
            }
        }

        if (requested) {
            if (settings.headHitters.value) {
                this.headHitJump(current);
            }
            return true;
        }

        if (current instanceof MovementDescend) {
            if (this.pathPosition < this.path.length() - 2) {
                const next = this.movement(this.pathPosition + 1);
                if (MovementHelper.canUseFrostWalkerCtx(ctx, next.getDest().below())) {
                    if (next instanceof MovementTraverse || next instanceof MovementParkour) {
                        const couldPlaceInstead = settings.allowPlace.value && this.baritone.getInventoryBehavior().hasGenericThrowaway() && next instanceof MovementParkour;
                        const cur = current.getDirection().above();
                        const nd = next.getDirection();
                        const sameFlatDirection = !cur.offset(nd).isZero() && cur.cross(nd).isZero();
                        if (sameFlatDirection && !couldPlaceInstead) {
                            current.forceSafeMode();
                        }
                    }
                }
            }
            if (current.safeMode() && !current.skipToAscend()) {
                this.logDebug("Sprinting would be unsafe");
                return false;
            }

            if (this.pathPosition < this.path.length() - 2) {
                const next = this.movement(this.pathPosition + 1);
                if (next instanceof MovementAscend && current.getDirection().above().equals(next.getDirection().below())) {
                    this.pathPosition++;
                    this.onChangeInPathPosition();
                    this.onTick();
                    this.logDebug("Skipping descend to straight ascend");
                    return true;
                }
                if (PathExecutor.canSprintFromDescendInto(ctx, current, next)) {
                    if (next instanceof MovementDescend && this.pathPosition < this.path.length() - 3) {
                        const next_next = this.movement(this.pathPosition + 2);
                        if (next_next instanceof MovementDescend && !PathExecutor.canSprintFromDescendInto(ctx, next, next_next)) {
                            return false;
                        }
                    }
                    if (ctx.playerFeet().equals(current.getDest())) {
                        this.pathPosition++;
                        this.onChangeInPathPosition();
                        this.onTick();
                    }

                    return true;
                }
            }
        }
        if (current instanceof MovementAscend && this.pathPosition !== 0) {
            const prev = this.movement(this.pathPosition - 1);
            if (prev instanceof MovementDescend && prev.getDirection().above().equals(current.getDirection().below())) {
                const center = current.getSrc().above();
                if (ctx.player().position().y >= center.y - 0.07) {
                    input.setInputForceState(Input.JUMP, false);
                    return true;
                }
            }
            if (this.pathPosition < this.path.length() - 2 && prev instanceof MovementTraverse && PathExecutor.sprintableAscend(ctx, prev, current, this.movement(this.pathPosition + 1))) {
                return true;
            }
        }
        if (current instanceof MovementFall) {
            const data = this.overrideFall(current);
            if (data !== null) {
                const fallDest = data[1];
                if (indexOfPos(this.path.positions(), fallDest) === -1) {
                    throw new Error(`Fall override at ${current.getSrc()} returned illegal destination ${fallDest}`);
                }
                if (ctx.playerFeet().equals(fallDest)) {
                    this.pathPosition = indexOfPos(this.path.positions(), fallDest);
                    this.onChangeInPathPosition();
                    this.onTick();
                    return true;
                }
                this.clearKeys();
                const src = current.getSrc();
                const dest = current.getDest();
                const fakeState = new MovementState();
                if (!MovementHelper.openDoors(ctx, fakeState, src, new BetterBlockPos(dest.x, src.y, dest.z))) {
                    const forceRotations = fakeState.getTarget().hasToForceRotations();
                    const rotation = fakeState.getTarget().getRotation();
                    if (rotation) this.baritone.getLookBehavior().updateTarget(rotation, forceRotations);
                    fakeState.getInputStates().forEach((forced, inp) => input.setInputForceState(inp, forced));
                    fakeState.getInputStates().clear();
                    return true;
                }
                this.baritone.getLookBehavior().updateTarget(RotationUtils.calcRotationFromVec3d(ctx.playerHead(), data[0], ctx.playerRotations()), false);
                input.setInputForceState(Input.MOVE_FORWARD, true);
                return true;
            }
        }
        return false;
    }

    private fly(): boolean {
        const p = this.ctx.player();
        if (!p.onGround() && !p.isInWater() && !p.isInLava() && !p.onClimbable() && this.flight!.ticks < MAX_TICKS && settings.sprintJumping.value) {
            this.steer(false);
            this.sprintNextTick = true;
            return true;
        }
        for (let i = this.pathPosition; i < Math.min(this.path.movements().length, this.pathPosition + this.flight!.floors.length); i++) {
            if (this.movement(i).getValidPositions().has(this.ctx.playerFeet())) {
                this.pathPosition = i;
                break;
            }
        }
        this.flight = null;
        this.onChangeInPathPosition();
        return false;
    }

    private steer(takeoff: boolean): void {
        this.clearKeys();
        this.baritone.getLookBehavior().updateTarget(this.flight!.steer(this.ctx), false);
        this.baritone.getInputOverrideHandler().setInputForceState(Input.MOVE_FORWARD, true);
        this.baritone.getInputOverrideHandler().setInputForceState(Input.JUMP, takeoff);
    }

    private headHitJump(current: Movement): void {
        if (!this.canStartHeadHitting(current) || !this.underHeadBonkCeiling(current.getDirection(), this.ctx.playerFeet()) || !this.clearOfLedgesAhead(current.getDirection())) {
            return;
        }
        this.baritone.getInputOverrideHandler().setInputForceState(Input.JUMP, true);
    }

    private canStartHeadHitting(current: Movement): boolean {
        if (!(current instanceof MovementTraverse || current instanceof MovementDiagonal) || current.getDirection().y !== 0) {
            return false;
        }
        if (current instanceof MovementDiagonal && !settings.headHittersDiagonal.value) {
            return false;
        }
        const p = this.ctx.player();
        if (!p.onGround() || MovementHelper.isLiquidCtx(this.ctx, this.ctx.playerFeet()) || p.isInWater()) {
            return false;
        }
        if (current.toBreakCached === null || current.toBreakCached.length !== 0) {
            return false;
        }
        return !this.baritone.getInputOverrideHandler().isInputForcedDown(Input.SNEAK);
    }

    private underHeadBonkCeiling(dir: BetterBlockPos, feet: BetterBlockPos): boolean {
        const ceiling = feet.above(2);
        if (MovementHelper.fullyPassableCtx(this.ctx, ceiling) || !MovementHelper.isBlockNormalCube(this.ctx.bsi().get(ceiling))) {
            return false;
        }
        return this.clearOfCeilingEntrance(feet, dir.x, 0) && this.clearOfCeilingEntrance(feet, 0, dir.z);
    }

    private clearOfCeilingEntrance(feet: BetterBlockPos, dx: number, dz: number): boolean {
        if (dx === 0 && dz === 0) {
            return true;
        }
        const behind = feet.offset(-dx, 0, -dz).above(2);
        if (MovementHelper.fullyPassableCtx(this.ctx, behind)) {
            const pos = this.ctx.player().position();
            const flatDist = Math.abs(dx * (behind.x + 0.5 - pos.x)) + Math.abs(dz * (behind.z + 0.5 - pos.z));
            return flatDist >= 0.8;
        }
        return true;
    }

    private clearOfLedgesAhead(dir: BetterBlockPos): boolean {
        for (let i = 1; i <= 2; i++) {
            if (this.pathPosition + i > this.path.length() - 2 || !this.movement(this.pathPosition + i).getDirection().equals(dir)) {
                return false;
            }
            const next = this.movement(this.pathPosition + i);
            if (next.toPlaceCached !== null && next.toPlaceCached.length !== 0) {
                return false;
            }
            const floor = next.getDest().below();
            if (MovementHelper.isLiquidCtx(this.ctx, floor) || !MovementHelper.canWalkOnCtx(this.ctx, floor)) {
                return false;
            }
        }
        return true;
    }

    private overrideFall(movement: MovementFall): [Vec3, BetterBlockPos] | null {
        const dir = movement.getDirection();
        if (dir.y < -3) {
            return null;
        }
        if (movement.toBreakCached === null || movement.toBreakCached.length !== 0) {
            return null;
        }
        const flatDir = new BetterBlockPos(dir.x, 0, dir.z);
        let i: number;
        outer: for (i = this.pathPosition + 1; i < this.path.length() - 1 && i < this.pathPosition + 3; i++) {
            const next = this.movement(i);
            if (!(next instanceof MovementTraverse)) {
                break;
            }
            if (!flatDir.equals(next.getDirection())) {
                break;
            }
            for (let y = next.getDest().y; y <= movement.getSrc().y + 1; y++) {
                const chk = new BetterBlockPos(next.getDest().x, y, next.getDest().z);
                if (!MovementHelper.fullyPassableCtx(this.ctx, chk)) {
                    break outer;
                }
            }
            if (!MovementHelper.canWalkOnCtx(this.ctx, next.getDest().below())) {
                break;
            }
        }
        i--;
        if (i === this.pathPosition) {
            return null;
        }
        const len = i - this.pathPosition - 0.4;
        const d = movement.getDest();
        return [
            { x: flatDir.x * len + d.x + 0.5, y: d.y, z: flatDir.z * len + d.z + 0.5 },
            d.offset(flatDir.x * (i - this.pathPosition), 0, flatDir.z * (i - this.pathPosition)),
        ];
    }

    private static skipNow(ctx: IPlayerContext, current: Movement): boolean {
        const pos = ctx.player().position();
        const dir = current.getDirection();
        const offTarget = Math.abs(dir.x * (current.getSrc().z + 0.5 - pos.z)) + Math.abs(dir.z * (current.getSrc().x + 0.5 - pos.x));
        if (offTarget > 0.1) {
            return false;
        }
        const headBonk = current.getSrc().subtract(dir).above(2);
        if (MovementHelper.fullyPassableCtx(ctx, headBonk)) {
            return true;
        }
        const flatDist = Math.abs(dir.x * (headBonk.x + 0.5 - pos.x)) + Math.abs(dir.z * (headBonk.z + 0.5 - pos.z));
        return flatDist > 0.8;
    }

    private static sprintableAscend(ctx: IPlayerContext, current: MovementTraverse, next: MovementAscend, nextnext: Movement): boolean {
        if (!settings.sprintAscends.value) {
            return false;
        }
        if (!current.getDirection().equals(next.getDirection().below())) {
            return false;
        }
        if (nextnext.getDirection().x !== next.getDirection().x || nextnext.getDirection().z !== next.getDirection().z) {
            return false;
        }
        if (!MovementHelper.canWalkOnCtx(ctx, current.getDest().below())) {
            return false;
        }
        if (!MovementHelper.canWalkOnCtx(ctx, next.getDest().below())) {
            return false;
        }
        if (next.toBreakCached === null || next.toBreakCached.length !== 0) {
            return false;
        }
        for (let x = 0; x < 2; x++) {
            for (let y = 0; y < 3; y++) {
                let chk = current.getSrc().above(y);
                if (x === 1) {
                    chk = chk.offset(current.getDirection());
                }
                if (!MovementHelper.fullyPassableCtx(ctx, chk)) {
                    return false;
                }
            }
        }
        const bsi = ctx.bsi();
        if (MovementHelper.avoidWalkingInto(bsi.get(current.getSrc().above(3)))) {
            return false;
        }
        return !MovementHelper.avoidWalkingInto(bsi.get(next.getDest().above(2)));
    }

    private static canSprintFromDescendInto(ctx: IPlayerContext, current: Movement, next: Movement): boolean {
        if (next instanceof MovementDescend && next.getDirection().equals(current.getDirection())) {
            return true;
        }
        if (!MovementHelper.canWalkOnCtx(ctx, current.getDest().offset(current.getDirection()))) {
            return false;
        }
        if (next instanceof MovementTraverse && next.getDirection().equals(current.getDirection())) {
            return true;
        }
        return next instanceof MovementDiagonal && settings.allowOvershootDiagonalDescend.value;
    }

    private onChangeInPathPosition(): void {
        this.clearKeys();
        this.ticksOnCurrent = 0;
    }

    private clearKeys(): void {
        this.baritone.getInputOverrideHandler().clearAllKeys();
    }

    private cancel(): void {
        this.clearKeys();
        this.baritone.getInputOverrideHandler().getBlockBreakHelper().stopBreakingBlock();
        this.pathPosition = this.path.length() + 3;
        this.failed_ = true;
    }

    getPosition(): number {
        return this.pathPosition;
    }

    trySplice(next: PathExecutor | null): PathExecutor {
        if (next === null) {
            return this.cutIfTooLong();
        }
        const spliced = SplicedPath.trySplice(this.path, next.path, false);
        if (!spliced) {
            return this.cutIfTooLong();
        }
        if (!spliced.getDest().equals(next.getPath().getDest())) {
            throw new Error(`Path has end ${spliced.getDest()} instead of ${next.getPath().getDest()} after splicing`);
        }
        const ret = new PathExecutor(this.behavior, spliced);
        ret.pathPosition = this.pathPosition;
        ret.currentMovementOriginalCostEstimate = this.currentMovementOriginalCostEstimate;
        ret.costEstimateIndex = this.costEstimateIndex;
        ret.ticksOnCurrent = this.ticksOnCurrent;
        ret.flight = this.flight;
        return ret;
    }

    private cutIfTooLong(): PathExecutor {
        if (this.pathPosition > settings.maxPathHistoryLength.value) {
            const cutoffAmt = settings.pathHistoryCutoffAmount.value;
            const newPath = new CutoffPath(this.path, cutoffAmt, this.path.length() - 1);
            if (!newPath.getDest().equals(this.path.getDest())) {
                throw new Error(`Path has end ${newPath.getDest()} instead of ${this.path.getDest()} after trimming its start`);
            }
            this.logDebug("Discarding earliest segment movements, length cut from " + this.path.length() + " to " + newPath.length());
            const ret = new PathExecutor(this.behavior, newPath);
            ret.pathPosition = this.pathPosition - cutoffAmt;
            ret.currentMovementOriginalCostEstimate = this.currentMovementOriginalCostEstimate;
            if (this.costEstimateIndex !== null) {
                ret.costEstimateIndex = this.costEstimateIndex - cutoffAmt;
            }
            ret.ticksOnCurrent = this.ticksOnCurrent;
            ret.flight = this.flight;
            return ret;
        }
        return this;
    }

    getPath(): IPath {
        return this.path;
    }

    failed(): boolean {
        return this.failed_;
    }

    finished(): boolean {
        return this.pathPosition >= this.path.length();
    }

    toBreak(): PosSet {
        return this.toBreak_;
    }

    toPlace(): PosSet {
        return this.toPlace_;
    }

    toWalkInto(): PosSet {
        return this.toWalkInto_;
    }

    isSprinting(): boolean {
        return this.sprintNextTick;
    }
}

function samePositions(a: BetterBlockPos[], b: BetterBlockPos[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!a[i].equals(b[i])) return false;
    }
    return true;
}
