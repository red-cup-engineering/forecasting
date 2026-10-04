"""Family classifier for observable-progress candidates (by series ticker/title/category)."""
import re
def family(s):
    t, ti, cat = s["ticker"], (s.get("title") or ""), s.get("category")
    tl = ti.lower()
    if cat == "Mentions": return "MENTIONS"
    if re.search(r"(^|[^A-Z])(KX)?TRUMPSAY|KXELONDJTSAY|MENTION", t) : return "MENTIONS"
    if "rotten tomatoes" in tl: return "RT"
    if t.startswith("KXYTVIEWS") or t.startswith("KXYTTOP") or t.startswith("KXYTMONTHLY") or "youtube" in tl and "view" in tl: return "YT"
    if "tsa" in tl and ("check" in tl or "screen" in tl or "min/max" in tl): return "TSA"
    if "tweets" in t.lower() or "tweets" in tl or "posts" in tl and "musk" in tl: return "TWEETS"
    if re.match(r"KX(SPOTIFY\d|SPOTIFYARTISTD|SPOTIFYNUM)|KXSPOTIFY[A-Z]*D$", t) or "daily" in tl and "spotify" in tl: return "SPOTIFY_CHART"
    if "stream" in tl or t.startswith("KXSPOTIFYSONGS") or t.startswith("KXALBUMSTREAMS"): return "STREAMS"
    if re.search(r"BILLBOARD|BBCHART|TOPALBUM|ALBUMCHART|TOPSONG", t): return "BILLBOARD_CHART"
    if "box office" in tl or "opening weekend" in tl: return "BOXOFFICE"
    if "netflix" in tl: return "NETFLIX"
    if "metacritic" in tl or "meta critic" in tl: return "METACRITIC"
    if re.search(r"gas price|gasoline", tl): return "GAS"
    if re.search(r"\b(rain|snow)", tl) and ("inch" in tl or "total" in tl or "month" in tl): return "PRECIP_CUM"
    if "wikipedia" in tl or "wiki" in t.lower(): return "WIKI"
    return None
