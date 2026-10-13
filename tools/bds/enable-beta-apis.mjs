import nbt from "prismarine-nbt";
import { readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
const buf = readFileSync(file);
const header = buf.subarray(0, 8);
const { parsed } = await nbt.parse(buf.subarray(8), "little");
const v = parsed.value;
v.experiments = { type: "compound", value: {
  gametest: { type: "byte", value: 1 },
  experiments_ever_used: { type: "byte", value: 1 },
  saved_with_toggled_experiments: { type: "byte", value: 1 },
} };
v.commandsEnabled = { type: "byte", value: 1 };
for (const k of ["doDaylightCycle", "doMobSpawning", "doWeatherCycle"]) v[k.toLowerCase()] = { type: "byte", value: 0 };
const body = nbt.writeUncompressed(parsed, "little");
const out = Buffer.alloc(8 + body.length);
header.copy(out, 0);
out.writeInt32LE(body.length, 4);
body.copy(out, 8);
writeFileSync(file, out);
console.log("experiments:", JSON.stringify(nbt.simplify(parsed).experiments), "keys sample:", Object.keys(v).filter(k => /mob|daylight|weather/i.test(k)).join(","));
