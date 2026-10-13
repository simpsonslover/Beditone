import { settings } from "../Settings";
import type { IBaritone } from "../IBaritone";
import { ArgConsumer, argumentsFrom, Command, CommandArgument, CommandException, CommandNotFoundException } from "./Command";
import { createAll } from "./DefaultCommands";

export const FORCE_COMMAND_PREFIX = "#\u0000";

export class CommandManager {
    private commands: Command[] = [];

    constructor(private readonly baritone: IBaritone) {}

    init(): void {
        this.commands = createAll(this.baritone);
    }

    getAll(): Command[] {
        return this.commands;
    }

    getCommand(name: string): Command | null {
        const lower = name.toLowerCase();
        return this.commands.find((c) => c.names.includes(lower)) ?? null;
    }

    static expand(string: string, preserveEmptyLast = false): [string, CommandArgument[]] {
        const label = string.split(" ", 1)[0];
        const args = argumentsFrom(string.substring(label.length), preserveEmptyLast);
        return [label, args];
    }

    execute(stringOrPair: string | [string, CommandArgument[]]): boolean {
        const [label, args] = typeof stringOrPair === "string" ? CommandManager.expand(stringOrPair) : stringOrPair;
        const command = this.getCommand(label);
        if (command === null) {
            return false;
        }
        try {
            command.execute(label, new ArgConsumer(this.baritone, args));
        } catch (e) {
            if (e instanceof CommandException) {
                e.handle(this.baritone);
            } else {
                this.baritone.logDirect("An unhandled exception occurred. The error is in your game's log, please report this at https://github.com/cabaletta/baritone/issues (Beditone: report it to the Beditone port, not upstream)", "§c");
                console.warn("[Beditone] " + ((e as Error)?.stack ?? e));
            }
        }
        return true;
    }
}

export class ExampleBaritoneControl {
    constructor(private readonly baritone: IBaritone, private readonly manager: CommandManager) {}

    onSendChatMessage(msg: string): boolean {
        const prefix = settings.prefix.value;
        const forceRun = msg.startsWith(FORCE_COMMAND_PREFIX);
        if ((settings.prefixControl.value && msg.startsWith(prefix)) || forceRun) {
            const commandStr = msg.substring(forceRun ? FORCE_COMMAND_PREFIX.length : prefix.length);
            if (!this.runCommand(commandStr) && commandStr.trim() !== "") {
                new CommandNotFoundException(CommandManager.expand(commandStr)[0]).handle(this.baritone);
            }
            return true;
        } else if ((settings.chatControl.value || settings.chatControlAnyway.value) && this.runCommand(msg)) {
            return true;
        }
        return false;
    }

    private logRanCommand(command: string, rest: string): void {
        if (settings.echoCommands.value) {
            const msg = command + rest;
            const toDisplay = settings.censorRanCommands.value ? command + " ..." : msg;
            this.baritone.logDirect(`> ${toDisplay}`, "§f");
        }
    }

    runCommand(msg: string): boolean {
        if (msg.trim().toLowerCase() === "damn") {
            this.baritone.logDirect("daniel");
            return false;
        } else if (msg.trim().toLowerCase() === "orderpizza") {
            return false;
        }
        if (msg === "") {
            return this.runCommand("help");
        }
        const pair = CommandManager.expand(msg);
        const command = pair[0];
        const rest = msg.substring(pair[0].length);
        const argc = new ArgConsumer(this.baritone, pair[1]);
        if (!argc.hasAny()) {
            const setting = settings.byLowerName.get(command.toLowerCase());
            if (setting) {
                this.logRanCommand(command, rest);
                if (setting.type === "boolean") {
                    this.manager.execute(`set toggle ${setting.name}`);
                } else {
                    this.manager.execute(`set ${setting.name}`);
                }
                return true;
            }
        } else if (argc.hasExactlyOne()) {
            for (const setting of settings.allSettings) {
                if (setting.name.toLowerCase() === pair[0].toLowerCase()) {
                    this.logRanCommand(command, rest);
                    this.manager.execute(`set ${setting.name} ${argc.getString()}`);
                    return true;
                }
            }
        }
        if (this.manager.getCommand(pair[0]) !== null) {
            this.logRanCommand(command, rest);
        }
        return this.manager.execute(pair);
    }
}
