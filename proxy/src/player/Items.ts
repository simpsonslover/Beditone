import { createRequire } from "node:module";
import { EMPTY_ITEM, ItemInfo } from "../../../src/utils/IPlayerContext";

const require = createRequire(import.meta.url);

export interface NetItem {
    network_id: number;
    count: number;
    metadata: number;
    has_stack_id?: boolean;
    stack_id?: number;
    block_runtime_id: number;
    extra?: any;
}

export class Items {
    private readonly names = new Map<number, string>();
    private readonly maxDurability = new Map<string, number>();
    private readonly enchantNames = new Map<number, string>();
    private readonly cache = new WeakMap<NetItem, ItemInfo>();

    constructor(version: string) {
        const data = require("minecraft-data")("bedrock_" + version);
        for (const it of data.itemsArray ?? []) {
            if (it.maxDurability) this.maxDurability.set("minecraft:" + it.name, it.maxDurability);
        }
        for (const e of data.enchantmentsArray ?? []) this.enchantNames.set(e.id, e.name);
    }

    loadRegistry(itemstates: { name: string; runtime_id: number }[]): void {
        for (const s of itemstates) this.names.set(s.runtime_id, s.name.includes(":") ? s.name : "minecraft:" + s.name);
    }

    name(networkId: number): string {
        if (networkId === 0) return "minecraft:air";
        return this.names.get(networkId) ?? "minecraft:unknown_" + networkId;
    }

    empty(): NetItem {
        return { network_id: 0, count: 0, metadata: 0, has_stack_id: false, block_runtime_id: 0 };
    }

    isEmpty(item: NetItem | null | undefined): boolean {
        return !item || item.network_id === 0 || item.count <= 0;
    }

    info(item: NetItem): ItemInfo {
        if (this.isEmpty(item)) return EMPTY_ITEM;
        let info = this.cache.get(item);
        if (info) return info;
        const typeId = this.name(item.network_id);
        const nbt = item.extra?.nbt?.nbt?.value ?? {};
        const damage = Number(nbt.Damage?.value ?? 0);
        const enchantments: Record<string, number> = {};
        for (const e of nbt.ench?.value?.value ?? []) {
            const id = Number(e.id?.value);
            const name = this.enchantNames.get(id);
            if (name) enchantments[name] = Number(e.lvl?.value ?? 1);
        }
        info = { typeId, amount: item.count, damage, maxDamage: this.maxDurability.get(typeId) ?? 0, enchantments };
        this.cache.set(item, info);
        return info;
    }
}
