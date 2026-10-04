#!/bin/sh
# Re-run every analysis from the data/ files (collector keeps appending; the fill grids take ~5 min each).
# usage: scripts/analyze.sh [--grids]   (--grids also rebuilds results/fill-grid*.csv from the tape)
set -e
cd "$(dirname "$0")/.."
node scripts/fetch-desk-history.mjs
node scripts/fetch-desk-tape.mjs
node scripts/fetch-universe-tape.mjs
if [ "$1" = "--grids" ]; then python3 scripts/fillmodel.py weather; python3 scripts/fillmodel.py gas; fi
python3 scripts/flow.py > /dev/null
python3 scripts/books.py > /dev/null
python3 scripts/validate.py > /dev/null
python3 scripts/ev.py > /dev/null
python3 scripts/gas.py > /dev/null
python3 scripts/taker_edge.py > /dev/null
echo "results/: flow.md books.md fill-model.md weather-ev.md taker-edge.md gas.md desk-validation.md"
