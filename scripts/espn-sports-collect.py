#!/usr/bin/env python3
"""Collect final ESPN events (teams, scores, sportsbook moneylines, win-probability series with wallclock).
usage: espn-sports-collect.py OUT_DIR [days=24]   (public ESPN JSON, no key)"""
import sys, json, time, urllib.request, os, datetime
S = "https://site.api.espn.com/apis/site/v2/sports/"
LEAGUES = ["football/nfl","football/college-football","baseball/mlb","basketball/wnba","hockey/nhl",
           "soccer/eng.1","soccer/uefa.champions","soccer/esp.1","soccer/ger.1","soccer/ita.1","soccer/fra.1","soccer/usa.1"]
def get(url):
    for a in range(4):
        try:
            with urllib.request.urlopen(url, timeout=40) as r: return json.load(r)
        except Exception: time.sleep(1 + a)
    return None
def ml(o):
    try:
        return {"provider": o["provider"]["name"], "home": o["homeTeamOdds"].get("moneyLine"), "away": o["awayTeamOdds"].get("moneyLine"),
                "draw": (o.get("drawOdds") or {}).get("moneyLine")}
    except Exception: return None
def main():
    out = sys.argv[1]; days = int(sys.argv[2]) if len(sys.argv) > 2 else 24
    os.makedirs(out, exist_ok=True)
    only = sys.argv[3] if len(sys.argv) > 3 else None
    f = open(os.path.join(out, "espn.jsonl" if not only else "espn-%s.jsonl" % only.replace("/", "-")), "w")
    today = datetime.date.today()
    for lg in LEAGUES:
        if only and not lg.startswith(only): continue
        seen = set(); n = 0
        for k in range(1, days + 2):
            d = (today - datetime.timedelta(days=k)).strftime("%Y%m%d")
            sb = get(S + lg + "/scoreboard?dates=%s&limit=400" % d)
            if not sb: continue
            for e in sb.get("events", []):
                if e["id"] in seen: continue
                c = e["competitions"][0]
                if c["status"]["type"]["name"] not in ("STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_FINAL_AET", "STATUS_FINAL_PEN"): continue
                seen.add(e["id"])
                su = get(S + lg + "/summary?event=" + e["id"])
                if not su: continue
                comp = {t["homeAway"]: t for t in c["competitors"]}
                pc = su.get("pickcenter") or []
                odds = [x for x in (ml(o) for o in pc) if x and x["home"] is not None]
                plays = {}
                for dr in (su.get("drives") or {}).get("previous", []):
                    for p in dr.get("plays", []): plays[str(p.get("id"))] = p.get("wallclock")
                for p in su.get("plays") or []: plays[str(p.get("id"))] = p.get("wallclock")
                wp = []
                for w in su.get("winprobability") or []:
                    wp.append([plays.get(str(w.get("playId"))), w.get("homeWinPercentage"), w.get("tiePercentage")])
                rec = {"league": lg, "id": e["id"], "date": e["date"], "name": e["name"],
                       "home": {"name": comp["home"]["team"]["displayName"], "abbr": comp["home"]["team"].get("abbreviation"), "score": comp["home"].get("score"), "winner": comp["home"].get("winner")},
                       "away": {"name": comp["away"]["team"]["displayName"], "abbr": comp["away"]["team"].get("abbreviation"), "score": comp["away"].get("score"), "winner": comp["away"].get("winner")},
                       "odds": odds, "wp": wp}
                f.write(json.dumps(rec) + "\n"); n += 1
        print(lg, n, flush=True)
    f.close()
main()
