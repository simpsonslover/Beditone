import { createRequire } from "node:module";
import { AIR, BlockState } from "../../../src/world/BlockState";

const require = createRequire(import.meta.url);

type RawState = { name: string; states: Record<string, { type: string; value: string | number }> };

export class BlockPalette {
    private readonly byRuntime = new Map<number, BlockState>();
    private readonly rawByRuntime = new Map<number, RawState>();
    private readonly runtimeByState = new Map<BlockState, number>();
    readonly unknown = new Set<number>();

    constructor(version: string, hashed: boolean) {
        const registry = require("prismarine-registry")("bedrock_" + version);
        const states: RawState[] = registry.blockStates;
        const Block = hashed ? require("prismarine-block")(registry) : null;
        for (let i = 0; i < states.length; i++) {
            const raw = states[i];
            const id = hashed ? Block.getHash(raw.name, raw.states) | 0 : i;
            this.rawByRuntime.set(id, raw);
        }
    }

    state(runtimeId: number): BlockState {
        const id = runtimeId | 0;
        let s = this.byRuntime.get(id);
        if (s) return s;
        const raw = this.rawByRuntime.get(id);
        if (!raw) {
            this.unknown.add(id);
            s = BlockState.of("minecraft:stone");
        } else if (raw.name === "air") {
            s = AIR;
        } else {
            const plain: Record<string, string | number | boolean> = {};
            for (const [k, v] of Object.entries(raw.states)) {
                plain[k] = v.type === "byte" ? v.value === 1 : v.value;
            }
            s = BlockState.of("minecraft:" + raw.name, plain);
        }
        this.byRuntime.set(id, s);
        if (!this.runtimeByState.has(s)) this.runtimeByState.set(s, id);
        return s;
    }

    runtimeOf(state: BlockState): number {
        return this.runtimeByState.get(state) ?? this.runtimeByState.get(BlockState.of(state.typeId, state.states)) ?? 0;
    }
}
