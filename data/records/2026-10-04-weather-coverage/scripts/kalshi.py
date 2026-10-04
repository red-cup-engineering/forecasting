"""Public Kalshi GET helper (no auth). Paced, retries on 429."""
import json, time, urllib.request, urllib.parse
BASE = 'https://api.elections.kalshi.com/trade-api/v2'
def get(path, **params):
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url = f'{BASE}{path}' + (f'?{q}' if q else '')
    for a in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'wx-coverage-research'}), timeout=30) as r:
                time.sleep(0.07)
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(1.5 * (a + 1)); continue
            if e.code == 404: return None
            raise
        except Exception:
            time.sleep(1 + a)
    raise RuntimeError(url)
def paged(path, key, **params):
    cur = None
    while True:
        d = get(path, cursor=cur, **params)
        if not d: return
        yield from d[key]
        cur = d.get('cursor')
        if not cur: return
