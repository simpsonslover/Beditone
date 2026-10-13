import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const cmdFile = join(dir, "cmd.txt");
const logFile = join(dir, "out.log");
writeFileSync(cmdFile, "");
writeFileSync(logFile, "");
const p = spawn(join(dir, "bedrock_server.exe"), [], { cwd: dir });
const log = (d) => appendFileSync(logFile, d);
p.stdout.on("data", log);
p.stderr.on("data", log);
let sent = 0;
const timer = setInterval(() => {
    if (!existsSync(cmdFile)) return;
    const lines = readFileSync(cmdFile, "utf8").split("\n");
    while (sent < lines.length - 1) {
        const l = lines[sent++];
        log(`>>> ${l}\n`);
        p.stdin.write(l + "\n");
    }
}, 200);
p.on("exit", (code) => { log(`\n[driver] server exited ${code}\n`); clearInterval(timer); process.exit(0); });
