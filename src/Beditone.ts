import { settings } from "./Settings";
import type { IBaritone } from "./IBaritone";
import { LookBehavior } from "./behavior/LookBehavior";
import { InventoryBehavior } from "./behavior/InventoryBehavior";
import { JobRunner, PathingBehavior } from "./behavior/PathingBehavior";
import { InputOverrideHandler } from "./input/InputOverrideHandler";
import { PathingControlManager } from "./process/PathingControlManager";
import { CustomGoalProcess } from "./process/CustomGoalProcess";
import { MineProcess } from "./process/MineProcess";
import { FollowProcess } from "./process/FollowProcess";
import { GetToBlockProcess } from "./process/GetToBlockProcess";
import { ExploreProcess } from "./process/ExploreProcess";
import { FarmProcess } from "./process/FarmProcess";
import { BuilderProcess } from "./process/BuilderProcess";
import { BackfillProcess } from "./process/BackfillProcess";
import { InventoryPauserProcess } from "./process/InventoryPauserProcess";
import { SelectionManager } from "./selection/SelectionManager";
import { CommandManager, ExampleBaritoneControl } from "./commands/CommandManager";
import { Storage, WaypointTag, Waypoint, WorldData } from "./cache/WorldData";
import { CalculationContext, CalculationContextParams } from "./movement/CalculationContext";
import { ToolSet } from "./world/ToolSet";
import { Blocks } from "./world/Blocks";
import type { BlockScanner } from "./world/WorldScanner";
import type { IStaticSchematic } from "./schematic/Schematic";
import type { BetterBlockPos } from "./utils/BetterBlockPos";
import type { IPlayerContext } from "./utils/IPlayerContext";

export interface BeditoneHost {
    ctx: IPlayerContext;
    runJob: JobRunner;
    scanner: BlockScanner;
    storage: Storage;
    ownerKey: string;
    send(message: string): void;
    notify(message: string, error: boolean): void;
    loadStructure(name: string): IStaticSchematic | null;
    saveSettings(): void;
    loadSettings(): void;
    viewerLookingAt(): BetterBlockPos | null;
    botCommand(action: string): void;
}

export class Beditone implements IBaritone {
    private readonly ctx: IPlayerContext;
    private readonly lookBehavior: LookBehavior;
    private readonly pathingBehavior: PathingBehavior;
    private readonly inventoryBehavior: InventoryBehavior;
    private readonly inputOverrideHandler: InputOverrideHandler;
    private readonly pathingControlManager: PathingControlManager;
    private readonly followProcess: FollowProcess;
    private readonly mineProcess: MineProcess;
    private readonly customGoalProcess: CustomGoalProcess;
    private readonly getToBlockProcess: GetToBlockProcess;
    private readonly builderProcess: BuilderProcess;
    private readonly exploreProcess: ExploreProcess;
    private readonly farmProcess: FarmProcess;
    private readonly inventoryPauserProcess: InventoryPauserProcess;
    private readonly backfillProcess: BackfillProcess;
    private readonly selectionManager: SelectionManager;
    private readonly commandManager: CommandManager;
    private readonly control: ExampleBaritoneControl;
    private readonly worldData = new Map<string, WorldData>();
    private ticks = 0;

    constructor(private readonly host: BeditoneHost) {
        this.ctx = host.ctx;
        this.lookBehavior = new LookBehavior(this);
        this.pathingBehavior = new PathingBehavior(this, host.runJob);
        this.inventoryBehavior = new InventoryBehavior(this);
        this.inputOverrideHandler = new InputOverrideHandler(this);
        this.pathingControlManager = new PathingControlManager(this);
        this.followProcess = this.registerProcess(new FollowProcess(this));
        this.mineProcess = this.registerProcess(new MineProcess(this));
        this.customGoalProcess = this.registerProcess(new CustomGoalProcess(this));
        this.getToBlockProcess = this.registerProcess(new GetToBlockProcess(this));
        this.builderProcess = this.registerProcess(new BuilderProcess(this));
        this.exploreProcess = this.registerProcess(new ExploreProcess(this));
        this.farmProcess = this.registerProcess(new FarmProcess(this));
        this.inventoryPauserProcess = this.registerProcess(new InventoryPauserProcess(this));
        this.backfillProcess = this.registerProcess(new BackfillProcess(this));
        this.selectionManager = new SelectionManager();
        this.commandManager = new CommandManager(this);
        this.commandManager.init();
        this.control = new ExampleBaritoneControl(this, this.commandManager);
    }

    private registerProcess<T extends import("./process/PathingCommand").BaritoneProcess>(p: T): T {
        this.pathingControlManager.registerProcess(p);
        return p;
    }

    tick(): void {
        this.ticks++;
        this.lookBehavior.onTick();
        this.pathingBehavior.onTick();
        this.inventoryBehavior.onTick();
        this.inputOverrideHandler.onTick();
        this.pathingControlManager.postTick();
        this.lookBehavior.onPlayerUpdate();
        this.inputOverrideHandler.applyMovement();
        if (this.ticks % 20 === 0) {
            this.markExplored();
        }
    }

    tickOut(): void {
        this.pathingBehavior.onTickOut();
    }

    onDeath(): void {
        if (!settings.doDeathWaypoints.value) return;
        const w = new Waypoint("death", WaypointTag.DEATH, this.ctx.playerFeet());
        this.getWorldData().getWaypoints().addWaypoint(w);
        this.logDirect(`Death position saved. ${settings.prefix.value}wp goto death @ ${w.creationTimestamp}`);
    }

    onBlockInteract(pos: BetterBlockPos): void {
        if (!settings.doBedWaypoints.value) return;
        const state = this.ctx.bsi().get(pos);
        if (!Blocks.isBed(state)) return;
        const wps = this.getWorldData().getWaypoints();
        if (!wps.getByTag(WaypointTag.BED).some((w) => w.location.equals(pos))) {
            wps.addWaypoint(new Waypoint("bed", WaypointTag.BED, pos));
        }
    }

    private markExplored(): void {
        const feet = this.ctx.playerFeet();
        const r = settings.exploreSeenRadius.value;
        const explored = this.getWorldData().explored;
        const world = this.ctx.world();
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                const cx = (feet.x >> 4) + dx;
                const cz = (feet.z >> 4) + dz;
                if (world.isLoaded(cx << 4, cz << 4)) explored.mark(cx, cz);
            }
        }
    }

    onChat(message: string): boolean {
        return this.control.onSendChatMessage(message);
    }

    getPlayerContext(): IPlayerContext {
        return this.ctx;
    }

    getPathingBehavior(): PathingBehavior {
        return this.pathingBehavior;
    }

    getLookBehavior(): LookBehavior {
        return this.lookBehavior;
    }

    getInventoryBehavior(): InventoryBehavior {
        return this.inventoryBehavior;
    }

    getInputOverrideHandler(): InputOverrideHandler {
        return this.inputOverrideHandler;
    }

    getPathingControlManager(): PathingControlManager {
        return this.pathingControlManager;
    }

    getCustomGoalProcess(): CustomGoalProcess {
        return this.customGoalProcess;
    }

    getMineProcess(): MineProcess {
        return this.mineProcess;
    }

    getFollowProcess(): FollowProcess {
        return this.followProcess;
    }

    getGetToBlockProcess(): GetToBlockProcess {
        return this.getToBlockProcess;
    }

    getExploreProcess(): ExploreProcess {
        return this.exploreProcess;
    }

    getFarmProcess(): FarmProcess {
        return this.farmProcess;
    }

    getBuilderProcess(): BuilderProcess {
        return this.builderProcess;
    }

    getBackfillProcess(): BackfillProcess {
        return this.backfillProcess;
    }

    getInventoryPauserProcess(): InventoryPauserProcess {
        return this.inventoryPauserProcess;
    }

    getSelectionManager(): SelectionManager {
        return this.selectionManager;
    }

    getCommandManager(): CommandManager {
        return this.commandManager;
    }

    getWorldData(): WorldData {
        const dim = this.ctx.world().dimensionId;
        let wd = this.worldData.get(dim);
        if (!wd) {
            wd = new WorldData(this.host.storage, this.host.ownerKey, dim);
            this.worldData.set(dim, wd);
        }
        return wd;
    }

    calculationContextParams(): CalculationContextParams {
        const p = this.ctx.player();
        const items = p.inventory().items;
        const hotbar = items.slice(0, 9);
        const hasWaterBucket =
            settings.allowWaterBucketFall.value && hotbar.some((i) => i && i.typeId === "minecraft:water_bucket" && i.amount > 0) && this.ctx.world().dimensionId !== "minecraft:nether";
        const depthStrider = p.armorEnchantmentLevel("depth_strider");
        return {
            world: this.ctx.world(),
            toolSet: new ToolSet(hotbar, (e) => p.effectAmplifier(e)),
            hasThrowaway: settings.allowPlace.value && this.inventoryBehavior.hasGenericThrowaway(),
            hasWaterBucket,
            canSprint: settings.allowSprint.value && p.foodLevel() > 6,
            frostWalker: p.armorEnchantmentLevel("frost_walker"),
            waterSpeedMultiplier: Math.min(1, depthStrider / 3),
            baritone: this,
        };
    }

    newCalculationContext(): CalculationContext {
        return new CalculationContext(this.calculationContextParams());
    }

    runJob(job: Generator<void, void, void>): void {
        this.host.runJob(job);
    }

    getBlockScanner(): BlockScanner {
        return this.host.scanner;
    }

    loadStructure(name: string): IStaticSchematic | null {
        return this.host.loadStructure(name);
    }

    saveSettings(): void {
        this.host.saveSettings();
    }

    loadSettings(): void {
        this.host.loadSettings();
    }

    viewerLookingAt(): BetterBlockPos | null {
        return this.host.viewerLookingAt();
    }

    botCommand(action: string): void {
        this.host.botCommand(action);
    }

    logDirect(message: string, color = ""): void {
        const prefix = settings.shortBaritonePrefix.value ? "§5B§r" : "§d[§5Beditone§d]§r";
        this.host.send(`${prefix} ${color}${message}`);
    }

    logDebug(message: string): void {
        if (!settings.chatDebug.value) {
            return;
        }
        this.logDirect(message, "§7");
    }

    logNotification(message: string, error: boolean): void {
        if (settings.desktopNotifications.value) {
            this.host.notify(message, error);
        }
    }
}
