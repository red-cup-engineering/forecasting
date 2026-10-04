"""Map Kalshi game-winner events to ESPN events (teams + start time). Writes matched.json."""
import json, re, sys, os, collections
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_sports_lib import *
LEAGUE_SERIES = {"football/nfl":["KXNFLGAME"],"football/college-football":["KXNCAAFGAME"],"baseball/mlb":["KXMLBGAME"],
  "basketball/wnba":["KXWNBAGAME"],"hockey/nhl":["KXNHLGAME"],"soccer/eng.1":["KXEPLGAME"],"soccer/uefa.champions":["KXUCLGAME"],
  "soccer/esp.1":["KXLALIGAGAME"],"soccer/ger.1":["KXBUNDESLIGAGAME"],"soccer/ita.1":["KXSERIEAGAME"],"soccer/fra.1":["KXLIGUE1GAME"],"soccer/usa.1":["KXMLSGAME"]}
def toks(s): return re.findall(r"[a-z0-9]+", s.lower().replace("&", " and "))
def name_match(sub, full):
    a = toks(sub); b = toks(full)
    if not a: return False
    return all(any(w.startswith(x) or x.startswith(w) and len(w) >= 3 for w in b) for x in a)
def match(D):
    M = load_markets(D + "/markets.jsonl")
    EV = collections.defaultdict(list)
    for m in M.values(): EV[m["event_ticker"]].append(m)
    out = []; unmatched = collections.Counter(); tot = collections.Counter()
    espn = [json.loads(l) for l in open(D + "/espn.jsonl")]
    by_series = collections.defaultdict(list)
    for ev, ms in EV.items(): by_series[ms[0]["series"]].append((ev, ms))
    for e in espn:
        st = ts(e["date"].replace("Z", ":00Z") if len(e["date"]) == 17 else e["date"])
        cand = []
        for s in LEAGUE_SERIES[e["league"]]:
            for ev, ms in by_series[s]:
                cl = ts(ms[0]["close_time"])
                if not (st - 3600 < cl < st + 8 * 3600 * 1.5): continue
                hm = [m for m in ms if name_match(m["yes_sub_title"], e["home"]["name"])]
                am = [m for m in ms if name_match(m["yes_sub_title"], e["away"]["name"])]
                if len(hm) == 1 and len(am) == 1 and hm[0] is not am[0]:
                    tie = [m for m in ms if m["yes_sub_title"].lower().startswith("tie") or m["yes_sub_title"].lower() == "draw"]
                    cand.append(dict(kalshi_event=ev, series=s, home=hm[0]["ticker"], away=am[0]["ticker"], tie=tie[0]["ticker"] if tie else None,
                                     home_res=hm[0]["result"], away_res=am[0]["result"], tie_res=tie[0]["result"] if tie else None, close=cl))
        tot[e["league"]] += 1
        if len(cand) == 1: out.append(dict(espn=e, start=st, **cand[0]))
        else: unmatched[e["league"]] += 1
    return out, tot, unmatched
if __name__ == "__main__":
    D = sys.argv[1]
    out, tot, un = match(D)
    json.dump(out, open(D + "/matched.json", "w"))
    for lg in tot: print(lg, "espn final:", tot[lg], "matched:", tot[lg] - un[lg])
