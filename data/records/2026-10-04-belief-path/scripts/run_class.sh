#!/bin/bash
# usage: run_class.sh CLASS...   (needs data/markets-CLASS.jsonl and data/candles-CLASS.jsonl; see README)
cd "$(dirname "$0")"
for c in "$@"; do
  for s in martingale overreaction rtscan longshot; do
    python3 -u $s.py $c > ../data/run-$s-$c.log 2>&1 || echo "FAIL $s $c"
  done
  echo "done $c"
done
