/**
 * Sports the generator-lag recorder covers, pure: Kalshi winner series, eligible player-prop series, ESPN
 * scoreboard path, and the matcher that pairs an ESPN game with a Kalshi game event.
 *
 * Series were discovered from public GET /series (category Sports) and GET /events?series_ticker=…&status=open.
 * Prop series that Kalshi lists but has no open event for today (NBA preseason, soccer goalscorers midweek)
 * stay in the map: discovery asks each series once per round and subscribes whatever is open. A prop event
 * belongs to a game when it carries the game's event-ticker suffix (KXMLBHIT-26OCT041600SDMIL joins
 * KXMLBGAME-26OCT041600SDMIL); that suffix, `code`, is the join key of the whole tape.
 */
const soccer = (espn, L, extra = []) => ({ espn: `soccer/${espn}`, game: `KX${L}GAME`, props: [`KX${L}GOAL`, ...extra], kind: 'team' });

export const SPORTS = {
  nfl: { espn: 'football/nfl', game: 'KXNFLGAME', kind: 'team', props: ['KXNFLTD', 'KXNFL2TD', 'KXNFLANYTD', 'KXNFLFIRSTTD', 'KXNFLRECYDS', 'KXNFLREC', 'KXNFLRSHYDS', 'KXNFLRSHATT', 'KXNFLRRYDS', 'KXNFLPASSYDS', 'KXNFLPASSTDS', 'KXNFLPASSCOMP', 'KXNFLPASSATT', 'KXNFLPASSINT', 'KXNFLGAMESACK'] },
  ncaaf: { espn: 'football/college-football', game: 'KXNCAAFGAME', kind: 'team', props: [] },
  mlb: { espn: 'baseball/mlb', game: 'KXMLBGAME', kind: 'team', props: ['KXMLBHIT', 'KXMLBHR', 'KXMLBTB', 'KXMLBKS', 'KXMLBHRR', 'KXMLBSB', 'KXMLBOUTS', 'KXMLBHA', 'KXMLBERA', 'KXMLBWA'] },
  nhl: { espn: 'hockey/nhl', game: 'KXNHLGAME', kind: 'team', props: ['KXNHLGOAL', 'KXNHLANYGOAL', 'KXNHLAST', 'KXNHLPTS', 'KXNHLSAVES', 'KXNHLSOG'] },
  nba: { espn: 'basketball/nba', game: 'KXNBAGAME', kind: 'team', props: ['KXNBAPTS', 'KXNBAREB', 'KXNBAAST', 'KXNBA3PT', 'KXNBAPR', 'KXNBAPA', 'KXNBARA', 'KXNBAPRA', 'KXNBASTL', 'KXNBABLK', 'KXNBASTOCK', 'KXNBA2D', 'KXNBA3D', 'KXNBAFTM'] },
  wnba: { espn: 'basketball/wnba', game: 'KXWNBAGAME', kind: 'team', props: ['KXWNBAPTS', 'KXWNBAREB', 'KXWNBAAST', 'KXWNBA3PT'] },
  epl: soccer('eng.1', 'EPL', ['KXEPLANYGOAL', 'KXEPLSOA']),
  ucl: soccer('uefa.champions', 'UCL', ['KXUCLSOA']),
  laliga: soccer('esp.1', 'LALIGA'),
  bundesliga: soccer('ger.1', 'BUNDESLIGA'),
  seriea: soccer('ita.1', 'SERIEA'),
  ligue1: soccer('fra.1', 'LIGUE1'),
  mls: soccer('usa.1', 'MLS'),
  atp: { espn: 'tennis/atp', game: 'KXATPMATCH', kind: 'tennis', grouping: 'mens-singles', props: [] },
  wta: { espn: 'tennis/wta', game: 'KXWTAMATCH', kind: 'tennis', grouping: 'womens-singles', props: [] },
};

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\bla\b/g, 'los angeles').replace(/\s+/g, ' ').trim();
const STOP = new Set(['jr', 'sr', 'ii', 'iii', 'fc', 'afc', 'cf', 'sc', 'ac', 'as', 'cd', 'ud', 'rc', 'sv', 'fsv', 'vfl', 'vfb', 'ssc', 'us', 'calcio', 'club']);
const toks = (s) => norm(s).split(' ').filter(Boolean);
const coreToks = (s) => toks(s).filter((t) => !STOP.has(t));
/** Kalshi shortenings that no token rule can derive (title token → ESPN name token). */
export const ALIASES = { bilbao: 'athletic', vallecano: 'rayo', 'man city': 'manchester city', 'man united': 'manchester united', spurs: 'tottenham', wolves: 'wolverhampton' };

/** The two competitor strings of a Kalshi game or prop event title ("Game 2: A vs B", "A vs B: Hits"). */
export function kalshiSides(title) {
  const t = String(title).replace(/^Game \d+:\s*/u, '').replace(/:\s*[^:]+$/u, '');
  const parts = t.split(/\s+vs\.?\s+/iu);
  return parts.length === 2 ? parts.map((s) => s.trim()) : null;
}

/** Event-ticker suffix after the series: the join key between a winner event and its prop events. */
export const gameCode = (eventTicker) => eventTicker.split('-').slice(1).join('-');

/** Date (UTC ms at 00:00) and optional HHMM of an event ticker suffix like 26OCT041600SDMIL. */
export function tickerDate(eventTicker) {
  const m = /^[A-Z0-9]+-(\d{2})([A-Z]{3})(\d{2})(\d{4})?/u.exec(eventTicker);
  if (!m) return null;
  const mon = 'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(m[2]) / 3;
  return mon < 0 ? null : Date.UTC(2000 + Number(m[1]), mon, Number(m[3]));
}

/** Does Kalshi title side `side` name competitor `c` ({names: string[]})? */
export function sideMatches(side, c) {
  const raw = side.trim();
  const noCode = /^[A-Z]{2,4}\s+\S/u.test(raw) ? raw.replace(/^[A-Z]{2,4}\s+/u, '') : raw;
  const alias = ALIASES[norm(noCode)];
  const st = alias ? toks(alias) : coreToks(noCode);
  if (!st.length) return false;
  const have = new Set(c.names.flatMap(coreToks));
  if (st.every((t) => have.has(t))) return true;
  // truncated tail: "Los Angeles C" is a prefix of "Los Angeles Clippers"
  const sn = st.join(' ');
  return c.names.some((n) => { const nn = coreToks(n).join(' '); return sn.length >= 3 && nn.startsWith(sn); });
}

const sameDay = (ev, g) => { const d = tickerDate(ev.event_ticker); return d === null || Math.abs(d - Date.parse(g.start)) <= 36 * 3600e3; };

/** Does Kalshi event `ev` ({title, event_ticker}) describe ESPN game `g` ({start, competitors:[{names}]})? */
export function eventMatchesGame(ev, g) {
  const sides = kalshiSides(ev.title);
  if (!sides || g.competitors.length !== 2 || !sameDay(ev, g)) return false;
  const [x, y] = g.competitors;
  return (sideMatches(sides[0], x) && sideMatches(sides[1], y)) || (sideMatches(sides[0], y) && sideMatches(sides[1], x));
}

/**
 * Pair ESPN games with Kalshi winner events. Doubleheaders pair in order (earlier start, earlier ticker).
 * @returns {{matched: {game: object, event: object}[], unmatchedGames: object[], unmatchedEvents: object[]}}
 */
export function matchGames(games, events) {
  const used = new Set(); const matched = []; const unmatchedGames = [];
  for (const g of [...games].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    const hit = events.filter((e) => !used.has(e.event_ticker) && eventMatchesGame(e, g)).sort((a, b) => a.event_ticker.localeCompare(b.event_ticker))[0];
    if (hit) { used.add(hit.event_ticker); matched.push({ game: g, event: hit }); } else unmatchedGames.push(g);
  }
  return { matched, unmatchedGames, unmatchedEvents: events.filter((e) => !used.has(e.event_ticker)) };
}

const stateOf = (status) => status?.type?.state ?? (/SCHEDULED|PRE/u.test(status?.type?.name ?? '') ? 'pre' : /FINAL|FULL_TIME|POSTPONED|CANCEL/u.test(status?.type?.name ?? '') ? 'post' : 'in');

/** ESPN scoreboard JSON → uniform games. Tennis: singles only, one game per match, score = sets won. */
export function normalizeScoreboard(kind, json, grouping = null) {
  const out = [];
  if (kind === 'tennis') {
    for (const e of json?.events ?? []) {
      for (const grp of e.groupings ?? []) {
        const slug = grp.grouping?.slug ?? ''; if (!/singles/u.test(slug) || (grouping && slug !== grouping)) continue;
        for (const c of grp.competitions ?? []) {
          if (c.competitors?.length !== 2 || c.competitors.some((x) => !x.athlete)) continue;
          const comp = c.competitors.map((x) => ({ key: x.athlete.displayName, names: [x.athlete.fullName ?? x.athlete.displayName, x.athlete.displayName], score: (x.linescores ?? []).filter((l) => l.winner).length, lines: (x.linescores ?? []).map((l) => l.value).join('-') }));
          out.push({ id: String(c.id), name: `${comp[0].key} vs ${comp[1].key}`, start: c.startDate ?? c.date, state: stateOf(c.status), status: c.status?.type?.name ?? null, completed: Boolean(c.status?.type?.completed), competitors: comp, play: null, playText: null, playType: null, clock: null, period: c.status?.period ?? null, lines: comp.map((x) => x.lines).join('|'), tournament: e.name });
        }
      }
    }
    return out;
  }
  for (const e of json?.events ?? []) {
    const c = e.competitions?.[0]; if (!c || c.competitors?.length !== 2) continue;
    const lp = c.situation?.lastPlay;
    out.push({ id: String(e.id), name: e.shortName ?? e.name, start: e.date, state: stateOf(c.status), status: c.status?.type?.name ?? null, completed: Boolean(c.status?.type?.completed), competitors: c.competitors.map((t) => ({ key: t.team.name ?? t.team.displayName, names: [t.team.displayName, t.team.location, t.team.name, t.team.abbreviation, t.team.shortDisplayName, `${t.team.location ?? ''} ${t.team.name ?? ''}`.trim()].filter(Boolean), score: Number(t.score) || 0 })), play: lp?.id ?? null, playText: lp?.text ?? null, playType: lp?.type?.text ?? null, clock: c.status?.displayClock ?? null, period: c.status?.period ?? null, lines: '' });
  }
  return out;
}

/** The state a feed row records: what changing it means a new row. */
export const feedState = (g) => ({ scores: Object.fromEntries(g.competitors.map((t) => [t.key, t.score])), play: g.play, status: g.status, state: g.state, lines: g.lines });

/** Which sports a `--sport` value names: "all", or a comma list of SPORTS keys. */
export function sportList(arg) {
  if (!arg || arg === 'all') return Object.keys(SPORTS);
  const keys = arg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = keys.filter((k) => !SPORTS[k]);
  if (bad.length) throw new Error(`unknown sport ${bad.join(',')}; known: ${Object.keys(SPORTS).join(',')}`);
  return keys;
}

/** Series → { sport, cls } for every series the map names (winner or prop). */
export function seriesIndex() {
  const idx = new Map();
  for (const [sport, s] of Object.entries(SPORTS)) { idx.set(s.game, { sport, cls: 'winner' }); for (const p of s.props) idx.set(p, { sport, cls: 'prop' }); }
  return idx;
}
