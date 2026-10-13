import { BetterBlockPos, PosSet } from "../../utils/BetterBlockPos";
import type { IBaritone } from "../../IBaritone";
import { COST_INF, FALL_N_BLOCKS_COST, LADDER_DOWN_ONE_COST } from "../ActionCosts";
import type { CalculationContext } from "../CalculationContext";
import { Movement } from "../Movement";
import { MovementHelper } from "../MovementHelper";
import { MovementState, MovementStatus } from "../MovementState";

export class MovementDownward extends Movement {
    private numTicks = 0;

    constructor(baritone: IBaritone | null, start: BetterBlockPos, end: BetterBlockPos) {
        super(baritone, start, end, [end]);
    }

    override reset(): void {
        super.reset();
        this.numTicks = 0;
    }

    calculateCost(context: CalculationContext): number {
        return MovementDownward.cost(context, this.src.x, this.src.y, this.src.z);
    }

    protected calculateValidPositions(): PosSet {
        return new PosSet([this.src, this.dest]);
    }

    static cost(context: CalculationContext, x: number, y: number, z: number): number {
        if (!context.allowDownward) {
            return COST_INF;
        }
        if (!MovementHelper.canWalkOn(context, x, y - 2, z)) {
            return COST_INF;
        }
        const down = context.get(x, y - 1, z);
        if (down.name === "ladder" || down.name === "vine") {
            return LADDER_DOWN_ONE_COST;
        } else {
            return FALL_N_BLOCKS_COST[1] + MovementHelper.getMiningDurationTicks(context, x, y - 1, z, down, false);
        }
    }

    override updateState(state: MovementState): MovementState {
        super.updateState(state);
        if (state.getStatus() !== MovementStatus.RUNNING) {
            return state;
        }
        const ctx = this.ctx;
        if (ctx.playerFeet().equals(this.dest)) {
            return state.setStatus(MovementStatus.SUCCESS);
        } else if (!this.playerInValidPosition()) {
            return state.setStatus(MovementStatus.UNREACHABLE);
        }
        const pos = ctx.player().position();
        const diffX = pos.x - (this.dest.x + 0.5);
        const diffZ = pos.z - (this.dest.z + 0.5);
        const ab = Math.sqrt(diffX * diffX + diffZ * diffZ);

        if (this.numTicks++ < 10 && ab < 0.2) {
            return state;
        }
        MovementHelper.moveTowards(ctx, state, this.positionsToBreak[0]);
        return state;
    }
}
