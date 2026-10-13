import { BetterBlockPos, Direction } from "../utils/BetterBlockPos";

export class Selection {
    private readonly min_: BetterBlockPos;
    private readonly max_: BetterBlockPos;

    constructor(readonly pos1_: BetterBlockPos, readonly pos2_: BetterBlockPos) {
        this.min_ = new BetterBlockPos(Math.min(pos1_.x, pos2_.x), Math.min(pos1_.y, pos2_.y), Math.min(pos1_.z, pos2_.z));
        this.max_ = new BetterBlockPos(Math.max(pos1_.x, pos2_.x), Math.max(pos1_.y, pos2_.y), Math.max(pos1_.z, pos2_.z));
    }

    pos1(): BetterBlockPos {
        return this.pos1_;
    }

    pos2(): BetterBlockPos {
        return this.pos2_;
    }

    min(): BetterBlockPos {
        return this.min_;
    }

    max(): BetterBlockPos {
        return this.max_;
    }

    size(): BetterBlockPos {
        return new BetterBlockPos(this.max_.x - this.min_.x + 1, this.max_.y - this.min_.y + 1, this.max_.z - this.min_.z + 1);
    }

    private isPos2(direction: Direction): boolean {
        const positive = direction.x + direction.y + direction.z > 0;
        if (direction.x !== 0) return positive ? this.pos2_.x > this.pos1_.x : this.pos2_.x < this.pos1_.x;
        if (direction.y !== 0) return positive ? this.pos2_.y > this.pos1_.y : this.pos2_.y < this.pos1_.y;
        return positive ? this.pos2_.z > this.pos1_.z : this.pos2_.z < this.pos1_.z;
    }

    expand(direction: Direction, blocks: number): Selection {
        if (this.isPos2(direction)) {
            return new Selection(this.pos1_, this.pos2_.relative(direction, blocks));
        }
        return new Selection(this.pos1_.relative(direction, blocks), this.pos2_);
    }

    contract(direction: Direction, blocks: number): Selection {
        if (this.isPos2(direction)) {
            return new Selection(this.pos1_.relative(direction, blocks), this.pos2_);
        }
        return new Selection(this.pos1_, this.pos2_.relative(direction, blocks));
    }

    shift(direction: Direction, blocks: number): Selection {
        return new Selection(this.pos1_.relative(direction, blocks), this.pos2_.relative(direction, blocks));
    }
}

export class SelectionManager {
    private selections: Selection[] = [];

    addSelection(pos1: BetterBlockPos, pos2: BetterBlockPos): Selection {
        const s = new Selection(pos1, pos2);
        this.selections.push(s);
        return s;
    }

    removeSelection(selection: Selection): Selection {
        this.selections = this.selections.filter((s) => s !== selection);
        return selection;
    }

    removeAllSelections(): Selection[] {
        const old = this.selections;
        this.selections = [];
        return old;
    }

    getSelections(): Selection[] {
        return [...this.selections];
    }

    private replace(selection: Selection, next: Selection): Selection {
        const i = this.selections.indexOf(selection);
        if (i >= 0) this.selections[i] = next;
        return next;
    }

    expand(selection: Selection, direction: Direction, blocks: number): Selection {
        return this.replace(selection, selection.expand(direction, blocks));
    }

    contract(selection: Selection, direction: Direction, blocks: number): Selection {
        return this.replace(selection, selection.contract(direction, blocks));
    }

    shift(selection: Selection, direction: Direction, blocks: number): Selection {
        return this.replace(selection, selection.shift(direction, blocks));
    }
}
