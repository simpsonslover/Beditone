#!/bin/bash
S="${BDS_TOOLS:?set BDS_TOOLS to the folder holding driver.mjs and bds/}"
D="$S/bds"
send() { for c in "$@"; do echo "$c" >> "$D/cmd.txt"; done; }
feet() { local N=$(wc -l < "$D/out.log"); send "scriptevent beditone:status"; sleep 1; tail -n +$N "$D/out.log" | grep -oE "feet=BetterBlockPos\{x=[-0-9]+,y=[-0-9]+,z=[-0-9]+\}" | tail -1 | sed -E 's/.*x=([-0-9]+),y=([-0-9]+),z=([-0-9]+).*/\1 \2 \3/'; }
blk() { local N=$(wc -l < "$D/out.log"); send "testforblock $1 $2 $3 $4"; sleep 0.7; tail -n +$N "$D/out.log" | grep -q "Successfully found" && echo yes || echo no; }
wait_feet() { # wait_feet "<x y z>" seconds
    for ((i=0;i<$2;i++)); do sleep 1; [ "$(feet)" == "$1" ] && return 0; done; return 1; }
check() { if [ "$2" == 0 ]; then echo "PASS  $1"; else echo "FAIL  $1 (bot at $(feet))"; fi; }
send "fill -5 -64 -45 100 -64 45 bedrock" "fill -5 -63 -45 100 -62 45 dirt" "fill -5 -61 -45 100 -61 45 grass_block" "fill -5 -60 -45 100 -40 45 air" \
     "kill @e[type=item]" "tickingarea add circle 50 -60 0 4 suite" "gamerule domobspawning false" "time set noon"
sleep 3
send "fill 40 -64 -45 41 -61 45 air" "fill 50 -60 -45 50 -57 45 stone" "fill 58 -64 -45 59 -61 45 air" "setblock 70 -61 5 diamond_ore" "setblock 72 -62 -3 diamond_ore"
sleep 1
send "scriptevent beditone:standin Steve 0.5 -60 0.5"; sleep 2; send "scriptevent beditone:runas Steve #set reset all" "scriptevent beditone:runas Steve #version"; sleep 3
send "scriptevent beditone:runas Steve #goto 12 -60 7"; wait_feet "12 -60 7" 15; check "walk (traverse + diagonal) to 12 -60 7" $?
send "scriptevent beditone:runas Steve #goto 12 -55 7"; wait_feet "12 -55 7" 20; check "pillar up 5 blocks" $?
send "scriptevent beditone:runas Steve #goto 16 -60 12"; wait_feet "16 -60 12" 30; check "get down (dig or water bucket fall)" $?
[ "$(blk 13 -60 12 air)" == yes ] && [ "$(blk 16 -60 11 air)" == yes ] && echo "PASS  no leftover water" || echo "WARN  water left behind"
send "tp Steve 36.5 -60 0.5"; sleep 2
send "scriptevent beditone:runas Steve #goto 45 -60 0"; wait_feet "45 -60 0" 30; check "bridge a 2-wide void ravine" $?
send "scriptevent beditone:runas Steve #goto 54 -60 0"; wait_feet "54 -60 0" 30; check "break through a 4-high stone wall" $?
send "scriptevent beditone:runas Steve #allowParkour true" "scriptevent beditone:runas Steve #allowPlace false"; sleep 1
send "scriptevent beditone:runas Steve #goto 63 -60 0"; wait_feet "63 -60 0" 20; check "parkour over a 2-wide gap (placing off)" $?
[ "$(blk 58 -61 0 air)" == yes ] && echo "PASS  parkour didn't bridge" || echo "FAIL  bridged instead of jumping"
send "scriptevent beditone:runas Steve #set reset allowParkour" "scriptevent beditone:runas Steve #set reset allowPlace"; sleep 1
send "scriptevent beditone:runas Steve #mine diamond_ore"; for i in $(seq 1 40); do sleep 1; [ "$(blk 70 -61 5 air)" == yes ] && [ "$(blk 72 -62 -3 air)" == yes ] && break; done
[ "$(blk 70 -61 5 air)" == yes ] && [ "$(blk 72 -62 -3 air)" == yes ]; check "#mine diamond_ore (2 buried ores)" $?
send "scriptevent beditone:runas Steve #stop" "summon cow 85 -60 10"; sleep 1
send "scriptevent beditone:runas Steve #follow entity cow"; sleep 12
N=$(wc -l < "$D/out.log"); send "scriptevent beditone:status"; sleep 1; tail -n +$N "$D/out.log" | grep -q "Following cow" ; check "#follow entity cow (still following after 12s)" $?
send "scriptevent beditone:runas Steve #stop" "kill @e[type=cow]"
send "scriptevent beditone:runas Steve #sel pos1 88 -60 0" "scriptevent beditone:runas Steve #sel pos2 91 -59 3" "scriptevent beditone:runas Steve #sel walls cobblestone"
for i in $(seq 1 60); do sleep 1; N=$(wc -l < "$D/out.log"); send "testforblocks 88 -60 0 88 -60 0 88 -60 0"; done >/dev/null 2>&1 &
sleep 45
ok=0; for p in "88 -60 0" "91 -59 3" "88 -59 2" "91 -60 1" "89 -60 3"; do [ "$(blk $p cobblestone)" == yes ] || ok=1; done
[ "$(blk 89 -60 1 air)" == yes ] || ok=1
check "#sel walls cobblestone (4x2x4)" $ok
send "scriptevent beditone:runas Steve #sel clear"
send "scriptevent beditone:standin-remove"
