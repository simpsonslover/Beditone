import { build } from "esbuild";
import { generateBlockData } from "../scripts/gen-blockdata.mjs";

generateBlockData("../src/world/blockdata.generated.ts");

await build({
    entryPoints: ["src/main.ts"],
    outfile: "dist/proxy.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "external",
    keepNames: true,
    sourcemap: true,
    logLevel: "warning",
});
if (process.argv.includes("--standin")) {
    await build({ entryPoints: ["test/standin.ts"], outfile: "dist/standin.mjs", bundle: true, platform: "node", format: "esm", target: "node20", packages: "external", keepNames: true, logLevel: "warning" });
}
console.log("Built dist/proxy.mjs");
