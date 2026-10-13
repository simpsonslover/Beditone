import { BlockState } from "./BlockState";
import type { Direction } from "../utils/BetterBlockPos";
import { Directions } from "../utils/BetterBlockPos";

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const AIRS = set("air structure_void");
const FIRES = set("fire soul_fire");
const FALLING = set(
    "sand red_sand gravel anvil chipped_anvil damaged_anvil dragon_egg " +
        ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]
            .map((c) => c + "_concrete_powder")
            .join(" "),
);
const CLIMBABLE = set("ladder vine weeping_vines twisting_vines");
const REPLACEABLE = set(
    "air water flowing_water lava flowing_lava short_grass tall_grass fern large_fern deadbush seagrass fire soul_fire vine glow_lichen " +
        "structure_void hanging_roots crimson_roots warped_roots nether_sprouts bubble_column light_block_0 light_block_1 light_block_2 light_block_3 " +
        "light_block_4 light_block_5 light_block_6 light_block_7 light_block_8 light_block_9 light_block_10 light_block_11 light_block_12 " +
        "light_block_13 light_block_14 light_block_15 short_dry_grass tall_dry_grass bush leaf_litter",
);
const CHESTS = set("chest trapped_chest ender_chest");
const AZALEA = set("azalea flowering_azalea");
const AMETHYST = set("amethyst_cluster small_amethyst_bud medium_amethyst_bud large_amethyst_bud");

export const Blocks = {
    isAir(s: BlockState): boolean {
        return AIRS.has(s.name) || s.name.startsWith("light_block");
    },
    isFire(s: BlockState): boolean {
        return FIRES.has(s.name);
    },
    isFalling(s: BlockState): boolean {
        return FALLING.has(s.name);
    },
    isClimbable(s: BlockState): boolean {
        return CLIMBABLE.has(s.name);
    },
    isLiquidBlock(s: BlockState): boolean {
        const n = s.name;
        return n === "water" || n === "flowing_water" || n === "lava" || n === "flowing_lava";
    },
    isSlab(s: BlockState): boolean {
        return s.name.endsWith("_slab");
    },
    isDoubleSlab(s: BlockState): boolean {
        return s.name.endsWith("_double_slab");
    },
    isBottomSlab(s: BlockState): boolean {
        return Blocks.isSlab(s) && !Blocks.isDoubleSlab(s) && s.get("vertical_half") !== "top";
    },
    isTopSlab(s: BlockState): boolean {
        return Blocks.isSlab(s) && !Blocks.isDoubleSlab(s) && s.get("vertical_half") === "top";
    },
    isStairs(s: BlockState): boolean {
        return s.name.endsWith("_stairs");
    },
    isTrapdoor(s: BlockState): boolean {
        return s.name.endsWith("trapdoor");
    },
    isDoor(s: BlockState): boolean {
        return s.name.endsWith("_door");
    },
    isWoodenDoor(s: BlockState): boolean {
        return Blocks.isDoor(s) && s.name !== "iron_door";
    },
    isFenceGate(s: BlockState): boolean {
        return s.name.endsWith("fence_gate");
    },
    isCarpet(s: BlockState): boolean {
        return s.name.endsWith("carpet");
    },
    isSnowLayer(s: BlockState): boolean {
        return s.name === "snow_layer";
    },
    snowLayers(s: BlockState): number {
        return Number(s.get("height") ?? 0) + 1;
    },
    isShulkerBox(s: BlockState): boolean {
        return s.name.endsWith("shulker_box");
    },
    isSkull(s: BlockState): boolean {
        return s.name.endsWith("_skull") || s.name.endsWith("_head") || s.name === "skull";
    },
    isAmethystCluster(s: BlockState): boolean {
        return AMETHYST.has(s.name);
    },
    isAzalea(s: BlockState): boolean {
        return AZALEA.has(s.name);
    },
    isCauldron(s: BlockState): boolean {
        return s.name === "cauldron" || s.name.endsWith("_cauldron");
    },
    isChest(s: BlockState): boolean {
        return CHESTS.has(s.name);
    },
    isGlass(s: BlockState): boolean {
        return s.name === "glass" || s.name.endsWith("_stained_glass") || s.name === "tinted_glass";
    },
    isLeaves(s: BlockState): boolean {
        return s.name.endsWith("leaves");
    },
    isInfested(s: BlockState): boolean {
        return s.name.startsWith("infested_");
    },
    isBed(s: BlockState): boolean {
        return s.name === "bed" || s.name.endsWith("_bed");
    },
    isLilyPad(s: BlockState): boolean {
        return s.name === "waterlily";
    },
    isReplaceableName(s: BlockState): boolean {
        return REPLACEABLE.has(s.name);
    },
    isScaffolding(s: BlockState): boolean {
        return s.name === "scaffolding";
    },
    isBambooStalk(s: BlockState): boolean {
        return s.name === "bamboo";
    },
    isMovingPiston(s: BlockState): boolean {
        return s.name === "moving_block";
    },
    isPointedDripstone(s: BlockState): boolean {
        return s.name === "pointed_dripstone";
    },
    isMagma(s: BlockState): boolean {
        return s.name === "magma";
    },
    isSoulSand(s: BlockState): boolean {
        return s.name === "soul_sand";
    },
    isFarmland(s: BlockState): boolean {
        return s.name === "farmland";
    },
    isDirtPath(s: BlockState): boolean {
        return s.name === "grass_path" || s.name === "dirt_path";
    },
    isOpen(s: BlockState): boolean {
        return s.get("open_bit") === true;
    },
    facing(s: BlockState): Direction {
        const c = s.get("cardinal_direction");
        switch (c) {
            case "north":
                return Directions.NORTH;
            case "east":
                return Directions.EAST;
            case "west":
                return Directions.WEST;
            default:
                return Directions.SOUTH;
        }
    },
    ladderFacing(s: BlockState): Direction {
        switch (Number(s.get("facing_direction") ?? 2)) {
            case 3:
                return Directions.SOUTH;
            case 4:
                return Directions.WEST;
            case 5:
                return Directions.EAST;
            default:
                return Directions.NORTH;
        }
    },
};
