import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { settings } from "../src/Settings";
import { MockWorld, STONE, S } from "./MockWorld";
import { FakeBot } from "./FakeBot";
import { AIR } from "../src/world/BlockState";

beforeEach(() => {
    for (const s of settings.allSettings) s.reset();
    settings.randomLooking113.value = 0;
    settings.randomLooking.value = 0;
});

function run(bot: FakeBot, ticks: number, until: () => boolean): number {
    for (let i = 0; i < ticks; i++) {
        bot.tick();
        if (until()) return i;
    }
    return -1;
}

test("#goto x y z walks there on a flat world", () => {
    const w = MockWorld.flat();
    const bot = FakeBot.create(w, { x: 0.5, y: 64, z: 0.5 });
    assert.ok(bot.chat("#goto 12 64 7"));
    const took = run(bot, 400, () => bot.playerFeet().equals({ x: 12, y: 64, z: 7 }) && !bot.baritone.getCustomGoalProcess().isActive());
    assert.ok(took > 0, `didn't arrive: at ${bot.playerFeet()} messages=${bot.messages.join(" | ")}`);
});

test("#goto x z, #stop cancels", () => {
    const w = MockWorld.flat();
    const bot = FakeBot.create(w, { x: 0.5, y: 64, z: 0.5 });
    bot.chat("#goto -20 15");
    run(bot, 40, () => false);
    assert.ok(bot.baritone.getPathingBehavior().isPathing());
    bot.chat("#stop");
    run(bot, 5, () => false);
    assert.ok(!bot.baritone.getCustomGoalProcess().isActive());
    assert.ok(bot.messages.some((m) => m.includes("ok canceled")));
});

test("chatControl: plain 'goto' works, unrelated chat doesn't", () => {
    const bot = FakeBot.create(MockWorld.flat(), { x: 0.5, y: 64, z: 0.5 });
    assert.equal(bot.chat("hello there"), false);
    assert.equal(bot.chat("goto 3 64 3"), true);
});

test("#set, #modified, #help, #version, #proc, #eta", () => {
    const bot = FakeBot.create(MockWorld.flat(), { x: 0.5, y: 64, z: 0.5 });
    bot.chat("#set allowBreak false");
    assert.equal(settings.allowBreak.value, false);
    bot.chat("#allowBreak");
    assert.equal(settings.allowBreak.value, true, "setting name alone toggles booleans");
    bot.chat("#maxFallHeightNoWater 5");
    assert.equal(settings.maxFallHeightNoWater.value, 5);
    bot.chat("#set reset maxFallHeightNoWater");
    assert.equal(settings.maxFallHeightNoWater.value, 3);
    bot.chat("#modified");
    bot.chat("#help");
    bot.chat("#help goto");
    bot.chat("#version");
    bot.chat("#proc");
    bot.chat("#eta");
    bot.chat("#nosuchcommand");
    const all = bot.messages.join("\n");
    assert.ok(all.includes("goto - Go to a coordinate or block"), all);
    assert.ok(all.includes("Beditone v"));
    assert.ok(all.includes("No process in control"));
    assert.ok(all.includes("Command not found: nosuchcommand"));
});

test("#mine digs the requested block", () => {
    const w = MockWorld.flat();
    w.set(6, 64, 3, S("diamond_ore"));
    const bot = FakeBot.create(w, { x: 0.5, y: 64, z: 0.5 }, [["minecraft:diamond_pickaxe", 1]]);
    bot.chat("#mine diamond_ore");
    const took = run(bot, 600, () => w.getState(6, 64, 3) === AIR);
    assert.ok(took > 0, `ore still there, bot at ${bot.playerFeet()} ${bot.messages.join(" | ")}`);
});

test("bridges a gap by placing throwaway blocks", () => {
    const w = MockWorld.flat();
    w.fill(3, 54, -40, 4, 63, 40, AIR);
    const bot = FakeBot.create(w, { x: 0.5, y: 64, z: 0.5 }, [["minecraft:cobblestone", 64]]);
    bot.chat("#goto 8 64 0");
    const took = run(bot, 1200, () => bot.playerFeet().equals({ x: 8, y: 64, z: 0 }));
    assert.ok(took > 0, `didn't cross: at ${bot.playerFeet()} ${bot.messages.join(" | ")}`);
    assert.ok(w.getState(3, 63, 0) === STONE || w.getState(3, 63, 0).name === "cobblestone");
});

test("waypoints: #sethome / #home / #wp", () => {
    const w = MockWorld.flat();
    const bot = FakeBot.create(w, { x: 0.5, y: 64, z: 0.5 });
    bot.chat("#sethome");
    bot.chat("#wp save user spot 10 64 10");
    bot.chat("#wp list");
    bot.pos = { x: 15.5, y: 64, z: 3.5 };
    bot.chat("#home");
    const took = run(bot, 400, () => bot.playerFeet().equals({ x: 0, y: 64, z: 0 }));
    assert.ok(took > 0, bot.messages.join(" | "));
    assert.ok(bot.messages.some((m) => m.includes("spot")));
});

test("#sel pos1/pos2 + #sel cleararea removes the blocks", () => {
    const w = MockWorld.flat();
    w.fill(4, 64, 0, 5, 65, 1, STONE);
    const bot = FakeBot.create(w, { x: 0.5, y: 64, z: 0.5 }, [["minecraft:diamond_pickaxe", 1]]);
    bot.chat("#sel pos1 4 64 0");
    bot.chat("#sel pos2 5 65 1");
    bot.chat("#sel cleararea");
    const took = run(bot, 1500, () => {
        for (let x = 4; x <= 5; x++) for (let y = 64; y <= 65; y++) for (let z = 0; z <= 1; z++) if (w.getState(x, y, z) !== AIR) return false;
        return true;
    });
    assert.ok(took > 0, bot.messages.join(" | "));
});

test("#explore and #follow and #farm start without throwing", () => {
    const bot = FakeBot.create(MockWorld.flat(), { x: 0.5, y: 64, z: 0.5 });
    bot.chat("#explore");
    run(bot, 20, () => false);
    assert.ok(bot.baritone.getExploreProcess().isActive());
    bot.chat("#stop");
    bot.chat("#follow players");
    bot.chat("#farm");
    run(bot, 20, () => false);
    bot.chat("#thisway 20");
    bot.chat("#axis");
    bot.chat("#invert");
    bot.chat("#tunnel");
    bot.chat("#surface");
    bot.chat("#elytra");
    bot.chat("#click");
    run(bot, 5, () => false);
});
