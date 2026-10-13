import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateBlockData } from "./scripts/gen-blockdata.mjs";

const args = new Set(process.argv.slice(2));

generateBlockData("src/world/blockdata.generated.ts");

if (args.has("--tests")) {
    rmSync("dist-test", { recursive: true, force: true });
    const entryPoints = readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => join("test", f));
    await build({
        entryPoints,
        outdir: "dist-test",
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        outExtension: { ".js": ".mjs" },
        keepNames: true,
        logLevel: "warning",
    });
    console.log(`Bundled ${entryPoints.length} test file(s) into dist-test/`);
} else {
    await build({
        entryPoints: ["src/main.ts"],
        outfile: "pack/scripts/main.js",
        bundle: true,
        format: "esm",
        target: "es2020",
        external: ["@minecraft/server", "@minecraft/server-gametest"],
        legalComments: "inline",
        keepNames: true,
        logLevel: "warning",
    });
    console.log("Built pack/scripts/main.js");
}

if (args.has("--deploy")) {
    const candidates = [
        process.env.APPDATA && join(process.env.APPDATA, "Minecraft Bedrock", "Users", "Shared", "games", "com.mojang"),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Packages", "Microsoft.MinecraftUWP_8wekyb3d8bbwe", "LocalState", "games", "com.mojang"),
    ].filter(Boolean);
    const root = candidates.find((p) => existsSync(p));
    if (!root) {
        console.error("Could not find a com.mojang folder. Copy pack/ manually into development_behavior_packs/Beditone.");
        process.exit(1);
    }
    const target = join(root, "development_behavior_packs", "Beditone");
    mkdirSync(target, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    cpSync("pack", target, { recursive: true });
    console.log(`Deployed to ${target}`);
}
