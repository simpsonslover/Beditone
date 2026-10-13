# Beditone

A port of [Baritone](https://github.com/cabaletta/baritone) to Minecraft **Bedrock Edition**

## How to install
1. make sure you have the latest version of node installed
2. copy all the files to your computer:
```
git clone https://github.com/simpsonslover/Beditone.git
```
3. open proxy/start.cmd
4. enter your ip to proxy, example: 0.0.0.0:0000

5. join the server at 127.0.0.1 (port: 19150)

## Project layout

```
src/
  pathing/calc/    A* (AStarPathFinder), PathNode, BinaryHeapOpenSet, Path, Favoring
  pathing/path/    PathExecutor, SprintJump, IPath (CutoffPath, SplicedPath)
  movement/        ActionCosts, MovementHelper, CalculationContext, PrecomputedData, Moves, Movement
  movement/movements/  Traverse, Ascend, Descend, Diagonal, Downward, Fall, Pillar, Parkour
  goals/           Goal and every goal type
  process/         PathingControlManager and the processes (custom goal, mine, follow, get to block, explore, farm, builder, backfill, inventory pauser)
  commands/        CommandManager, ArgConsumer, datatypes, DefaultCommands
  behavior/        PathingBehavior, LookBehavior, InventoryBehavior
  input/           InputOverrideHandler, BlockBreakHelper, BlockPlaceHelper
  world/           BlockState, block data (generated), BlockStateInterface (chunk-aware cache), ToolSet, WorldScanner
  schematic/, selection/, cache/   Builder schematics, #sel selections, waypoints and explored chunks
  render/          PathRenderer (path, goal and selection particles, through a ParticleSink)
  bedrock/         The only code that touches @minecraft/server: world adapter, simulated-player and real-player adapters
  Beditone.ts      Wires everything together, like Baritone.java
  main.ts          The behavior pack: sessions, chat hook, tick loop
proxy/             The proxy: NetherNet relay with HTTP signaling, chunk decoding, packet player, movement physics
tools/bds/         Headless Bedrock Dedicated Server test harness (driver, Beta APIs enabler, flat-world suites)
scripts/gen-blockdata.mjs   Builds the block table from minecraft-data
test/              Node tests (MockWorld, FakeBot)
pack/              The behavior pack: manifest.json and scripts/main.js after a build
```

## Credits and license

- **Baritone**, © its contributors, LGPL-3.0: <https://github.com/cabaletta/baritone>.
- **Block data** comes from [PrismarineJS minecraft-data](https://github.com/PrismarineJS/minecraft-data) (MIT), generated at build time.
