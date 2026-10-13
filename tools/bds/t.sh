#!/bin/bash
D="${BDS_TOOLS:?}/bds"
secs=$1; every=$2; shift 2
N=$(wc -l < "$D/out.log")
for c in "$@"; do echo "$c" >> "$D/cmd.txt"; done
for ((i=0;i<secs;i++)); do sleep 1; if (( (i+1) % every == 0 )); then echo "scriptevent beditone:status" >> "$D/cmd.txt"; fi; done
sleep 1
tail -n +$((N+1)) "$D/out.log" | grep -E "Beditone>|ERROR|rror|>>> [^s]|Exception" | grep -v "Script event" | sed -E 's/^\[[^]]*\] //; s/\[Scripting\] //; s/BetterBlockPos\{x=([-0-9]+),y=([-0-9]+),z=([-0-9]+)\}/(\1,\2,\3)/g; s/GoalBlock\{x=([-0-9]+),y=([-0-9]+),z=([-0-9]+)\}/Goal(\1,\2,\3)/g; s/ proc=[^g]*goal=/ goal=/'
