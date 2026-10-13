import {
    settings,
    Setting,
    settingValueToString,
    settingDefaultToString,
    settingTypeToString,
    modifiedSettings,
    parseAndApply,
} from "../Settings";
import { BEDITONE_VERSION, BARITONE_BASE } from "../version";
import { Goal, GoalAxis, GoalBlock, GoalInverted, GoalStrictDirection, GoalTwoBlocks, GoalXZ } from "../goals/Goal";
import type { IBaritone } from "../IBaritone";
import { BetterBlockPos, Directions, Direction, blockCenter } from "../utils/BetterBlockPos";
import { Blocks } from "../world/Blocks";
import { BlockOptionalMeta, BlockOptionalMetaLookup } from "../world/BlockOptionalMeta";
import { scanChunkRadius } from "../world/WorldScanner";
import { allTagNames, tagByName, Waypoint, WaypointTag } from "../cache/WorldData";
import {
    CompositeSchematic,
    computeMask,
    cylinderMask,
    FillSchematic,
    ISchematic,
    MaskSchematic,
    ReplaceSchematic,
    ShellSchematic,
    sphereMask,
    StaticSchematic,
    WallsSchematic,
} from "../schematic/Schematic";
import type { BlockState } from "../world/BlockState";
import type { Selection } from "../selection/SelectionManager";
import {
    ArgConsumer,
    Command,
    CommandInvalidStateException,
    CommandInvalidTypeException,
    CommandNotFoundException,
    paginate,
} from "./Command";
import {
    entityClassById,
    forAxis,
    forBlockOptionalMeta,
    forDirection,
    forWaypoints,
    isCoordinate,
    itemById,
    nearbyPlayer,
    relativeBlockPos,
    relativeGoal,
    relativeGoalXZ,
} from "./Datatypes";
import { BaritoneProcess, PathingCommand, PathingCommandType, DEFAULT_PRIORITY } from "../process/PathingCommand";

type CommandFactory = (b: IBaritone) => Command;

function simple(names: string[], shortDesc: string, longDesc: string[], execute: (b: IBaritone, label: string, args: ArgConsumer) => void, hidden = false): CommandFactory {
    return (b) =>
        new (class extends Command {
            execute(label: string, args: ArgConsumer): void {
                execute(b, label, args);
            }
            getShortDesc(): string {
                return shortDesc;
            }
            getLongDesc(): string[] {
                return longDesc;
            }
            override hiddenFromHelp(): boolean {
                return hidden;
            }
        })(b, ...names);
}

function alias(names: string[], shortDesc: string, target: string): CommandFactory {
    return simple(names, shortDesc, [`This command is an alias, for: ${target} ...`], (b, _label, args) => {
        b.getCommandManager().execute(`${target} ${args.rawRest()}`);
    });
}

const help = simple(
    ["help", "?"],
    "View all commands or help on specific ones",
    ["Using this command, you can view detailed help information on how to use certain commands of Baritone.", "", "Usage:", "> help - Lists all commands and their short descriptions.", "> help <command> - Displays help information on a specific command."],
    (b, label, args) => {
        args.requireMax(1);
        const prefix = settings.prefix.value;
        if (!args.hasAny() || args.is("int")) {
            const cmds = b
                .getCommandManager()
                .getAll()
                .filter((c) => !c.hiddenFromHelp());
            paginate(b, args, cmds, () => b.logDirect("All Baritone commands:"), (c) => `§7${c.names[0]} §8- ${c.getShortDesc()}`, prefix + label);
        } else {
            const commandName = args.getString().toLowerCase();
            const command = b.getCommandManager().getCommand(commandName);
            if (command === null) {
                throw new CommandNotFoundException(commandName);
            }
            b.logDirect(`${command.names.join(" / ")} - ${command.getShortDesc()}`);
            b.logDirect("");
            command.getLongDesc().forEach((l) => b.logDirect(l.replace(/^> /, "> " + prefix)));
            b.logDirect("");
            b.logDirect(`§7Type ${prefix}${label} to return to the help menu`);
        }
    },
);

function settingLine(s: Setting<any>): string {
    return `§7${s.name} §8(${settingTypeToString(s)})§r = ${settingValueToString(s)}`;
}

const set = simple(
    ["set", "setting", "settings"],
    "View or change settings",
    [
        "Using the set command, you can manage all of Baritone's settings. Almost every aspect is controlled by these settings - go wild!",
        "",
        "Usage:",
        "> set - Same as `set list`",
        "> set list [page] - View all settings",
        "> set modified [page] - View modified settings",
        "> set <setting> - View the current value of a setting",
        "> set <setting> <value> - Set the value of a setting",
        "> set reset all - Reset ALL SETTINGS to their defaults",
        "> set reset <setting> - Reset a setting to its default",
        "> set toggle <setting> - Toggle a boolean setting",
        "> set save - Save all settings (this is automatic tho)",
        "> set load - Load settings from the world (undo unsaved changes)",
    ],
    (b, _label, args) => {
        const arg = args.hasAny() ? args.getString().toLowerCase() : "list";
        const persist = () => b.saveSettings();
        if (["s", "save"].includes(arg)) {
            persist();
            b.logDirect("Settings saved");
            return;
        }
        if (["load", "ld"].includes(arg)) {
            modifiedSettings(settings).forEach((s) => s.reset());
            b.loadSettings();
            b.logDirect("Settings reloaded from world");
            return;
        }
        const viewModified = ["m", "mod", "modified"].includes(arg);
        const viewAll = ["all", "l", "list"].includes(arg);
        const paginateIt = viewModified || viewAll;
        if (paginateIt) {
            const search = args.hasAny() && args.peekAsOrNull("int") === null ? args.getString() : "";
            args.requireMax(1);
            const toPaginate = (viewModified ? modifiedSettings(settings) : settings.allSettings)
                .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
                .sort((s1, s2) => s1.name.toLowerCase().localeCompare(s2.name.toLowerCase()));
            paginate(
                b,
                args,
                toPaginate,
                () => b.logDirect(search ? `All ${viewModified ? "modified " : ""}settings containing the string '${search}':` : `All ${viewModified ? "modified " : ""}settings:`),
                settingLine,
                `${settings.prefix.value}set ${arg}${search ? " " + search : ""}`,
            );
            return;
        }
        args.requireMax(1);
        const resetting = arg === "reset";
        const toggling = arg === "toggle";
        const doingSomething = resetting || toggling;
        if (resetting) {
            if (!args.hasAny()) {
                b.logDirect("Please specify 'all' as an argument to reset to confirm you'd really like to do this");
                b.logDirect("ALL settings will be reset. Use the 'set modified' or 'modified' commands to see what will be reset.");
                b.logDirect("Specify a setting name instead of 'all' to only reset one setting");
            } else if (args.peekString().toLowerCase() === "all") {
                modifiedSettings(settings).forEach((s) => s.reset());
                b.logDirect("All settings have been reset to their default values");
                persist();
                return;
            }
        }
        if (toggling) {
            args.requireMin(1);
        }
        const settingName = doingSomething ? args.getString() : arg;
        const setting = settings.byLowerName.get(settingName.toLowerCase());
        if (!setting) {
            throw new CommandInvalidTypeException(args.consumed(), "a valid setting");
        }
        if (!doingSomething && !args.hasAny()) {
            b.logDirect(`Value of setting ${setting.name}:`);
            b.logDirect(settingValueToString(setting));
            b.logDirect(`§7Default: ${settingDefaultToString(setting)}`);
        } else {
            const oldValue = settingValueToString(setting);
            if (resetting) {
                setting.reset();
            } else if (toggling) {
                if (setting.type !== "boolean") {
                    throw new CommandInvalidTypeException(args.consumed(), "a toggleable setting", "some other setting");
                }
                setting.value = !setting.value;
                b.logDirect(`Toggled setting ${setting.name} to ${setting.value}`);
            } else {
                const newValue = args.getString();
                try {
                    parseAndApply(settings, arg, newValue);
                } catch (t) {
                    throw new CommandInvalidTypeException(args.consumed(), "a valid value", t);
                }
            }
            if (!toggling) {
                b.logDirect(`Successfully ${resetting ? "reset" : "set"} ${setting.name} to ${settingValueToString(setting)}`);
            }
            b.logDirect(`§7Old value: ${oldValue}`);
            if ((setting.name === "chatControl" && !setting.value && !settings.chatControlAnyway.value) || (setting.name === "chatControlAnyway" && !setting.value && !settings.chatControl.value)) {
                b.logDirect("Warning: Chat commands will no longer work. If you want to revert this change, use prefix control (if enabled).", "§c");
            } else if (setting.name === "prefixControl" && !setting.value) {
                b.logDirect("Warning: Prefixed commands will no longer work. If you want to revert this change, use chat control (if enabled).", "§c");
            }
        }
        persist();
    },
);

const goal = simple(
    ["goal"],
    "Set or clear the goal",
    [
        "The goal command allows you to set or clear Baritone's goal.",
        "",
        "Wherever a coordinate is expected, you can use ~ just like in regular Minecraft commands. Or, you can just use regular numbers.",
        "",
        "Usage:",
        "> goal - Set the goal to your current position",
        "> goal <reset/clear/none> - Erase the goal",
        "> goal <y> - Set the goal to a Y level",
        "> goal <x> <z> - Set the goal to an X,Z position",
        "> goal <x> <y> <z> - Set the goal to an X,Y,Z position",
    ],
    (b, _label, args) => {
        const goalProcess = b.getCustomGoalProcess();
        if (args.hasAny() && ["reset", "clear", "none"].includes(args.peekString())) {
            args.requireMax(1);
            if (goalProcess.getGoal() !== null) {
                goalProcess.setGoal(null);
                b.logDirect("Cleared goal");
            } else {
                b.logDirect("There was no goal to clear");
            }
        } else {
            args.requireMax(3);
            const origin = b.getPlayerContext().playerFeet();
            const g = relativeGoal(args, origin);
            goalProcess.setGoal(g);
            b.logDirect(`Goal: ${g.toString()}`);
        }
    },
);

const gotoCmd = simple(
    ["goto"],
    "Go to a coordinate or block",
    [
        "The goto command tells Baritone to head towards a given goal or block.",
        "",
        "Wherever a coordinate is expected, you can use ~ just like in regular Minecraft commands. Or, you can just use regular numbers.",
        "",
        "Usage:",
        "> goto <block> - Go to a block, wherever it is in the world",
        "> goto <y> - Go to a Y level",
        "> goto <x> <z> - Go to an X,Z position",
        "> goto <x> <y> <z> - Go to an X,Y,Z position",
    ],
    (b, _label, args) => {
        if (args.hasAny() && isCoordinate(args.peekString())) {
            args.requireMax(3);
            const origin = b.getPlayerContext().playerFeet();
            const g = relativeGoal(args, origin);
            b.logDirect(`Going to: ${g.toString()}`);
            b.getCustomGoalProcess().setGoalAndPath(g);
            return;
        }
        args.requireMax(1);
        const destination = forBlockOptionalMeta(args);
        b.getGetToBlockProcess().getToBlock(destination);
    },
);

const path = simple(["path"], "Start heading towards the goal", ["The path command tells Baritone to head towards the current goal.", "", "Usage:", "> path - Start the pathing."], (b, _l, args) => {
    args.requireMax(0);
    if (b.getCustomGoalProcess().getGoal() === null) {
        b.logDirect("No goal set");
        return;
    }
    b.getCustomGoalProcess().path();
    b.logDirect("Now pathing");
});

const proc = simple(
    ["proc"],
    "View process state information",
    ["The proc command provides miscellaneous information about the process currently controlling Baritone.", "", "You are not expected to understand this if you aren't familiar with how Baritone works.", "", "Usage:", "> proc - View process information, if present"],
    (b, _l, args) => {
        args.requireMax(0);
        const pcm = b.getPathingControlManager();
        const process = pcm.mostRecentInControl();
        if (process === null) {
            throw new CommandInvalidStateException("No process in control");
        }
        b.logDirect(`Class: ${process.constructor.name}`);
        b.logDirect(`Priority: ${process.priority()}`);
        b.logDirect(`Temporary: ${process.isTemporary()}`);
        b.logDirect(`Display name: ${process.displayName()}`);
        b.logDirect(`Last command: ${pcm.mostRecentCommand()?.toString() ?? "None"}`);
    },
);

const UNITS = ["seconds", "minutes", "hours", "days", "weeks"];
const TICKS_PER_UNIT = [20, 1200, 72000, 1728000, 12096000];
function formatTime(ticks: number): string {
    if (!Number.isFinite(ticks)) {
        return "" + ticks;
    }
    for (let i = UNITS.length - 1; i >= 0; i--) {
        const value = Math.trunc(ticks / TICKS_PER_UNIT[i]);
        if (value >= 2) {
            return `${value} ${UNITS[i]} (${Math.round(ticks)} ticks)`;
        }
    }
    return `${Math.round(ticks)} ticks`;
}

const eta = simple(
    ["eta"],
    "View the current ETA",
    ["The ETA command provides information about the estimated time until the next segment.", "and the goal", "", "Be aware that the ETA to your goal is really unprecise", "", "Usage:", "> eta - View ETA, if present"],
    (b, _l, args) => {
        args.requireMax(0);
        if (b.getPathingControlManager().mostRecentInControl() === null) {
            throw new CommandInvalidStateException("No process in control");
        }
        const pb = b.getPathingBehavior();
        const seg = pb.ticksRemainingInSegment() ?? NaN;
        const toGoal = pb.estimatedTicksToGoal() ?? NaN;
        b.logDirect(`Next segment: ${formatTime(seg)}`);
        b.logDirect(`        Goal: ${formatTime(toGoal)}`);
        if (Number.isFinite(toGoal) && toGoal >= 24192000) {
            b.logDirect("Please don't do this to me.");
        }
    },
);

const version = simple(["version"], "View the Baritone version", ["The version command prints the version of Baritone you're currently running.", "", "Usage:", "> version - View version information, if present"], (b, _l, args) => {
    args.requireMax(0);
    b.logDirect(`You are running Beditone v${BEDITONE_VERSION}, a Bedrock port of Baritone ${BARITONE_BASE}`);
});

const come = simple(
    ["come"],
    "Start heading towards your camera",
    ["The come command tells Baritone to head towards your camera.", "", "Beditone: your camera is you, the player who controls the bot.", "", "Usage:", "> come"],
    (b, _l, args) => {
        args.requireMax(0);
        b.getCustomGoalProcess().setGoalAndPath(GoalBlock.of(b.getPlayerContext().viewerPos()));
        b.logDirect("Coming");
    },
);

const axis = simple(
    ["axis", "highway"],
    "Set a goal to the axes",
    ["The axis command sets a goal that tells Baritone to head towards the nearest axis. That is, X=0 or Z=0 or X=Z or X=-Z.", "The target y level is configured using the axisHeight setting.", "", "Usage:", "> axis"],
    (b, _l, args) => {
        args.requireMax(0);
        const g = new GoalAxis();
        b.getCustomGoalProcess().setGoal(g);
        b.logDirect(`Goal: ${g.toString()}`);
    },
);

const forceCancel = simple(["forcecancel"], "Force cancel", ["Like cancel, but more forceful.", "", "Usage:", "> forcecancel"], (b, _l, args) => {
    args.requireMax(0);
    b.getPathingBehavior().cancelEverything();
    b.getPathingBehavior().forceCancel();
    b.logDirect("ok force canceled");
});

const invert = simple(["invert"], "Run away from the current goal", ["The invert command tells Baritone to head away from the current goal rather than towards it.", "", "Usage:", "> invert - Invert the current goal."], (b, _l, args) => {
    args.requireMax(0);
    const cgp = b.getCustomGoalProcess();
    let g = cgp.getGoal();
    if (g === null) {
        throw new CommandInvalidStateException("No goal");
    }
    if (g instanceof GoalInverted) {
        g = g.origin;
    } else {
        g = new GoalInverted(g);
    }
    cgp.setGoalAndPath(g);
    b.logDirect(`Goal: ${g.toString()}`);
});

function facing(yaw: number): Direction {
    const i = Math.floor(yaw / 90 + 0.5) & 3;
    return [Directions.SOUTH, Directions.WEST, Directions.NORTH, Directions.EAST][i];
}

const tunnel = simple(
    ["tunnel"],
    "Set a goal to tunnel in your current direction",
    ["The tunnel command sets a goal that tells Baritone to mine completely straight in the direction that you're facing.", "", "Usage:", "> tunnel - No arguments, mines in a 1x2 radius.", "> tunnel <height> <width> <depth> - Tunnels in a user defined height, width and depth."],
    (b, _l, args) => {
        args.requireMax(3);
        const ctx = b.getPlayerContext();
        const feet = ctx.playerFeet();
        const dir = facing(ctx.viewerYaw());
        if (args.hasExactly(3)) {
            let height = args.getAs("int");
            let width = args.getAs("int");
            const depth = args.getAs("int");
            if (width < 1 || height < 2 || depth < 1 || height > ctx.world().maxY) {
                b.logDirect("Width and depth must at least be 1 block; Height must at least be 2 blocks, and cannot be greater than the build limit.");
                return;
            }
            height--;
            width--;
            const addition = width % 2 === 0 ? 0 : 1;
            const half = Math.trunc(width / 2);
            let corner1: BetterBlockPos;
            let corner2: BetterBlockPos;
            switch (dir) {
                case Directions.EAST:
                    corner1 = new BetterBlockPos(feet.x, feet.y, feet.z - half);
                    corner2 = new BetterBlockPos(feet.x + depth, feet.y + height, feet.z + half + addition);
                    break;
                case Directions.WEST:
                    corner1 = new BetterBlockPos(feet.x, feet.y, feet.z + half + addition);
                    corner2 = new BetterBlockPos(feet.x - depth, feet.y + height, feet.z - half);
                    break;
                case Directions.NORTH:
                    corner1 = new BetterBlockPos(feet.x - half, feet.y, feet.z);
                    corner2 = new BetterBlockPos(feet.x + half + addition, feet.y + height, feet.z - depth);
                    break;
                default:
                    corner1 = new BetterBlockPos(feet.x + half + addition, feet.y, feet.z);
                    corner2 = new BetterBlockPos(feet.x - half, feet.y + height, feet.z + depth);
                    break;
            }
            b.logDirect(`Creating a tunnel ${height + 1} block(s) high, ${width + 1} block(s) wide, and ${depth} block(s) deep`);
            b.getBuilderProcess().clearArea(corner1, corner2);
        } else {
            const g = new GoalStrictDirection(feet, dir);
            b.getCustomGoalProcess().setGoalAndPath(g);
            b.logDirect(`Goal: ${g.toString()}`);
        }
    },
);

const surface = simple(
    ["surface", "top"],
    "Used to get out of caves, mines, ...",
    ["The surface/top command tells Baritone to head towards the closest surface-like area.", "", "This can be the surface or the highest available air space, depending on circumstances.", "", "Usage:", "> surface - Used to get out of caves, mines, ...", "> top - Used to get out of caves, mines, ..."],
    (b) => {
        const ctx = b.getPlayerContext();
        const playerPos = ctx.playerFeet();
        const bsi = ctx.bsi();
        const surfaceLevel = 63;
        const worldHeight = ctx.world().maxY + 1;
        if (playerPos.y > surfaceLevel && Blocks.isAir(bsi.get(playerPos.above()))) {
            b.logDirect("Already at surface");
            return;
        }
        const startingYPos = Math.max(playerPos.y, surfaceLevel);
        for (let y = startingYPos; y < worldHeight; y++) {
            const newPos = new BetterBlockPos(playerPos.x, y, playerPos.z);
            if (!Blocks.isAir(bsi.get(newPos)) && newPos.y > playerPos.y) {
                const g = GoalBlock.of(newPos.above());
                b.logDirect(`Going to: ${g.toString()}`);
                b.getCustomGoalProcess().setGoalAndPath(g);
                return;
            }
        }
        b.logDirect("No higher location found");
    },
);

const thisway = simple(
    ["thisway", "forward"],
    "Travel in your current direction",
    ["Creates a GoalXZ some amount of blocks in the direction you're currently looking", "", "Usage:", "> thisway <distance> - makes a GoalXZ distance blocks in front of you"],
    (b, _l, args) => {
        args.requireExactly(1);
        const ctx = b.getPlayerContext();
        const g = GoalXZ.fromDirection(ctx.playerFeetAsVec(), ctx.viewerYaw(), args.getAs("double"));
        b.getCustomGoalProcess().setGoal(g);
        b.logDirect(`Goal: ${g}`);
    },
);

const click = simple(
    ["click"],
    "Open click",
    [
        "Opens a GUI to select positions using your mouse.",
        "Beditone: there is no GUI, so it uses the block you are looking at (up to 256 blocks away).",
        "- click / click right: walk onto the block.",
        "- click left: walk into the block.",
        "",
        "Usage:",
        "> click [left|right]",
    ],
    (b, _l, args) => {
        args.requireMax(1);
        const mode = args.hasAny() ? args.getString().toLowerCase() : "right";
        const pos = b.viewerLookingAt();
        if (pos === null) {
            throw new CommandInvalidStateException("You aren't looking at a block");
        }
        const g: Goal = mode === "left" ? GoalTwoBlocks.of(pos) : GoalBlock.of(pos.above());
        b.getCustomGoalProcess().setGoalAndPath(g);
        b.logDirect("aight dude");
    },
);

const mine = simple(
    ["mine"],
    "Mine some blocks",
    [
        "The mine command allows you to tell Baritone to search for and mine individual blocks.",
        "",
        "The specified blocks can be ores, or any other block.",
        "",
        "Also see the legitMine settings (see #set l legitMine).",
        "",
        "Usage:",
        "> mine <blocks...> - Mine blocks.",
        "> mine <n> <blocks...> - Mine blocks until you have n of their drops.",
        "",
        "Examples:",
        "> mine diamond_ore deepslate_diamond_ore - Mines all diamonds it can find.",
        "> mine 64 diamond_ore - Mines diamond ore until you have 64 diamonds.",
    ],
    (b, _l, args) => {
        const quantity = args.getAsOrDefault("int", 0);
        args.requireMin(1);
        const boms: BlockOptionalMeta[] = [];
        while (args.hasAny()) {
            boms.push(forBlockOptionalMeta(args));
        }
        b.logDirect(`Mining [${boms.map((x) => x.toString()).join(", ")}]`);
        b.getMineProcess().mineBoms(quantity, boms);
    },
);

const follow = simple(
    ["follow"],
    "Follow entity things",
    [
        "The follow command tells Baritone to follow certain kinds of entities.",
        "",
        "Usage:",
        "> follow entities - Follows all entities.",
        "> follow entity <entity1> <entity2> <...> - Follow certain entities (for example 'skeleton', 'horse' etc.)",
        "> follow players - Follow players",
        "> follow player <username1> <username2> <...> - Follow certain players",
    ],
    (b, _l, args) => {
        args.requireMin(1);
        const fp = b.getFollowProcess();
        if (args.hasExactlyOne()) {
            const group = args.getString().toLowerCase();
            if (group === "entities") {
                fp.follow((e) => e.isLiving);
            } else if (group === "players") {
                fp.follow((e) => e.isPlayer);
            } else {
                throw new CommandInvalidTypeException(args.consumed(), "entities or players", group);
            }
            b.logDirect(`Following all ${group}`);
            return;
        }
        args.requireMin(2);
        const list = args.getString().toLowerCase();
        if (list === "entity") {
            const classes: string[] = [];
            while (args.hasAny()) classes.push(entityClassById(args));
            fp.follow((e) => classes.includes(e.typeId));
            b.logDirect("Following these types of entities:");
            classes.forEach((c) => b.logDirect(c));
        } else if (list === "player") {
            const ids: string[] = [];
            const names: string[] = [];
            while (args.hasAny()) {
                const p = nearbyPlayer(b, args);
                ids.push(p.id);
                names.push(p.name);
            }
            if (ids.length === 0) throw new CommandInvalidStateException("No valid entities in range!");
            fp.follow((e) => ids.includes(e.id));
            b.logDirect("Following these entities:");
            names.forEach((n) => b.logDirect(n));
        } else {
            throw new CommandInvalidTypeException(args.consumed(), "entity or player", list);
        }
    },
);

const pickup = simple(["pickup"], "Pickup items", ["Usage:", "> pickup - Pickup anything", "> pickup <item1> <item2> <...> - Pickup certain items"], (b, _l, args) => {
    const collecting = new Set<string>();
    while (args.hasAny()) {
        collecting.add(itemById(args));
    }
    if (collecting.size === 0) {
        b.getFollowProcess().pickup(() => true);
        b.logDirect("Picking up all items");
    } else {
        b.getFollowProcess().pickup((id) => collecting.has(id));
        b.logDirect("Picking up these items:");
        collecting.forEach((c) => b.logDirect(c));
    }
});

const explore = simple(
    ["explore"],
    "Explore things",
    ["Tell Baritone to explore chunks it does not have cached yet by distance.", "If you used explorefilter before this, it will be applied.", "", "Usage:", "> explore - Explore from your current position.", "> explore <x> <z> - Explore from the specified X and Z position."],
    (b, _l, args) => {
        if (args.hasAny()) {
            args.requireExactly(2);
        } else {
            args.requireMax(0);
        }
        const feet = b.getPlayerContext().playerFeet();
        const g = args.hasAny() ? relativeGoalXZ(args, feet) : GoalXZ.fromPos(feet);
        b.getExploreProcess().explore(g.getX(), g.getZ());
        b.logDirect(`Exploring from ${g.toString()}`);
    },
);

const exploreFilter = simple(
    ["explorefilter"],
    "Explore chunks from a json",
    [
        "Apply an explore filter before using explore, which tells the explore process which chunks have been explored/not explored.",
        "",
        "Beditone: scripts can't read files, so paste the JSON array of {\"x\":..,\"z\":..} chunk positions inline.",
        "",
        "If 'invert' is given, the chunks in the list are unexplored, otherwise they're explored.",
        "",
        "Usage:",
        "> explorefilter <json> [invert] - Load the filter",
    ],
    (b, _l, args) => {
        args.requireMin(1);
        let raw = args.rawRest().trim();
        let invertIt = false;
        if (/\sinvert$/i.test(raw)) {
            invertIt = true;
            raw = raw.replace(/\sinvert$/i, "");
        }
        let positions: { x: number; z: number }[];
        try {
            positions = JSON.parse(raw);
        } catch {
            throw new CommandInvalidStateException("Invalid JSON syntax");
        }
        b.getExploreProcess().applyChunkListFilter(positions, invertIt);
        b.logDirect(`Explore filter applied. Inverted: ${invertIt}`);
    },
);

const farm = simple(
    ["farm"],
    "Farm nearby crops",
    ["The farm command starts farming nearby plants. It harvests mature crops and plants new ones.", "", "Usage:", "> farm - farms every crop it can find.", "> farm <range> - farm crops within range from the starting position.", "> farm <range> <waypoint> - farm crops within range from waypoint."],
    (b, _l, args) => {
        args.requireMax(2);
        let range = 0;
        let origin: BetterBlockPos | null = null;
        if (args.has(1)) {
            range = args.getAs("int");
        }
        if (args.has(1)) {
            const waypoints = forWaypoints(b, args);
            if (waypoints.length === 0) throw new CommandInvalidStateException("No waypoints found");
            if (waypoints.length > 1) throw new CommandInvalidStateException("Multiple waypoints were found");
            origin = waypoints[0].location;
        }
        b.getFarmProcess().farm(range, origin);
        b.logDirect("Farming");
    },
);

const blacklist = simple(
    ["blacklist"],
    "Blacklist closest block",
    ["While going to a block this command blacklists the closest block so that Baritone won't attempt to get to it.", "", "Usage:", "> blacklist"],
    (b, _l, args) => {
        args.requireMax(0);
        const p = b.getGetToBlockProcess();
        if (!p.isActive()) {
            throw new CommandInvalidStateException("GetToBlockProcess is not currently active");
        }
        if (p.blacklistClosest()) {
            b.logDirect("Blacklisted closest instances");
        } else {
            throw new CommandInvalidStateException("No known locations, unable to blacklist");
        }
    },
);

const find = simple(
    ["find"],
    "Find positions of a certain block",
    ["The find command searches through Baritone's cache and attempts to find the location of the block.", "Beditone: it scans the loaded chunks around the bot instead.", "", "Usage:", "> find <block> [...] - Try finding the listed blocks"],
    (b, _l, args) => {
        args.requireMin(1);
        const boms: BlockOptionalMeta[] = [];
        while (args.hasAny()) boms.push(forBlockOptionalMeta(args));
        const lookup = new BlockOptionalMetaLookup(...boms);
        const ctx = b.getPlayerContext();
        b.runJob(
            (function* () {
                const found = yield* scanChunkRadius(ctx, b.getBlockScanner(), lookup, 64, 10, 32);
                if (found.length === 0) {
                    b.logDirect("No positions known, are you sure the blocks are loaded?");
                    return;
                }
                const feet = ctx.playerFeet();
                found.sort((p, q) => feet.distSqr(p) - feet.distSqr(q));
                for (const p of found) b.logDirect(`${b.getPlayerContext().bsi().get(p).typeId} ${p.x} ${p.y} ${p.z}`);
            })(),
        );
    },
);

const WP_ACTIONS: Record<string, string[]> = {
    LIST: ["list", "get", "l"],
    CLEAR: ["clear", "c"],
    SAVE: ["save", "s"],
    INFO: ["info", "show", "i"],
    DELETE: ["delete", "d"],
    RESTORE: ["restore"],
    GOAL: ["goal", "g"],
    GOTO: ["goto"],
};

function wpAction(name: string): string | null {
    for (const [a, names] of Object.entries(WP_ACTIONS)) {
        if (names.includes(name.toLowerCase())) return a;
    }
    return null;
}

function wpLine(w: Waypoint): string {
    return `§7${w.tag.toUpperCase()} §7${w.name || "§8<empty>"} §8@ ${new Date(w.creationTimestamp).toISOString()} §7(${w.location.x} ${w.location.y} ${w.location.z})`;
}

const deletedWaypoints = new WeakMap<object, Waypoint[]>();

const waypoints = simple(
    ["waypoints", "waypoint", "wp"],
    "Manage waypoints",
    [
        "The waypoint command allows you to manage Baritone's waypoints.",
        "",
        "Waypoints can be used to mark positions for later. Waypoints are each given a tag and an optional name.",
        "",
        "Note that the info, delete, and goal commands let you specify a waypoint by tag. If there is more than one waypoint with a certain tag, then they will let you select which waypoint you mean.",
        "",
        "Missing arguments for the save command use the USER tag, creating an unnamed waypoint and your current position as defaults.",
        "",
        "Usage:",
        "> wp [l/list] - List all waypoints.",
        "> wp <l/list> <tag> - List all waypoints by tag.",
        "> wp <s/save> - Save an unnamed USER waypoint at your current position",
        "> wp <s/save> [tag] [name] [pos] - Save a waypoint with the specified tag, name and position.",
        "> wp <i/info/show> <tag/name> - Show info on a waypoint by tag or name.",
        "> wp <d/delete> <tag/name> - Delete a waypoint by tag or name.",
        "> wp <restore> <n> - Restore the last n deleted waypoints.",
        "> wp <c/clear> <tag> - Delete all waypoints with the specified tag.",
        "> wp <g/goal> <tag/name> - Set a goal to a waypoint by tag or name.",
        "> wp <goto> <tag/name> - Set a goal to a waypoint by tag or name and start pathing.",
    ],
    (b, label, args) => {
        const action = args.hasAny() ? wpAction(args.getString()) : "LIST";
        if (action === null) {
            throw new CommandInvalidTypeException(args.consumed(), "an action");
        }
        const collection = b.getWorldData().getWaypoints();
        const deletedKey = collection as unknown as object;
        if (!deletedWaypoints.has(deletedKey)) deletedWaypoints.set(deletedKey, []);
        const deleted = deletedWaypoints.get(deletedKey)!;
        if (action === "LIST") {
            const tag = args.hasAny() ? tagByName(args.peekString()) : null;
            if (tag !== null) {
                args.get();
            }
            const list = (tag !== null ? collection.getByTag(tag) : collection.getAllWaypoints()).sort((a, c) => c.creationTimestamp - a.creationTimestamp);
            if (list.length > 0) {
                args.requireMax(1);
                paginate(b, args, list, () => b.logDirect(tag !== null ? `All waypoints by tag ${tag.toUpperCase()}:` : "All waypoints:"), wpLine, `${settings.prefix.value}${label} list${tag ? " " + tag : ""}`);
            } else {
                args.requireMax(0);
                throw new CommandInvalidStateException(tag !== null ? "No waypoints found by that tag" : "No waypoints found");
            }
        } else if (action === "SAVE") {
            let tag = args.hasAny() ? tagByName(args.peekString()) : null;
            if (tag === null) {
                tag = WaypointTag.USER;
            } else {
                args.get();
            }
            const name = args.hasExactlyOne() || args.hasExactly(4) ? args.getString() : "";
            const feet = b.getPlayerContext().playerFeet();
            const pos = args.hasAny() ? relativeBlockPos(args, feet) : feet;
            args.requireMax(0);
            const waypoint = new Waypoint(name, tag, pos);
            collection.addWaypoint(waypoint);
            b.logDirect("§7Waypoint added: " + wpLine(waypoint));
        } else if (action === "CLEAR") {
            args.requireMax(1);
            const name = args.getString();
            const tag = tagByName(name);
            if (tag === null) {
                throw new CommandInvalidStateException(`Invalid tag, "${name}"`);
            }
            const list = collection.getByTag(tag);
            for (const w of list) collection.removeWaypoint(w);
            deleted.push(...list);
            b.logDirect(`Cleared ${list.length} waypoints, use ${settings.prefix.value}${label} restore ${list.length} to restore them`);
        } else if (action === "RESTORE") {
            let toRestore: Waypoint[] = [];
            if (args.hasAny() && args.peekString() === "@") {
                args.get();
                while (args.hasAny()) {
                    const timestamp = args.getAs("long");
                    const w = deleted.find((d) => d.creationTimestamp === timestamp);
                    if (w) toRestore.push(w);
                }
            } else {
                args.requireExactly(1);
                const size = deleted.length;
                const amount = Math.min(size, args.getAs("int"));
                toRestore = deleted.slice(size - amount, size);
            }
            toRestore.forEach((w) => collection.addWaypoint(w));
            for (const w of toRestore) deleted.splice(deleted.indexOf(w), 1);
            b.logDirect(`Restored ${toRestore.length} waypoints`);
        } else {
            const list = forWaypoints(b, args);
            let waypoint: Waypoint | null = null;
            if (args.hasAny() && args.peekString() === "@") {
                args.requireExactly(2);
                args.get();
                const timestamp = args.getAs("long");
                waypoint = list.find((w) => w.creationTimestamp === timestamp) ?? null;
                if (waypoint === null) {
                    throw new CommandInvalidStateException("Timestamp was specified but no waypoint was found");
                }
            } else {
                if (list.length === 0) throw new CommandInvalidStateException("No waypoints found");
                if (list.length === 1) waypoint = list[0];
            }
            if (waypoint === null) {
                args.requireMax(1);
                paginate(b, args, list, () => b.logDirect(`Multiple waypoints were found, use ${settings.prefix.value}${label} ${WP_ACTIONS[action][0]} <tag/name> @ <timestamp>:`), (w) => wpLine(w) + ` §8@ ${w.creationTimestamp}`, `${settings.prefix.value}${label} ${WP_ACTIONS[action][0]} ${args.consumedString()}`);
            } else if (action === "INFO") {
                b.logDirect(wpLine(waypoint));
                b.logDirect(`Position: ${waypoint.location}`);
                b.logDirect(`§7Delete: ${settings.prefix.value}${label} delete ${waypoint.tag} @ ${waypoint.creationTimestamp}`);
                b.logDirect(`§7Goal: ${settings.prefix.value}${label} goal ${waypoint.tag} @ ${waypoint.creationTimestamp}`);
                b.logDirect(`§7Recreate: ${settings.prefix.value}${label} save ${waypoint.tag} ${waypoint.name} ${waypoint.location.x} ${waypoint.location.y} ${waypoint.location.z}`);
            } else if (action === "DELETE") {
                collection.removeWaypoint(waypoint);
                deleted.push(waypoint);
                b.logDirect(`That waypoint has successfully been deleted, use ${settings.prefix.value}${label} restore @ ${waypoint.creationTimestamp} to restore it`);
            } else if (action === "GOAL") {
                const g = GoalBlock.of(waypoint.location);
                b.getCustomGoalProcess().setGoal(g);
                b.logDirect(`Goal: ${g}`);
            } else if (action === "GOTO") {
                const g = GoalBlock.of(waypoint.location);
                b.getCustomGoalProcess().setGoalAndPath(g);
                b.logDirect(`Going to: ${g}`);
            }
        }
    },
);

const build = simple(
    ["build"],
    "Build a schematic",
    [
        "Build a schematic from a file.",
        "Beditone: schematics are Bedrock structures (saved with a structure block or /structure save).",
        "",
        "Usage:",
        "> build <structure> - Loads and builds the structure at your position",
        "> build <structure> <x> <y> <z> - Custom position",
    ],
    (b, _l, args) => {
        args.requireMin(1);
        const name = args.getString();
        const origin = b.getPlayerContext().playerFeet();
        let buildOrigin: BetterBlockPos;
        if (args.hasAny()) {
            args.requireMax(3);
            buildOrigin = relativeBlockPos(args, origin);
        } else {
            args.requireMax(0);
            buildOrigin = origin;
        }
        const id = name.includes(":") ? name : "mystructure:" + name;
        const success = b.getBuilderProcess().buildStructure(name, buildOrigin) || b.getBuilderProcess().buildStructure(id, buildOrigin);
        if (!success) {
            throw new CommandInvalidStateException(`Cannot find structure ${name}`);
        }
        b.logDirect(`Successfully loaded schematic for building`);
        b.logDirect(`Origin: ${buildOrigin}`);
    },
);

const SEL_ACTIONS: Record<string, string[]> = {
    POS1: ["pos1", "p1", "1"],
    POS2: ["pos2", "p2", "2"],
    CLEAR: ["clear", "c"],
    UNDO: ["undo", "u"],
    SET: ["set", "fill", "s", "f"],
    WALLS: ["walls", "w"],
    SHELL: ["shell", "shl"],
    SPHERE: ["sphere", "sph"],
    HSPHERE: ["hsphere", "hsph"],
    CYLINDER: ["cylinder", "cyl"],
    HCYLINDER: ["hcylinder", "hcyl"],
    CLEARAREA: ["cleararea", "ca"],
    REPLACE: ["replace", "r"],
    EXPAND: ["expand", "ex"],
    COPY: ["copy", "cp"],
    PASTE: ["paste", "p"],
    CONTRACT: ["contract", "ct"],
    SHIFT: ["shift", "sh"],
};
const FILL_ACTIONS = ["SET", "WALLS", "SHELL", "SPHERE", "HSPHERE", "CYLINDER", "HCYLINDER", "CLEARAREA", "REPLACE"];

function selAction(name: string): string | null {
    for (const [a, names] of Object.entries(SEL_ACTIONS)) {
        if (names.includes(name.toLowerCase())) return a;
    }
    return null;
}

const selState = new WeakMap<IBaritone, { pos1: BetterBlockPos | null; clipboard: ISchematic | null; clipboardOffset: BetterBlockPos | null }>();

export function selectionPos1(b: IBaritone): BetterBlockPos | null {
    return selState.get(b)?.pos1 ?? null;
}

const sel = simple(
    ["sel", "selection", "s"],
    "WorldEdit-like commands",
    [
        "The sel command allows you to manipulate Baritone's selections, similarly to WorldEdit.",
        "",
        "Using these selections, you can clear areas, fill them with blocks, or something else.",
        "",
        "The expand/contract/shift commands use a kind of selector to choose which selections to target. Supported ones are a/all, n/newest, and o/oldest.",
        "",
        "Usage:",
        "> sel pos1/p1/1 - Set position 1 to your current position.",
        "> sel pos1/p1/1 <x> <y> <z> - Set position 1 to a relative position.",
        "> sel pos2/p2/2 - Set position 2 to your current position.",
        "> sel pos2/p2/2 <x> <y> <z> - Set position 2 to a relative position.",
        "",
        "> sel clear/c - Clear the selection.",
        "> sel undo/u - Undo the last action (setting positions, creating selections, etc.)",
        "> sel set/fill/s/f [block] - Completely fill all selections with a block.",
        "> sel walls/w [block] - Fill in the walls of the selection with a specified block.",
        "> sel shell/shl [block] - The same as walls, but fills in a ceiling and floor too.",
        "> sel sphere/sph [block] - Fills the selection with a sphere bounded by the sides.",
        "> sel hsphere/hsph [block] - The same as sphere, but hollow.",
        "> sel cylinder/cyl [block] <axis> - Fills the selection with a cylinder bounded by the sides, oriented about the given axis. (default=y)",
        "> sel hcylinder/hcyl [block] <axis> - The same as cylinder, but hollow.",
        "> sel cleararea/ca - Basically 'set air'.",
        "> sel replace/r <blocks...> <with> - Replaces blocks with another block.",
        "> sel copy/cp <x> <y> <z> - Copy the selected area relative to the specified or your position.",
        "> sel paste/p <x> <y> <z> - Build the copied area relative to the specified or your position.",
        "",
        "> sel expand <target> <direction> <blocks> - Expand the targets.",
        "> sel contract <target> <direction> <blocks> - Contract the targets.",
        "> sel shift <target> <direction> <blocks> - Shift the targets (does not resize).",
    ],
    (b, _l, args) => {
        if (!selState.has(b)) selState.set(b, { pos1: null, clipboard: null, clipboardOffset: null });
        const st = selState.get(b)!;
        const manager = b.getSelectionManager();
        const action = selAction(args.getString());
        if (action === null) {
            throw new CommandInvalidTypeException(args.consumed(), "an action");
        }
        const viewer = b.getPlayerContext().viewerPos();
        if (action === "POS1" || action === "POS2") {
            if (action === "POS2" && st.pos1 === null) {
                throw new CommandInvalidStateException("Set pos1 first before using pos2");
            }
            const pos = args.hasAny() ? relativeBlockPos(args, viewer) : viewer;
            args.requireMax(0);
            if (action === "POS1") {
                st.pos1 = pos;
                b.logDirect("Position 1 has been set");
            } else {
                manager.addSelection(st.pos1!, pos);
                st.pos1 = null;
                b.logDirect("Selection added");
            }
        } else if (action === "CLEAR") {
            args.requireMax(0);
            st.pos1 = null;
            b.logDirect(`Removed ${manager.removeAllSelections().length} selections`);
        } else if (action === "UNDO") {
            args.requireMax(0);
            if (st.pos1 !== null) {
                st.pos1 = null;
                b.logDirect("Undid pos1");
            } else {
                const selections = manager.getSelections();
                if (selections.length < 1) {
                    throw new CommandInvalidStateException("Nothing to undo!");
                }
                st.pos1 = manager.removeSelection(selections[selections.length - 1]).pos1();
                b.logDirect("Undid pos2");
            }
        } else if (FILL_ACTIONS.includes(action)) {
            let type = action === "CLEARAREA" ? new BlockOptionalMeta("minecraft:air") : forBlockOptionalMeta(args);
            let replaces: BlockOptionalMetaLookup | null = null;
            let alignment: "x" | "y" | "z" = "y";
            if (action === "REPLACE") {
                args.requireMin(1);
                const replacesList = [type];
                while (args.has(2)) {
                    replacesList.push(forBlockOptionalMeta(args));
                }
                type = forBlockOptionalMeta(args);
                replaces = new BlockOptionalMetaLookup(...replacesList);
            } else if (action === "CYLINDER" || action === "HCYLINDER") {
                args.requireMax(1);
                alignment = args.hasAny() ? forAxis(args) : "y";
            } else {
                args.requireMax(0);
            }
            const selections = manager.getSelections();
            if (selections.length === 0) {
                throw new CommandInvalidStateException("No selections");
            }
            const origin = selectionsOrigin(selections);
            const composite = new CompositeSchematic(0, 0, 0);
            for (const selection of selections) {
                const size = selection.size();
                const min = selection.min();
                const fill = new FillSchematic(size.x, size.y, size.z, type);
                const w = size.x;
                const h = size.y;
                const l = size.z;
                let schematic: ISchematic;
                switch (action) {
                    case "WALLS":
                        schematic = new WallsSchematic(fill);
                        break;
                    case "SHELL":
                        schematic = new ShellSchematic(fill);
                        break;
                    case "REPLACE":
                        schematic = new ReplaceSchematic(fill, replaces!);
                        break;
                    case "SPHERE":
                        schematic = MaskSchematic.create(fill, computeMask(w, h, l, sphereMask(w, h, l, true)));
                        break;
                    case "HSPHERE":
                        schematic = MaskSchematic.create(fill, computeMask(w, h, l, sphereMask(w, h, l, false)));
                        break;
                    case "CYLINDER":
                        schematic = MaskSchematic.create(fill, computeMask(w, h, l, cylinderMask(w, h, l, true, alignment)));
                        break;
                    case "HCYLINDER":
                        schematic = MaskSchematic.create(fill, computeMask(w, h, l, cylinderMask(w, h, l, false, alignment)));
                        break;
                    default:
                        schematic = fill;
                }
                composite.put(schematic, min.x - origin.x, min.y - origin.y, min.z - origin.z);
            }
            b.getBuilderProcess().build("Fill", composite, origin);
            b.logDirect("Filling now");
        } else if (action === "COPY") {
            const pos = args.hasAny() ? relativeBlockPos(args, viewer) : viewer;
            args.requireMax(0);
            const selections = manager.getSelections();
            if (selections.length < 1) {
                throw new CommandInvalidStateException("No selections");
            }
            const bsi = b.getPlayerContext().bsi();
            const origin = selectionsOrigin(selections);
            const composite = new CompositeSchematic(0, 0, 0);
            for (const selection of selections) {
                const size = selection.size();
                const min = selection.min();
                const blockstates: BlockState[][][] = [];
                for (let x = 0; x < size.x; x++) {
                    blockstates.push([]);
                    for (let z = 0; z < size.z; z++) {
                        blockstates[x].push([]);
                        for (let y = 0; y < size.y; y++) {
                            blockstates[x][z].push(bsi.get0(min.x + x, min.y + y, min.z + z));
                        }
                    }
                }
                composite.put(new StaticSchematic(blockstates), min.x - origin.x, min.y - origin.y, min.z - origin.z);
            }
            st.clipboard = composite;
            st.clipboardOffset = origin.subtract(pos);
            b.logDirect("Selection copied");
        } else if (action === "PASTE") {
            const pos = args.hasAny() ? relativeBlockPos(args, viewer) : viewer;
            args.requireMax(0);
            if (st.clipboard === null) {
                throw new CommandInvalidStateException("You need to copy a selection first");
            }
            b.getBuilderProcess().build("Paste", st.clipboard, pos.offset(st.clipboardOffset!));
            b.logDirect("Building now");
        } else if (action === "EXPAND" || action === "CONTRACT" || action === "SHIFT") {
            args.requireExactly(3);
            const target = args.getString().toLowerCase();
            let selections = manager.getSelections();
            if (selections.length < 1) {
                throw new CommandInvalidStateException("No selections found");
            }
            if (["newest", "n"].includes(target)) {
                selections = [selections[selections.length - 1]];
            } else if (["oldest", "o"].includes(target)) {
                selections = [selections[0]];
            } else if (!["all", "a"].includes(target)) {
                throw new CommandInvalidStateException("Invalid transform type");
            }
            const direction = forDirection(args);
            const blocks = args.getAs("int");
            for (const s of selections) {
                if (action === "EXPAND") manager.expand(s, direction, blocks);
                else if (action === "CONTRACT") manager.contract(s, direction, blocks);
                else manager.shift(s, direction, blocks);
            }
            b.logDirect(`Transformed ${selections.length} selections`);
        }
    },
);

function selectionsOrigin(selections: Selection[]): BetterBlockPos {
    let origin = selections[0].min();
    for (const s of selections) {
        const min = s.min();
        origin = new BetterBlockPos(Math.min(origin.x, min.x), Math.min(origin.y, min.y), Math.min(origin.z, min.z));
    }
    return origin;
}

function unsupported(names: string[], shortDesc: string, why: string): CommandFactory {
    return simple(names, shortDesc, [why], (b) => {
        throw new CommandInvalidStateException(why);
    });
}

const elytra = unsupported(["elytra"], "elytra time", "Elytra flight isn't available in Beditone: simulated players can't be steered precisely enough mid-flight, and Bedrock elytra physics differ from the ones Baritone simulates.");
const litematica = unsupported(["litematica"], "Builds the loaded schematic", "Litematica is a Java client mod. Use #build <structure> with a Bedrock structure instead.");
const repack = simple(["repack", "rescan"], "Re-cache chunks", ["Beditone has no chunk cache; mining scans loaded chunks directly.", "", "Usage:", "> repack"], (b, _l, args) => {
    args.requireMax(0);
    b.logDirect("Queued 0 chunks for repacking (Beditone scans loaded chunks live, there is no cache to repack)");
});
const gc = simple(["gc"], "Call System.gc()", ["There is no System.gc() in the Bedrock script engine; this does nothing.", "", "Usage:", "> gc"], (b, _l, args) => {
    args.requireMax(0);
    b.logDirect("ok called System.gc() (no-op on Bedrock)");
});
const render = simple(["render"], "Fix glitched chunks", ["Re-renders chunks on the Java client. Bedrock servers can't touch client rendering; this does nothing.", "", "Usage:", "> render"], (b, _l, args) => {
    args.requireMax(0);
    b.logDirect("Done");
});
const reloadAll = simple(["reloadall"], "Reloads Baritone's cache for this world", ["Beditone has no chunk cache; this does nothing.", "", "Usage:", "> reloadall"], (b, _l, args) => {
    args.requireMax(0);
    b.logDirect("ok");
});
const saveAll = simple(["saveall"], "Saves Baritone's cache for this world", ["Beditone has no chunk cache; this does nothing.", "", "Usage:", "> saveall"], (b, _l, args) => {
    args.requireMax(0);
    b.logDirect("ok");
});

class PauseProcess extends BaritoneProcess {
    paused = false;

    isActive(): boolean {
        return this.paused;
    }

    onTick(): PathingCommand {
        this.baritone.getInputOverrideHandler().clearAllKeys();
        return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
    }

    override isTemporary(): boolean {
        return true;
    }

    onLostControl(): void {}

    override priority(): number {
        return DEFAULT_PRIORITY + 1;
    }

    displayName0(): string {
        return "Pause/Resume Commands";
    }
}

function executionControlCommands(b: IBaritone): Command[] {
    const p = new PauseProcess(b);
    b.getPathingControlManager().registerProcess(p);
    return [
        simple(["pause", "p", "paws"], "Pauses Baritone until you use resume", ["The pause command tells Baritone to temporarily stop whatever it's doing.", "", "This can be used to pause pathing, building, following, whatever. A single use of the resume command will start it right back up again!", "", "Usage:", "> pause"], (bb, _l, args) => {
            args.requireMax(0);
            if (p.paused) {
                throw new CommandInvalidStateException("Already paused");
            }
            p.paused = true;
            bb.logDirect("Paused");
        })(b),
        simple(["resume", "r", "unpause", "unpaws"], "Resumes Baritone after a pause", ["The resume command tells Baritone to resume whatever it was doing when you last used pause.", "", "Usage:", "> resume"], (bb, _l, args) => {
            args.requireMax(0);
            if (!p.paused && !bb.getBuilderProcess().isPaused()) {
                throw new CommandInvalidStateException("Not paused");
            }
            bb.getBuilderProcess().resume();
            p.paused = false;
            bb.logDirect("Resumed");
        })(b),
        simple(["paused"], "Tells you if Baritone is paused", ["The paused command tells you if Baritone is currently paused by use of the pause command.", "", "Usage:", "> paused"], (bb, _l, args) => {
            args.requireMax(0);
            bb.logDirect(`Baritone is ${p.paused ? "" : "not "}paused`);
        })(b),
        simple(["cancel", "c", "stop"], "Cancel what Baritone is currently doing", ["The cancel command tells Baritone to stop whatever it's currently doing.", "", "Usage:", "> cancel"], (bb, _l, args) => {
            args.requireMax(0);
            if (p.paused) {
                p.paused = false;
            }
            bb.getPathingBehavior().cancelEverything();
            bb.logDirect("ok canceled");
        })(b),
    ];
}

const bot = simple(
    ["bot"],
    "Manage your Beditone bot (Beditone only)",
    ["Beditone drives a simulated player. This command manages it.", "", "Usage:", "> bot spawn - Spawn your bot next to you (it spawns automatically on your first command)", "> bot remove - Disconnect your bot", "> bot tp - Teleport your bot to you", "> bot kit - Give the bot the starterKitItems", "> bot inv - Show the bot's hotbar"],
    (b, _l, args) => {
        args.requireMax(1);
        const action = args.hasAny() ? args.getString().toLowerCase() : "spawn";
        b.botCommand(action);
    },
);

export function createAll(b: IBaritone): Command[] {
    const factories: CommandFactory[] = [
        help,
        set,
        alias(["modified", "mod", "baritone", "modifiedsettings"], "List modified settings", "set modified"),
        alias(["reset"], "Reset all settings or just one", "set reset"),
        goal,
        gotoCmd,
        path,
        proc,
        eta,
        version,
        repack,
        build,
        litematica,
        come,
        axis,
        forceCancel,
        gc,
        invert,
        tunnel,
        render,
        farm,
        follow,
        pickup,
        exploreFilter,
        reloadAll,
        saveAll,
        explore,
        blacklist,
        find,
        mine,
        click,
        surface,
        thisway,
        waypoints,
        alias(["sethome"], "Sets your home waypoint", "waypoints save home"),
        alias(["home"], "Path to your home waypoint", "waypoints goto home"),
        sel,
        elytra,
        bot,
    ];
    const commands = factories.map((f) => f(b));
    commands.push(...executionControlCommands(b));
    return commands;
}
