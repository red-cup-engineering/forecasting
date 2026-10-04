#!/bin/sh
# Re-run order (from the record directory). Fetchers are resumable; heavy ones are slow under API contention.
python3 scripts/extract_nowcasts.py                       # Cleveland daily nowcasts + GDPNow history (data/ext)
python3 scripts/fetch_econ_candles.py KXCPICORE KXCPI KXGDP KXFEDDECISION KXPAYROLLS KXCPIYOY KXU3
python3 scripts/analyze_cpi.py KXCPI cpi;  python3 scripts/evaluate_probs.py data/rows/KXCPI_rows.json 2024-12-31 pr
python3 scripts/analyze_cpi.py KXCPICORE core; python3 scripts/evaluate_probs.py data/rows/KXCPICORE_rows.json 2024-12-31 pr
python3 scripts/analyze_gdp.py; python3 scripts/evaluate_probs.py data/rows/KXGDP_rows.json 2024-06-30 pn
python3 scripts/fed_eval.py;    python3 scripts/evaluate_probs.py data/rows/KXFEDDECISION_rows.json 2025-03-01 pn
for s in KXPAYROLLS KXCPIYOY KXU3 KXFEDDECISION; do python3 scripts/calib_only.py $s 15.4 0.10; done
python3 scripts/mortgage.py; python3 scripts/fed_futures.py
python3 scripts/fetch_spot_long.py; python3 scripts/fetch_idx_spot.py
python3 scripts/fetch_range.py KXBTCD crypto 17,13,10; python3 scripts/fetch_range_hist.py KXBTCD 200
python3 scripts/analyze_range.py KXBTCD BTC 4,2,1,0.5; python3 scripts/evaluate_range.py KXBTCD crypto 4 1 0.5; python3 scripts/cells.py data/rows/KXBTCD_rows.json 4
python3 scripts/maker_tail.py 1.0 2.0
python3 scripts/live_deribit_vs_kalshi.py BTC
