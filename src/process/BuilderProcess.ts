import { settings } from "../Settings";
import { Goal, GoalBlock, GoalComposite, GoalGetToBlock } from "../goals/Goal";
import { COST_INF } from "../movement/ActionCosts";
import { CalculationContext } from "../movement/CalculationContext";
import { MovementHelper, HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP, inferSneakingEyePosition } from "../movement/MovementHelper";
import { Input } from "../movement/MovementState";
import { ALL_DIRECTIONS, BetterBlockPos, Direction, opposite, PosSet, Vec3 } from "../utils/BetterBlockPos";
import { isEmpty } from "../utils/IPlayerContext";
import { reachable } from "../utils/Reachability";
import { Rotation, RotationUtils } from "../utils/Rotation";
import { BLOCKS } from "../world/blockdata.generated";
import { AIR, BlockState } from "../world/BlockState";
import { Blocks } from "../world/Blocks";
import type { BlockStateInterface } from "../world/BlockStateInterface";
import { BlockOptionalMeta } from "../world/BlockOptionalMeta";
import { FillSchematic, ISchematic, IStaticSchematic, MapArtSchematic, MaskSchematic, MirroredSchematic, RotatedSchematic, SelectionSchematic, SubstituteSchematic } from "../schematic/Schematic";
import { BaritoneProcess, PathingCommand, PathingCommandType } from "./PathingCommand";

const ORIENTATION_PROPS = new Set([
    "pillar_axis",
    "minecraft:cardinal_direction",
    "minecraft:facing_direction",
    "facing_direction",
    "weirdo_direction",
    "upside_down_bit",
    "direction",
    "minecraft:block_face",
    "minecraft:vertical_half",
    "open_bit",
    "rail_direction",
    "torch_facing_direction",
]);

export class GoalBreak extends GoalGetToBlock {
    override isInGoal(x: number, y: number, z: number): boolean {
        if (y > this.y) {
            return false;
        }
        return super.isInGoal(x, y, z);
    }

    override toString(): string {
        return `GoalBreak{x=${this.x},y=${this.y},z=${this.z}}`;
    }
}

class GoalBreakFromAbove extends GoalGetToBlock {
    override isInGoal(x: number, y: number, z: number): boolean {
        if (y > this.y || (x === this.x && y === this.y && z === this.z)) {
            return false;
        }
        return super.isInGoal(x, y, z);
    }
}

export class JankyGoalComposite extends GoalComposite {
    constructor(private readonly primary: Goal, private readonly fallback: Goal) {
        super(primary, fallback);
    }

    override isInGoal(x: number, y: number, z: number): boolean {
        return this.primary.isInGoal(x, y, z) || this.fallback.isInGoal(x, y, z);
    }

    override heuristic(x: number, y: number, z: number): number {
        return this.primary.heuristic(x, y, z);
    }

    override heuristicAtGoal(): number {
        return 0;
    }

    override toString(): string {
        return "JankyComposite Primary: " + this.primary + " Fallback: " + this.fallback;
    }
}

export class GoalAdjacent extends GoalGetToBlock {
    constructor(pos: Vec3, private readonly no: Vec3, private readonly allowSameLevel: boolean) {
        super(pos);
    }

    override isInGoal(x: number, y: number, z: number): boolean {
        if (x === this.x && y === this.y && z === this.z) {
            return false;
        }
        if (x === this.no.x && y === this.no.y && z === this.no.z) {
            return false;
        }
        if (!this.allowSameLevel && y === this.y - 1) {
            return false;
        }
        if (y < this.y - 1) {
            return false;
        }
        return super.isInGoal(x, y, z);
    }

    override heuristic(x: number, y: number, z: number): number {
        return this.y * 100 + super.heuristic(x, y, z);
    }

    override equals(o: Goal | null | undefined): boolean {
        if (!super.equals(o)) return false;
        const g = o as GoalAdjacent;
        return g.allowSameLevel === this.allowSameLevel && g.no.x === this.no.x && g.no.y === this.no.y && g.no.z === this.no.z;
    }

    override toString(): string {
        return `GoalAdjacent{x=${this.x},y=${this.y},z=${this.z}}`;
    }
}

export class GoalPlace extends GoalBlock {
    constructor(placeAt: Vec3) {
        super(placeAt.x, placeAt.y + 1, placeAt.z);
    }

    override heuristic(x: number, y: number, z: number): number {
        return this.y * 100 + super.heuristic(x, y, z);
    }

    override toString(): string {
        return `GoalPlace{x=${this.x},y=${this.y},z=${this.z}}`;
    }
}

interface Placement {
    hotbarSelection: number;
    placeAgainst: BetterBlockPos;
    side: Direction;
    rot: Rotation;
}

function sameBlockstate(first: BlockState, second: BlockState): boolean {
    if (first.typeId !== second.typeId) {
        return false;
    }
    const ignoreDirection = settings.buildIgnoreDirection.value;
    const ignoredProps = settings.buildIgnoreProperties.value;
    if (!ignoreDirection && ignoredProps.length === 0) {
        return first === second;
    }
    for (const prop of Object.keys(first.states)) {
        const bare = prop.startsWith("minecraft:") ? prop.substring(10) : prop;
        if (first.states[prop] !== second.states[prop] && !(ignoreDirection && ORIENTATION_PROPS.has(prop)) && !ignoredProps.includes(prop) && !ignoredProps.includes(bare)) {
            return false;
        }
    }
    return true;
}

function containsBlockState(states: BlockState[], state: BlockState): boolean {
    for (const testee of states) {
        if (sameBlockstate(testee, state)) {
            return true;
        }
    }
    return false;
}

function valid(current: BlockState, desired: BlockState | null, itemVerify: boolean): boolean {
    if (desired === null) {
        return true;
    }
    if (Blocks.isLiquidBlock(current) && settings.okIfWater.value) {
        return true;
    }
    if (Blocks.isAir(current) && Blocks.isAir(desired)) {
        return true;
    }
    if (Blocks.isAir(current) && settings.okIfAir.value.includes(desired.typeId)) {
        return true;
    }
    if (Blocks.isAir(desired) && settings.buildIgnoreBlocks.value.includes(current.typeId)) {
        return true;
    }
    if (!Blocks.isAir(current) && settings.buildIgnoreExisting.value && !itemVerify) {
        return true;
    }
    if ((settings.buildValidSubstitutes.value.get(desired.typeId) ?? []).includes(current.typeId) && !itemVerify) {
        return true;
    }
    if (current === desired) {
        return true;
    }
    if (itemVerify) {
        return current.typeId === desired.typeId;
    }
    return sameBlockstate(current, desired);
}

export class BuilderCalculationContext extends CalculationContext {
    private readonly placeable: BlockState[];
    private readonly schematic: ISchematic;
    private readonly originX: number;
    private readonly originY: number;
    private readonly originZ: number;

    constructor(private readonly builder: BuilderProcess) {
        super(builder.baritoneRef().calculationContextParams());
        this.placeable = builder.approxPlaceableN(9);
        this.schematic = builder.schematicRef()!;
        const origin = builder.originRef()!;
        this.originX = origin.x;
        this.originY = origin.y;
        this.originZ = origin.z;
        this.jumpPenalty += 10;
        this.backtrackCostFavoringCoefficient = 1;
    }

    getSchematic(x: number, y: number, z: number, current: BlockState): BlockState | null {
        if (this.schematic.inSchematic(x - this.originX, y - this.originY, z - this.originZ, current)) {
            return this.schematic.desiredState(x - this.originX, y - this.originY, z - this.originZ, current, this.builder.approxPlaceableList());
        }
        return null;
    }

    override costOfPlacingAt(x: number, y: number, z: number, current: BlockState): number {
        if (this.isPossiblyProtected(x, y, z) || !this.worldBorder.canPlaceAt(x, z)) {
            return COST_INF;
        }
        const sch = this.getSchematic(x, y, z, current);
        if (sch !== null) {
            if (Blocks.isAir(sch)) {
                return this.placeBlockCost * settings.placeIncorrectBlockPenaltyMultiplier.value;
            }
            if (this.placeable.some((p) => p.typeId === sch.typeId)) {
                return 0;
            }
            if (!this.hasThrowaway) {
                return COST_INF;
            }
            return this.placeBlockCost * 1.5 * settings.placeIncorrectBlockPenaltyMultiplier.value;
        } else {
            if (this.hasThrowaway) {
                return this.placeBlockCost;
            } else {
                return COST_INF;
            }
        }
    }

    override breakCostMultiplierAt(x: number, y: number, z: number, current: BlockState): number {
        if ((!this.allowBreak && !this.allowBreakAnyway.includes(current.typeId)) || this.isPossiblyProtected(x, y, z)) {
            return COST_INF;
        }
        const sch = this.getSchematic(x, y, z, current);
        if (sch !== null) {
            if (Blocks.isAir(sch)) {
                return 1;
            }
            if (valid(this.bsi.get0(x, y, z), sch, false)) {
                return settings.breakCorrectBlockPenaltyMultiplier.value;
            } else {
                return 1;
            }
        } else {
            return 1;
        }
    }
}

export class BuilderProcess extends BaritoneProcess {
    private incorrectPositions: PosSet | null = null;
    private observedCompleted: Set<number> | null = null;
    private name: string | null = null;
    private realSchematic: ISchematic | null = null;
    private schematic: ISchematic | null = null;
    private origin: BetterBlockPos | null = null;
    private ticks = 0;
    private paused = false;
    private layer = 0;
    private numRepeats = 0;
    private approxPlaceable_: BlockState[] = [];
    stopAtHeight = 0;

    baritoneRef() {
        return this.baritone;
    }

    schematicRef(): ISchematic | null {
        return this.schematic;
    }

    originRef(): BetterBlockPos | null {
        return this.origin;
    }

    approxPlaceableList(): BlockState[] {
        return this.approxPlaceable_;
    }

    build(name: string, schematic: ISchematic, origin: Vec3): void {
        this.name = name;
        this.schematic = schematic;
        this.realSchematic = null;
        const buildingSelectionSchematic = schematic instanceof SelectionSchematic;
        if (settings.buildSubstitutes.value.size) {
            this.schematic = new SubstituteSchematic(this.schematic, settings.buildSubstitutes.value);
        }
        if (settings.buildSchematicMirror.value !== "NONE") {
            this.schematic = new MirroredSchematic(this.schematic, settings.buildSchematicMirror.value);
        }
        if (settings.buildSchematicRotation.value !== "NONE") {
            this.schematic = new RotatedSchematic(this.schematic, settings.buildSchematicRotation.value);
        }
        const inner = this.schematic;
        this.schematic = MaskSchematic.create(inner, (x, y, z, current) => {
            return !settings.buildSkipBlocks.value.includes(inner.desiredState(x, y, z, current, []).typeId);
        });
        let x = origin.x;
        let y = origin.y;
        let z = origin.z;
        if (settings.schematicOrientationX.value) {
            x += schematic.widthX();
        }
        if (settings.schematicOrientationY.value) {
            y += schematic.heightY();
        }
        if (settings.schematicOrientationZ.value) {
            z += schematic.lengthZ();
        }
        this.origin = new BetterBlockPos(x, y, z);
        this.paused = false;
        this.layer = settings.startAtLayer.value;
        this.stopAtHeight = schematic.heightY();
        if (settings.buildOnlySelection.value && buildingSelectionSchematic) {
            const sels = this.baritone.getSelectionManager().getSelections();
            if (sels.length === 0) {
                this.logDirect("Poor little kitten forgot to set a selection while BuildOnlySelection is true");
                this.stopAtHeight = 0;
            } else if (settings.buildInLayers.value) {
                const minim = Math.min(...sels.map((s) => s.min().y));
                const maxim = Math.max(...sels.map((s) => s.max().y));
                const startAtHeight = settings.layerOrder.value ? y + schematic.heightY() - maxim : minim - y;
                this.stopAtHeight = (settings.layerOrder.value ? y + schematic.heightY() - minim : maxim - y) + 1;
                this.layer = Math.max(this.layer, Math.trunc(startAtHeight / settings.layerHeight.value));
            }
        }
        this.numRepeats = 0;
        this.observedCompleted = new Set();
        this.incorrectPositions = null;
    }

    resume(): void {
        this.paused = false;
    }

    pause(): void {
        this.paused = true;
    }

    isPaused(): boolean {
        return this.paused;
    }

    buildStructure(name: string, origin: Vec3): boolean {
        const parsed = this.baritone.loadStructure(name);
        if (parsed === null) {
            return false;
        }
        this.build(name, this.applyMapArtAndSelection(origin, parsed), origin);
        return true;
    }

    private applyMapArtAndSelection(origin: Vec3, parsed: IStaticSchematic): ISchematic {
        let schematic: ISchematic = parsed;
        if (settings.mapArtMode.value) {
            schematic = new MapArtSchematic(parsed);
        }
        if (settings.buildOnlySelection.value) {
            schematic = new SelectionSchematic(schematic, origin, this.baritone.getSelectionManager().getSelections());
        }
        return schematic;
    }

    clearArea(corner1: Vec3, corner2: Vec3): void {
        const origin = new BetterBlockPos(Math.min(corner1.x, corner2.x), Math.min(corner1.y, corner2.y), Math.min(corner1.z, corner2.z));
        const widthX = Math.abs(corner1.x - corner2.x) + 1;
        const heightY = Math.abs(corner1.y - corner2.y) + 1;
        const lengthZ = Math.abs(corner1.z - corner2.z) + 1;
        this.build("clear area", new FillSchematic(widthX, heightY, lengthZ, new BlockOptionalMeta("minecraft:air")), origin);
    }

    getApproxPlaceable(): BlockState[] {
        return [...this.approxPlaceable_];
    }

    isActive(): boolean {
        return this.schematic !== null;
    }

    placeAt(x: number, y: number, z: number, current: BlockState): BlockState | null {
        if (!this.isActive()) {
            return null;
        }
        const o = this.origin!;
        if (!this.schematic!.inSchematic(x - o.x, y - o.y, z - o.z, current)) {
            return null;
        }
        const state = this.schematic!.desiredState(x - o.x, y - o.y, z - o.z, current, this.approxPlaceable_);
        if (Blocks.isAir(state)) {
            return null;
        }
        return state;
    }

    private toBreakNearPlayer(bcc: BuilderCalculationContext): [BetterBlockPos, Rotation] | null {
        const center = this.ctx.playerFeet();
        const pathStart = this.baritone.getPathingBehavior().pathStart();
        for (let dx = -5; dx <= 5; dx++) {
            for (let dy = settings.breakFromAbove.value ? -1 : 0; dy <= 5; dy++) {
                for (let dz = -5; dz <= 5; dz++) {
                    const x = center.x + dx;
                    const y = center.y + dy;
                    const z = center.z + dz;
                    if (dy === -1 && x === pathStart.x && z === pathStart.z) {
                        continue;
                    }
                    const desired = bcc.getSchematic(x, y, z, bcc.bsi.get0(x, y, z));
                    if (desired === null) {
                        continue;
                    }
                    const curr = bcc.bsi.get0(x, y, z);
                    if (!Blocks.isAir(curr) && !(curr.name === "water" || curr.name === "lava") && !valid(curr, desired, false)) {
                        const pos = new BetterBlockPos(x, y, z);
                        const rot = reachable(this.ctx, pos, this.ctx.blockReachDistance());
                        if (rot) {
                            return [pos, rot];
                        }
                    }
                }
            }
        }
        return null;
    }

    private searchForPlacables(bcc: BuilderCalculationContext, desirableOnHotbar: BlockState[]): Placement | null {
        const center = this.ctx.playerFeet();
        for (let dx = -5; dx <= 5; dx++) {
            for (let dy = -5; dy <= 1; dy++) {
                for (let dz = -5; dz <= 5; dz++) {
                    const x = center.x + dx;
                    const y = center.y + dy;
                    const z = center.z + dz;
                    const desired = bcc.getSchematic(x, y, z, bcc.bsi.get0(x, y, z));
                    if (desired === null) {
                        continue;
                    }
                    const curr = bcc.bsi.get0(x, y, z);
                    if (MovementHelper.isReplaceable(x, y, z, curr, bcc.bsi) && !valid(curr, desired, false)) {
                        if (dy === 1 && Blocks.isAir(bcc.bsi.get0(x, y + 1, z))) {
                            continue;
                        }
                        desirableOnHotbar.push(desired);
                        const opt = this.possibleToPlace(desired, x, y, z, bcc.bsi);
                        if (opt !== null) {
                            return opt;
                        }
                    }
                }
            }
        }
        return null;
    }

    placementPlausible(pos: BetterBlockPos, state: BlockState): boolean {
        if (state.collisionEmpty()) {
            return true;
        }
        for (const e of this.ctx.entities()) {
            if (!e.isLiving) continue;
            const p = e.position;
            if (p.x + 0.3 > pos.x && p.x - 0.3 < pos.x + 1 && p.z + 0.3 > pos.z && p.z - 0.3 < pos.z + 1 && p.y < pos.y + 1 && p.y + 1.8 > pos.y) {
                return false;
            }
        }
        return true;
    }

    private possibleToPlace(toPlace: BlockState, x: number, y: number, z: number, bsi: BlockStateInterface): Placement | null {
        let checkedPlaceable = false;
        for (const against of ALL_DIRECTIONS) {
            const placeAgainstPos = new BetterBlockPos(x, y, z).relative(against);
            const placeAgainstState = bsi.get(placeAgainstPos);
            if (MovementHelper.isReplaceable(placeAgainstPos.x, placeAgainstPos.y, placeAgainstPos.z, placeAgainstState, bsi)) {
                continue;
            }
            if (!checkedPlaceable) {
                const pos = new BetterBlockPos(x, y, z);
                if (!this.placementPlausible(pos, toPlace)) {
                    return null;
                }
                checkedPlaceable = true;
            }
            const aabb = placeAgainstState.bounds();
            if (aabb === null) {
                continue;
            }
            for (const m of aabbSideMultipliers(against)) {
                const placeX = placeAgainstPos.x + aabb[0] * m.x + aabb[3] * (1 - m.x);
                const placeY = placeAgainstPos.y + aabb[1] * m.y + aabb[4] * (1 - m.y);
                const placeZ = placeAgainstPos.z + aabb[2] * m.z + aabb[5] * (1 - m.z);
                const rot = RotationUtils.calcRotationFromVec3d(inferSneakingEyePosition(this.ctx), { x: placeX, y: placeY, z: placeZ }, this.ctx.playerRotations());
                const actualRot = this.baritone.getLookBehavior().getAimProcessor().peekRotation(rot);
                const result = this.ctx.rayTraceTowards(actualRot, this.ctx.blockReachDistance(), true);
                if (result && result.pos.equals(placeAgainstPos) && result.direction === opposite(against)) {
                    const hotbar = this.hasAnyItemThatWouldPlace(toPlace);
                    if (hotbar !== null) {
                        return { hotbarSelection: hotbar, placeAgainst: placeAgainstPos, side: opposite(against), rot };
                    }
                }
            }
        }
        return null;
    }

    private hasAnyItemThatWouldPlace(desired: BlockState): number | null {
        const items = this.ctx.player().inventory().items;
        for (let i = 0; i < 9; i++) {
            const stack = items[i];
            if (isEmpty(stack) || !isBlockItem(stack.typeId)) {
                continue;
            }
            const wouldBePlaced = BlockState.of(stack.typeId);
            if (valid(wouldBePlaced, desired, true)) {
                return i;
            }
        }
        return null;
    }

    onTick(calcFailed: boolean, isSafeToCancel: boolean): PathingCommand | null {
        return this.onTick0(calcFailed, isSafeToCancel, 0);
    }

    private onTick0(calcFailed: boolean, isSafeToCancel: boolean, recursions: number): PathingCommand | null {
        if (recursions > 100) {
            return new PathingCommand(null, PathingCommandType.SET_GOAL_AND_PATH);
        }
        this.approxPlaceable_ = this.approxPlaceableN(36);
        const input = this.baritone.getInputOverrideHandler();
        if (input.isInputForcedDown(Input.CLICK_LEFT)) {
            this.ticks = 5;
        } else {
            this.ticks--;
        }
        input.clearAllKeys();
        if (this.paused) {
            return new PathingCommand(null, PathingCommandType.CANCEL_AND_SET_GOAL);
        }
        if (settings.buildInLayers.value) {
            if (this.realSchematic === null) {
                this.realSchematic = this.schematic;
            }
            const realSchematic = this.realSchematic!;
            let minYInclusive: number;
            let maxYInclusive: number;
            if (settings.layerOrder.value) {
                maxYInclusive = realSchematic.heightY() - 1;
                minYInclusive = realSchematic.heightY() - this.layer * settings.layerHeight.value;
            } else {
                maxYInclusive = this.layer * settings.layerHeight.value - 1;
                minYInclusive = 0;
            }
            const self = this;
            this.schematic = {
                desiredState: (x, y, z, current) => realSchematic.desiredState(x, y, z, current, self.approxPlaceable_),
                inSchematic: (x, y, z, currentState) =>
                    x >= 0 && x < realSchematic.widthX() && y >= 0 && y < realSchematic.heightY() && z >= 0 && z < realSchematic.lengthZ() && y >= minYInclusive && y <= maxYInclusive && realSchematic.inSchematic(x, y, z, currentState),
                reset: () => realSchematic.reset(),
                widthX: () => realSchematic.widthX(),
                heightY: () => realSchematic.heightY(),
                lengthZ: () => realSchematic.lengthZ(),
            };
        }
        const bcc = new BuilderCalculationContext(this);
        if (!this.recalc(bcc)) {
            if (settings.buildInLayers.value && this.layer * settings.layerHeight.value < this.stopAtHeight) {
                this.logDirect("Starting layer " + this.layer);
                this.layer++;
                return this.onTick0(calcFailed, isSafeToCancel, recursions + 1);
            }
            const repeat = settings.buildRepeat.value;
            const max = settings.buildRepeatCount.value;
            this.numRepeats++;
            if ((repeat.x === 0 && repeat.y === 0 && repeat.z === 0) || (max !== -1 && this.numRepeats >= max)) {
                this.logDirect("Done building");
                if (settings.notificationOnBuildFinished.value) {
                    this.logNotification("Done building", false);
                }
                this.onLostControl();
                return null;
            }
            this.layer = 0;
            this.origin = this.origin!.offset(repeat);
            if (!settings.buildRepeatSneaky.value) {
                this.schematic!.reset();
            }
            this.logDirect("Repeating build in vector " + `${repeat.x},${repeat.y},${repeat.z}` + ", new origin is " + this.origin);
            return this.onTick0(calcFailed, isSafeToCancel, recursions + 1);
        }
        if (settings.distanceTrim.value) {
            this.trim();
        }

        const toBreak = this.toBreakNearPlayer(bcc);
        if (toBreak !== null && isSafeToCancel && this.ctx.player().onGround()) {
            const [pos, rot] = toBreak;
            this.baritone.getLookBehavior().updateTarget(rot, true);
            MovementHelper.switchToBestToolFor(this.ctx, bcc.get(pos.x, pos.y, pos.z));
            if (this.ctx.player().isCrouching()) {
                input.setInputForceState(Input.SNEAK, true);
            }
            if (this.ctx.isLookingAt(pos) || this.ctx.playerRotations().isReallyCloseTo(rot)) {
                input.setInputForceState(Input.CLICK_LEFT, true);
            }
            return new PathingCommand(null, PathingCommandType.CANCEL_AND_SET_GOAL);
        }
        const desirableOnHotbar: BlockState[] = [];
        const toPlace = this.searchForPlacables(bcc, desirableOnHotbar);
        if (toPlace !== null && isSafeToCancel && this.ctx.player().onGround() && this.ticks <= 0) {
            const rot = toPlace.rot;
            this.baritone.getLookBehavior().updateTarget(rot, true);
            this.ctx.player().setSelectedSlot(toPlace.hotbarSelection);
            input.setInputForceState(Input.SNEAK, true);
            const mouseOver = this.ctx.objectMouseOver();
            if ((this.ctx.isLookingAt(toPlace.placeAgainst) && mouseOver !== null && mouseOver.direction === toPlace.side) || this.ctx.playerRotations().isReallyCloseTo(rot)) {
                input.setInputForceState(Input.CLICK_RIGHT, true);
            }
            return new PathingCommand(null, PathingCommandType.CANCEL_AND_SET_GOAL);
        }

        if (settings.allowInventory.value) {
            const usefulSlots: number[] = [];
            const noValidHotbarOption: BlockState[] = [];
            outer: for (const desired of desirableOnHotbar) {
                for (let i = 0; i < 9; i++) {
                    if (valid(this.approxPlaceable_[i], desired, true)) {
                        usefulSlots.push(i);
                        continue outer;
                    }
                }
                noValidHotbarOption.push(desired);
            }

            outer2: for (let i = 9; i < 36; i++) {
                for (const desired of noValidHotbarOption) {
                    if (valid(this.approxPlaceable_[i], desired, true)) {
                        if (!this.baritone.getInventoryBehavior().attemptToPutOnHotbar(i, (s) => usefulSlots.includes(s))) {
                            return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
                        }
                        break outer2;
                    }
                }
            }
        }

        let goal = this.assemble(bcc, this.approxPlaceable_.slice(0, 9), false);
        if (goal === null) {
            goal = this.assemble(bcc, this.approxPlaceable_, true);
            if (goal === null) {
                if (settings.skipFailedLayers.value && settings.buildInLayers.value && this.layer * settings.layerHeight.value < this.realSchematic!.heightY()) {
                    this.logDirect("Skipping layer that I cannot construct! Layer #" + this.layer);
                    this.layer++;
                    return this.onTick0(calcFailed, isSafeToCancel, recursions + 1);
                }
                this.logDirect("Unable to do it. Pausing. resume to resume, cancel to cancel");
                this.paused = true;
                return new PathingCommand(null, PathingCommandType.REQUEST_PAUSE);
            }
        }
        return new PathingCommand(goal, PathingCommandType.FORCE_REVALIDATE_GOAL_AND_PATH, bcc);
    }

    private recalc(bcc: BuilderCalculationContext): boolean {
        if (this.incorrectPositions === null) {
            this.incorrectPositions = new PosSet();
            this.fullRecalc(bcc);
            if (this.incorrectPositions.size === 0) {
                return false;
            }
        }
        this.recalcNearby(bcc);
        if (this.incorrectPositions.size === 0) {
            this.fullRecalc(bcc);
        }
        return this.incorrectPositions.size > 0;
    }

    private trim(): void {
        const me = BetterBlockPos.of(this.ctx.player().position());
        const copy = new PosSet([...this.incorrectPositions!].filter((pos) => pos.distSqr(me) <= 200));
        if (copy.size > 0) {
            this.incorrectPositions = copy;
        }
    }

    private recalcNearby(bcc: BuilderCalculationContext): void {
        const center = this.ctx.playerFeet();
        const radius = settings.builderTickScanRadius.value;
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const x = center.x + dx;
                    const y = center.y + dy;
                    const z = center.z + dz;
                    const desired = bcc.getSchematic(x, y, z, bcc.bsi.get0(x, y, z));
                    if (desired !== null) {
                        const pos = new BetterBlockPos(x, y, z);
                        if (valid(bcc.bsi.get0(x, y, z), desired, false)) {
                            this.incorrectPositions!.delete(pos);
                            this.observedCompleted!.add(pos.hash());
                        } else {
                            this.incorrectPositions!.add(pos);
                            this.observedCompleted!.delete(pos.hash());
                        }
                    }
                }
            }
        }
    }

    private fullRecalc(bcc: BuilderCalculationContext): void {
        this.incorrectPositions = new PosSet();
        const schematic = this.schematic!;
        const origin = this.origin!;
        for (let y = 0; y < schematic.heightY(); y++) {
            for (let z = 0; z < schematic.lengthZ(); z++) {
                for (let x = 0; x < schematic.widthX(); x++) {
                    const blockX = x + origin.x;
                    const blockY = y + origin.y;
                    const blockZ = z + origin.z;
                    const current = bcc.bsi.get0(blockX, blockY, blockZ);
                    if (!schematic.inSchematic(x, y, z, current)) {
                        continue;
                    }
                    const hash = BetterBlockPos.longHash(blockX, blockY, blockZ);
                    if (bcc.bsi.worldContainsLoadedChunk(blockX, blockZ)) {
                        if (valid(current, schematic.desiredState(x, y, z, current, this.approxPlaceable_), false)) {
                            this.observedCompleted!.add(hash);
                        } else {
                            this.incorrectPositions.add(new BetterBlockPos(blockX, blockY, blockZ));
                            this.observedCompleted!.delete(hash);
                            if (this.incorrectPositions.size > settings.incorrectSize.value) {
                                return;
                            }
                        }
                        continue;
                    }
                    if (!this.observedCompleted!.has(hash)) {
                        this.incorrectPositions.add(new BetterBlockPos(blockX, blockY, blockZ));
                        if (this.incorrectPositions.size > settings.incorrectSize.value) {
                            return;
                        }
                    }
                }
            }
        }
    }

    private assemble(bcc: BuilderCalculationContext, approxPlaceable: BlockState[], logMissing: boolean): Goal | null {
        const placeable: BetterBlockPos[] = [];
        const breakable: BetterBlockPos[] = [];
        const sourceLiquids: BetterBlockPos[] = [];
        const flowingLiquids: BetterBlockPos[] = [];
        const missing = new Map<string, number>();
        const outOfBounds: BetterBlockPos[] = [];
        for (const pos of this.incorrectPositions!) {
            const state = bcc.bsi.get(pos);
            if (Blocks.isAir(state)) {
                const desired = bcc.getSchematic(pos.x, pos.y, pos.z, state);
                if (desired === null) {
                    outOfBounds.push(pos);
                } else if (containsBlockState(approxPlaceable, desired) || approxPlaceable.some((p) => p.typeId === desired.typeId)) {
                    placeable.push(pos);
                } else {
                    missing.set(desired.toString(), 1 + (missing.get(desired.toString()) ?? 0));
                }
            } else {
                if (Blocks.isLiquidBlock(state)) {
                    if (!MovementHelper.possiblyFlowing(state)) {
                        sourceLiquids.push(pos);
                    } else {
                        flowingLiquids.push(pos);
                    }
                } else {
                    breakable.push(pos);
                }
            }
        }
        for (const p of outOfBounds) this.incorrectPositions!.delete(p);
        const toBreak: Goal[] = breakable.map((pos) => this.breakGoal(pos, bcc));
        const toPlace: Goal[] = [];
        const placeableSet = new PosSet(placeable);
        for (const pos of placeable) {
            if (!placeableSet.has(pos.below()) && !placeableSet.has(pos.below(2))) {
                toPlace.push(this.placementGoal(pos, bcc));
            }
        }
        sourceLiquids.forEach((pos) => toPlace.push(GoalBlock.of(pos.above())));

        if (toPlace.length) {
            return new JankyGoalComposite(new GoalComposite(...toPlace), new GoalComposite(...toBreak));
        }
        if (toBreak.length === 0) {
            if (logMissing && missing.size) {
                this.logDirect("Missing materials for at least:");
                this.logDirect([...missing.entries()].map(([k, v]) => `${v}x ${k}`).join("\n"));
            }
            if (logMissing && flowingLiquids.length) {
                this.logDirect("Unreplaceable liquids at at least:");
                this.logDirect(flowingLiquids.map((p) => `${p.x} ${p.y} ${p.z}`).join("\n"));
            }
            return null;
        }
        return new GoalComposite(...toBreak);
    }

    private placementGoal(pos: BetterBlockPos, bcc: BuilderCalculationContext): Goal {
        const bsi = this.ctx.bsi();
        if (!Blocks.isAir(bsi.get(pos))) {
            return new GoalPlace(pos);
        }
        const allowSameLevel = !Blocks.isAir(bsi.get(pos.above()));
        const current = bsi.get(pos);
        for (const facing of HORIZONTALS_BUT_ALSO_DOWN_____SO_EVERY_DIRECTION_EXCEPT_UP) {
            const desired = bcc.getSchematic(pos.x, pos.y, pos.z, current);
            if (MovementHelper.canPlaceAgainstCtx(this.ctx, pos.relative(facing)) && desired !== null && this.placementPlausible(pos, desired)) {
                return new GoalAdjacent(pos, pos.relative(facing), allowSameLevel);
            }
        }
        return new GoalPlace(pos);
    }

    private breakGoal(pos: BetterBlockPos, bcc: BuilderCalculationContext): Goal {
        if (settings.goalBreakFromAbove.value && Blocks.isAir(bcc.bsi.get(pos.above())) && Blocks.isAir(bcc.bsi.get(pos.above(2)))) {
            return new JankyGoalComposite(
                new GoalBreak(pos),
                new GoalBreakFromAbove(pos.above()),
            );
        }
        return new GoalBreak(pos);
    }

    onLostControl(): void {
        this.incorrectPositions = null;
        this.name = null;
        this.schematic = null;
        this.realSchematic = null;
        this.layer = settings.startAtLayer.value;
        this.numRepeats = 0;
        this.paused = false;
        this.observedCompleted = null;
    }

    displayName0(): string {
        return this.paused ? "Builder Paused" : "Building " + this.name;
    }

    approxPlaceableN(size: number): BlockState[] {
        const result: BlockState[] = [];
        const items = this.ctx.player().inventory().items;
        for (let i = 0; i < size; i++) {
            const stack = items[i];
            if (isEmpty(stack) || !isBlockItem(stack.typeId)) {
                result.push(AIR);
                continue;
            }
            result.push(BlockState.of(stack.typeId));
        }
        return result;
    }
}

function isBlockItem(typeId: string): boolean {
    const name = typeId.startsWith("minecraft:") ? typeId.substring(10) : typeId;
    return BLOCKS[name] !== undefined && name !== "air";
}

function aabbSideMultipliers(side: Direction): Vec3[] {
    switch (side.name) {
        case "up":
            return [
                { x: 0.5, y: 1, z: 0.5 },
                { x: 0.1, y: 1, z: 0.5 },
                { x: 0.9, y: 1, z: 0.5 },
                { x: 0.5, y: 1, z: 0.1 },
                { x: 0.5, y: 1, z: 0.9 },
            ];
        case "down":
            return [
                { x: 0.5, y: 0, z: 0.5 },
                { x: 0.1, y: 0, z: 0.5 },
                { x: 0.9, y: 0, z: 0.5 },
                { x: 0.5, y: 0, z: 0.1 },
                { x: 0.5, y: 0, z: 0.9 },
            ];
        default: {
            const x = side.x === 0 ? 0.5 : (1 + side.x) / 2;
            const z = side.z === 0 ? 0.5 : (1 + side.z) / 2;
            return [
                { x, y: 0.25, z },
                { x, y: 0.75, z },
            ];
        }
    }
}
