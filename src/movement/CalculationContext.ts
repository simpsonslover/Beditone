import { settings } from "../Settings";
import type { BlockState } from "../world/BlockState";
import { BlockStateInterface, BetterWorldBorder, WorldAccess } from "../world/BlockStateInterface";
import { ToolSet } from "../world/ToolSet";
import { COST_INF, SWIM_ONE_BLOCK_COST, WALK_ONE_BLOCK_COST, WALK_ONE_IN_WATER_COST } from "./ActionCosts";
import { PrecomputedData } from "./PrecomputedData";
import type { IBaritone } from "../IBaritone";

export interface CalculationContextParams {
    world: WorldAccess;
    toolSet: ToolSet;
    hasThrowaway: boolean;
    hasWaterBucket: boolean;
    canSprint: boolean;
    frostWalker: number;
    waterSpeedMultiplier: number;
    baritone?: IBaritone | null;
}

export class CalculationContext {
    readonly baritone: IBaritone | null;
    readonly world: WorldAccess;
    readonly bsi: BlockStateInterface;
    readonly toolSet: ToolSet;
    readonly hasWaterBucket: boolean;
    readonly hasThrowaway: boolean;
    readonly canSprint: boolean;
    protected readonly placeBlockCost: number;
    readonly allowBreak: boolean;
    readonly allowBreakAnyway: string[];
    readonly allowParkour: boolean;
    readonly allowParkourPlace: boolean;
    readonly allowJumpAtBuildLimit: boolean;
    readonly allowParkourAscend: boolean;
    readonly assumeWalkOnWater: boolean;
    allowFallIntoLava: boolean;
    readonly frostWalker: number;
    readonly allowDiagonalDescend: boolean;
    readonly allowDiagonalAscend: boolean;
    readonly allowDownward: boolean;
    minFallHeight: number;
    maxFallHeightNoWater: number;
    readonly maxFallHeightBucket: number;
    readonly waterWalkSpeed: number;
    readonly breakBlockAdditionalCost: number;
    backtrackCostFavoringCoefficient: number;
    jumpPenalty: number;
    readonly walkOnWaterOnePenalty: number;
    readonly allowWalkOnMagmaBlocks: boolean;
    readonly worldBorder: BetterWorldBorder;
    readonly minY: number;
    readonly maxY: number;
    readonly precomputedData: PrecomputedData;
    miningCache: Map<number, number> | null = null;
    miningCacheFalling: Map<number, number> | null = null;
    private claimed = false;
    private lastFlush = Date.now();

    constructor(p: CalculationContextParams) {
        this.precomputedData = PrecomputedData.forCurrentSettings();
        this.baritone = p.baritone ?? null;
        this.world = p.world;
        this.bsi = new BlockStateInterface(p.world);
        this.toolSet = p.toolSet;
        this.hasThrowaway = p.hasThrowaway;
        this.hasWaterBucket = p.hasWaterBucket;
        this.canSprint = p.canSprint;
        this.minY = this.bsi.minY;
        this.maxY = this.bsi.maxY;
        this.placeBlockCost = settings.blockPlacementPenalty.value;
        this.allowBreak = settings.allowBreak.value;
        this.allowBreakAnyway = [...settings.allowBreakAnyway.value];
        this.allowParkour = settings.allowParkour.value;
        this.allowParkourPlace = settings.allowParkourPlace.value;
        this.allowJumpAtBuildLimit = settings.allowJumpAtBuildLimit.value;
        this.allowParkourAscend = settings.allowParkourAscend.value;
        this.assumeWalkOnWater = settings.assumeWalkOnWater.value;
        this.allowFallIntoLava = false;
        this.frostWalker = p.frostWalker;
        this.allowDiagonalDescend = settings.allowDiagonalDescend.value;
        this.allowDiagonalAscend = settings.allowDiagonalAscend.value;
        this.allowDownward = settings.allowDownward.value;
        this.minFallHeight = 3;
        this.maxFallHeightNoWater = settings.maxFallHeightNoWater.value;
        this.maxFallHeightBucket = settings.maxFallHeightBucket.value;
        let waterSpeed = WALK_ONE_IN_WATER_COST * (1 - p.waterSpeedMultiplier) + WALK_ONE_BLOCK_COST * p.waterSpeedMultiplier;
        if (settings.allowSwimming.value && this.canSprint) {
            waterSpeed = Math.min(waterSpeed, SWIM_ONE_BLOCK_COST);
        }
        this.waterWalkSpeed = waterSpeed;
        this.breakBlockAdditionalCost = settings.blockBreakAdditionalPenalty.value;
        this.backtrackCostFavoringCoefficient = settings.backtrackCostFavoringCoefficient.value;
        this.jumpPenalty = settings.jumpPenalty.value;
        this.walkOnWaterOnePenalty = settings.walkOnWaterOnePenalty.value;
        this.allowWalkOnMagmaBlocks = settings.allowWalkOnMagmaBlocks.value;
        this.worldBorder = this.bsi.worldBorder;
    }

    claimSearchCaches(): void {
        if (this.claimed) {
            return;
        }
        this.claimed = true;
        this.miningCache = new Map();
        this.miningCacheFalling = new Map();
        this.bsi.claimCache();
    }

    releaseSearchCaches(): void {
        if (!this.claimed) return;
        this.claimed = false;
        this.miningCache = null;
        this.miningCacheFalling = null;
        this.bsi.releaseCache();
    }

    onWorldTicked(): void {
        if (!this.claimed) return;
        const now = Date.now();
        if (now - this.lastFlush < 1000) return;
        this.lastFlush = now;
        this.miningCache = new Map();
        this.miningCacheFalling = new Map();
        this.bsi.claimCache();
    }

    getBaritone(): IBaritone | null {
        return this.baritone;
    }

    get(x: number, y: number, z: number): BlockState {
        return this.bsi.get0(x, y, z);
    }

    isLoaded(x: number, z: number): boolean {
        return this.bsi.isLoaded(x, z);
    }

    costOfPlacingAt(x: number, y: number, z: number, current: BlockState): number {
        if (!this.hasThrowaway) {
            return COST_INF;
        }
        if (this.isPossiblyProtected(x, y, z)) {
            return COST_INF;
        }
        if (!this.worldBorder.canPlaceAt(x, z)) {
            return COST_INF;
        }
        const isSource = current.hasFluid() && current.fluidAmount === 8 && Number(current.get("liquid_depth") ?? 0) === 0;
        if (!settings.allowPlaceInFluidsSource.value && isSource) {
            return COST_INF;
        }
        if (!settings.allowPlaceInFluidsFlow.value && current.hasFluid() && !isSource) {
            return COST_INF;
        }
        return this.placeBlockCost;
    }

    breakCostMultiplierAt(x: number, y: number, z: number, current: BlockState): number {
        if (!this.allowBreak && !this.allowBreakAnyway.includes(current.typeId)) {
            return COST_INF;
        }
        if (this.isPossiblyProtected(x, y, z)) {
            return COST_INF;
        }
        return 1;
    }

    placeBucketCost(): number {
        return this.placeBlockCost;
    }

    isPossiblyProtected(_x: number, _y: number, _z: number): boolean {
        return false;
    }
}
