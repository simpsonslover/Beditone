import { settings, Color } from "../Settings";
import type { Beditone } from "../Beditone";
import { Goal, GoalComposite, GoalGetToBlock, GoalInverted, GoalTwoBlocks, GoalXZ, GoalYLevel, hasGoalPos } from "../goals/Goal";
import type { BetterBlockPos, Vec3 } from "../utils/BetterBlockPos";
import { selectionPos1 } from "../commands/DefaultCommands";

export const PATH_PARTICLE = "minecraft:colored_flame_particle";
const STEP = 0.5;

export interface ParticleSink {
    readonly isValid: boolean;
    readonly location: Vec3;
    spawn(x: number, y: number, z: number, color: Color): void;
}

export class PathRenderer {
    private budget = 0;

    constructor(private readonly viewer: ParticleSink, private readonly baritone: Beditone) {}

    private point(x: number, y: number, z: number, color: Color): void {
        if (this.budget-- <= 0) return;
        try {
            this.viewer.spawn(x, y, z, color);
        } catch {
            this.budget = 0;
        }
    }

    private line(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: Color): void {
        const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2);
        const n = Math.max(1, Math.ceil(len / STEP));
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            this.point(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t, color);
        }
    }

    render(): void {
        if (!this.viewer.isValid) return;
        this.budget = settings.renderMaxParticles.value;
        const behavior = this.baritone.getPathingBehavior();
        const goal = behavior.getGoal();
        if (goal !== null && settings.renderGoal.value) {
            this.drawGoal(goal, settings.colorGoalBox.value);
        }
        this.drawSelections();
        if (!settings.renderPath.value) {
            return;
        }
        const current = behavior.getCurrent();
        const next = behavior.getNext();
        if (current !== null && settings.renderSelectionBoxes.value) {
            this.drawManySelectionBoxes([...current.toBreak()], settings.colorBlocksToBreak.value);
            this.drawManySelectionBoxes([...current.toPlace()], settings.colorBlocksToPlace.value);
            this.drawManySelectionBoxes([...current.toWalkInto()], settings.colorBlocksToWalkInto.value);
        }
        if (current !== null) {
            const renderBegin = Math.max(current.getPosition() - 3, 0);
            this.drawPath(current.getPath().positions(), renderBegin, settings.colorCurrentPath.value);
        }
        if (next !== null) {
            this.drawPath(next.getPath().positions(), 0, settings.colorNextPath.value);
        }
        const inProgress = behavior.getInProgress();
        if (inProgress !== null) {
            const best = inProgress.bestPathSoFar();
            if (best) this.drawPath(best.positions(), 0, settings.colorBestPathSoFar.value);
            const mr = inProgress.pathToMostRecentNodeConsidered();
            if (mr) {
                this.drawPath(mr.positions(), 0, settings.colorMostRecentConsidered.value);
                this.drawManySelectionBoxes([mr.getDest()], settings.colorMostRecentConsidered.value);
            }
        }
    }

    drawPath(positions: readonly BetterBlockPos[], startIndex: number, color: Color): void {
        const fadeOut = settings.fadePath.value;
        const fadeEnd = 20 + startIndex;
        for (let i = startIndex, next: number; i < positions.length - 1; i = next) {
            const start = positions[i];
            let end = positions[(next = i + 1)];
            const dirX = end.x - start.x;
            const dirY = end.y - start.y;
            const dirZ = end.z - start.z;
            while (next + 1 < positions.length && dirX === positions[next + 1].x - end.x && dirY === positions[next + 1].y - end.y && dirZ === positions[next + 1].z - end.z) {
                end = positions[++next];
            }
            if (fadeOut && i > fadeEnd) {
                break;
            }
            this.line(start.x + 0.5, start.y + 0.5, start.z + 0.5, end.x + 0.5, end.y + 0.5, end.z + 0.5, color);
        }
    }

    drawManySelectionBoxes(positions: BetterBlockPos[], color: Color): void {
        const bsi = this.baritone.getPlayerContext().bsi();
        for (const pos of positions) {
            const b = bsi.get(pos).bounds() ?? [0, 0, 0, 1, 1, 1];
            this.box(pos.x + b[0], pos.y + b[1], pos.z + b[2], pos.x + b[3], pos.y + b[4], pos.z + b[5], color);
        }
    }

    private box(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, c: Color): void {
        this.line(x1, y1, z1, x2, y1, z1, c);
        this.line(x2, y1, z1, x2, y1, z2, c);
        this.line(x2, y1, z2, x1, y1, z2, c);
        this.line(x1, y1, z2, x1, y1, z1, c);
        this.line(x1, y2, z1, x2, y2, z1, c);
        this.line(x2, y2, z1, x2, y2, z2, c);
        this.line(x2, y2, z2, x1, y2, z2, c);
        this.line(x1, y2, z2, x1, y2, z1, c);
        this.line(x1, y1, z1, x1, y2, z1, c);
        this.line(x2, y1, z1, x2, y2, z1, c);
        this.line(x2, y1, z2, x2, y2, z2, c);
        this.line(x1, y1, z2, x1, y2, z2, c);
    }

    drawGoal(goal: Goal, color: Color): void {
        let y: number;
        if (!settings.renderGoalAnimated.value) {
            y = 0.999;
        } else {
            y = Math.cos(((Date.now() % 2000) / 2000) * Math.PI * 2);
        }
        if (hasGoalPos(goal)) {
            const goalPos = goal.getGoalPos();
            const minX = goalPos.x + 0.002;
            const maxX = goalPos.x + 1 - 0.002;
            const minZ = goalPos.z + 0.002;
            const maxZ = goalPos.z + 1 - 0.002;
            if (goal instanceof GoalGetToBlock || goal instanceof GoalTwoBlocks) {
                y /= 2;
            }
            let y1 = 1 + y + goalPos.y;
            let y2 = 1 - y + goalPos.y;
            const minY = goalPos.y;
            let maxY = minY + 2;
            if (goal instanceof GoalGetToBlock || goal instanceof GoalTwoBlocks) {
                y1 -= 0.5;
                y2 -= 0.5;
                maxY--;
            }
            this.drawDankLitGoalBox(color, minX, maxX, minZ, maxZ, minY, maxY, y1, y2);
        } else if (goal instanceof GoalXZ) {
            const vy = this.viewer.location.y;
            const minY = Math.floor(vy) - 16;
            const maxY = Math.floor(vy) + 16;
            this.drawDankLitGoalBox(color, goal.getX() + 0.002, goal.getX() + 1 - 0.002, goal.getZ() + 0.002, goal.getZ() + 1 - 0.002, minY, maxY, 0, 0);
        } else if (goal instanceof GoalComposite) {
            for (const g of goal.goals()) {
                this.drawGoal(g, color);
            }
        } else if (goal instanceof GoalInverted) {
            this.drawGoal(goal.origin, settings.colorInvertedGoalBox.value);
        } else if (goal instanceof GoalYLevel) {
            const p = this.baritone.getPlayerContext().player().position();
            const size = settings.yLevelBoxSize.value;
            this.drawDankLitGoalBox(color, p.x - size, p.x + size, p.z - size, p.z + size, goal.level, goal.level + 2, 1 + y + goal.level, 1 - y + goal.level);
        }
    }

    private drawDankLitGoalBox(color: Color, minX: number, maxX: number, minZ: number, maxZ: number, minY: number, maxY: number, y1: number, y2: number): void {
        this.renderHorizontalQuad(minX, maxX, minZ, maxZ, y1, color);
        this.renderHorizontalQuad(minX, maxX, minZ, maxZ, y2, color);
        this.line(minX, minY, minZ, minX, maxY, minZ, color);
        this.line(maxX, minY, minZ, maxX, maxY, minZ, color);
        this.line(maxX, minY, maxZ, maxX, maxY, maxZ, color);
        this.line(minX, minY, maxZ, minX, maxY, maxZ, color);
    }

    private renderHorizontalQuad(minX: number, maxX: number, minZ: number, maxZ: number, y: number, color: Color): void {
        if (y !== 0) {
            this.line(minX, y, minZ, maxX, y, minZ, color);
            this.line(maxX, y, minZ, maxX, y, maxZ, color);
            this.line(maxX, y, maxZ, minX, y, maxZ, color);
            this.line(minX, y, maxZ, minX, y, minZ, color);
        }
    }

    private drawSelections(): void {
        if (!settings.renderSelection.value) return;
        for (const sel of this.baritone.getSelectionManager().getSelections()) {
            const min = sel.min();
            const max = sel.max();
            this.box(min.x, min.y, min.z, max.x + 1, max.y + 1, max.z + 1, settings.colorSelection.value);
            if (settings.renderSelectionCorners.value) {
                this.cornerBox(sel.pos1(), settings.colorSelectionPos1.value);
                this.cornerBox(sel.pos2(), settings.colorSelectionPos2.value);
            }
        }
        const pos1 = selectionPos1(this.baritone);
        if (pos1 && settings.renderSelectionCorners.value) {
            this.cornerBox(pos1, settings.colorSelectionPos1.value);
        }
    }

    private cornerBox(p: Vec3, color: Color): void {
        this.box(p.x, p.y, p.z, p.x + 1, p.y + 1, p.z + 1, color);
    }
}
