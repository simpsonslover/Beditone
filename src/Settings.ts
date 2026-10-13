export type SettingType =
    | "boolean"
    | "int"
    | "long"
    | "float"
    | "double"
    | "string"
    | "color"
    | "vec3i"
    | "block[]"
    | "item[]"
    | "string[]"
    | "blockmap"
    | "rotation"
    | "mirror";

export interface Color {
    r: number;
    g: number;
    b: number;
}

export interface Vec3i {
    x: number;
    y: number;
    z: number;
}

const c = (r: number, g: number, b: number): Color => ({ r, g, b });
const Color_ = {
    RED: c(255, 0, 0),
    MAGENTA: c(255, 0, 255),
    GREEN: c(0, 255, 0),
    BLUE: c(0, 0, 255),
    CYAN: c(0, 255, 255),
    BLACK: c(0, 0, 0),
    ORANGE: c(255, 200, 0),
};

export class Setting<T> {
    value: T;
    readonly defaultValue: T;

    constructor(readonly name: string, readonly type: SettingType, value: T, readonly beditoneOnly = false) {
        this.value = clone(value);
        this.defaultValue = clone(value);
    }

    reset(): void {
        this.value = clone(this.defaultValue);
    }

    isModified(): boolean {
        return settingValueToString(this) !== settingDefaultToString(this);
    }
}

function clone<T>(v: T): T {
    if (Array.isArray(v)) return [...v] as unknown as T;
    if (v instanceof Map) return new Map(v) as unknown as T;
    if (v && typeof v === "object") return { ...(v as object) } as T;
    return v;
}

export function blockId(s: string): string {
    s = s.trim().toLowerCase();
    return s.includes(":") ? s : "minecraft:" + s;
}

export class Settings {
    readonly allSettings: Setting<any>[] = [];
    readonly byLowerName = new Map<string, Setting<any>>();

    private s<T>(name: string, type: SettingType, value: T, beditoneOnly = false): Setting<T> {
        const setting = new Setting<T>(name, type, value, beditoneOnly);
        this.allSettings.push(setting);
        this.byLowerName.set(name.toLowerCase(), setting);
        return setting;
    }

    readonly allowBreak = this.s("allowBreak", "boolean", true);
    readonly allowBreakAnyway = this.s<string[]>("allowBreakAnyway", "block[]", []);
    readonly allowSprint = this.s("allowSprint", "boolean", true);
    readonly allowPlace = this.s("allowPlace", "boolean", true);
    readonly allowPlaceInFluidsSource = this.s("allowPlaceInFluidsSource", "boolean", true);
    readonly allowPlaceInFluidsFlow = this.s("allowPlaceInFluidsFlow", "boolean", true);
    readonly allowInventory = this.s("allowInventory", "boolean", false);
    readonly ticksBetweenInventoryMoves = this.s("ticksBetweenInventoryMoves", "int", 1);
    readonly inventoryMoveOnlyIfStationary = this.s("inventoryMoveOnlyIfStationary", "boolean", false);
    readonly assumeExternalAutoTool = this.s("assumeExternalAutoTool", "boolean", false);
    readonly autoTool = this.s("autoTool", "boolean", true);
    readonly blockPlacementPenalty = this.s("blockPlacementPenalty", "double", 20);
    readonly blockBreakAdditionalPenalty = this.s("blockBreakAdditionalPenalty", "double", 2);
    readonly jumpPenalty = this.s("jumpPenalty", "double", 2);
    readonly walkOnWaterOnePenalty = this.s("walkOnWaterOnePenalty", "double", 3);
    readonly strictLiquidCheck = this.s("strictLiquidCheck", "boolean", false);
    readonly allowWaterBucketFall = this.s("allowWaterBucketFall", "boolean", true);
    readonly assumeWalkOnWater = this.s("assumeWalkOnWater", "boolean", false);
    readonly assumeWalkOnLava = this.s("assumeWalkOnLava", "boolean", false);
    readonly assumeStep = this.s("assumeStep", "boolean", false);
    readonly assumeSafeWalk = this.s("assumeSafeWalk", "boolean", false);
    readonly allowJumpAtBuildLimit = this.s("allowJumpAtBuildLimit", "boolean", false);
    readonly allowJumpAt256 = this.s("allowJumpAt256", "boolean", false);
    readonly allowParkourAscend = this.s("allowParkourAscend", "boolean", true);
    readonly allowDiagonalDescend = this.s("allowDiagonalDescend", "boolean", false);
    readonly allowDiagonalAscend = this.s("allowDiagonalAscend", "boolean", false);
    readonly allowDownward = this.s("allowDownward", "boolean", true);
    readonly acceptableThrowawayItems = this.s<string[]>("acceptableThrowawayItems", "item[]", [
        "minecraft:dirt",
        "minecraft:cobblestone",
        "minecraft:netherrack",
        "minecraft:stone",
    ]);
    readonly blocksToAvoid = this.s<string[]>("blocksToAvoid", "block[]", ["minecraft:trip_wire"]);
    readonly blocksToDisallowBreaking = this.s<string[]>("blocksToDisallowBreaking", "block[]", []);
    readonly blocksToAvoidBreaking = this.s<string[]>("blocksToAvoidBreaking", "block[]", [
        "minecraft:crafting_table",
        "minecraft:furnace",
        "minecraft:lit_furnace",
        "minecraft:chest",
        "minecraft:trapped_chest",
    ]);
    readonly avoidBreakingMultiplier = this.s("avoidBreakingMultiplier", "double", 0.1);
    readonly buildIgnoreBlocks = this.s<string[]>("buildIgnoreBlocks", "block[]", []);
    readonly buildSkipBlocks = this.s<string[]>("buildSkipBlocks", "block[]", []);
    readonly buildValidSubstitutes = this.s<Map<string, string[]>>("buildValidSubstitutes", "blockmap", new Map());
    readonly buildSubstitutes = this.s<Map<string, string[]>>("buildSubstitutes", "blockmap", new Map());
    readonly okIfAir = this.s<string[]>("okIfAir", "block[]", []);
    readonly buildIgnoreExisting = this.s("buildIgnoreExisting", "boolean", false);
    readonly buildIgnoreDirection = this.s("buildIgnoreDirection", "boolean", false);
    readonly buildIgnoreProperties = this.s<string[]>("buildIgnoreProperties", "string[]", []);
    readonly avoidUpdatingFallingBlocks = this.s("avoidUpdatingFallingBlocks", "boolean", true);
    readonly allowVines = this.s("allowVines", "boolean", false);
    readonly allowWalkOnBottomSlab = this.s("allowWalkOnBottomSlab", "boolean", true);
    readonly allowParkour = this.s("allowParkour", "boolean", false);
    readonly allowParkourPlace = this.s("allowParkourPlace", "boolean", false);
    readonly considerPotionEffects = this.s("considerPotionEffects", "boolean", true);
    readonly sprintAscends = this.s("sprintAscends", "boolean", true);
    readonly headHitters = this.s("headHitters", "boolean", false);
    readonly headHittersDiagonal = this.s("headHittersDiagonal", "boolean", true);
    readonly sprintJumping = this.s("sprintJumping", "boolean", false);
    readonly sprintJumpingDiagonals = this.s("sprintJumpingDiagonals", "boolean", true);
    readonly overshootTraverse = this.s("overshootTraverse", "boolean", true);
    readonly pauseMiningForFallingBlocks = this.s("pauseMiningForFallingBlocks", "boolean", true);
    readonly rightClickSpeed = this.s("rightClickSpeed", "int", 4);
    readonly randomLooking113 = this.s("randomLooking113", "double", 2);
    readonly blockReachDistance = this.s("blockReachDistance", "float", 4.5);
    readonly blockBreakSpeed = this.s("blockBreakSpeed", "int", 6);
    readonly randomLooking = this.s("randomLooking", "double", 0.01);
    readonly costHeuristic = this.s("costHeuristic", "double", 3.563);
    readonly pathingMaxChunkBorderFetch = this.s("pathingMaxChunkBorderFetch", "int", 50);
    readonly backtrackCostFavoringCoefficient = this.s("backtrackCostFavoringCoefficient", "double", 0.5);
    readonly avoidance = this.s("avoidance", "boolean", false);
    readonly mobSpawnerAvoidanceCoefficient = this.s("mobSpawnerAvoidanceCoefficient", "double", 2.0);
    readonly mobSpawnerAvoidanceRadius = this.s("mobSpawnerAvoidanceRadius", "int", 16);
    readonly mobAvoidanceCoefficient = this.s("mobAvoidanceCoefficient", "double", 1.5);
    readonly mobAvoidanceRadius = this.s("mobAvoidanceRadius", "int", 8);
    readonly rightClickContainerOnArrival = this.s("rightClickContainerOnArrival", "boolean", true);
    readonly enterPortal = this.s("enterPortal", "boolean", true);
    readonly minimumImprovementRepropagation = this.s("minimumImprovementRepropagation", "boolean", true);
    readonly cutoffAtLoadBoundary = this.s("cutoffAtLoadBoundary", "boolean", false);
    readonly maxCostIncrease = this.s("maxCostIncrease", "double", 10);
    readonly costVerificationLookahead = this.s("costVerificationLookahead", "int", 5);
    readonly pathCutoffFactor = this.s("pathCutoffFactor", "double", 0.9);
    readonly pathCutoffMinimumLength = this.s("pathCutoffMinimumLength", "int", 30);
    readonly planningTickLookahead = this.s("planningTickLookahead", "int", 150);
    readonly pathingMapDefaultSize = this.s("pathingMapDefaultSize", "int", 1024);
    readonly pathingMapLoadFactor = this.s("pathingMapLoadFactor", "float", 0.75);
    readonly maxFallHeightNoWater = this.s("maxFallHeightNoWater", "int", 3);
    readonly maxFallHeightBucket = this.s("maxFallHeightBucket", "int", 20);
    readonly allowOvershootDiagonalDescend = this.s("allowOvershootDiagonalDescend", "boolean", true);
    readonly simplifyUnloadedYCoord = this.s("simplifyUnloadedYCoord", "boolean", true);
    readonly repackOnAnyBlockChange = this.s("repackOnAnyBlockChange", "boolean", true);
    readonly movementTimeoutTicks = this.s("movementTimeoutTicks", "int", 100);
    readonly primaryTimeoutMS = this.s("primaryTimeoutMS", "long", 500);
    readonly failureTimeoutMS = this.s("failureTimeoutMS", "long", 2000);
    readonly planAheadPrimaryTimeoutMS = this.s("planAheadPrimaryTimeoutMS", "long", 4000);
    readonly planAheadFailureTimeoutMS = this.s("planAheadFailureTimeoutMS", "long", 5000);
    readonly slowPath = this.s("slowPath", "boolean", false);
    readonly slowPathTimeDelayMS = this.s("slowPathTimeDelayMS", "long", 100);
    readonly slowPathTimeoutMS = this.s("slowPathTimeoutMS", "long", 40000);
    readonly doBedWaypoints = this.s("doBedWaypoints", "boolean", true);
    readonly doDeathWaypoints = this.s("doDeathWaypoints", "boolean", true);
    readonly chunkCaching = this.s("chunkCaching", "boolean", true);
    readonly pruneRegionsFromRAM = this.s("pruneRegionsFromRAM", "boolean", true);
    readonly chunkPackerQueueMaxSize = this.s("chunkPackerQueueMaxSize", "int", 2000);
    readonly backfill = this.s("backfill", "boolean", false);
    readonly logAsToast = this.s("logAsToast", "boolean", false);
    readonly chatDebug = this.s("chatDebug", "boolean", false);
    readonly chatControl = this.s("chatControl", "boolean", true);
    readonly chatControlAnyway = this.s("chatControlAnyway", "boolean", false);
    readonly renderPath = this.s("renderPath", "boolean", true);
    readonly renderPathAsLine = this.s("renderPathAsLine", "boolean", false);
    readonly renderGoal = this.s("renderGoal", "boolean", true);
    readonly renderGoalAnimated = this.s("renderGoalAnimated", "boolean", true);
    readonly renderSelectionBoxes = this.s("renderSelectionBoxes", "boolean", true);
    readonly renderGoalIgnoreDepth = this.s("renderGoalIgnoreDepth", "boolean", true);
    readonly renderGoalXZBeacon = this.s("renderGoalXZBeacon", "boolean", false);
    readonly renderSelectionBoxesIgnoreDepth = this.s("renderSelectionBoxesIgnoreDepth", "boolean", true);
    readonly renderPathIgnoreDepth = this.s("renderPathIgnoreDepth", "boolean", true);
    readonly pathRenderLineWidthPixels = this.s("pathRenderLineWidthPixels", "float", 5);
    readonly goalRenderLineWidthPixels = this.s("goalRenderLineWidthPixels", "float", 3);
    readonly fadePath = this.s("fadePath", "boolean", false);
    readonly freeLook = this.s("freeLook", "boolean", true);
    readonly blockFreeLook = this.s("blockFreeLook", "boolean", false);
    readonly elytraFreeLook = this.s("elytraFreeLook", "boolean", true);
    readonly smoothLook = this.s("smoothLook", "boolean", false);
    readonly elytraSmoothLook = this.s("elytraSmoothLook", "boolean", false);
    readonly smoothLookTicks = this.s("smoothLookTicks", "int", 5);
    readonly remainWithExistingLookDirection = this.s("remainWithExistingLookDirection", "boolean", true);
    readonly antiCheatCompatibility = this.s("antiCheatCompatibility", "boolean", true);
    readonly pathThroughCachedOnly = this.s("pathThroughCachedOnly", "boolean", false);
    readonly sprintInWater = this.s("sprintInWater", "boolean", true);
    readonly allowSwimming = this.s("allowSwimming", "boolean", false);
    readonly blacklistClosestOnFailure = this.s("blacklistClosestOnFailure", "boolean", true);
    readonly renderCachedChunks = this.s("renderCachedChunks", "boolean", false);
    readonly cachedChunksOpacity = this.s("cachedChunksOpacity", "float", 0.5);
    readonly prefixControl = this.s("prefixControl", "boolean", true);
    readonly prefix = this.s("prefix", "string", "#");
    readonly shortBaritonePrefix = this.s("shortBaritonePrefix", "boolean", false);
    readonly useMessageTag = this.s("useMessageTag", "boolean", false);
    readonly echoCommands = this.s("echoCommands", "boolean", true);
    readonly censorCoordinates = this.s("censorCoordinates", "boolean", false);
    readonly censorRanCommands = this.s("censorRanCommands", "boolean", false);
    readonly itemSaver = this.s("itemSaver", "boolean", false);
    readonly itemSaverThreshold = this.s("itemSaverThreshold", "int", 10);
    readonly preferSilkTouch = this.s("preferSilkTouch", "boolean", false);
    readonly walkWhileBreaking = this.s("walkWhileBreaking", "boolean", true);
    readonly splicePath = this.s("splicePath", "boolean", true);
    readonly maxPathHistoryLength = this.s("maxPathHistoryLength", "int", 300);
    readonly pathHistoryCutoffAmount = this.s("pathHistoryCutoffAmount", "int", 50);
    readonly mineGoalUpdateInterval = this.s("mineGoalUpdateInterval", "int", 5);
    readonly maxCachedWorldScanCount = this.s("maxCachedWorldScanCount", "int", 10);
    readonly mineMaxOreLocationsCount = this.s("mineMaxOreLocationsCount", "int", 64);
    readonly minYLevelWhileMining = this.s("minYLevelWhileMining", "int", 0);
    readonly maxYLevelWhileMining = this.s("maxYLevelWhileMining", "int", 2031);
    readonly allowOnlyExposedOres = this.s("allowOnlyExposedOres", "boolean", false);
    readonly allowOnlyExposedOresDistance = this.s("allowOnlyExposedOresDistance", "int", 1);
    readonly exploreForBlocks = this.s("exploreForBlocks", "boolean", true);
    readonly worldExploringChunkOffset = this.s("worldExploringChunkOffset", "int", 0);
    readonly exploreChunkSetMinimumSize = this.s("exploreChunkSetMinimumSize", "int", 10);
    readonly exploreMaintainY = this.s("exploreMaintainY", "int", 64);
    readonly replantCrops = this.s("replantCrops", "boolean", true);
    readonly replantNetherWart = this.s("replantNetherWart", "boolean", false);
    readonly farmMaxScanSize = this.s("farmMaxScanSize", "int", 256);
    readonly farmWaitForGrowth = this.s("farmWaitForGrowth", "boolean", false);
    readonly extendCacheOnThreshold = this.s("extendCacheOnThreshold", "boolean", false);
    readonly buildInLayers = this.s("buildInLayers", "boolean", false);
    readonly layerOrder = this.s("layerOrder", "boolean", false);
    readonly layerHeight = this.s("layerHeight", "int", 1);
    readonly startAtLayer = this.s("startAtLayer", "int", 0);
    readonly skipFailedLayers = this.s("skipFailedLayers", "boolean", false);
    readonly buildOnlySelection = this.s("buildOnlySelection", "boolean", false);
    readonly buildRepeat = this.s<Vec3i>("buildRepeat", "vec3i", { x: 0, y: 0, z: 0 });
    readonly buildRepeatCount = this.s("buildRepeatCount", "int", -1);
    readonly buildRepeatSneaky = this.s("buildRepeatSneaky", "boolean", true);
    readonly breakFromAbove = this.s("breakFromAbove", "boolean", false);
    readonly goalBreakFromAbove = this.s("goalBreakFromAbove", "boolean", false);
    readonly mapArtMode = this.s("mapArtMode", "boolean", false);
    readonly okIfWater = this.s("okIfWater", "boolean", false);
    readonly incorrectSize = this.s("incorrectSize", "int", 100);
    readonly breakCorrectBlockPenaltyMultiplier = this.s("breakCorrectBlockPenaltyMultiplier", "double", 10);
    readonly placeIncorrectBlockPenaltyMultiplier = this.s("placeIncorrectBlockPenaltyMultiplier", "double", 2);
    readonly schematicOrientationX = this.s("schematicOrientationX", "boolean", false);
    readonly schematicOrientationY = this.s("schematicOrientationY", "boolean", false);
    readonly schematicOrientationZ = this.s("schematicOrientationZ", "boolean", false);
    readonly buildSchematicRotation = this.s("buildSchematicRotation", "rotation", "NONE");
    readonly buildSchematicMirror = this.s("buildSchematicMirror", "mirror", "NONE");
    readonly schematicFallbackExtension = this.s("schematicFallbackExtension", "string", "schematic");
    readonly builderTickScanRadius = this.s("builderTickScanRadius", "int", 5);
    readonly mineScanDroppedItems = this.s("mineScanDroppedItems", "boolean", true);
    readonly mineDropLoiterDurationMSThanksLouca = this.s("mineDropLoiterDurationMSThanksLouca", "long", 250);
    readonly distanceTrim = this.s("distanceTrim", "boolean", true);
    readonly cancelOnGoalInvalidation = this.s("cancelOnGoalInvalidation", "boolean", true);
    readonly axisHeight = this.s("axisHeight", "int", 120);
    readonly disconnectOnArrival = this.s("disconnectOnArrival", "boolean", false);
    readonly legitMine = this.s("legitMine", "boolean", false);
    readonly legitMineYLevel = this.s("legitMineYLevel", "int", -59);
    readonly legitMineIncludeDiagonals = this.s("legitMineIncludeDiagonals", "boolean", false);
    readonly forceInternalMining = this.s("forceInternalMining", "boolean", true);
    readonly internalMiningAirException = this.s("internalMiningAirException", "boolean", true);
    readonly followOffsetDistance = this.s("followOffsetDistance", "double", 0);
    readonly followOffsetDirection = this.s("followOffsetDirection", "float", 0);
    readonly followRadius = this.s("followRadius", "int", 3);
    readonly followTargetMaxDistance = this.s("followTargetMaxDistance", "int", 0);
    readonly disableCompletionCheck = this.s("disableCompletionCheck", "boolean", false);
    readonly cachedChunksExpirySeconds = this.s("cachedChunksExpirySeconds", "long", -1);
    readonly verboseCommandExceptions = this.s("verboseCommandExceptions", "boolean", false);
    readonly yLevelBoxSize = this.s("yLevelBoxSize", "double", 15);
    readonly colorCurrentPath = this.s("colorCurrentPath", "color", Color_.RED);
    readonly colorNextPath = this.s("colorNextPath", "color", Color_.MAGENTA);
    readonly colorBlocksToBreak = this.s("colorBlocksToBreak", "color", Color_.RED);
    readonly colorBlocksToPlace = this.s("colorBlocksToPlace", "color", Color_.GREEN);
    readonly colorBlocksToWalkInto = this.s("colorBlocksToWalkInto", "color", Color_.MAGENTA);
    readonly colorBestPathSoFar = this.s("colorBestPathSoFar", "color", Color_.BLUE);
    readonly colorMostRecentConsidered = this.s("colorMostRecentConsidered", "color", Color_.CYAN);
    readonly colorGoalBox = this.s("colorGoalBox", "color", Color_.GREEN);
    readonly colorInvertedGoalBox = this.s("colorInvertedGoalBox", "color", Color_.RED);
    readonly colorSelection = this.s("colorSelection", "color", Color_.CYAN);
    readonly colorSelectionPos1 = this.s("colorSelectionPos1", "color", Color_.BLACK);
    readonly colorSelectionPos2 = this.s("colorSelectionPos2", "color", Color_.ORANGE);
    readonly selectionOpacity = this.s("selectionOpacity", "float", 0.5);
    readonly selectionLineWidth = this.s("selectionLineWidth", "float", 2);
    readonly renderSelection = this.s("renderSelection", "boolean", true);
    readonly renderSelectionIgnoreDepth = this.s("renderSelectionIgnoreDepth", "boolean", true);
    readonly renderSelectionCorners = this.s("renderSelectionCorners", "boolean", true);
    readonly useSwordToMine = this.s("useSwordToMine", "boolean", true);
    readonly desktopNotifications = this.s("desktopNotifications", "boolean", false);
    readonly notificationOnPathComplete = this.s("notificationOnPathComplete", "boolean", true);
    readonly notificationOnFarmFail = this.s("notificationOnFarmFail", "boolean", true);
    readonly notificationOnBuildFinished = this.s("notificationOnBuildFinished", "boolean", true);
    readonly notificationOnExploreFinished = this.s("notificationOnExploreFinished", "boolean", true);
    readonly notificationOnMineFail = this.s("notificationOnMineFail", "boolean", true);
    readonly elytraSimulationTicks = this.s("elytraSimulationTicks", "int", 20);
    readonly elytraPitchRange = this.s("elytraPitchRange", "int", 25);
    readonly elytraFireworkSpeed = this.s("elytraFireworkSpeed", "double", 1.2);
    readonly elytraFireworkSetbackUseDelay = this.s("elytraFireworkSetbackUseDelay", "int", 15);
    readonly elytraMinimumAvoidance = this.s("elytraMinimumAvoidance", "double", 0.2);
    readonly elytraConserveFireworks = this.s("elytraConserveFireworks", "boolean", false);
    readonly elytraRenderRaytraces = this.s("elytraRenderRaytraces", "boolean", false);
    readonly elytraRenderHitboxRaytraces = this.s("elytraRenderHitboxRaytraces", "boolean", false);
    readonly elytraRenderSimulation = this.s("elytraRenderSimulation", "boolean", true);
    readonly elytraAutoJump = this.s("elytraAutoJump", "boolean", false);
    readonly elytraNetherSeed = this.s("elytraNetherSeed", "long", 146008555100680);
    readonly elytraPredictTerrain = this.s("elytraPredictTerrain", "boolean", false);
    readonly elytraAutoSwap = this.s("elytraAutoSwap", "boolean", true);
    readonly elytraMinimumDurability = this.s("elytraMinimumDurability", "int", 5);
    readonly elytraMinFireworksBeforeLanding = this.s("elytraMinFireworksBeforeLanding", "int", 5);
    readonly elytraAllowEmergencyLand = this.s("elytraAllowEmergencyLand", "boolean", true);
    readonly elytraTimeBetweenCacheCullSecs = this.s("elytraTimeBetweenCacheCullSecs", "long", 180);
    readonly elytraCacheCullDistance = this.s("elytraCacheCullDistance", "int", 5000);
    readonly elytraAllowLandOnNetherFortress = this.s("elytraAllowLandOnNetherFortress", "boolean", false);
    readonly elytraTermsAccepted = this.s("elytraTermsAccepted", "boolean", false);
    readonly elytraChatSpam = this.s("elytraChatSpam", "boolean", false);
    readonly elytraAllowTightSpaces = this.s("elytraAllowTightSpaces", "boolean", false);
    readonly elytraAllowAboveRoof = this.s("elytraAllowAboveRoof", "boolean", false);
    readonly elytraUseCache = this.s("elytraUseCache", "boolean", true);
    readonly elytraAllowAboveBuildLimit = this.s("elytraAllowAboveBuildLimit", "boolean", true);
    readonly elytraLongDistanceThreshold = this.s("elytraLongDistanceThreshold", "int", 500);
    readonly allowWalkOnMagmaBlocks = this.s("allowWalkOnMagmaBlocks", "boolean", false);

    readonly controlMode = this.s("controlMode", "string", "player", true);
    readonly starterKit = this.s("starterKit", "boolean", true, true);
    readonly starterKitItems = this.s<string[]>(
        "starterKitItems",
        "string[]",
        ["minecraft:iron_pickaxe*1", "minecraft:iron_axe*1", "minecraft:iron_shovel*1", "minecraft:cobblestone*64", "minecraft:dirt*64", "minecraft:water_bucket*1"],
        true,
    );
    readonly botName = this.s("botName", "string", "Beditone", true);
    readonly renderIntervalTicks = this.s("renderIntervalTicks", "int", 5, true);
    readonly renderMaxParticles = this.s("renderMaxParticles", "int", 600, true);
    readonly pathingWallClockCapMS = this.s("pathingWallClockCapMS", "long", 30000, true);
    readonly searchTimeMultiplier = this.s("searchTimeMultiplier", "double", 5, true);
    readonly proxyPredictMotion = this.s("proxyPredictMotion", "boolean", true, true);
    readonly proxyCatchUp = this.s("proxyCatchUp", "double", 0.2, true);
    readonly proxyMotionTick = this.s("proxyMotionTick", "string", "next", true);
    readonly proxyCameraWhenNeeded = this.s("proxyCameraWhenNeeded", "boolean", true, true);
    readonly proxyCameraPacket = this.s("proxyCameraPacket", "string", "rotation", true);
    readonly exploreSeenRadius = this.s("exploreSeenRadius", "int", 4, true);
}

export const settings = new Settings();

export function settingValueToString(setting: Setting<any>, value: any = setting.value): string {
    switch (setting.type) {
        case "color":
            return `${value.r},${value.g},${value.b}`;
        case "vec3i":
            return `${value.x},${value.y},${value.z}`;
        case "block[]":
        case "item[]":
        case "string[]":
            return (value as string[]).join(",");
        case "blockmap":
            return [...(value as Map<string, string[]>).entries()].map(([k, v]) => `${k}->${v.join(",")}`).join(",");
        default:
            return String(value);
    }
}

export function settingDefaultToString(setting: Setting<any>): string {
    return settingValueToString(setting, setting.defaultValue);
}

export function settingTypeToString(setting: Setting<any>): string {
    return setting.type;
}

function parseIntStrict(s: string): number {
    if (!/^[+-]?\d+$/.test(s.trim())) throw new Error(`not an integer: ${s}`);
    return parseInt(s, 10);
}

function parseNum(s: string): number {
    const n = Number(s.trim());
    if (!Number.isFinite(n) || s.trim() === "") throw new Error(`not a number: ${s}`);
    return n;
}

export function parseSettingValue(setting: Setting<any>, raw: string): any {
    switch (setting.type) {
        case "boolean":
            return raw.trim().toLowerCase() === "true";
        case "int":
        case "long":
            return parseIntStrict(raw);
        case "float":
        case "double":
            return parseNum(raw);
        case "string":
            return raw;
        case "color": {
            const p = raw.split(",").map(parseIntStrict);
            return { r: p[0], g: p[1], b: p[2] };
        }
        case "vec3i": {
            const p = raw.split(",").map(parseIntStrict);
            return { x: p[0], y: p[1], z: p[2] };
        }
        case "block[]":
        case "item[]":
            return raw.split(",").filter((s) => s.trim() !== "").map(blockId);
        case "string[]":
            return raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
        case "blockmap": {
            const m = new Map<string, string[]>();
            for (const part of raw.split(/,(?=[^,]*->)/)) {
                const [k, v] = part.split("->");
                m.set(blockId(k), v.split(",").map(blockId));
            }
            return m;
        }
        case "rotation": {
            const v = raw.trim().toUpperCase();
            if (!["NONE", "CLOCKWISE_90", "CLOCKWISE_180", "COUNTERCLOCKWISE_90"].includes(v)) throw new Error("bad rotation " + raw);
            return v;
        }
        case "mirror": {
            const v = raw.trim().toUpperCase();
            if (!["NONE", "LEFT_RIGHT", "FRONT_BACK"].includes(v)) throw new Error("bad mirror " + raw);
            return v;
        }
    }
}

export function parseAndApply(s: Settings, settingName: string, raw: string): void {
    const setting = s.byLowerName.get(settingName.toLowerCase());
    if (!setting) throw new Error(`No setting called ${settingName}`);
    setting.value = parseSettingValue(setting, raw);
}

export function modifiedSettings(s: Settings): Setting<any>[] {
    return s.allSettings.filter((x) => x.isModified());
}

export function serializeModified(s: Settings): string {
    return modifiedSettings(s)
        .map((x) => `${x.name} ${settingValueToString(x)}`)
        .join("\n");
}

export function readAndApply(s: Settings, text: string): void {
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
        const idx = trimmed.indexOf(" ");
        const name = idx === -1 ? trimmed : trimmed.substring(0, idx);
        const value = idx === -1 ? "" : trimmed.substring(idx + 1);
        try {
            parseAndApply(s, name, value);
        } catch {
        }
    }
}

export function maybeCensor(coord: number): string {
    if (settings.censorCoordinates.value) return "<censored>";
    return String(coord);
}
