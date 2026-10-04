"""Shared helpers: polite Kalshi public-API client (<=8 req/s), fees, Wilson CI.
Public endpoints only, no auth, honest User-Agent."""
import json, math, os, time, urllib.request, urllib.parse, urllib.error
BASE = "https://api.elections.kalshi.com/trade-api/v2"
UA = "info-research-bot/0.1 (561 Group research, read-only public data; contact morgan.sennhauser@gmail.com)"
_last = [0.0]
MIN_GAP = 0.13  # ~7.5 req/s, well under the 15 req/s ceiling

def http_json(url, retries=4):
    for k in range(retries):
        dt = time.time() - _last[0]
        if dt < MIN_GAP: time.sleep(MIN_GAP - dt)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(2 * (k + 1)); continue
            return None  # 400/404 etc: caller treats as 'no data'
        except Exception:
            time.sleep(2 * (k + 1))
    return None

def kget(path, **params):
    q = {k: v for k, v in params.items() if v is not None}
    return http_json(f"{BASE}{path}?{urllib.parse.urlencode(q)}")

def paged(path, key, maxpages=200, **params):
    cur = None
    for _ in range(maxpages):
        d = kget(path, cursor=cur, **params)
        if not d: return
        for x in d.get(key, []): yield x
        cur = d.get("cursor") or d.get("next_cursor")
        if not cur: return

def wilson(k, n, z=1.96):
    if n == 0: return (float("nan"),) * 3
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return p, c - h, c + h

def taker_fee(p, mult=1.0, n=1):  # dollars for n contracts at price p, ceil to cent per order
    return math.ceil(round(0.07 * mult * n * p * (1 - p) * 100, 6)) / 100.0
def maker_fee(p, mult=1.0, n=1, maker_pays=False):
    return math.ceil(round(0.0175 * mult * n * p * (1 - p) * 100, 6)) / 100.0 if maker_pays else 0.0

def fnum(x):
    try: return float(x)
    except Exception: return None

# ---------- candlesticks (live batch / historical single), cached ----------
import datetime as _dt
def iso_ts(s):
    return int(_dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())

def _slim(c):
    def g(d, k):
        x = c.get(d) or {}
        v = x.get(k + "_dollars", x.get(k))   # live API uses *_dollars, historical API plain keys
        return float(v) if v not in (None, "") else None
    return (c["end_period_ts"], g("yes_bid", "close"), g("yes_ask", "close"),
            g("price", "close"), float(c.get("volume_fp") or c.get("volume") or 0), g("yes_bid", "low"), g("yes_ask", "high"))
# tuple: (end_ts, bid_close, ask_close, last_close, volume, bid_low, ask_high)

def candles(market_list, cache_path, period=60):
    """market_list: [(ticker, series_ticker, start_ts, end_ts)]; returns {ticker: [tuple,...]}; caches to json."""
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    todo = [m for m in market_list if m[0] not in cache]
    todo.sort(key=lambda m: m[2])
    i = 0
    while i < len(todo):
        chunk = [todo[i]]; i += 1   # batch only markets whose windows overlap closely (<=25 tickers, <=9 days span)
        while i < len(todo) and len(chunk) < 25 and todo[i][3] - chunk[0][2] <= 9 * 86400:
            chunk.append(todo[i]); i += 1
        s_ = min(c[2] for c in chunk); e_ = max(c[3] for c in chunk)
        d = kget("/markets/candlesticks", market_tickers=",".join(c[0] for c in chunk), start_ts=s_, end_ts=e_, period_interval=period)
        got = {x["market_ticker"]: x["candlesticks"] for x in (d or {}).get("markets", [])}
        for c in chunk:
            cs = got.get(c[0]) or []
            if not cs:   # archived (before the historical cutoff): single-market historical call
                h = kget(f"/historical/markets/{c[0]}/candlesticks", start_ts=c[2], end_ts=c[3], period_interval=period)
                cs = (h or {}).get("candlesticks", [])
            cache[c[0]] = [_slim(x) for x in cs]
        json.dump(cache, open(cache_path, "w"))
    return {m[0]: cache.get(m[0], []) for m in market_list}
