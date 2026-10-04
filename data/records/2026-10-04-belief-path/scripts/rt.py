"""Executable round trips on the 1-minute grid. Taker in, taker out (or settlement), Kalshi quadratic fee on each order, latency L minutes.
YES-long: pay ask(t+L), sell into bid(t+L+h) (or collect X at settlement, no fee). NO-long: pay 1-bid(t+L), sell NO into 1-ask(t+L+h).
A missing exit quote is charged as worthless (bid 0 for YES, NO bid 0), the conservative reading."""
import numpy as np
from lab import *

def round_trips(A, h, L, C=1):
    X = A["X"]; askv, bidv = A["askv"], A["bidv"]
    ask_in, in1 = shift(A, askv, L)               # entry quote; NaN if the market already ended
    bid_in, _ = shift(A, bidv, L)
    # exit index inside the market?
    inside = (A["pos"] + L + h) < A["Lm"]
    bid_out, _ = shift(A, bidv, L + h); ask_out, _ = shift(A, askv, L + h)
    bid_out = np.where(inside, np.nan_to_num(bid_out, nan=0.0), X)               # YES exit value
    ask_out = np.where(inside, np.nan_to_num(ask_out, nan=1.0), X)               # YES ask at exit (NO exit value = 1 - ask)
    fe_y = fee_c(ask_in, C) / C; fx_y = np.where(inside, fee_c(bid_out, C) / C, 0.0)
    fe_n = fee_c(1 - bid_in, C) / C; fx_n = np.where(inside, fee_c(1 - ask_out, C) / C, 0.0)
    net_yes = (bid_out - ask_in) * 100 - fe_y - fx_y
    net_no = (bid_in - ask_out) * 100 - fe_n - fx_n
    gross_yes = (bid_out - ask_in) * 100; gross_no = (bid_in - ask_out) * 100
    return dict(net_yes=net_yes, net_no=net_no, gross_yes=gross_yes, gross_no=gross_no, ask_in=ask_in, bid_in=bid_in)
