import json, os, glob, re, math
import numpy as np, pandas as pd
from zoneinfo import ZoneInfo
from datetime import datetime, timedelta, timezone
H = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(H, '..', 'data'); R = os.path.join(H, '..', 'results')
# Kalshi KXRAIN city code -> (ICAO station in NBS, IANA zone)
RAIN_STN = {'TTN':('KTTN','America/New_York'),'SFO':('KSFO','America/Los_Angeles'),'SEA':('KSEA','America/Los_Angeles'),'SATX':('KSAT','America/Chicago'),'PVD':('KPVD','America/New_York'),'PROV':('KPVD','America/New_York'),'PIT':('KPIT','America/New_York'),'PHX':('KPHX','America/Phoenix'),'PHIL':('KPHL','America/New_York'),'OKC':('KOKC','America/Chicago'),'NYC':('KNYC','America/New_York'),'NOLA':('KMSY','America/Chicago'),'MKE':('KMKE','America/Chicago'),'MIL':('KMKE','America/Chicago'),'MIN':('KMSP','America/Chicago'),'MIA':('KMIA','America/New_York'),'LV':('KLAS','America/Los_Angeles'),'LEX':('KLEX','America/New_York'),'LAX':('KLAX','America/Los_Angeles'),'HOU':('KIAH','America/Chicago'),'EWR':('KEWR','America/New_York'),'DEN':('KDEN','America/Denver'),'DC':('KDCA','America/New_York'),'DAL':('KDFW','America/Chicago'),'CLL':('KCLL','America/Chicago'),'COL':('KCLL','America/Chicago'),'CHI':('KORD','America/Chicago'),'BOS':('KBOS','America/New_York'),'AUS':('KAUS','America/Chicago'),'ATL':('KATL','America/New_York'),'DTW':('KDTW','America/New_York'),'CMH':('KCMH','America/New_York')}
MON = {m: i for i, m in enumerate('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(), 1)}
def event_date(ev):
    m = re.search(r'-(\d\d)([A-Z]{3})(\d\d)$', ev); return datetime(2000 + int(m[1]), MON[m[2]], int(m[3])).date()
def utc(ts): return pd.Timestamp(ts, unit='s', tz='UTC')
def load_nbs(stn):
    p = f'{D}/nbs/{stn}.csv'
    if not os.path.exists(p): return None
    df = pd.read_csv(p, parse_dates=['runtime', 'ftime'])
    df['runtime'] = df.runtime.dt.tz_localize('UTC'); df['ftime'] = df.ftime.dt.tz_localize('UTC')
    return df
def lst_window(date, zone):
    """UTC [start,end) of the local-standard-time calendar day (the NWS climate day)."""
    z = ZoneInfo(zone); jan = datetime(date.year, 1, 15, tzinfo=z).utcoffset()
    s = datetime(date.year, date.month, date.day, tzinfo=timezone.utc) - jan
    return pd.Timestamp(s), pd.Timestamp(s + timedelta(days=1))
def fee_cents(price_c, n, rate=0.07):
    """Kalshi taker fee, cents: ceil(0.07 * n * p * (1-p)) to the cent (quadratic), p in dollars."""
    p = price_c / 100
    return math.ceil(rate * n * p * (1 - p) * 100 - 1e-9)
def md(df, index=True):
    if index: df = df.reset_index()
    cols = list(df.columns)
    out = ['| ' + ' | '.join(map(str, cols)) + ' |', '|' + '---|' * len(cols)]
    for _, r in df.iterrows(): out.append('| ' + ' | '.join(f'{v:.3f}' if isinstance(v, float) else str(v) for v in r.values) + ' |')
    return '\n'.join(out)
RAIN_STN['WPB'] = ('KPBI', 'America/New_York')
