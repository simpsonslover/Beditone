# Beditone proxy

Baritone for Minecraft Bedrock **without installing anything on the server**. Run the proxy on your PC, connect your game to it, and it forwards everything to the real server. Type Baritone commands (`#goto`, `#mine`, …) in chat and Baritone moves **you**.

Use it only on servers where that's allowed. To the server it looks like you playing, but on servers with anti-cheat, automated movement is the kind of thing that gets people banned.

## Start it (Windows)

Requirements:

- Minecraft Bedrock **1.26.50 or newer**, on PC
- [Node.js](https://nodejs.org) 20 or newer

Steps:

1. Double-click **`start.cmd`** in this folder.
   - The first run installs packages, which takes a minute.
   - When asked, type the server's address, for example `play.example.com:19132` or `192.168.1.20`. You can also pass it on the command line: `start.cmd play.example.com:19132`.
2. **The first time only:** before you join, the proxy shows a Microsoft sign-in code in its window. Open https://www.microsoft.com/link, enter the code and sign in with your Minecraft account. The proxy logs in to the server as you, so it needs this. The sign-in is saved in `beditone-data/auth`, and afterwards it just says "Signed in as …".
3. In Minecraft, go to **Play > Servers > Add Server**, use address **`127.0.0.1`** and port **`19150`**, and join it.
4. Type `#help` in chat.

From a terminal it's: `npm install --allow-git=all`, then `npm start -- <server>[:port] [--listen <port>] [--offline]`.

- **`--allow-git`** is needed because one of the Xbox sign-in packages comes from GitHub.
- **`--offline`** is only for servers with `online-mode=false`. Those take any name, so no Microsoft sign-in is needed.
- **`--nethernet`** makes your game connect to the proxy over NetherNet instead of RakNet. It's experimental, and the real game failed to connect that way in the first test.

In the proxy window you can type:

- `status` to see what Baritone is doing
- `stop` to quit

## What happens while Baritone drives

- **Moving:** Baritone presses the keys the way it does on Java. The proxy writes them into the input packet your game sends every tick (move keys, jump, sneak, sprint and look direction). The server then walks you with its own vanilla physics.
- **Your game:** the proxy predicts that movement each tick and moves your game along, so you see yourself move smoothly. When the server disagrees, it corrects, and the proxy replays from the corrected spot, as the game itself does.
- **Your keys:** your movement keys are locked while Baritone drives and unlocked when it stops. `#stop` always gives them back.
- **Your camera:** it stays yours, like Baritone's `freeLook`. The server sees Baritone's aim, and you can look around.
- **Mining:** sent as the block-breaking actions your game would send, timed to vanilla break speed for the tool in your hand. The server checks the timing.
- **Placing and using items:** sent as your game's item-use packets.
- **What you see:** like Baritone, the goal is boxed in **green** and the path is drawn in **red** (the next segment magenta, blocks to break, place or walk into in their own colors). These are colored particles, drawn only for you. They use the same settings as Baritone: `renderPath`, `renderGoal`, `colorCurrentPath`, `colorGoalBox` and the rest, plus `renderIntervalTicks` and `renderMaxParticles`.
- **Your settings and waypoints:** saved in `beditone-data/<your name>.json`.

## What doesn't work (yet)

- **Moving items around your inventory.** Baritone can't pull a tool or throwaway block from your main inventory into the hotbar. Keep your pickaxe and some cobblestone or dirt in the hotbar.
- **Breaking-crack animation.** Your game doesn't show cracks while Baritone mines. The block just breaks.
- **`#build`, `#bot`:** `#build` needs the server's structure files. `#bot` is for the behavior pack's separate bot.
- **Realms**, and anything older than 1.26.50.

## How it was tested

There's no Minecraft client on the test machine. The proxy was tested with a stand-in client (`test/standin.ts`) against Bedrock Dedicated Server 1.26.52 running a plain world, with no pack installed.

The stand-in:

- connects the way the game does
- loads chunks
- runs simple movement physics
- reports its position every tick

The same 11-step flat-world suite used for the behavior pack passes through the proxy: walk, pillar up, get down, bridge, break a wall, parkour, `#mine`, `#follow` and `#sel walls`. Over the whole suite the server corrected the proxy's movement prediction 19 times, mostly by about 0.01 blocks.

**Not tested:** a real Minecraft client. How smooth the movement looks in the real game, and whether the real game sends anything the stand-in doesn't, still need checking. If something is off, run `status` in the proxy window. To see the server's corrections, start the proxy with `BEDITONE_DEBUG=1`.

## Things found by probing the server (not documented anywhere)

- **Connection handshake:** a 1.26 dedicated server's NetherNet handshake is plain HTTP on its game port.
  - `GET /v1/join` returns the server's info.
  - `POST /v1/join/<connection id>` takes the WebRTC offer and returns the answer.
  - The offer must carry an `a=identity` line signed with the login key, otherwise the reply is error `37`.
- **Loading screen:** the server ignores all movement input until the client reports its loading screen has ended (`serverbound_loading_screen` type 1, then 2).
- **Sprint speed:** while sprinting, the server's movement-speed attribute already includes the sprint boost, as a modifier named "Sprinting speed boost".
