import { settings } from "../Settings";
import { Goal, GoalBlock, GoalComposite, GoalGetToBlock } from "../goals/Goal";
import { MovementHelper } from "../movement/MovementHelper";
import { Input } from "../movement/MovementState";
import { BetterBlockPos, Directions, HORIZONTALS } from "../utils/BetterBlockPos";
import { isEmpty, ItemInfo } from "../utils/IPlayerContext";
import { reachable, reachableOffset } from "../utils/Reachability";
import type { BlockState } from "../world/BlockState";
import { Blocks } from "../world/Blocks";
import { BlockOptionalMetaLookup } from "../world/BlockOptionalMeta";
import type { BlockStateInterface } from "../world/BlockStateInterface";
import { scanChunkRadius } from "../world/WorldScanner";
import { GoalBreak } from "./BuilderProcess";
import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";

const FARMLAND_PLANTABLE = ["wheat_seeds", "beetroot_seeds", "melon_seeds", "pumpkin_seeds", "potato", "carrot"].map((s) => "minecraft:" + s);
const PICKUP_DROPPED = ["beetroot_seeds", "beetroot", "melon_seeds", "melon_slice", "melon_block", "wheat_seeds", "wheat", "pumpkin_seeds", "pumpkin", "potato", "carrot", "nether_wart", "cocoa_beans", "sugar_cane", "bamboo", "cactus"].map((s) => "minecraft:" + s);

interface Harvest {
    block: string;
    ready(bsi: BlockStateInterface, pos: BetterBlockPos, state: BlockState): boolean;
}

const crop = (block: string): Harvest => ({ block, ready: (_b, _p, s) => Number(s.get("growth") ?? 0) >= 7 });
const stack = (block: string): Harvest => ({
    block,
    ready: (bsi, pos) => (settings.replantCrops.value ? bsi.get(pos.below()).name === block : true),
});

const HARVESTS: Harvest[] = [
    crop("wheat"),
    crop("carrots"),
    crop("potatoes"),
    crop("beetroot"),
    { block: "pumpkin", ready: () => true },
    { block: "melon_block", ready: () => true },
    { block: "nether_wart", ready: (_b, _p, s) => Number(s.get("age") ?? 0) >= 3 },
    { block: "cocoa", ready: (_b, _p, s) => Number(s.get("age") ?? 0) >= 2 },
    stack("reeds"),
    stack("bamboo"),
    stack("cactus"),
];

export class FarmProcess extends BaritoneProcess {
    private active = false;
    private locations: BetterBlockPos[] | null = null;
    private tickCount = 0;
    private range = 0;
    private center: BetterBlockPos | null = null;
    private scanning = false;

    isActive(): boolean {
        return this.active;
    }

    farm(range: number, pos: BetterBlockPos | null): void {
        this.center = pos ?? this.ctx.playerFeet();
        this.range = range;
        this.active = true;
        this.locations = null;
    }

    private readyForHarvest(bsi: BlockStateInterface, pos: BetterBlockPos, state: BlockState): boolean {
        for (const harvest of HARVESTS) {
            if (harvest.block === state.name) {
                return harvest.ready(bsi, pos, state);
            }
        }
        return false;
    }

    private isPlantable = (stack: ItemInfo): boolean => FARMLAND_PLANTABLE.includes(stack.typeId);
    private isBoneMeal = (stack: ItemInfo): boolean => !isEmpty(stack) && stack.typeId === "minecraft:bone_meal";
    private isNetherWart = (stack: ItemInfo): boolean => !isEmpty(stack) && stack.typeId === "minecraft:nether_wart";
    private isCocoa = (stack: ItemInfo): boolean => !isEmpty(stack) && stack.typeId === "minecraft:cocoa_beans";

    onTick(calcFailed: boolean, isSafeToCancel: boolean): PathingCommand {
        if (settings.mineGoalUpdateInterval.value !== 0 && this.tickCount++ % settings.mineGoalUpdateInterval.value === 0 && !this.scanning) {
            const scan = HARVESTS.map((h) => h.block);
            if (settings.replantCrops.value) {
                scan.push("farmland", "jungle_log");
                if (settings.replantNetherWart.value) {
                    scan.push("soul_sand");
                }
            }
            this.scanning = true;
            const self = this;
            this.baritone.runJob(
                (function* () {
                    try {
                        self.locations = yield* scanChunkRadius(self.ctx, self.baritone.getBlockScanner(), new BlockOptionalMetaLookup(...scan), settings.farmMaxScanSize.value, 10, 10);
                    } finally {
                        self.scanning = false;
                    }
                })(),
            );
        }
        if (this.locations === null) {
            return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
        }
        const bsi = this.ctx.bsi();
        const toBreak: BetterBlockPos[] = [];
        const openFarmland: BetterBlockPos[] = [];
        const bonemealable: BetterBlockPos[] = [];
        const openSoulsand: BetterBlockPos[] = [];
        const openLog: BetterBlockPos[] = [];
        let hasImmatureCrop = false;
        for (const pos of this.locations) {
            if (this.range !== 0 && pos.distSqr(this.center!) > this.range * this.range) {
                continue;
            }
            const state = bsi.get(pos);
            const airAbove = Blocks.isAir(bsi.get(pos.above()));
            if (state.name === "farmland") {
                if (airAbove) {
                    openFarmland.push(pos);
                }
                continue;
            }
            if (state.name === "soul_sand") {
                if (airAbove) {
                    openSoulsand.push(pos);
                }
                continue;
            }
            if (state.name === "jungle_log") {
                for (const direction of HORIZONTALS) {
                    if (Blocks.isAir(bsi.get(pos.relative(direction)))) {
                        openLog.push(pos);
                        break;
                    }
                }
                continue;
            }
            if (this.readyForHarvest(bsi, pos, state)) {
                toBreak.push(pos);
                continue;
            }
            if (HARVESTS.some((h) => h.block === state.name)) {
                hasImmatureCrop = true;
            }
            if (["wheat", "carrots", "potatoes", "beetroot", "cocoa", "sweet_berry_bush"].includes(state.name)) {
                bonemealable.push(pos);
            }
        }

        this.baritone.getInputOverrideHandler().clearAllKeys();
        const playerPos = this.ctx.playerFeet();
        const blockReachDistance = this.ctx.blockReachDistance();
        for (const pos of toBreak) {
            if (playerPos.distSqr(pos) > blockReachDistance * blockReachDistance) {
                continue;
            }
            const rot = reachable(this.ctx, pos);
            if (rot && isSafeToCancel) {
                this.baritone.getLookBehavior().updateTarget(rot, true);
                MovementHelper.switchToBestToolFor(this.ctx, bsi.get(pos));
                if (this.ctx.isLookingAt(pos)) {
                    this.baritone.getInputOverrideHandler().setInputForceState(Input.CLICK_LEFT, true);
                }
                return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
            }
        }
        const both = [...openFarmland, ...openSoulsand];
        for (const pos of both) {
            if (playerPos.distSqr(pos) > blockReachDistance * blockReachDistance) {
                continue;
            }
            const soulsand = openSoulsand.includes(pos);
            const rot = reachableOffset(this.ctx, pos, { x: pos.x + 0.5, y: pos.y + 1, z: pos.z + 0.5 }, blockReachDistance, false);
            if (rot && isSafeToCancel && this.baritone.getInventoryBehavior().throwaway(true, soulsand ? this.isNetherWart : this.isPlantable)) {
                const result = this.ctx.rayTraceTowards(rot, blockReachDistance, false);
                if (result && result.direction === Directions.UP) {
                    this.baritone.getLookBehavior().updateTarget(rot, true);
                    if (this.ctx.isLookingAt(pos)) {
                        this.baritone.getInputOverrideHandler().setInputForceState(Input.CLICK_RIGHT, true);
                    }
                    return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
                }
            }
        }
        for (const pos of openLog) {
            if (playerPos.distSqr(pos) > blockReachDistance * blockReachDistance) {
                continue;
            }
            for (const dir of HORIZONTALS) {
                if (!Blocks.isAir(bsi.get(pos.relative(dir)))) {
                    continue;
                }
                const faceCenter = { x: pos.x + 0.5 + dir.x * 0.5, y: pos.y + 0.5, z: pos.z + 0.5 + dir.z * 0.5 };
                const rot = reachableOffset(this.ctx, pos, faceCenter, blockReachDistance, false);
                if (rot && isSafeToCancel && this.baritone.getInventoryBehavior().throwaway(true, this.isCocoa)) {
                    const result = this.ctx.rayTraceTowards(rot, blockReachDistance, false);
                    if (result && result.direction === dir) {
                        this.baritone.getLookBehavior().updateTarget(rot, true);
                        if (this.ctx.isLookingAt(pos)) {
                            this.baritone.getInputOverrideHandler().setInputForceState(Input.CLICK_RIGHT, true);
                        }
                        return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
                    }
                }
            }
        }
        for (const pos of bonemealable) {
            if (playerPos.distSqr(pos) > blockReachDistance * blockReachDistance) {
                continue;
            }
            const rot = reachable(this.ctx, pos);
            if (rot && isSafeToCancel && this.baritone.getInventoryBehavior().throwaway(true, this.isBoneMeal)) {
                this.baritone.getLookBehavior().updateTarget(rot, true);
                if (this.ctx.isLookingAt(pos)) {
                    this.baritone.getInputOverrideHandler().setInputForceState(Input.CLICK_RIGHT, true);
                }
                return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
            }
        }

        if (calcFailed) {
            this.logDirect("Farm failed");
            if (settings.notificationOnFarmFail.value) {
                this.logNotification("Farm failed", true);
            }
            this.onLostControl();
            return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
        }

        const goalz: Goal[] = [];
        for (const pos of toBreak) {
            goalz.push(new GoalBreak(pos));
        }
        if (this.baritone.getInventoryBehavior().throwaway(false, this.isPlantable)) {
            for (const pos of openFarmland) {
                goalz.push(GoalBlock.of(pos.above()));
            }
        }
        if (this.baritone.getInventoryBehavior().throwaway(false, this.isNetherWart)) {
            for (const pos of openSoulsand) {
                goalz.push(GoalBlock.of(pos.above()));
            }
        }
        if (this.baritone.getInventoryBehavior().throwaway(false, this.isCocoa)) {
            for (const pos of openLog) {
                for (const direction of HORIZONTALS) {
                    if (Blocks.isAir(bsi.get(pos.relative(direction)))) {
                        goalz.push(new GoalGetToBlock(pos.relative(direction)));
                    }
                }
            }
        }
        if (this.baritone.getInventoryBehavior().throwaway(false, this.isBoneMeal)) {
            for (const pos of bonemealable) {
                goalz.push(GoalBlock.of(pos));
            }
        }
        for (const entity of this.ctx.entities()) {
            if (entity.typeId === "minecraft:item" && entity.onGround && entity.itemTypeId && PICKUP_DROPPED.includes(entity.itemTypeId)) {
                goalz.push(GoalBlock.of(BetterBlockPos.of({ x: entity.position.x, y: entity.position.y + 0.1, z: entity.position.z })));
            }
        }
        if (goalz.length === 0) {
            if (hasImmatureCrop && settings.farmWaitForGrowth.value) {
                return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
            }
            this.logDirect("Farm failed");
            if (settings.notificationOnFarmFail.value) {
                this.logNotification("Farm failed", true);
            }
            this.onLostControl();
            return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
        }
        return new PathingCommand(new GoalComposite(...goalz), PathingCommandType.SET_GOAL_AND_PATH);
    }

    onLostControl(): void {
        this.active = false;
    }

    displayName0(): string {
        return "Farming";
    }
}
