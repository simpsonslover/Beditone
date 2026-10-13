#!/bin/bash
S="${BDS_TOOLS:?set BDS_TOOLS to the folder holding driver.mjs and bds/}"
D="$S/bds"
send() { for c in "$@"; do echo "$c" >> "$D/cmd.txt"; done; }
status() { local N=$(wc -l < "$D/out.log"); send "scriptevent beditone:status verbose"; sleep 1; tail -n +$N "$D/out.log" | grep "Beditone>status"; }
keys() { status | grep -oE "movementKeys=[a-z]+" | tail -1 | cut -d= -f2; }
feet() { status | grep -oE "feet=BetterBlockPos\{x=[-0-9]+,y=[-0-9]+,z=[-0-9]+\}" | tail -1 | sed -E 's/.*x=([-0-9]+),y=([-0-9]+),z=([-0-9]+).*/\1 \2 \3/'; }
check() { if [ "$2" == 0 ]; then echo "PASS  $1"; else echo "FAIL  $1"; fi; }
send "fill -5 -64 -20 40 -64 20 bedrock" "fill -5 -63 -20 40 -61 20 grass_block" "fill -5 -60 -20 40 -40 20 air" \
     "tickingarea add circle 15 -60 0 4 extras" "time set noon" \
     "scriptevent beditone:standin Steve 0.5 -60 0.5"
sleep 3
send "scriptevent beditone:runas Steve #set reset all"; sleep 1
[ "$(keys)" == player ]; check "keys are the player's while idle" $?
send "scriptevent beditone:runas Steve #goto 30 -60 0"; sleep 2
[ "$(keys)" == locked ]; check "keys are locked while pathing" $?
send "scriptevent beditone:runas Steve #pause"; sleep 1
[ "$(keys)" == player ]; check "#pause gives the keys back" $?
a=$(feet); sleep 2; b=$(feet)
[ "$a" == "$b" ]; check "paused player stays put" $?
send "scriptevent beditone:runas Steve #resume"; sleep 2
[ "$(keys)" == locked ]; check "#resume locks them again" $?
send "scriptevent beditone:runas Steve #stop"; sleep 1
[ "$(keys)" == player ]; check "#stop gives the keys back" $?
send "scriptevent beditone:runas Steve #allowBreak false" "scriptevent beditone:runas Steve #allowPlace false" "scriptevent beditone:runas Steve #allowParkour false"
send "fill 20 -60 -20 20 -55 20 stone" "setblock 20 -60 0 wooden_door [\"direction\"=0]" "setblock 20 -59 0 wooden_door [\"direction\"=0,\"upper_block_bit\"=true]"
sleep 1
send "scriptevent beditone:runas Steve #goto 25 -60 0"
ok=1; for i in $(seq 1 25); do [ "$(feet)" == "25 -60 0" ] && { ok=0; break; }; done
check "opens a closed door to walk through it" $ok
send "scriptevent beditone:runas Steve #set reset all" "scriptevent beditone:standin-remove"
