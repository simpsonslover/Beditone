import { GameMode, InputPermissionCategory, ItemStack, MolangVariableMap, Player, system, world } from "@minecraft/server";
import { spawnSimulatedPlayer, SimulatedPlayer } from "@minecraft/server-gametest";
import { Beditone } from "./Beditone";
import { settings, serializeModified, readAndApply } from "./Settings";
import { BedrockPlayerContext } from "./bedrock/BedrockPlayerContext";
import { RealPlayerContext } from "./bedrock/RealPlayerContext";
import { PathingCommandType } from "./process/PathingCommand";
import { PATH_PARTICLE, ParticleSink, PathRenderer } from "./render/PathRenderer";
import type { Storage } from "./cache/WorldData";
import { CommandManager } from "./commands/CommandManager";
import { StaticSchematic } from "./schematic/Schematic";
import { AIR, BlockState } from "./world/BlockState";
import { BetterBlockPos } from "./utils/BetterBlockPos";
import { BEDITONE_VERSION } from "./version";

const SETTINGS_KEY = "beditone:settings";
const CONSOLE_ID = "beditone-console";
const MAX_PROPERTY = 32000;

const storage: Storage = {
    load(key) {
        const v = world.getDynamicProperty(key);
        return typeof v === "string" ? v : undefined;
    },
    save(key, value) {
        if (value.length > MAX_PROPERTY) {
            console.warn(`[Beditone] ${key} is too large to save (${value.length} chars)`);
            return;
        }
        world.setDynamicProperty(key, value);
    },
};

function saveSettings(): void {
    storage.save(SETTINGS_KEY, serializeModified(settings));
}

function loadSettings(): void {
    const text = storage.load(SETTINGS_KEY);
    if (text) readAndApply(settings, text);
}

interface Session {
    owner: Player;
    body: Player | null;
    sim: SimulatedPlayer | null;
    ctx: BedrockPlayerContext | null;
    baritone: Beditone | null;
    renderer: PathRenderer | null;
    wasAlive: boolean;
    pending: string[];
    area: { x: number; z: number; dim: string; name: string } | null;
}

const AREA_RADIUS_CHUNKS = 4;
let areaCounter = 0;

function updateTickingArea(s: Session): void {
    const sim = s.sim;
    if (!sim) return;
    const l = sim.location;
    const a = s.area;
    if (a && a.dim === sim.dimension.id && Math.abs(a.x - l.x) < 24 && Math.abs(a.z - l.z) < 24) return;
    removeTickingArea(s);
    const name = `beditone${areaCounter++}`;
    try {
        sim.dimension.runCommand(`tickingarea add circle ${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)} ${AREA_RADIUS_CHUNKS} ${name}`);
        s.area = { x: l.x, z: l.z, dim: sim.dimension.id, name };
    } catch (e) {
        console.warn(`[Beditone] couldn't add a ticking area for the bot: ${e}`);
    }
}

function removeTickingArea(s: Session): void {
    if (!s.area) return;
    try {
        world.getDimension(s.area.dim).runCommand(`tickingarea remove ${s.area.name}`);
    } catch {
    }
    s.area = null;
}

const sessions = new Map<string, Session>();

function send(owner: Player, message: string): void {
    try {
        owner.sendMessage(message);
    } catch {
    }
}

function giveStarterKit(sim: Player): void {
    const container = sim.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    for (const entry of settings.starterKitItems.value) {
        const [id, countStr] = entry.split("*");
        const count = Math.max(1, parseInt(countStr ?? "1", 10) || 1);
        try {
            container.addItem(new ItemStack(id.includes(":") ? id : "minecraft:" + id, count));
        } catch (e) {
            console.warn(`[Beditone] bad starter kit item ${entry}: ${e}`);
        }
    }
}

function loadStructure(owner: Player, name: string): StaticSchematic | null {
    let structure;
    try {
        structure = world.structureManager.get(name);
    } catch {
        return null;
    }
    if (!structure) return null;
    const size = structure.size;
    const states: BlockState[][][] = [];
    for (let x = 0; x < size.x; x++) {
        states.push([]);
        for (let z = 0; z < size.z; z++) {
            states[x].push([]);
            for (let y = 0; y < size.y; y++) {
                const perm = structure.getBlockPermutation({ x, y, z });
                states[x][z].push(perm ? BlockState.of(perm.type.id, perm.getAllStates()) : AIR);
            }
        }
    }
    send(owner, `§7Loaded structure ${name} (${size.x}x${size.y}x${size.z})`);
    return new StaticSchematic(states, name);
}

function spawnBot(session: Session): void {
    const owner = session.owner;
    const loc = owner.location;
    const sim = spawnSimulatedPlayer({ dimension: owner.dimension, x: loc.x, y: loc.y, z: loc.z }, settings.botName.value, GameMode.Survival);
    sim.teleport({ x: loc.x, y: loc.y, z: loc.z }, { dimension: owner.dimension });
    session.sim = sim;
    session.body = sim;
    session.wasAlive = true;
    updateTickingArea(session);
    if (settings.starterKit.value) {
        giveStarterKit(sim);
    }
    attach(session, new BedrockPlayerContext(sim, owner));
    send(owner, `§d[§5Beditone§d]§r Spawned your bot "${settings.botName.value}" (Beditone v${BEDITONE_VERSION}, a Baritone port). Try ${settings.prefix.value}help`);
}

function startPlayer(session: Session): void {
    const owner = session.owner;
    session.sim = null;
    session.body = owner;
    session.wasAlive = true;
    attach(session, new RealPlayerContext(owner));
    send(owner, `§d[§5Beditone§d]§r Baritone is driving you now (Beditone v${BEDITONE_VERSION}). Your movement keys are locked while it paths; ${settings.prefix.value}stop gives them back. Try ${settings.prefix.value}help`);
}

function wantsBot(session: Session): boolean {
    return settings.controlMode.value === "bot" || session.owner.id === CONSOLE_ID;
}

function startSession(session: Session): void {
    if (wantsBot(session)) {
        spawnBot(session);
    } else {
        startPlayer(session);
    }
}

function isPlayerMode(session: Session): boolean {
    return session.ctx instanceof RealPlayerContext;
}

function particleSink(viewer: Player): ParticleSink {
    const molang = new Map<string, MolangVariableMap>();
    return {
        get isValid() {
            return viewer.isValid;
        },
        get location() {
            return viewer.location;
        },
        spawn(x, y, z, color) {
            const key = `${color.r},${color.g},${color.b}`;
            let m = molang.get(key);
            if (!m) {
                m = new MolangVariableMap();
                m.setColorRGB("variable.color", { red: color.r / 255, green: color.g / 255, blue: color.b / 255 });
                molang.set(key, m);
            }
            viewer.spawnParticle(PATH_PARTICLE, { x, y, z }, m);
        },
    };
}

function attach(session: Session, ctx: BedrockPlayerContext): void {
    const owner = session.owner;
    const baritone = new Beditone({
        ctx,
        runJob: (job) => system.runJob(job),
        scanner: ctx.world(),
        storage,
        ownerKey: owner.name,
        send: (m) => send(owner, m),
        notify: (m, error) => {
            try {
                owner.onScreenDisplay.setActionBar((error ? "§c" : "§a") + m);
            } catch {
            }
        },
        loadStructure: (name) => loadStructure(owner, name),
        saveSettings,
        loadSettings,
        viewerLookingAt: () => {
            const hit = owner.getBlockFromViewDirection({ maxDistance: 256, includePassableBlocks: false, includeLiquidBlocks: false });
            return hit ? BetterBlockPos.of(hit.block.location) : null;
        },
        botCommand: (action) => botCommand(session, action),
    });
    ctx.setAim((r) => baritone.getLookBehavior().getAimProcessor().peekRotation(r));
    for (const c of baritone.getCommandManager().getAll()) {
        for (const n of c.names) KNOWN_COMMANDS.add(n);
    }
    session.ctx = ctx;
    session.baritone = baritone;
    session.renderer = new PathRenderer(particleSink(owner), baritone);
}

function endSession(session: Session): void {
    removeTickingArea(session);
    try {
        session.baritone?.getPathingBehavior().forceCancel();
    } catch {
    }
    if (session.ctx instanceof RealPlayerContext) session.ctx.setDriving(false);
    try {
        session.sim?.disconnect();
    } catch {
    }
    session.sim = null;
    session.body = null;
    session.ctx = null;
    session.baritone = null;
    session.renderer = null;
}

function botCommand(session: Session, action: string): void {
    const b = session.baritone;
    switch (action) {
        case "spawn":
            if (session.sim?.isValid) {
                b?.logDirect("Your bot is already spawned. Use bot remove first to respawn it.");
            } else {
                endSession(session);
                if (session.owner.id !== CONSOLE_ID) {
                    settings.controlMode.value = "bot";
                    saveSettings();
                }
                spawnBot(session);
            }
            break;
        case "remove":
            if (isPlayerMode(session)) {
                b?.logDirect("There's no bot; Baritone is driving you (controlMode player)");
                break;
            }
            endSession(session);
            if (session.owner.id === CONSOLE_ID) {
                send(session.owner, "Removed the bot");
                break;
            }
            send(session.owner, "Removed your bot; Baritone drives you again (controlMode player)");
            settings.controlMode.value = "player";
            saveSettings();
            startPlayer(session);
            break;
        case "tp":
            if (!session.sim) {
                b?.logDirect("There's no bot to teleport (controlMode player)");
                break;
            }
            session.sim.teleport(session.owner.location, { dimension: session.owner.dimension });
            b?.getPathingBehavior().cancelEverything();
            b?.logDirect("Teleported your bot to you");
            break;
        case "kit":
            if (session.body) giveStarterKit(session.body);
            b?.logDirect("Gave the starter kit");
            break;
        case "inv": {
            const items = session.ctx?.inventory().items ?? [];
            b?.logDirect(
                "Hotbar: " +
                    items
                        .slice(0, 9)
                        .map((i, n) => `${n}:${i.typeId.replace("minecraft:", "")}${i.amount > 1 ? "x" + i.amount : ""}`)
                        .join(" "),
            );
            break;
        }
        default:
            b?.logDirect("Usage: bot spawn | remove | tp | kit | inv (spawn switches to a separate bot, remove back to driving you)", "§c");
    }
}

function isBaritoneMessage(msg: string): boolean {
    if (msg.startsWith(settings.prefix.value) && settings.prefixControl.value) return true;
    if (!(settings.chatControl.value || settings.chatControlAnyway.value)) return false;
    const [label, args] = CommandManager.expand(msg);
    if (label.trim() === "") return false;
    const lower = label.toLowerCase();
    if (args.length <= 1 && settings.byLowerName.has(lower)) return true;
    return KNOWN_COMMANDS.has(lower);
}

let KNOWN_COMMANDS = new Set<string>();

function sessionFor(player: Player): Session {
    let s = sessions.get(player.id);
    if (!s) {
        s = { owner: player, body: null, sim: null, ctx: null, baritone: null, renderer: null, wasAlive: false, pending: [], area: null };
        sessions.set(player.id, s);
    }
    s.owner = player;
    return s;
}

world.beforeEvents.chatSend.subscribe((event) => {
    const msg = event.message;
    if (!isBaritoneMessage(msg)) return;
    event.cancel = true;
    const player = event.sender;
    system.run(() => handleCommand(player, msg));
});

function handleCommand(player: Player, msg: string): void {
    const session = sessionFor(player);
    if (session.baritone === null) {
        try {
            startSession(session);
        } catch (e) {
            send(player, `§d[§5Beditone§d]§c Couldn't start: ${e}. Is the "Beta APIs" experiment on?`);
            return;
        }
    }
    session.baritone?.onChat(msg);
    if (session.baritone && wantsBot(session) === isPlayerMode(session)) {
        endSession(session);
        try {
            startSession(session);
        } catch (e) {
            send(player, `§d[§5Beditone§d]§c Couldn't switch control mode: ${e}`);
        }
    }
}

const standIns: SimulatedPlayer[] = [];

function removeStandIns(): void {
    for (const sim of standIns.splice(0)) {
        const s = sessions.get(sim.id);
        if (s) {
            endSession(s);
            sessions.delete(sim.id);
        }
        try {
            sim.disconnect();
        } catch {
        }
    }
}

const consoleOwner = {
    id: CONSOLE_ID,
    name: "console",
    isValid: true,
    location: { x: 0.5, y: 0, z: 0.5 },
    yaw: 0,
    get dimension() {
        return world.getDimension("overworld");
    },
    getRotation() {
        return { x: 0, y: consoleOwner.yaw };
    },
    sendMessage(m: string) {
        console.warn("[Beditone>console] " + m.replace(/§./g, ""));
    },
    spawnParticle() {},
    getBlockFromViewDirection() {
        return undefined;
    },
    onScreenDisplay: { setActionBar(m: string) { console.warn("[Beditone>actionbar] " + m.replace(/§./g, "")); } },
} as unknown as Player & { location: { x: number; y: number; z: number }; yaw: number };

system.afterEvents.scriptEventReceive.subscribe((event) => {
    const msg = event.message.trim();
    switch (event.id) {
        case "beditone:owner": {
            const parts = msg.split(/\s+/);
            const [x, , z, yaw] = parts.map(Number);
            let y = Number(parts[1]);
            if (parts[1] === "top") {
                let top;
                try {
                    top = world.getDimension("overworld").getTopmostBlock({ x, z });
                } catch {
                    top = undefined;
                }
                if (!top) {
                    console.warn("[Beditone>console] that column isn't loaded; add a tickingarea there first or give a y");
                    break;
                }
                y = top.location.y + 1;
            }
            consoleOwner.location = { x, y, z };
            consoleOwner.yaw = yaw || 0;
            console.warn(`[Beditone>console] owner at ${x} ${y} ${z} yaw ${consoleOwner.yaw}`);
            break;
        }
        case "beditone:run":
            handleCommand(consoleOwner, msg);
            break;
        case "beditone:runas": {
            const sp = msg.indexOf(" ");
            const name = sp < 0 ? msg : msg.slice(0, sp);
            const p = standIns.find((pl) => pl.isValid && pl.name === name) ?? world.getAllPlayers().find((pl) => pl.name === name);
            if (!p) {
                console.warn(`[Beditone>console] no player named ${name}`);
                break;
            }
            handleCommand(p, sp < 0 ? "" : msg.slice(sp + 1));
            break;
        }
        case "beditone:standin": {
            removeStandIns();
            const [name, ...xyz] = msg.split(/\s+/);
            const [x, y, z] = xyz.map(Number);
            system.runTimeout(() => {
                const sim = spawnSimulatedPlayer({ dimension: world.getDimension("overworld"), x, y, z }, name, GameMode.Survival);
                sim.teleport({ x, y, z });
                giveStarterKit(sim);
                standIns.push(sim);
                console.warn(`[Beditone>console] stand-in ${sim.name} at ${x} ${y} ${z}`);
            }, 10);
            break;
        }
        case "beditone:standin-remove":
            removeStandIns();
            break;
        case "beditone:status": {
            for (const s of sessions.values()) {
                const sim = s.body;
                if (!sim || !sim.isValid) {
                    console.warn(`[Beditone>status] ${s.owner.name}: no bot`);
                    continue;
                }
                const b = s.baritone!;
                const l = sim.location;
                const pb = b.getPathingBehavior();
                const cur = pb.getCurrent();
                const proc = b.getPathingControlManager().mostRecentInControl();
                console.warn(
                    `[Beditone>status] ${s.owner.name}: ${isPlayerMode(s) ? "player" : "bot"} at ${l.x.toFixed(2)} ${l.y.toFixed(2)} ${l.z.toFixed(2)} feet=${b.getPlayerContext().playerFeet()} ` +
                        `ground=${sim.isOnGround} rot=${b.getPlayerContext().playerRotations().yaw.toFixed(0)}/${b.getPlayerContext().playerRotations().pitch.toFixed(0)} proc=${proc ? proc.displayName() : "none"} ` +
                        `goal=${pb.getGoal()} path=${cur ? `${cur.getPosition()}/${cur.getPath().length()} -> ${cur.getPath().getDest()}` : "none"} calculating=${pb.getInProgress() !== null}`,
                );
                if (msg === "chunks") {
                    const cx = Math.floor(l.x) >> 4;
                    const cz = Math.floor(l.z) >> 4;
                    const rows: string[] = [];
                    for (let dz = -6; dz <= 6; dz++) {
                        let row = "";
                        for (let dx = -6; dx <= 6; dx++) {
                            const loaded = sim.dimension.isChunkLoaded({ x: (cx + dx) * 16, y: 0, z: (cz + dz) * 16 });
                            row += dx === 0 && dz === 0 ? "B" : loaded ? "#" : ".";
                        }
                        rows.push(row);
                    }
                    console.warn(`[Beditone>status] loaded chunks around the bot (chunk ${cx},${cz}; B = bot, x to the right):\n` + rows.join("\n"));
                }
                if (msg === "verbose") {
                    const ioh = b.getInputOverrideHandler();
                    const held = ["MOVE_FORWARD", "MOVE_BACK", "MOVE_LEFT", "MOVE_RIGHT", "CLICK_LEFT", "CLICK_RIGHT", "JUMP", "SNEAK", "SPRINT"].filter((i) => ioh.isInputForcedDown(i as never));
                    const hit = s.ctx!.objectMouseOver();
                    const m = cur ? cur.getPath().movements()[cur.getPosition()] : null;
                    console.warn(
                        `[Beditone>status]   movement=${m ?? "none"} inputs=[${held.join(",")}] slot=${sim.selectedSlotIndex} sneaking=${s.ctx!.isCrouching()} movementKeys=${sim.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Movement) ? "player" : "locked"} ` +
                            `lookingAt=${hit ? `${hit.pos} face=${hit.direction.name} (${b.getPlayerContext().bsi().get(hit.pos).typeId})` : "nothing"}`,
                    );
                }
            }
            break;
        }
    }
});

world.afterEvents.entityDie.subscribe((event) => {
    for (const s of sessions.values()) {
        if (s.body && event.deadEntity.id === s.body.id) {
            s.baritone?.onDeath();
        }
    }
});

world.afterEvents.playerInteractWithBlock.subscribe((event) => {
    for (const s of sessions.values()) {
        if (s.body && event.player.id === s.body.id) {
            const l = event.block.location;
            s.baritone?.onBlockInteract(new BetterBlockPos(l.x, l.y, l.z));
        }
    }
});

world.afterEvents.playerLeave.subscribe((event) => {
    const s = sessions.get(event.playerId);
    if (s) {
        endSession(s);
        sessions.delete(event.playerId);
    }
});

let tickCount = 0;

system.runInterval(() => {
    tickCount++;
    for (const s of sessions.values()) {
        const b = s.baritone;
        const body = s.body;
        if (!b || !body || !s.ctx) continue;
        if (!body.isValid) {
            b.tickOut();
            continue;
        }
        s.ctx.newTick();
        const alive = s.ctx.isAlive();
        if (!alive) {
            if (s.wasAlive) b.tickOut();
            s.wasAlive = false;
            if (s.sim && tickCount % 20 === 0) {
                try {
                    s.sim.respawn();
                } catch {
                }
            }
            continue;
        }
        s.wasAlive = true;
        if (s.sim && tickCount % 10 === 0) updateTickingArea(s);
        try {
            b.tick();
            if (s.sim && b.getPathingControlManager().mostRecentInControl() === null && s.sim.isInWater) {
                s.sim.applyImpulse({ x: 0, y: 0.04, z: 0 });
            }
            if (s.ctx instanceof RealPlayerContext) {
                const pcm = b.getPathingControlManager();
                const cmd = pcm.mostRecentCommand();
                const active = pcm.mostRecentInControl() !== null && cmd !== null && cmd.commandType !== PathingCommandType.REQUEST_PAUSE;
                s.ctx.setDriving(b.getPathingBehavior().isPathing() || active);
            }
        } catch (e) {
            console.warn("[Beditone] tick failed: " + ((e as Error)?.stack ?? e));
        }
        if (tickCount % Math.max(1, settings.renderIntervalTicks.value) === 0) {
            try {
                s.renderer?.render();
            } catch (e) {
                console.warn("[Beditone] render failed: " + e);
            }
        }
    }
}, 1);

function unlockMovement(player: Player): void {
    try {
        player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
    } catch {
    }
}

world.afterEvents.playerSpawn.subscribe((event) => {
    if (event.initialSpawn) unlockMovement(event.player);
});

system.run(() => {
    for (const p of world.getAllPlayers()) unlockMovement(p);
    loadSettings();
    const probe = new Set<string>();
    for (const name of [
        "help ? set setting settings modified mod baritone modifiedsettings reset goal goto path proc eta version repack rescan build litematica come axis highway forcecancel gc invert tunnel render farm follow pickup explorefilter reloadall saveall explore blacklist find mine click surface top thisway forward waypoints waypoint wp sethome home sel selection s elytra bot pause p paws resume r unpause unpaws paused cancel c stop",
    ]) {
        for (const n of name.split(" ")) probe.add(n);
    }
    KNOWN_COMMANDS = probe;
    console.warn(`[Beditone] v${BEDITONE_VERSION} loaded. Type ${settings.prefix.value}help in chat.`);
});

