"""Shared helpers for the belief-path laboratory (public Kalshi data, no orders)."""
import json, os, time, urllib.request, urllib.parse, urllib.error
B = "https://api.elections.kalshi.com/trade-api/v2"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
RES = os.path.join(HERE, "..", "results")
_last = [0.0]
MIN_GAP = float(os.environ.get("BP_GAP", "0.35"))
def get(path, params, tries=8):
    for a in range(tries):
        dt = time.time() - _last[0]
        if dt < MIN_GAP: time.sleep(MIN_GAP - dt)
        _last[0] = time.time()
        try:
            with urllib.request.urlopen(B + path + "?" + urllib.parse.urlencode(params), timeout=45) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            time.sleep(min(60, 3 * (2 ** a)) if e.code == 429 else 1.5 * (a + 1))
            if e.code in (400, 404): return None
        except Exception:
            time.sleep(1.5 * (a + 1))
    return None
def fee_cents(price_c, n, maker=False, maker_fee_type=False):
    """Kalshi quadratic fee for one order of n contracts at price_c cents: ceil-to-cent of 0.07*n*P*(1-P) dollars; maker pays 0 unless quadratic_with_maker_fees (0.0175 coefficient)."""
    import math
    P = price_c / 100.0
    if maker:
        if not maker_fee_type: return 0
        return math.ceil(round(0.0175 * n * P * (1 - P) * 100, 9))
    return math.ceil(round(0.07 * n * P * (1 - P) * 100, 9))
