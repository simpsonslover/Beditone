import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const DATA_VERSION = "bedrock_1.26.51";

const TOOL = { none: 0, pickaxe: 1, axe: 2, shovel: 3, hoe: 4, sword: 5, shears: 6 };

function toolFor(material) {
    if (!material) return TOOL.none;
    if (material.includes("mineable/pickaxe") || material.startsWith("incorrect_for_")) return TOOL.pickaxe;
    if (material.includes("mineable/axe")) return TOOL.axe;
    if (material.includes("mineable/shovel")) return TOOL.shovel;
    if (material.includes("leaves") || material.includes("mineable/hoe")) return TOOL.hoe;
    if (material.includes("coweb") || material.includes("sword_instantly_mines")) return TOOL.sword;
    if (material.includes("wool")) return TOOL.shears;
    return TOOL.none;
}

function tierFor(harvestTools) {
    if (!harvestTools) return 0;
    const n = Object.keys(harvestTools).length;
    if (n >= 6) return 1;
    if (n >= 4) return 2;
    if (n === 3) return 3;
    return 4;
}

function norm(state) {
    if (state.type === "byte") return state.value ? "true" : "false";
    return String(state.value);
}

export function generateBlockData(outFile) {
    const mcData = require("minecraft-data")(DATA_VERSION);
    const shapesTable = mcData.blockCollisionShapes;
    const shapeIds = new Map();
    const shapes = [];
    const internShape = (rawId) => {
        const boxes = shapesTable.shapes[rawId] || [];
        const key = JSON.stringify(boxes);
        if (!shapeIds.has(key)) {
            shapeIds.set(key, shapes.length);
            shapes.push(boxes);
        }
        return shapeIds.get(key);
    };

    const blocks = {};
    const varying = [];
    for (const b of mcData.blocksArray) {
        const raw = shapesTable.blocks[b.name];
        const perState = (Array.isArray(raw) ? raw : [raw ?? 0]).map(internShape);
        const unbreakable = !b.diggable || b.hardness < 0;
        const entry = [unbreakable ? -1 : b.hardness, toolFor(b.material), tierFor(b.harvestTools), perState[0], -1];
        if (new Set(perState).size > 1) {
            const rows = [];
            for (let i = 0; i < perState.length; i++) {
                const st = mcData.blockStates[b.minStateId + i];
                if (!st || st.name !== b.name) continue;
                rows.push({ states: st.states, shape: perState[i] });
            }
            let props = rows.length ? Object.keys(rows[0].states) : [];
            for (const p of [...props]) {
                const trial = props.filter((q) => q !== p);
                const seen = new Map();
                let ok = true;
                for (const r of rows) {
                    const k = trial.map((q) => norm(r.states[q])).join("|");
                    if (seen.has(k) && seen.get(k) !== r.shape) {
                        ok = false;
                        break;
                    }
                    seen.set(k, r.shape);
                }
                if (ok) props = trial;
            }
            const map = {};
            for (const r of rows) map[props.map((q) => norm(r.states[q])).join("|")] = r.shape;
            entry[4] = varying.length;
            varying.push([props, map]);
        }
        blocks[b.name] = entry;
    }

    const out = [
        "export const BLOCK_DATA_VERSION = " + JSON.stringify(DATA_VERSION) + ";",
        "export const SHAPES: number[][][] = " + JSON.stringify(shapes) + ";",
        "export const BLOCKS: Record<string, [number, number, number, number, number]> = " + JSON.stringify(blocks) + ";",
        "export const VARYING: [string[], Record<string, number>][] = " + JSON.stringify(varying) + ";",
        "",
    ].join("\n");
    writeFileSync(outFile, out);
}

if (process.argv[1] && process.argv[1].endsWith("gen-blockdata.mjs")) {
    generateBlockData(process.argv[2] || "src/world/blockdata.generated.ts");
}
