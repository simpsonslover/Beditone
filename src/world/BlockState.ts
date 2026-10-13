import { BLOCKS, SHAPES, VARYING } from "./blockdata.generated";

export type StateValue = boolean | number | string;
export type StateMap = Readonly<Record<string, StateValue>>;

export const enum Tool {
    NONE = 0,
    PICKAXE = 1,
    AXE = 2,
    SHOVEL = 3,
    HOE = 4,
    SWORD = 5,
    SHEARS = 6,
}

export const enum Fluid {
    NONE = 0,
    WATER = 1,
    LAVA = 2,
}

const EMPTY_STATES: StateMap = Object.freeze({});
const FULL_CUBE = "[[0,0,0,1,1,1]]";

let nextId = 0;
const interned = new Map<string, BlockState>();

export class BlockState {
    readonly id: number;
    readonly name: string;
    readonly collision: readonly (readonly number[])[];
    readonly hardness: number;
    readonly tool: Tool;
    readonly tier: number;
    readonly fluid: Fluid;
    readonly fluidAmount: number;
    readonly fullCube: boolean;
    readonly known: boolean;

    private constructor(readonly typeId: string, readonly states: StateMap, readonly waterlogged: boolean) {
        this.id = nextId++;
        this.name = typeId.startsWith("minecraft:") ? typeId.substring(10) : typeId;
        const data = BLOCKS[this.name];
        this.known = !!data;
        let shapeId = data ? data[3] : 1;
        if (data && data[4] >= 0) {
            const [props, map] = VARYING[data[4]];
            const key = props.map((p) => String(states[p] ?? states["minecraft:" + p] ?? "")).join("|");
            const s = map[key];
            if (s !== undefined) shapeId = s;
        }
        this.collision = SHAPES[shapeId] ?? [];
        this.fullCube = JSON.stringify(this.collision) === FULL_CUBE;
        this.hardness = data ? data[0] : 1;
        this.tool = data ? data[1] : Tool.NONE;
        this.tier = data ? data[2] : 0;
        const n = this.name;
        if (n === "water" || n === "flowing_water") {
            this.fluid = Fluid.WATER;
        } else if (n === "lava" || n === "flowing_lava") {
            this.fluid = Fluid.LAVA;
        } else if (waterlogged) {
            this.fluid = Fluid.WATER;
        } else {
            this.fluid = Fluid.NONE;
        }
        if (this.fluid === Fluid.NONE) {
            this.fluidAmount = 0;
        } else if (waterlogged) {
            this.fluidAmount = 8;
        } else {
            const depth = Number(states["liquid_depth"] ?? 0);
            this.fluidAmount = depth === 0 || depth >= 8 ? 8 : 8 - depth;
        }
    }

    static of(typeId: string, states: StateMap = EMPTY_STATES, waterlogged = false): BlockState {
        if (!typeId.includes(":")) typeId = "minecraft:" + typeId;
        let key = typeId;
        const keys = Object.keys(states);
        if (keys.length) {
            keys.sort();
            for (const k of keys) key += "," + k + "=" + states[k];
        }
        if (waterlogged) key += ",~wl";
        let s = interned.get(key);
        if (!s) {
            s = new BlockState(typeId, keys.length ? Object.freeze({ ...states }) : EMPTY_STATES, waterlogged);
            interned.set(key, s);
        }
        return s;
    }

    static ofSimple(typeId: string): BlockState {
        let s = interned.get(typeId);
        if (!s) {
            s = BlockState.of(typeId);
        }
        return s;
    }

    static count(): number {
        return nextId;
    }

    get(state: string): StateValue | undefined {
        const v = this.states[state];
        return v !== undefined ? v : this.states["minecraft:" + state];
    }

    is(name: string): boolean {
        return this.name === name;
    }

    hasFluid(): boolean {
        return this.fluid !== Fluid.NONE;
    }

    collisionEmpty(): boolean {
        return this.collision.length === 0;
    }

    bounds(): number[] | null {
        if (!this.collision.length) return null;
        const b = [1, 1, 1, 0, 0, 0];
        for (const box of this.collision) {
            for (let i = 0; i < 3; i++) {
                b[i] = Math.min(b[i], box[i]);
                b[i + 3] = Math.max(b[i + 3], box[i + 3]);
            }
        }
        return b;
    }

    toString(): string {
        const st = Object.entries(this.states).map(([k, v]) => `${k}=${v}`);
        if (this.waterlogged) st.push("waterlogged=true");
        return st.length ? `${this.typeId}[${st.join(",")}]` : this.typeId;
    }
}

export const AIR = BlockState.of("minecraft:air");
