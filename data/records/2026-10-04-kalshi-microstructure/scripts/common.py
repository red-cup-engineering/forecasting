import warnings; warnings.filterwarnings("ignore")
import json, os, glob
import pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
RES = os.path.join(HERE, '..', 'results')

def load_tape(include_live=True):
    """Historic settled-market tape plus the live collector's tape, one frame (memory-lean: typed columns, categorical tickers).
    Columns: t (UTC), tk, p (cents), n (contracts), s (taker side yes|no), close, kind, result, series, hrs_to_close, et_hour."""
    import numpy as np
    meta = json.load(open(os.path.join(DATA, 'tape-markets.json')))
    seen, T, TK, P, N, S = set(), [], [], [], [], []
    files = [os.path.join(DATA, 'tape-history.ndjson'), os.path.join(DATA, 'tape-desk.ndjson')] + (sorted(glob.glob(os.path.join(DATA, 'trades-*.ndjson'))) if include_live else [])
    for f in files:
        if not os.path.exists(f): continue
        with open(f) as fh:
            for l in fh:
                if not l.strip(): continue
                r = json.loads(l)
                h = hash(r['id'])
                if h in seen: continue
                seen.add(h)
                T.append(np.datetime64(r['t'].rstrip('Z'), 's')); TK.append(r['tk']); P.append(r['p']); N.append(r['n']); S.append(r['s'] == 'yes')
    seen.clear()
    df = pd.DataFrame({'t': pd.to_datetime(np.array(T, dtype='datetime64[ns]')).tz_localize('UTC'), 'tk': pd.Categorical(TK), 'p': np.array(P, dtype='int16'), 'n': np.array(N, dtype='float32'), 's': pd.Categorical(np.where(S, 'yes', 'no'))})
    del T, TK, P, N, S
    cats = df.tk.cat.categories
    cl = pd.to_datetime(pd.Series([meta.get(k, {}).get('close') for k in cats]), utc=True, format='ISO8601')
    codes = df.tk.cat.codes.values
    df['close'] = cl.reindex(codes).values
    df['kind'] = pd.Categorical(np.array([meta.get(k, {}).get('kind') for k in cats], dtype=object)[codes])
    df['result'] = pd.Categorical(np.array([meta.get(k, {}).get('result') for k in cats], dtype=object)[codes])
    df['series'] = pd.Categorical(np.array([k.split('-')[0] for k in cats], dtype=object)[codes])
    df['close'] = pd.to_datetime(df['close'], utc=True)
    df['hrs_to_close'] = ((df['close'] - df['t']).dt.total_seconds() / 3600).astype('float32')
    df['et_hour'] = ((df['t'] - pd.Timedelta(hours=4)).dt.hour).astype('int8')
    return df.sort_values('t').reset_index(drop=True)

def md(df, floatfmt=3):
    cols = list(df.columns)
    out = ['| ' + ' | '.join(map(str, cols)) + ' |', '|' + '---|' * len(cols)]
    for _, r in df.iterrows():
        out.append('| ' + ' | '.join((f'{v:.{floatfmt}f}' if isinstance(v, float) else str(v)) for v in r.values) + ' |')
    return '\n'.join(out)
