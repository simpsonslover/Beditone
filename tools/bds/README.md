# Testing Beditone on a Bedrock Dedicated Server

This is how Beditone was tested in game without a client. A headless Bedrock Dedicated Server (BDS) runs the pack; the bot is driven from the server console.

1. Download BDS for Windows from <https://www.minecraft.net/download/server/bedrock>. Pick the version that matches your game (1.26.52 was used). Unzip it to `<tools>\bds\` and copy `driver.mjs` and `t.sh` from this folder into `<tools>\`.
2. In `bds\server.properties`, set:
   - `level-type=FLAT` (or `DEFAULT` for terrain)
   - `content-log-console-output-enabled=true`
   - `allow-cheats=true`
3. Start the server once so it creates the world: `node driver.mjs <tools>\bds`. Then append `stop` to `bds\cmd.txt`.
4. Turn on Beta APIs in the world: `node enable-beta-apis.mjs <tools>\bds\worlds\<level-name>\level.dat`.
5. Copy the pack:
   - Copy `pack\` into `bds\development_behavior_packs\Beditone`.
   - Create `bds\worlds\<level-name>\world_behavior_packs.json` containing `[{"pack_id":"<uuid from pack/manifest.json>","version":[1,0,0]}]`.
6. Start the server again with `node driver.mjs <tools>\bds`.
   - Each new line in `cmd.txt` is sent to the server console.
   - Everything the server prints goes to `out.log`.
7. Run the suites (Git Bash):
   - `BDS_TOOLS=<tools> ./flat-suite.sh` tests bot mode.
   - `BDS_TOOLS=<tools> ./player-suite.sh` and `./player-extras.sh` test player mode. A simulated player named Steve stands in for you and is pushed exactly the way a real player is.
   - `BDS_TOOLS=<tools> ./proxy-suite.sh` tests the proxy (`proxy/`). Use a world **without** the pack, with `online-mode=false` and `allow-list=false` in `server.properties`. A stand-in game client joins through the proxy. Note that 1.26 servers only accept `transport=nethernet` clients, which is the default.

Console control works on any server running the pack:

```
scriptevent beditone:owner <x> <y|top> <z> [yaw]   where the console "stands"; the bot spawns here
scriptevent beditone:run <chat text>               e.g. scriptevent beditone:run #goto 10 -60 5
scriptevent beditone:status [verbose|chunks]       each session's position, process, path, inputs, loaded chunks
scriptevent beditone:runas <player> <chat text>    run a command as that player (player mode)
scriptevent beditone:standin <name> <x> <y> <z>    spawn a simulated player to stand in for a real one
scriptevent beditone:standin-remove                disconnect it (/kick doesn't work on simulated players)
```
