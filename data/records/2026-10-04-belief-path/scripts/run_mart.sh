#!/bin/bash
cd "$(dirname "$0")"
for c in "$@"; do python3 -u martingale.py $c 5 > ../data/run-martingale-$c.log 2>&1; python3 -u martingale.py $c 100 > ../data/run-martingale-all-$c.log 2>&1; echo "m $c"; done
