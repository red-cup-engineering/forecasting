#!/usr/bin/env python3
"""List Kalshi series per category with fee_type -> data/series-all.json (needed by collect_markets.py for fee types and the Mentions series list)."""
import json, os
from bp_common import *
cat = []
for c in ["Economics", "Crypto", "Climate and Weather", "Mentions", "Sports", "Financials"]:
    d = get("/series", {"category": c})
    for s in (d or {}).get("series", []): cat.append((c, s["ticker"], s.get("frequency"), s.get("fee_type"), s["title"][:60]))
os.makedirs(DATA, exist_ok=True)
json.dump(cat, open(os.path.join(DATA, "series-all.json"), "w"))
print(len(cat), "series")
