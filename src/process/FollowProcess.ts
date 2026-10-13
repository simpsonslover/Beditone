import { settings } from "../Settings";
import { Goal, GoalBlock, GoalComposite, GoalNear, GoalXZ } from "../goals/Goal";
import { BetterBlockPos } from "../utils/BetterBlockPos";
import type { EntityInfo } from "../utils/IPlayerContext";
import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";

export class FollowProcess extends BaritoneProcess {
    private filter: ((e: EntityInfo) => boolean) | null = null;
    private cache: EntityInfo[] | null = null;
    private into = false;

    onTick(_calcFailed: boolean, _isSafeToCancel: boolean): PathingCommand {
        this.scanWorld();
        const goal = new GoalComposite(...this.cache!.map((e) => this.towards(e)));
        return new PathingCommand(goal, PathingCommandType.REVALIDATE_GOAL_AND_PATH);
    }

    private towards(following: EntityInfo): Goal {
        let pos: BetterBlockPos;
        if (settings.followOffsetDistance.value === 0 || this.into) {
            pos = BetterBlockPos.of(following.position);
        } else {
            const g = GoalXZ.fromDirection(following.position, settings.followOffsetDirection.value, settings.followOffsetDistance.value);
            pos = new BetterBlockPos(g.getX(), Math.floor(following.position.y), g.getZ());
        }
        if (this.into) {
            return GoalBlock.of(pos);
        }
        return new GoalNear(pos, settings.followRadius.value);
    }

    private followable(entity: EntityInfo): boolean {
        if (!entity) {
            return false;
        }
        const me = this.ctx.player().position();
        if (entity.id === this.ctx.player().id()) {
            return false;
        }
        const maxDist = settings.followTargetMaxDistance.value;
        const dx = entity.position.x - me.x;
        const dy = entity.position.y - me.y;
        const dz = entity.position.z - me.z;
        if (maxDist !== 0 && dx * dx + dy * dy + dz * dz > maxDist * maxDist) {
            return false;
        }
        return true;
    }

    private scanWorld(): void {
        const seen = new Set<string>();
        this.cache = this.ctx
            .entities()
            .filter((e) => this.followable(e))
            .filter(this.filter!)
            .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    }

    isActive(): boolean {
        if (this.filter === null) {
            return false;
        }
        this.scanWorld();
        return this.cache!.length > 0;
    }

    onLostControl(): void {
        this.filter = null;
        this.cache = null;
    }

    displayName0(): string {
        return "Following " + (this.cache ?? []).map((e) => e.name || e.typeId).join(", ");
    }

    follow(filter: (e: EntityInfo) => boolean): void {
        this.filter = filter;
        this.into = false;
    }

    pickup(filter: (itemTypeId: string) => boolean): void {
        this.filter = (e) => e.typeId === "minecraft:item" && e.itemTypeId !== undefined && filter(e.itemTypeId);
        this.into = true;
    }

    following(): EntityInfo[] | null {
        return this.cache;
    }

    currentFilter(): ((e: EntityInfo) => boolean) | null {
        return this.filter;
    }
}
