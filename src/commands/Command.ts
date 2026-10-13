import type { IBaritone } from "../IBaritone";

export class CommandException extends Error {
    handle(baritone: IBaritone): void {
        baritone.logDirect(this.message, "§c");
    }
}

export class CommandErrorMessageException extends CommandException {}

export class CommandInvalidStateException extends CommandErrorMessageException {}

export class CommandNotEnoughArgumentsException extends CommandErrorMessageException {
    constructor(minArgs: number) {
        super(`Not enough arguments (expected at least ${minArgs})`);
    }
}

export class CommandTooManyArgumentsException extends CommandErrorMessageException {
    constructor(maxArgs: number) {
        super(`Too many arguments (expected at most ${maxArgs})`);
    }
}

export class CommandInvalidTypeException extends CommandErrorMessageException {
    constructor(arg: CommandArgument | null, expected: string, actual?: string | unknown) {
        const where = arg ? `Invalid argument at index ${arg.index}: ` : "Invalid argument: ";
        const got = actual === undefined ? "" : typeof actual === "string" ? `, but got ${actual} instead` : actual instanceof Error ? ` (${actual.message})` : "";
        super(`${where}expected ${expected}${got}`);
    }
}

export class CommandNotFoundException extends CommandErrorMessageException {
    constructor(command: string) {
        super(`Command not found: ${command}`);
    }
}

export class CommandArgument {
    constructor(readonly index: number, readonly value: string, readonly rawRest: string) {}

    is(type: "int" | "double" | "long"): boolean {
        return parseNumber(this.value, type) !== null;
    }

    getAs(type: "int" | "double" | "long"): number {
        const n = parseNumber(this.value, type);
        if (n === null) {
            throw new CommandInvalidTypeException(this, type === "double" ? "a double" : "an integer");
        }
        return n;
    }
}

function parseNumber(s: string, type: "int" | "double" | "long"): number | null {
    if (type === "double") {
        return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null;
    }
    return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
}

export function argumentsFrom(string: string, preserveEmptyLast = false): CommandArgument[] {
    const args: CommandArgument[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(string)) !== null) {
        args.push(new CommandArgument(i++, m[0], string.substring(m.index)));
    }
    if (preserveEmptyLast && /\s$/.test(string)) {
        args.push(new CommandArgument(i, "", ""));
    }
    return args;
}

export class ArgConsumer {
    private readonly args: CommandArgument[];
    readonly consumedList: CommandArgument[] = [];

    constructor(readonly baritone: IBaritone, args: CommandArgument[]) {
        this.args = [...args];
    }

    has(num: number): boolean {
        return this.args.length >= num;
    }

    hasAny(): boolean {
        return this.has(1);
    }

    hasAtMost(num: number): boolean {
        return this.args.length <= num;
    }

    hasAtMostOne(): boolean {
        return this.hasAtMost(1);
    }

    hasExactly(num: number): boolean {
        return this.args.length === num;
    }

    hasExactlyOne(): boolean {
        return this.hasExactly(1);
    }

    peek(index = 0): CommandArgument {
        this.requireMin(index + 1);
        return this.args[index];
    }

    peekString(index = 0): string {
        return this.peek(index).value;
    }

    is(type: "int" | "double" | "long", index = 0): boolean {
        return this.has(index + 1) && this.peek(index).is(type);
    }

    peekAsOrNull(type: "int" | "double" | "long", index = 0): number | null {
        return this.is(type, index) ? this.peek(index).getAs(type) : null;
    }

    get(): CommandArgument {
        this.requireMin(1);
        const arg = this.args.shift()!;
        this.consumedList.push(arg);
        return arg;
    }

    getString(): string {
        return this.get().value;
    }

    getAs(type: "int" | "double" | "long"): number {
        return this.get().getAs(type);
    }

    getAsOrDefault(type: "int" | "double" | "long", def: number): number {
        if (this.is(type)) {
            return this.getAs(type);
        }
        return def;
    }

    peekDatatypeOrNull<T>(fn: (c: ArgConsumer) => T): T | null {
        const copy = this.copy();
        try {
            return fn(copy);
        } catch {
            return null;
        }
    }

    getDatatype<T>(fn: (c: ArgConsumer) => T): T {
        try {
            return fn(this);
        } catch (e) {
            if (e instanceof CommandException) throw e;
            throw new CommandInvalidTypeException(this.hasAny() ? this.peek() : this.consumed(), "a valid value", e);
        }
    }

    rawRest(): string {
        return this.args.length ? this.args[0].rawRest : "";
    }

    consumed(): CommandArgument | null {
        return this.consumedList.length ? this.consumedList[this.consumedList.length - 1] : null;
    }

    consumedString(): string {
        return this.consumed()?.value ?? "";
    }

    remaining(): number {
        return this.args.length;
    }

    requireMin(min: number): void {
        if (this.args.length < min) {
            throw new CommandNotEnoughArgumentsException(min + this.consumedList.length);
        }
    }

    requireMax(max: number): void {
        if (this.args.length > max) {
            throw new CommandTooManyArgumentsException(max + this.consumedList.length);
        }
    }

    requireExactly(args: number): void {
        this.requireMin(args);
        this.requireMax(args);
    }

    copy(): ArgConsumer {
        const c = new ArgConsumer(this.baritone, this.args);
        c.consumedList.push(...this.consumedList);
        return c;
    }
}

export abstract class Command {
    readonly names: string[];

    constructor(protected readonly baritone: IBaritone, ...names: string[]) {
        this.names = names.map((n) => n.toLowerCase());
    }

    protected get ctx() {
        return this.baritone.getPlayerContext();
    }

    abstract execute(label: string, args: ArgConsumer): void;

    abstract getShortDesc(): string;

    abstract getLongDesc(): string[];

    hiddenFromHelp(): boolean {
        return false;
    }

    protected logDirect(msg: string, color?: string): void {
        for (const line of msg.split("\n")) this.baritone.logDirect(line, color);
    }
}

export function paginate<T>(baritone: IBaritone, args: ArgConsumer, items: T[], pre: () => void, transform: (t: T) => string, commandPrefix: string, pageSize = 8): void {
    let page = 1;
    args.requireMax(1);
    if (args.hasAny()) {
        page = args.getAs("int");
    }
    const maxPage = Math.max(1, Math.ceil(items.length / pageSize));
    if (page < 1 || page > maxPage) {
        throw new CommandInvalidTypeException(args.consumed(), `a valid page (1-${maxPage})`, String(page));
    }
    pre();
    for (const item of items.slice((page - 1) * pageSize, page * pageSize)) {
        baritone.logDirect(transform(item));
    }
    if (maxPage > 1) {
        baritone.logDirect(`§7--- page ${page}/${maxPage} ---${page < maxPage ? ` next: ${commandPrefix} ${page + 1}` : ""}`);
    }
}
