"""Render results/census.md from data/census-rows.json (+ settled counts) -- family rollup and per-series rows."""
import sys, os, re, json
sys.path.insert(0, os.path.dirname(__file__))
from common import *
rows = pd.DataFrame(json.load(open(f'{D}/census-rows.json')))
sc = json.load(open(f'{D}/settled-counts.json'))
ser = {s['ticker']: s for s in json.load(open(f'{D}/series.json'))['series']}
def fam(t):
    if re.match(r'KX(HIGHT|LOWT)', t) or t in ('KXHIGHAUS','KXHIGHCHI','KXHIGHDEN','KXHIGHLAX','KXHIGHMIA','KXHIGHNY','KXHIGHPHIL','KXLOWAUS','KXLOWCHI','KXLOWDEN','KXLOWLAX','KXLOWMIA','KXLOWNY','KXLOWPHIL','KXHIGHOU','KXHIGHHOU','KXHOUHIGH','KXDENHIGH','KXPHILHIGH','KXHIGHNYD','KXHIGHTEMPDEN','KXMINNYC','KXLOWNYC','KXHIGHUS','KXDVHIGH','KXMAXTEMP100','KXHEATAPHX','KXSJCLOWT','KXHOLIDAYTMAX','KXHOLIDAYTMIN'): return 'temperature, daily high/low'
    if t.startswith('KXTEMP') and t.endswith(('H','HS')) or t in ('KXTEMPMON',): return 'temperature, hourly directional' if t != 'KXTEMPMON' else 'temperature, other'
    if t.startswith('KXAVGT'): return 'temperature, weekly average (consecutive hot days)'
    if t.startswith('KXWEEKHT'): return 'temperature, weekly high'
    if t == 'KXRAIN' or t.startswith('KXRAIND'): return 'rain, daily'
    if t.startswith('KXRAINWKND') or t == 'KXRAINNYCW': return 'rain, weekend/weekly'
    if t.startswith('KXRAIN'): return 'rain, monthly/custom'
    if re.search(r'SNOW', t): return 'snow'
    if 'OPEN' in t or 'CLOSE' in t: return 'ski-resort open/close dates'
    if t.startswith(('KXHUR','KXFIRSTHUR','KXNAMEDSTORM','KXTROPSTORM','KXNEXTHUR','KXNEXTCAT5','KXHURRICANE')): return 'hurricane / tropical'
    if t.startswith(('KXEARTH','KXBIGGESTQUAKE','KXERUPT','KXKILAUEA','KXVEI','KXTSUNAMI')): return 'earthquake / volcano'
    return 'climate / other'
rows['family'] = rows.series.map(fam)
rows['settled'] = rows.series.map(lambda t: sc.get(t, {}).get('settled', ''))
rows['span'] = rows.series.map(lambda t: (sc[t]['first'][:10] + '..' + sc[t]['last'][:10]) if t in sc and sc[t]['settled'] else '')
# temperature daily: history from the temperature record (408 settled per series since 2026-07-28)
cfgs = {x['seriesTicker'] for x in json.load(open(os.path.join(D, '../../../../content/config/temperature-markets.json')))['series']}
rows.loc[rows.series.isin(cfgs), ['settled', 'span']] = ['(~400)', '2026-07-28..']
fr = rows.groupby('family').agg(series_open=('series', lambda s: int((rows.loc[s.index, 'markets'] > 0).sum())), markets=('markets', 'sum'), vol24h=('vol24h', 'sum'), oi=('oi', 'sum')).sort_values('vol24h', ascending=False).reset_index()
all_series = len(ser); open_series = int((rows.markets > 0).sum())
out = ['# Census of Kalshi Climate & Weather (public API, 2026-10-04 05:00Z)', '', f'{all_series} series in the category, {open_series} with open markets. vol24h in contracts; depth columns are TOP-OF-BOOK only (sum of best-bid / best-ask sizes across a series\' open markets), the full-ladder depth at policy prices is in saturation.md.', '', '## By family', '', md(fr, index=False), '']
cols = ['series', 'freq', 'markets', 'events', 'vol24h', 'oi', 'bid_top', 'ask_top', 'settled', 'span', 'source']
for f, g in rows[rows.markets > 0].groupby('family'):
    g = g.sort_values('vol24h', ascending=False)
    out += [f'### {f}', '', md(g[cols].assign(source=g.source.str.replace('\n', ' ').str[:40]), index=False), '']
zero = rows[(rows.markets == 0) & (rows.settled != '') & (rows.settled.apply(lambda v: isinstance(v, int) and v > 0))].sort_values('settled', ascending=False)
out += ['### Series with no open market now but settled history', '', md(zero[['series', 'family', 'freq', 'settled', 'span']].head(40), index=False)]
open(f'{R}/census.md', 'w').write('\n'.join(out)); fr.to_csv(f'{R}/census-families.csv', index=False); rows.to_csv(f'{R}/census.csv', index=False)
print(md(fr, index=False))
