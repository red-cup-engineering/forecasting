#!/bin/sh
# Re-run the whole study (public data only; no orders). Network steps are paced and resumable; IEM throttles (~5 s per call).
cd "$(dirname "$0")/.."
python3 scripts/census.py > data/census.log          # series + open markets (about 3 min)
python3 scripts/settled_counts.py                      # settled history per series
python3 scripts/fetch_settled.py KXRAIN KXRAINWKND KXAVGTKSAN KXAVGTKPHX KXAVGTKLAS KXAVGTKIAH KXAVGTKDEN KXAVGTKSAT KXAVGTKDFW KXAVGTKAUS KXAVGTKMSY KXAVGTKOKC
python3 scripts/fetch_candles.py KXRAIN; for f in KXRAINWKND KXAVGTKSAN KXAVGTKPHX KXAVGTKLAS KXAVGTKIAH KXAVGTKDEN KXAVGTKSAT KXAVGTKDFW KXAVGTKAUS KXAVGTKMSY KXAVGTKOKC; do python3 scripts/fetch_candles.py $f 5; done
python3 scripts/fetch_iem.py KTTN,KSFO,KSEA,KSAT,KPVD,KPIT,KPHX,KPHL,KOKC,KNYC,KMSY,KMKE,KMSP,KMIA,KLAS,KLEX,KLAX,KIAH,KEWR,KDEN,KDCA,KDFW,KCLL,KORD,KBOS,KAUS,KATL,KDTW,KCMH,KSAN,KHOU,KMDW,KSDF,KPBI
python3 scripts/rain_dataset.py && python3 scripts/rain_model.py
python3 - <<'P'
import pandas as pd
d=pd.read_csv('data/rain-scored.csv')
t=d[(d.pm_pany<=0.02)&(d.bid>=0.03)&(d.bid<=0.10)]; f=d[(d.pm_pany>=0.97)&(d.ask<=0.97)&(d.ask>0.5)]
t2=d[(d.dec=='D 07h')&(d.pm_pany<=0.02)&(d.bid>=0.03)&(d.bid<=0.10)]
pd.concat([t,f,t2]).ticker.drop_duplicates().to_csv('data/rain-cand-tickers.csv',index=False)
P
python3 scripts/fetch_trades.py rain data/rain-cand-tickers.csv && python3 scripts/rain_edges.py
python3 scripts/rain_weekend.py && python3 scripts/fetch_trades.py rainwknd data/rain-wknd-cand.csv && python3 scripts/rain_weekend_edges.py
python3 scripts/avg_temp.py
python3 scripts/temp_fetch.py 16 && node scripts/temp_certify.mjs
python3 -c "import pandas as pd; pd.read_json('data/temp-cert.ndjson',lines=True)[['ticker']].drop_duplicates().to_csv('data/temp-cand.csv',index=False)"
python3 scripts/fetch_trades.py temp data/temp-cand.csv
python3 scripts/live_books.py      # live ladders -> data/live-books.ndjson; derive stock with the snippet in README
python3 scripts/saturation.py; INCLUDE_WKND=1 python3 scripts/saturation.py
python3 scripts/census_report.py
