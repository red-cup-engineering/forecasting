import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from edges import *
c = pd.read_csv(f'{D}/rain-wknd-cand-full.csv'); tapes = load_tape(f'{D}/trades-rainwknd.ndjson')
rows = []
for kind in ('tail_sell', 'fav_buy'):
    cc = c[c.kind == kind]; s = score(cc, tapes)
    n = len(s); f = int(s.rest_fill.sum())
    rows.append(dict(rule=kind + (' p<=0.03 bid>=3c' if kind == 'tail_sell' else ' p>=0.97 ask<=97c'), markets=n, wrong=int(s.y.sum()) if kind == 'tail_sell' else int(n - s.y.sum()), taker_c_per_ct=round(100 * s.taker_pnl.mean(), 2), rest_fill_rate=round(f / n, 2), rest_c_per_placed=round(100 * s.rest_pnl.sum() / n, 2), median_flow=float(s.flow_at_touch.median())))
res = pd.DataFrame(rows); res.to_csv(f'{R}/rain-weekend-edges.csv', index=False)
open(f'{R}/rain-weekend.md', 'a').write('\n\n' + md(res, index=False)); print(md(res, index=False))
