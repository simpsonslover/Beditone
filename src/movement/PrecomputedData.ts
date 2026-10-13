import { settings } from "../Settings";
import type { BlockState } from "../world/BlockState";
import { Blocks } from "../world/Blocks";
import type { BlockStateInterface } from "../world/BlockStateInterface";
import { MovementHelper, Ternary } from "./MovementHelper";

const COMPLETED_MASK = 1;
const FULLY_PASSABLE_MAYBE_MASK = 1 << 1;
const FULLY_PASSABLE_MASK = 1 << 2;
const CAN_WALK_THROUGH_MAYBE_MASK = 1 << 3;
const CAN_WALK_THROUGH_MASK = 1 << 4;
const CAN_WALK_ON_MAYBE_MASK = 1 << 5;
const CAN_WALK_ON_MASK = 1 << 6;
const CAN_PLACE_AGAINST_MASK = 1 << 7;
const NEVER_BREAK_MASK = 1 << 8;

let shared: PrecomputedData | null = null;

export class PrecomputedData {
    private data: number[] = [];
    private readonly allowWalkOnMagmaBlocks = settings.allowWalkOnMagmaBlocks.value;
    private readonly allowVines = settings.allowVines.value;
    private readonly assumeWalkOnLava = settings.assumeWalkOnLava.value;
    private readonly allowWalkOnBottomSlab = settings.allowWalkOnBottomSlab.value;
    private readonly blocksToAvoid = settings.blocksToAvoid.value.join(",");
    private readonly blocksToDisallowBreaking = settings.blocksToDisallowBreaking.value.join(",");

    static forCurrentSettings(): PrecomputedData {
        let s = shared;
        if (!s || !s.matchesCurrentSettings()) {
            s = new PrecomputedData();
            shared = s;
        }
        return s;
    }

    private matchesCurrentSettings(): boolean {
        return (
            this.allowWalkOnMagmaBlocks === settings.allowWalkOnMagmaBlocks.value &&
            this.allowVines === settings.allowVines.value &&
            this.assumeWalkOnLava === settings.assumeWalkOnLava.value &&
            this.allowWalkOnBottomSlab === settings.allowWalkOnBottomSlab.value &&
            this.blocksToAvoid === settings.blocksToAvoid.value.join(",") &&
            this.blocksToDisallowBreaking === settings.blocksToDisallowBreaking.value.join(",")
        );
    }

    private fillData(state: BlockState): number {
        let blockData = 0;
        switch (MovementHelper.canWalkOnBlockState(state)) {
            case Ternary.YES:
                blockData |= CAN_WALK_ON_MASK;
                break;
            case Ternary.MAYBE:
                blockData |= CAN_WALK_ON_MAYBE_MASK;
                break;
        }
        switch (MovementHelper.canWalkThroughBlockState(state)) {
            case Ternary.YES:
                blockData |= CAN_WALK_THROUGH_MASK;
                break;
            case Ternary.MAYBE:
                blockData |= CAN_WALK_THROUGH_MAYBE_MASK;
                break;
        }
        switch (MovementHelper.fullyPassableBlockState(state)) {
            case Ternary.YES:
                blockData |= FULLY_PASSABLE_MASK;
                break;
            case Ternary.MAYBE:
                blockData |= FULLY_PASSABLE_MAYBE_MASK;
                break;
        }
        if (MovementHelper.isBlockNormalCube(state) || Blocks.isGlass(state)) {
            blockData |= CAN_PLACE_AGAINST_MASK;
        }
        if (
            settings.blocksToDisallowBreaking.value.includes(state.typeId) ||
            state.name === "ice" ||
            Blocks.isInfested(state)
        ) {
            blockData |= NEVER_BREAK_MASK;
        }
        blockData |= COMPLETED_MASK;
        this.data[state.id] = blockData;
        return blockData;
    }

    private flags(state: BlockState): number {
        const d = this.data[state.id];
        return d === undefined ? this.fillData(state) : d;
    }

    canWalkOn(bsi: BlockStateInterface, x: number, y: number, z: number, state: BlockState): boolean {
        const blockData = this.flags(state);
        if ((blockData & CAN_WALK_ON_MAYBE_MASK) !== 0) {
            return MovementHelper.canWalkOnPosition(bsi, x, y, z, state);
        }
        return (blockData & CAN_WALK_ON_MASK) !== 0;
    }

    canWalkThrough(bsi: BlockStateInterface, x: number, y: number, z: number, state: BlockState): boolean {
        const blockData = this.flags(state);
        if ((blockData & CAN_WALK_THROUGH_MAYBE_MASK) !== 0) {
            return MovementHelper.canWalkThroughPosition(bsi, x, y, z, state);
        }
        return (blockData & CAN_WALK_THROUGH_MASK) !== 0;
    }

    fullyPassable(bsi: BlockStateInterface, x: number, y: number, z: number, state: BlockState): boolean {
        const blockData = this.flags(state);
        if ((blockData & FULLY_PASSABLE_MAYBE_MASK) !== 0) {
            return MovementHelper.fullyPassablePosition(bsi, x, y, z, state);
        }
        return (blockData & FULLY_PASSABLE_MASK) !== 0;
    }

    canPlaceAgainst(state: BlockState): boolean {
        return (this.flags(state) & CAN_PLACE_AGAINST_MASK) !== 0;
    }

    neverBreak(state: BlockState): boolean {
        return (this.flags(state) & NEVER_BREAK_MASK) !== 0;
    }
}
