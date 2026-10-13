import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SignalStructure, SignalType } = require("nethernet/src/signalling");
const { attachIdentity } = require("nethernet/src/identity");

export interface ServerInfo {
    name: string;
    protocol: number;
    version: string;
    level: string;
    players: number;
    maxPlayers: number;
    gameType: number;
}

function request(method: string, host: string, port: number, path: string, body?: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const headers: Record<string, string | number> = {};
        if (body !== undefined) {
            headers["Content-Type"] = "application/sdp";
            headers["Content-Length"] = Buffer.byteLength(body);
        }
        const req = http.request({ host, port, path, method, headers, timeout: 10000 }, (res) => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (d) => (data += d));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
        });
        req.on("timeout", () => req.destroy(new Error(`signaling request to ${host}:${port} timed out`)));
        req.on("error", reject);
        req.end(body);
    });
}

export async function queryServer(host: string, port: number): Promise<ServerInfo | null> {
    try {
        const r = await request("GET", host, port, "/v1/join");
        return r.status === 200 ? (JSON.parse(r.body) as ServerInfo) : null;
    } catch {
        return null;
    }
}

function inlineCandidates(sdp: string, candidates: string[]): string {
    let out = sdp.replace(/(\r?\n)*$/, "\r\n");
    for (const c of candidates) out += "a=" + c + "\r\n";
    return out;
}

export function useHttpSignaling(client: any, host: string, port: number, onError: (e: Error) => void): void {
    const nn = client.connection.nethernet;
    const candidates: string[] = [];
    nn.signalHandler = (signal: { type: string; data: string }) => {
        if (signal.type === SignalType.CandidateAdd) {
            candidates.push(signal.data);
            return;
        }
        if (signal.type !== SignalType.ConnectRequest) return;
        setTimeout(async () => {
            try {
                let sdp = signal.data;
                if (!/^a=identity:/m.test(sdp)) {
                    if (!client.multiplayerToken) client.createClientChain(null, true);
                    sdp = attachIdentity(sdp, { privateKey: client.ecdhKeyPair.privateKey, token: client.multiplayerToken });
                }
                const r = await request("POST", host, port, `/v1/join/${nn.connectionId}`, inlineCandidates(sdp, candidates));
                if (r.status !== 200 || !r.body.startsWith("v=")) {
                    const code = r.body.trim();
                    const why = code === "37" ? " (identity not allowed: the server wants an Xbox-signed login, run the proxy without --offline)" : "";
                    throw new Error(`the server refused the connection: HTTP ${r.status} ${code}${why}`);
                }
                nn.handleSignal(new SignalStructure(SignalType.ConnectResponse, nn.connectionId, r.body));
            } catch (e) {
                onError(e as Error);
            }
        }, 400);
    };
}

export function serveHttpSignaling(nethernetServer: any, port: number, host: string, info: () => ServerInfo, log: (m: string) => void = () => {}): Promise<http.Server> {
    const server = http.createServer((req, res) => {
        const url = req.url ?? "/";
        log(`game -> proxy: ${req.method} ${url} from ${req.socket.remoteAddress}`);
        if (req.method === "GET" && url === "/v1/join") {
            const body = JSON.stringify(info());
            res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Connection: "close" });
            res.end(body);
            return;
        }
        const m = /^\/v1\/join\/([^/?]+)/.exec(url);
        if (req.method !== "POST" || !m) {
            res.writeHead(404, { "Content-Type": "text/plain", Connection: "close" });
            res.end("Not Found");
            return;
        }
        let offer = "";
        req.setEncoding("utf8");
        req.on("data", (d) => (offer += d));
        req.on("end", () => {
            let connectionId: bigint;
            try {
                connectionId = BigInt(m[1]);
            } catch {
                connectionId = BigInt.asUintN(64, BigInt("0x" + (Buffer.from(m[1]).toString("hex").slice(0, 16) || "1")));
            }
            const candidates: string[] = [];
            let answered = false;
            const reply = (status: number, type: string, body: string) => {
                if (answered) return;
                answered = true;
                log(body.startsWith("v=") ? "proxy -> game: handshake answered, connecting" : `proxy -> game: handshake refused (${status} ${body})`);
                if (!body.startsWith("v=")) {
                    try {
                        fs.mkdirSync("beditone-data", { recursive: true });
                        fs.writeFileSync("beditone-data/refused-offer.txt", `${req.method} ${url}\n${JSON.stringify(req.headers, null, 1)}\n\n${offer}`);
                        log("saved the game's offer to beditone-data/refused-offer.txt");
                    } catch {
                    }
                }
                res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body), Connection: "close" });
                res.end(body);
            };
            const respond = (signal: { type: string; data: string }) => {
                if (signal.type === SignalType.CandidateAdd) {
                    candidates.push(signal.data);
                } else if (signal.type === SignalType.ConnectResponse) {
                    const answer = signal.data;
                    setTimeout(() => reply(200, "application/sdp", inlineCandidates(answer, candidates)), 400);
                } else if (signal.type === SignalType.ConnectError) {
                    reply(200, "application/sdp", String(signal.data));
                }
            };
            const signal = new SignalStructure(SignalType.ConnectRequest, connectionId, offer);
            signal.networkId = connectionId;
            nethernetServer.handleOffer(signal, respond).catch?.((e: Error) => reply(500, "text/plain", e.message));
            setTimeout(() => reply(200, "application/sdp", "2"), 10000);
        });
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.removeListener("error", reject);
            resolve(server);
        });
    });
}
