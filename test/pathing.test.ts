import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { settings } from "../src/Settings";
import { BetterBlockPos } from "../src/utils/BetterBlockPos";
import { GoalBlock, GoalNear, GoalXZ, GoalYLevel, GoalGetToBlock, GoalComposite, GoalInverted, GoalRunAway, GoalAxis } from "../src/goals/Goal";
import { PathCalculationResultType } from "../src/pathing/calc/AStarPathFinder";
import { MovementParkour } from "../src/movement/movements/MovementParkour";
import { MovementPillar } from "../src/movement/movements/MovementPillar";
import { MovementFall } from "../src/movement/movements/MovementFall";
import { MovementTraverse } from "../src/movement/movements/MovementTraverse";
import { MovementDiagonal } from "../src/movement/movements/MovementDiagonal";
import { MovementAscend } from "../src/movement/movements/MovementAscend";
import * as AC from "../src/movement/ActionCosts";
import { MockWorld, search, STONE, WATER, LAVA, DIRT, context, S } from "./MockWorld";
import { MovementHelper } from "../src/movement/MovementHelper";
import { AIR } from "../src/world/BlockState";

const P = (x: number, y: number, z: number) => new BetterBlockPos(x, y, z);

beforeEach(() => {
    for (const s of settings.allSettings) s.reset();
});

function kinds(result: ReturnType<typeof search>): string[] {
    return result.path!.movements().map((m) => m.constructor.name);
}

function ticksToBlocks(ticks: number): number {
    const velocity = (t: number) => (Math.pow(0.98, t) - 1) * -3.92;
    let fallDistance = 0;
    const integralComponent = Math.floor(ticks);
    for (let tick = 0; tick < integralComponent; tick++) {
        fallDistance += velocity(tick);
    }
    const partialTickComponent = ticks - Math.floor(ticks);
    fallDistance += velocity(integralComponent) * partialTickComponent;
    return fallDistance;
}

test("ActionCostsTest.testFallNBlocksCost (from Baritone)", () => {
    assert.equal(AC.FALL_N_BLOCKS_COST.length, 4097);
    for (let i = 0; i < 4097; i++) {
        assert.ok(Math.abs(ticksToBlocks(AC.FALL_N_BLOCKS_COST[i]) - i) < 0.00000000001, "i=" + i);
    }
    assert.ok(Math.abs(AC.FALL_1_25_BLOCKS_COST - 6.2344) < 0.00001);
    assert.ok(Math.abs(AC.FALL_0_25_BLOCKS_COST - 3.071) < 0.00001);
    assert.ok(Math.abs(AC.JUMP_ONE_BLOCK_COST - 3.1634) < 0.00001);
});

test("ActionCosts constants", () => {
    assert.equal(AC.WALK_ONE_BLOCK_COST.toFixed(3), "4.633");
    assert.equal(AC.SPRINT_ONE_BLOCK_COST.toFixed(3), "3.564");
    assert.equal(AC.WALK_OFF_BLOCK_COST.toFixed(3), "3.706");
    assert.equal(GoalXZ.calculate(10, 0), 10 * 3.563);
    assert.equal(GoalXZ.calculate(3, 3).toFixed(4), (3 * Math.SQRT2 * 3.563).toFixed(4));
});

test("flat world: straight path to a GoalBlock", () => {
    const w = MockWorld.flat();
    const r = search(w, P(0, 64, 0), new GoalBlock(20, 64, 5));
    assert.equal(r.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    assert.ok(r.path!.getDest().equals(P(20, 64, 5)));
    const k = kinds(r);
    assert.ok(k.every((x) => x === "MovementTraverse" || x === "MovementDiagonal"), k.join(","));
    assert.equal(k.filter((x) => x === "MovementDiagonal").length, 5);
});

test("flat world: GoalXZ, GoalNear, GoalYLevel, GoalGetToBlock, GoalComposite", () => {
    const w = MockWorld.flat();
    const start = P(0, 64, 0);
    for (const goal of [new GoalXZ(-15, 12), new GoalNear(P(10, 64, 10), 3), new GoalGetToBlock(P(-8, 63, 3)), new GoalComposite(new GoalBlock(30, 64, 0), new GoalBlock(5, 64, 0))]) {
        const r = search(w, start, goal);
        assert.equal(r.type, PathCalculationResultType.SUCCESS_TO_GOAL, goal.toString());
        const d = r.path!.getDest();
        assert.ok(goal.isInGoal(d.x, d.y, d.z), goal.toString());
    }
    const c = search(w, start, new GoalComposite(new GoalBlock(30, 64, 0), new GoalBlock(5, 64, 0)));
    assert.ok(c.path!.getDest().equals(P(5, 64, 0)));
    const y = search(w, start, new GoalYLevel(70));
    assert.equal(y.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    assert.ok(kinds(y).includes("MovementPillar"));
});

test("staircase: ascends and descends", () => {
    const w = MockWorld.flat();
    for (let i = 1; i <= 6; i++) w.fill(i, 64, -3, i, 63 + i, 3, STONE);
    const up = search(w, P(0, 64, 0), new GoalBlock(6, 70, 0), { throwaway: false });
    assert.equal(up.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    assert.ok(kinds(up).includes("MovementAscend"));
    const down = search(w, P(6, 70, 0), new GoalBlock(0, 64, 0), { throwaway: false });
    assert.equal(down.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    assert.ok(kinds(down).includes("MovementDescend"));
});

test("gap: parkour when allowed, bridge when placing, around when neither", () => {
    const w = MockWorld.flat(20);
    w.fill(3, 54, -12, 4, 63, 12, AIR);
    settings.allowParkour.value = true;
    const pk = search(w, P(0, 64, 0), new GoalBlock(8, 64, 0), { throwaway: false });
    assert.equal(pk.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    assert.ok(pk.path!.movements().some((m) => m instanceof MovementParkour), kinds(pk).join(","));

    settings.allowParkour.value = false;
    const bridge = search(w, P(0, 64, 0), new GoalBlock(8, 64, 0), { throwaway: true });
    assert.equal(bridge.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    const placed = bridge.path!.movements().flatMap((m) => m.toPlace(context(w).bsi));
    assert.ok(placed.length >= 2, "expected bridging, got " + kinds(bridge).join(","));

    const around = search(w, P(0, 64, 0), new GoalBlock(8, 64, 0), { throwaway: false });
    assert.equal(around.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    assert.ok(around.path!.positions().some((p) => Math.abs(p.z) > 12), "should have walked around the trench");
});

test("cave: tunnels through stone only when allowBreak", () => {
    const w = MockWorld.flat(30).fill(-30, 40, -30, 30, 63, 30, STONE);
    w.fill(10, 50, 0, 12, 51, 2, AIR);
    const dig = search(w, P(0, 64, 0), new GoalBlock(11, 50, 1));
    assert.equal(dig.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    assert.ok(dig.path!.movements().some((m) => m.toBreak(context(w).bsi).length > 0));

    settings.allowBreak.value = false;
    const noDig = search(w, P(0, 64, 0), new GoalBlock(11, 50, 1), {}, 300, 600);
    assert.notEqual(noDig.type, PathCalculationResultType.SUCCESS_TO_GOAL);
});

test("lava: never stands in it, never breaks into it, bridges over it by placing (like Baritone)", () => {
    const w = MockWorld.flat();
    w.fill(3, 64, -40, 3, 65, 40, STONE);
    w.fill(4, 64, -40, 4, 64, 40, LAVA);
    const r = search(w, P(0, 64, 0), new GoalBlock(6, 64, 0), {}, 500, 1000);
    assert.equal(r.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    const bsi = context(w).bsi;
    for (const pos of r.path!.positions()) {
        assert.ok(!MovementHelper.isLava(w.getState(pos.x, pos.y, pos.z)), "feet in lava at " + pos);
        assert.ok(!MovementHelper.isLava(w.getState(pos.x, pos.y + 1, pos.z)), "head in lava at " + pos);
    }
    for (const m of r.path!.movements()) {
        for (const b of m.toBreak(bsi)) {
            assert.ok(!(b.x === 3 && b.y === 64), "broke the block holding back the lava");
        }
    }
    settings.allowBreak.value = false;
    const noPlace = search(w, P(0, 64, 0), new GoalBlock(6, 64, 0), { throwaway: false }, 300, 600);
    assert.notEqual(noPlace.type, PathCalculationResultType.SUCCESS_TO_GOAL);
});

test("water: falls into water from height, never further than maxFallHeightNoWater onto stone", () => {
    const w = MockWorld.flat(20);
    w.fill(0, 64, 0, 0, 75, 0, STONE);
    w.fill(1, 61, -1, 3, 63, 1, AIR).fill(1, 60, -1, 3, 60, 1, STONE).fill(1, 61, -1, 3, 63, 1, WATER);
    const into = search(w, P(0, 76, 0), new GoalYLevel(63), { throwaway: false });
    assert.equal(into.type, PathCalculationResultType.SUCCESS_TO_GOAL, kinds(into).join(","));
    const fall = into.path!.movements().find((m) => m instanceof MovementFall);
    assert.ok(fall, "expected a MovementFall into the pool: " + kinds(into).join(","));
    assert.ok(MovementHelper.isWater(w.getState(fall!.getDest().x, fall!.getDest().y, fall!.getDest().z)));

    const dry = MockWorld.flat(20).fill(0, 64, 0, 0, 75, 0, STONE);
    const r = search(dry, P(0, 76, 0), new GoalYLevel(64), { throwaway: false, tools: false }, 300, 600);
    if (r.path) {
        for (const m of r.path.movements()) {
            assert.ok(m.getSrc().y - m.getDest().y <= settings.maxFallHeightNoWater.value + 1);
        }
    }
});

test("walking through water uses waterWalkSpeed", () => {
    const w = MockWorld.flat();
    w.fill(2, 62, -40, 6, 63, 40, WATER);
    const r = search(w, P(0, 64, 0), new GoalBlock(8, 64, 0), { throwaway: false });
    assert.equal(r.type, PathCalculationResultType.SUCCESS_TO_GOAL);
});

test("pillar up a 1x1 shaft needs throwaway blocks", () => {
    const w = MockWorld.flat();
    w.fill(-1, 64, -1, 1, 70, 1, STONE).fill(0, 64, 0, 0, 70, 0, AIR);
    const ok = search(w, P(0, 64, 0), new GoalBlock(0, 70, 0), { tools: false });
    assert.equal(ok.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    assert.ok(ok.path!.movements().every((m) => m instanceof MovementPillar), kinds(ok).join(","));
    const dig = search(w, P(0, 64, 0), new GoalBlock(0, 70, 0));
    assert.equal(dig.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    assert.ok(kinds(dig).includes("MovementPillar"));
    const no = search(w, P(0, 64, 0), new GoalBlock(0, 70, 0), { throwaway: false, tools: false }, 200, 400);
    assert.notEqual(no.type, PathCalculationResultType.SUCCESS_TO_GOAL);
});

test("costs: one sprinting traverse costs SPRINT_ONE_BLOCK_COST, one diagonal sprint costs sqrt2 of it", () => {
    const w = MockWorld.flat();
    const ctx = context(w);
    assert.equal(MovementTraverse.cost(ctx, 0, 64, 0, 1, 0), AC.WALK_ONE_BLOCK_COST * AC.SPRINT_MULTIPLIER);
    const t = new MovementTraverse(null, P(0, 64, 0), P(1, 64, 0));
    assert.equal(t.calculateCost(ctx), AC.WALK_ONE_BLOCK_COST * AC.SPRINT_MULTIPLIER);
    const d = search(w, P(0, 64, 0), new GoalBlock(1, 64, 1));
    assert.ok(d.path!.movements()[0] instanceof MovementDiagonal);
    assert.ok(Math.abs(d.path!.movements()[0].getCost() - AC.WALK_ONE_BLOCK_COST * AC.SPRINT_MULTIPLIER * Math.SQRT2) < 1e-9);
    w.set(1, 64, 0, STONE);
    assert.equal(MovementAscend.cost(ctx, 0, 64, 0, 1, 0), Math.max(AC.JUMP_ONE_BLOCK_COST, AC.WALK_ONE_BLOCK_COST) + settings.jumpPenalty.value);
});

test("breaking dirt is cheaper than stone with a shovel/pickaxe hotbar", () => {
    const w = MockWorld.flat();
    w.set(1, 64, 0, DIRT).set(1, 65, 0, AIR);
    const dirt = MovementTraverse.cost(context(w), 0, 64, 0, 1, 0);
    w.set(1, 64, 0, S("obsidian"));
    const obs = MovementTraverse.cost(context(w), 0, 64, 0, 1, 0);
    assert.ok(dirt < obs, `${dirt} < ${obs}`);
    w.set(1, 64, 0, S("bedrock"));
    assert.equal(MovementTraverse.cost(context(w), 0, 64, 0, 1, 0), AC.COST_INF);
});

test("inverted / runaway / axis goals produce segments heading away", () => {
    const w = MockWorld.flat(30);
    const inv = search(w, P(0, 64, 0), new GoalInverted(new GoalBlock(0, 64, 0)), {}, 300, 600);
    assert.equal(inv.type, PathCalculationResultType.SUCCESS_SEGMENT);
    assert.ok(inv.path!.getDest().distSqr(P(0, 64, 0)) > 25);
    const ra = search(w, P(0, 64, 0), new GoalRunAway(10, null, P(0, 64, 0)));
    assert.equal(ra.type, PathCalculationResultType.SUCCESS_TO_GOAL);
    settings.axisHeight.value = 64;
    const ax = search(w, P(7, 64, 3), new GoalAxis());
    assert.equal(ax.type, PathCalculationResultType.SUCCESS_TO_GOAL);
});

test("unloaded chunks stop the search at the border (segmenting)", () => {
    const w = new MockWorld(2).fill(-200, 63, -40, 200, 63, 40, STONE);
    const r = search(w, P(0, 64, 0), new GoalXZ(500, 0), {}, 500, 1000);
    assert.equal(r.type, PathCalculationResultType.SUCCESS_SEGMENT);
    assert.ok(r.path!.getDest().x > 10 && r.path!.getDest().x < 48);
});

test("goals built on different ticks compare equal (Java anonymous classes are one class)", async () => {
    const { GoalRunAwayForever } = await import("../src/process/GetToBlockProcess");
    const a = new GoalRunAwayForever(1, null, P(1, 2, 3));
    const b = new GoalRunAwayForever(1, null, P(1, 2, 3));
    assert.ok(a.equals(b));
    assert.ok(new GoalComposite(a, new GoalXZ(1, 2)).equals(new GoalComposite(b, new GoalXZ(1, 2))));
});
