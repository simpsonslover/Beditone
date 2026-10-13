import { BLOCKS } from "./blockdata.generated";
import type { BlockState, StateValue } from "./BlockState";
import type { ItemInfo } from "../utils/IPlayerContext";

const PATTERN = /^(?<id>(?:[a-z0-9_.-]+:)?[a-z0-9/_.-]+)(?:\[(?<props>(?:[a-z0-9_:]+=[a-z0-9_]+,)*[a-z0-9_:]+=[a-z0-9_]+)?\])?$/;

export class BlockOptionalMeta {
    readonly typeId: string;
    readonly properties: Readonly<Record<string, string>>;

    constructor(selector: string) {
        const m = PATTERN.exec(selector.trim().toLowerCase());
        if (!m || !m.groups) {
            throw new Error("invalid block selector");
        }
        const id = m.groups.id;
        this.typeId = id.includes(":") ? id : "minecraft:" + id;
        const props: Record<string, string> = {};
        if (m.groups.props) {
            for (const kv of m.groups.props.split(",")) {
                const [k, v] = kv.split("=");
                props[k] = v;
            }
        }
        this.properties = props;
    }

    static isKnownBlock(typeId: string): boolean {
        const name = typeId.startsWith("minecraft:") ? typeId.substring(10) : typeId;
        return BLOCKS[name] !== undefined || !typeId.startsWith("minecraft:");
    }

    matches(state: BlockState): boolean {
        if (state.typeId !== this.typeId) return false;
        for (const [k, v] of Object.entries(this.properties)) {
            const actual: StateValue | undefined = state.get(k);
            if (actual === undefined || String(actual) !== v) return false;
        }
        return true;
    }

    matchesItem(stack: ItemInfo): boolean {
        if (stack.typeId === this.typeId) return true;
        const drop = DROPS[this.typeId.substring(10)];
        return drop !== undefined && stack.typeId === "minecraft:" + drop;
    }

    getBlock(): string {
        return this.typeId;
    }

    toString(): string {
        const p = Object.entries(this.properties).map(([k, v]) => `${k}=${v}`);
        return p.length ? `${this.typeId}[${p.join(",")}]` : this.typeId;
    }
}

export class BlockOptionalMetaLookup {
    private readonly boms: BlockOptionalMeta[];

    constructor(...boms: (BlockOptionalMeta | string)[]) {
        this.boms = boms.map((b) => (typeof b === "string" ? new BlockOptionalMeta(b) : b));
    }

    has(state: BlockState): boolean {
        for (const b of this.boms) {
            if (b.matches(state)) return true;
        }
        return false;
    }

    hasItem(stack: ItemInfo): boolean {
        for (const b of this.boms) {
            if (b.matchesItem(stack)) return true;
        }
        return false;
    }

    blocks(): BlockOptionalMeta[] {
        return this.boms;
    }

    typeIds(): string[] {
        return [...new Set(this.boms.map((b) => b.typeId))];
    }

    toString(): string {
        return "BlockOptionalMetaLookup{" + this.boms.map((b) => b.toString()).join(",") + "}";
    }
}

const DROPS: Record<string, string> = {
    stone: "cobblestone",
    deepslate: "cobbled_deepslate",
    coal_ore: "coal",
    deepslate_coal_ore: "coal",
    diamond_ore: "diamond",
    deepslate_diamond_ore: "diamond",
    emerald_ore: "emerald",
    deepslate_emerald_ore: "emerald",
    lapis_ore: "lapis_lazuli",
    deepslate_lapis_ore: "lapis_lazuli",
    redstone_ore: "redstone",
    deepslate_redstone_ore: "redstone",
    lit_redstone_ore: "redstone",
    lit_deepslate_redstone_ore: "redstone",
    iron_ore: "raw_iron",
    deepslate_iron_ore: "raw_iron",
    gold_ore: "raw_gold",
    deepslate_gold_ore: "raw_gold",
    copper_ore: "raw_copper",
    deepslate_copper_ore: "raw_copper",
    nether_gold_ore: "gold_nugget",
    quartz_ore: "quartz",
    grass_block: "dirt",
    gravel: "gravel",
    glowstone: "glowstone_dust",
    clay: "clay_ball",
    melon_block: "melon_slice",
};
