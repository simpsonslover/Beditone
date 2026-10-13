import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { settings } from "../../src/Settings";
import type { Storage } from "../../src/cache/WorldData";
import { BEDITONE_VERSION } from "../../src/version";
import { queryServer, serveHttpSignaling, ServerInfo, useHttpSignaling } from "./net/signaling";
import { Session } from "./Session";

const require = createRequire(import.meta.url);
const { Relay, Client } = require("bedrock-protocol");
const RelayBase: new (options: object) => any = Relay;

const VERSION = "1.26.51";

function usage(): never {
    console.log(`Beditone proxy v${BEDITONE_VERSION} (Baritone for Bedrock ${VERSION})

usage: npm start -- <server>[:port] [--listen <port>] [--offline]

  <server>        the server you want to play on, e.g. play.example.com:19132 or 192.168.1.20
  --listen <port> the port your game connects to (default 19150). In Minecraft: Servers > Add Server,
                  address 127.0.0.1, this port.
  --offline       don't sign in with Xbox (only for servers with online-mode=false)
  --nethernet     let your game connect over NetherNet instead of RakNet (experimental)`);
    process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) usage();
const offline = args.includes("--offline");
const listenTransport = args.includes("--nethernet") ? "nethernet" : "raknet";
const listenIdx = args.indexOf("--listen");
const listenPort = listenIdx >= 0 ? Number(args[listenIdx + 1]) : 19150;
const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--listen");
if (!target || !Number.isFinite(listenPort)) usage();
const [destHost, destPortStr] = target.includes("]") ? [target.slice(1, target.indexOf("]")), target.split("]:")[1]] : target.split(":");
const destPort = Number(destPortStr || 19132);

const dataDir = path.resolve("beditone-data");
fs.mkdirSync(dataDir, { recursive: true });

function fileStorage(name: string): Storage {
    const file = path.join(dataDir, name.replace(/[^a-zA-Z0-9_.-]/g, "_") + ".json");
    let data: Record<string, string> = {};
    try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        data = {};
    }
    return {
        load: (key) => data[key],
        save: (key, value) => {
            data[key] = value;
            fs.writeFileSync(file, JSON.stringify(data, null, 1));
        },
    };
}

if (!settings.searchTimeMultiplier.isModified?.()) settings.searchTimeMultiplier.value = 1;

let authflow: unknown = undefined;
if (!offline) {
    const { Authflow, Titles } = require("prismarine-auth");
    authflow = new Authflow("account", path.join(dataDir, "auth"), { authTitle: Titles.MinecraftNintendoSwitch, deviceType: "Nintendo", flow: "live" }, (code: { message: string }) => {
        console.log(`\nSign in with the Microsoft account you play Minecraft with:\n  ${code.message}\n(waiting for you to sign in...)`);
    });
    console.log("Signing in to Xbox...");
    const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    try {
        const login = await (authflow as any).getMinecraftBedrockToken(publicKey.export({ format: "der", type: "spki" }).toString("base64"));
        const profile = JSON.parse(Buffer.from(String(login.chain[1]).split(".")[1], "base64").toString());
        console.log(`Signed in as ${profile?.extraData?.displayName ?? "you"}.`);
    } catch (e) {
        console.log("Couldn't sign in to Xbox: " + (e as Error).message);
        process.exit(1);
    }
}

const info = await queryServer(destHost, destPort);
const transport = info ? "nethernet" : "raknet";
console.log(info ? `Server: ${info.name} (${info.level}), Minecraft ${info.version}, ${info.players}/${info.maxPlayers} players, NetherNet` : `Server ${destHost}:${destPort}: no NetherNet handshake there, trying RakNet`);

class BeditoneRelay extends RelayBase {
    async openUpstreamConnection(ds: any, clientAddr: any) {
        const options = {
            authTitle: this.options.authTitle,
            flow: this.options.flow,
            deviceType: this.options.deviceType,
            offline,
            username: offline ? ds.profile.name : "account",
            version: VERSION,
            host: destHost,
            port: destPort,
            transport,
            skipPing: true,
            nethernet: { networkId: 1n },
            onMsaCode: (code: { message: string }) => {
                console.log("\n" + code.message + "\n");
                ds.disconnect("Beditone needs you to sign in to Xbox once. See the proxy window, then reconnect.\n\n" + code.message);
            },
            profilesFolder: path.join(dataDir, "auth"),
            authflow,
            autoInitPlayer: false,
        };
        const client = new Client(options);
        if (!client.noLoginForward) client.options.skinData = ds.skinData;
        if (transport === "nethernet") useHttpSignaling(client, destHost, destPort, (e) => client.onConnectionError(e));
        client.outLog = ds.upOutLog;
        client.inLog = ds.upInLog;
        client.on("kick", (p: { message?: string; reason?: string }) => console.log(`[${ds.profile?.name}] the server disconnected you: ${p.reason ?? ""} ${p.message ?? ""}`));
        client.once("join", () => {
            console.log(`[${ds.profile?.name}] joined ${destHost}:${destPort} through the proxy`);
            client.write("client_cache_status", { enabled: false });
            ds.upstream = client;
            ds.flushUpQueue();
            client.readPacket = (packet: Buffer) => ds.readUpstream(packet);
            this.emit("join", ds, client);
        });
        client.on("error", (err: Error) => {
            console.log(`[${ds.profile?.name}] server connection error: ${err.message}`);
            ds.disconnect("Beditone proxy: " + err.message);
            this.upstreams.delete(clientAddr.hash);
        });
        client.on("close", () => {
            ds.disconnect("The server closed the connection");
            this.upstreams.delete(clientAddr.hash);
        });
        ds.once("close", () => client.close());
        this.upstreams.set(clientAddr.hash, client);
        client.connect();
    }
}

const relay = new BeditoneRelay({
    host: "0.0.0.0",
    port: listenPort,
    version: VERSION,
    offline: true,
    transport: listenTransport,
    omitParseErrors: true,
    motd: { motd: "Beditone", levelName: info?.level ?? "Beditone" },
    destination: { host: destHost, port: destPort, offline, transport },
});

const sessions = new Set<Session>();

relay.on("connect", (player: any) => {
    console.log("[connect] your game connected to the proxy; logging in");
    player.on("login", () => console.log(`[connect] ${player.profile?.name ?? "player"} logged in to the proxy; connecting to ${destHost}:${destPort}`));
    let session: Session | null = null;
    const name = () => player.profile?.name ?? "player";
    const make = () => {
        session = new Session(name(), VERSION, {
            toClient: (n, params) => player.queue(n, params),
            toServer: (n, params) => player.upstream?.queue(n, params),
            log: (m) => console.log(`[${name()}] ${m}`),
        }, fileStorage(name()));
        sessions.add(session);
        return session;
    };
    player.on("clientbound", (data: any, des: any) => {
        try {
            if ((session ?? make()).onClientbound(data.name, data.params) === true) des.canceled = true;
        } catch (e) {
            console.log(`[${name()}] error handling ${data.name}:`, e);
        }
    });
    player.on("serverbound", (data: any, des: any) => {
        try {
            if (session?.onServerbound(data.name, data.params)) des.canceled = true;
        } catch (e) {
            console.log(`[${name()}] error handling ${data.name}:`, e);
        }
    });
    player.on("close", () => {
        if (session) {
            session.close();
            sessions.delete(session);
            console.log(`[${name()}] left`);
        }
    });
});

await relay.listen();
const serverInfo = (): ServerInfo => ({
    name: info?.name ?? "Beditone",
    protocol: info?.protocol ?? 2193,
    version: info?.version ?? VERSION,
    level: info?.level ?? "Beditone",
    players: sessions.size,
    maxPlayers: info?.maxPlayers ?? 10,
    gameType: info?.gameType ?? 0,
});
if (listenTransport === "nethernet") {
    await serveHttpSignaling(relay.transport.nethernet, listenPort, "0.0.0.0", serverInfo, (m) => console.log("[connect] " + m));
}

console.log(`
Beditone proxy v${BEDITONE_VERSION} is running.
  In Minecraft: Servers > Add Server > address 127.0.0.1, port ${listenPort}
  Then type ${settings.prefix.value}help in chat.
  Forwarding to ${destHost}:${destPort}${offline ? " (offline mode)" : ""}.
  Type "status" here to see what Baritone is doing, "stop" to quit.
`);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (line: string) => {
    const cmd = line.trim();
    if (cmd === "status") {
        if (sessions.size === 0) console.log("nobody connected");
        for (const s of sessions) console.log(s.describe());
    } else if (cmd === "stop" || cmd === "exit") {
        relay.close();
        process.exit(0);
    } else if (cmd.startsWith("#")) {
        const s = [...sessions][0];
        if (!s?.baritone) console.log("nobody connected");
        else s.baritone.onChat(cmd);
    }
});
