import { settings } from "../Settings";
import { BlockState, Tool } from "./BlockState";
import { EMPTY_ITEM, isEmpty, ItemInfo } from "../utils/IPlayerContext";

const MATERIALS: [string, number, number][] = [
    ["wooden_", 2, 1],
    ["stone_", 4, 2],
    ["copper_", 5, 2],
    ["iron_", 6, 3],
    ["diamond_", 8, 4],
    ["netherite_", 9, 4],
    ["golden_", 12, 1],
];
const MATERIAL_PRIORITY = ["wooden_", "stone_", "iron_", "golden_", "diamond_", "netherite_"];

function toolKind(id: string): Tool {
    if (id.endsWith("_pickaxe")) return Tool.PICKAXE;
    if (id.endsWith("_axe")) return Tool.AXE;
    if (id.endsWith("_shovel")) return Tool.SHOVEL;
    if (id.endsWith("_hoe")) return Tool.HOE;
    if (id.endsWith("_sword")) return Tool.SWORD;
    if (id === "minecraft:shears") return Tool.SHEARS;
    return Tool.NONE;
}

function material(id: string): [number, number] | null {
    const name = id.startsWith("minecraft:") ? id.substring(10) : id;
    for (const [prefix, speed, tier] of MATERIALS) {
        if (name.startsWith(prefix)) return [speed, tier];
    }
    return null;
}

export function itemDestroySpeed(item: ItemInfo, state: BlockState): number {
    if (isEmpty(item)) return 1;
    const kind = toolKind(item.typeId);
    if (kind === Tool.NONE) return 1;
    if (kind === Tool.SHEARS) {
        if (state.name === "web" || state.tool === Tool.HOE) return 15;
        if (state.name.endsWith("wool")) return 5;
        if (state.name === "vine" || state.name === "glow_lichen") return 2;
        return 1;
    }
    if (kind === Tool.SWORD) {
        if (state.name === "web") return 15;
        if (state.tool === Tool.SWORD) return 1.5;
        if (state.tool === Tool.HOE || state.name.includes("melon") || state.name.includes("pumpkin")) return 1.5;
        return 1;
    }
    const mat = material(item.typeId);
    if (!mat) return 1;
    return state.tool === kind ? mat[0] : 1;
}

export function isCorrectToolForDrops(item: ItemInfo, state: BlockState): boolean {
    if (state.tier <= 0) return true;
    if (toolKind(item.typeId) !== Tool.PICKAXE) return false;
    const mat = material(item.typeId);
    return !!mat && mat[1] >= state.tier;
}

export function requiresCorrectToolForDrops(state: BlockState): boolean {
    return state.tier > 0;
}

export class ToolSet {
    private readonly breakStrengthCache = new Map<number, number>();
    private readonly potionAmplifier: number;

    constructor(private readonly hotbar: readonly ItemInfo[], effects?: (name: string) => number | undefined) {
        this.potionAmplifier = settings.considerPotionEffects.value && effects ? ToolSet.computePotionAmplifier(effects) : 1;
    }

    getStrVsBlock(state: BlockState): number {
        let v = this.breakStrengthCache.get(state.id);
        if (v === undefined) {
            v = this.potionAmplifier * this.getBestDestructionTime(state);
            this.breakStrengthCache.set(state.id, v);
        }
        return v;
    }

    private static materialCost(item: ItemInfo): number {
        const name = item.typeId.startsWith("minecraft:") ? item.typeId.substring(10) : item.typeId;
        return MATERIAL_PRIORITY.findIndex((p) => name.startsWith(p));
    }

    static hasSilkTouch(item: ItemInfo): boolean {
        return (item.enchantments["silk_touch"] ?? 0) > 0;
    }

    getBestSlot(state: BlockState, preferSilkTouch: boolean): number {
        let best = 0;
        let highestSpeed = -Infinity;
        let lowestCost = -2147483648;
        let bestSilkTouch = false;
        for (let i = 0; i < 9; i++) {
            const itemStack = this.hotbar[i] ?? EMPTY_ITEM;
            if (!settings.useSwordToMine.value && itemStack.typeId.endsWith("_sword")) {
                continue;
            }
            if (settings.itemSaver.value && itemStack.damage + settings.itemSaverThreshold.value >= itemStack.maxDamage && itemStack.maxDamage > 1) {
                continue;
            }
            const speed = ToolSet.calculateSpeedVsBlock(itemStack, state);
            const silkTouch = ToolSet.hasSilkTouch(itemStack);
            if (speed > highestSpeed) {
                highestSpeed = speed;
                best = i;
                lowestCost = ToolSet.materialCost(itemStack);
                bestSilkTouch = silkTouch;
            } else if (speed === highestSpeed) {
                const cost = ToolSet.materialCost(itemStack);
                if ((cost < lowestCost && (silkTouch || !bestSilkTouch)) || (preferSilkTouch && !bestSilkTouch && silkTouch)) {
                    highestSpeed = speed;
                    best = i;
                    lowestCost = cost;
                    bestSilkTouch = silkTouch;
                }
            }
        }
        return best;
    }

    private getBestDestructionTime(state: BlockState): number {
        const stack = this.hotbar[this.getBestSlot(state, false)] ?? EMPTY_ITEM;
        return ToolSet.calculateSpeedVsBlock(stack, state) * ToolSet.avoidanceMultiplier(state);
    }

    private static avoidanceMultiplier(state: BlockState): number {
        return settings.blocksToAvoidBreaking.value.includes(state.typeId) ? settings.avoidBreakingMultiplier.value : 1;
    }

    static calculateSpeedVsBlock(item: ItemInfo, state: BlockState): number {
        const hardness = state.hardness;
        if (hardness < 0) {
            return -1;
        }
        let speed = itemDestroySpeed(item, state);
        if (speed > 1) {
            const eff = item.enchantments["efficiency"] ?? 0;
            if (eff > 0) {
                speed += eff * eff + 1;
            }
        }
        speed /= hardness;
        if (!requiresCorrectToolForDrops(state) || (!isEmpty(item) && isCorrectToolForDrops(item, state))) {
            return speed / 30;
        }
        return speed / 100;
    }

    private static computePotionAmplifier(effects: (name: string) => number | undefined): number {
        let speed = 1;
        const haste = effects("haste");
        if (haste !== undefined) {
            speed *= 1 + (haste + 1) * 0.2;
        }
        const fatigue = effects("mining_fatigue");
        if (fatigue !== undefined) {
            switch (fatigue) {
                case 0:
                    speed *= 0.3;
                    break;
                case 1:
                    speed *= 0.09;
                    break;
                case 2:
                    speed *= 0.0027;
                    break;
                default:
                    speed *= 0.00081;
                    break;
            }
        }
        return speed;
    }
}
