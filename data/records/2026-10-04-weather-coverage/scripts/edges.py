"""Score trade candidates with taker (IOC at the touch) and queue-aware resting execution, real fees.
cand columns: ticker, t (UTC iso), kind ('tail_sell' = sell YES to the bid / rest an ask ; 'fav_buy' = lift the ask / rest a bid), bid, ask (dollars), y (1 if YES).
Per contract, dollars. Taker fee: Kalshi quadratic 0.07*n*p*(1-p) rounded up to a cent per order, evaluated at a batch of NB contracts."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from fills import *
NB = 10   # taker batch size for the fee rounding (desk policy v5 takes in batches)
def score(cand, tapes, horizon_h=4.0, q0=None, nb=NB):
    q0 = q0 or Q0_SELL_TOUCH
    out = []
    for r in cand.itertuples():
        tp = tapes.get(r.ticker); t0 = pd.Timestamp(r.t)
        if r.kind == 'tail_sell':
            pt = round(r.bid * 100); tak = (r.bid - r.y) - fee_cents(pt, nb) / nb / 100          # sell YES at the bid
            pr = round(r.ask * 100); rest_px = pr; side = 'sell'; pnl_rest = r.ask - r.y
            q = q0.get(pr, 60 if pr > 6 else 150)
            flow_take = flow(tp, 'no', ge_p=pt, t0=t0, horizon_h=horizon_h)   # taker sold YES into bids at >= our price: what the bids absorbed
        else:
            pt = round(r.ask * 100); tak = (r.y - r.ask) - fee_cents(pt, nb) / nb / 100          # buy YES at the ask
            pr = round(r.bid * 100); rest_px = pr; side = 'buy'; pnl_rest = r.y - r.bid
            q = q0.get(100 - pr, 60)                                                              # symmetric queue at the touch
            flow_take = flow(tp, 'yes', le_p=pt, t0=t0, horizon_h=horizon_h)   # taker bought YES from asks at <= our price
        ft, ch = first_fill(tp, side, rest_px, t0, horizon_h, q)
        out.append(dict(ticker=r.ticker, t=r.t, kind=r.kind, taker_px=pt, taker_pnl=tak, rest_px=rest_px, rest_fill=ft is not None, rest_channel=ch, rest_pnl=pnl_rest if ft is not None else 0.0, flow_at_touch=flow_take, y=r.y))
    return pd.DataFrame(out)
