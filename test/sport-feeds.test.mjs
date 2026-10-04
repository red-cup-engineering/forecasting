import test from 'node:test';
import assert from 'node:assert/strict';
import { SPORTS, kalshiSides, gameCode, tickerDate, matchGames, normalizeScoreboard, sportList, seriesIndex, feedState } from '../src/sport-feeds.mjs';

const team = (displayName, location, name, abbreviation) => ({ displayName, location, name, abbreviation, shortDisplayName: name });
const g = (id, start, a, b) => ({ id, start, competitors: [a, b].map((t) => ({ key: t.name, names: [t.displayName, t.location, t.name, t.abbreviation, `${t.location} ${t.name}`], score: 0 })) });
const ev = (title, event_ticker) => ({ title, event_ticker });

test('every sport has a winner series, an ESPN path and a kind', () => {
  for (const [k, s] of Object.entries(SPORTS)) { assert.match(s.game, /^KX[A-Z0-9]+$/u, k); assert.match(s.espn, /^[a-z]+\/[a-z0-9.-]+$/u, k); assert.ok(['team', 'tennis'].includes(s.kind)); }
  assert.ok(SPORTS.mlb.props.includes('KXMLBHIT') && SPORTS.nfl.props.includes('KXNFLTD') && SPORTS.nba.props.includes('KXNBAPTS'));
  assert.equal(seriesIndex().get('KXMLBHR').cls, 'prop');
});

test('titles split into sides for game and prop events', () => {
  assert.deepEqual(kalshiSides('Game 2: San Diego vs Milwaukee'), ['San Diego', 'Milwaukee']);
  assert.deepEqual(kalshiSides('Atlanta vs Los Angeles D: Home Runs'), ['Atlanta', 'Los Angeles D']);
  assert.equal(gameCode('KXMLBHIT-26OCT041600SDMIL'), '26OCT041600SDMIL');
  assert.equal(tickerDate('KXNFLGAME-26OCT04INDWAS'), Date.UTC(2026, 9, 4));
});

test('NFL code+nickname, city, truncated city and abbreviation sides all match', () => {
  const games = [
    g('1', '2026-10-04T17:00Z', team('Indianapolis Colts', 'Indianapolis', 'Colts', 'IND'), team('Washington Commanders', 'Washington', 'Commanders', 'WSH')),
    g('2', '2026-10-04T23:30Z', team('Golden State Warriors', 'Golden State', 'Warriors', 'GS'), team('LA Clippers', 'LA', 'Clippers', 'LAC')),
    g('3', '2026-10-04T23:30Z', team('Los Angeles Dodgers', 'Los Angeles', 'Dodgers', 'LAD'), team('Atlanta Braves', 'Atlanta', 'Braves', 'ATL')),
  ];
  const events = [ev('IND Colts vs WAS Commanders', 'KXNFLGAME-26OCT04INDWAS'), ev('Golden State vs Los Angeles C', 'KXNBAGAME-26OCT04GSWLAC'), ev('Atlanta vs Los Angeles D', 'KXMLBGAME-26OCT042000ATLLAD'), ev('Nobody vs Else', 'KXNFLGAME-26OCT04NOBELS')];
  const r = matchGames(games, events);
  assert.deepEqual(r.matched.map((m) => m.game.id), ['1', '2', '3']);
  assert.deepEqual(r.unmatchedEvents.map((e) => e.event_ticker), ['KXNFLGAME-26OCT04NOBELS']);
});

test('an unmatched game is reported, a wrong date does not match, doubleheaders pair in order', () => {
  const a = team('Cubs', 'Chicago', 'Cubs', 'CHC'); const b = team('Brewers', 'Milwaukee', 'Brewers', 'MIL');
  const games = [g('g2', '2026-10-04T23:00Z', a, b), g('g1', '2026-10-04T17:00Z', a, b), g('old', '2026-09-01T17:00Z', a, b)];
  const events = [ev('Game 2: Chicago C vs Milwaukee', 'KXMLBGAME-26OCT042300CHCMIL'), ev('Game 1: Chicago C vs Milwaukee', 'KXMLBGAME-26OCT041700CHCMIL')];
  const r = matchGames(games, events);
  assert.equal(r.matched.find((m) => m.game.id === 'g1').event.event_ticker, 'KXMLBGAME-26OCT041700CHCMIL');
  assert.equal(r.matched.find((m) => m.game.id === 'g2').event.event_ticker, 'KXMLBGAME-26OCT042300CHCMIL');
  assert.deepEqual(r.unmatchedGames.map((x) => x.id), ['old']);
});

test('soccer sides drop club affixes and use aliases; tennis matches by surname', () => {
  const soc = [g('s1', '2026-10-10T14:00Z', team('Athletic Club', 'Bilbao', 'Athletic Club', 'ATH'), team('Rayo Vallecano', 'Rayo', 'Rayo Vallecano', 'RAY')), g('s2', '2026-10-10T17:00Z', team('Parma', 'Parma', 'Parma', 'PAR'), team('Inter Milan', 'Inter', 'Inter Milan', 'INT'))];
  const r = matchGames(soc, [ev('Vallecano vs Bilbao', 'KXLALIGAGAME-26OCT10RVCATH'), ev('Inter vs Parma Calcio', 'KXSERIEAGAME-26OCT10INTPAR')]);
  assert.equal(r.matched.length, 2);
  const ten = normalizeScoreboard('tennis', { events: [{ name: 'China Open', groupings: [{ grouping: { slug: 'mens-singles' }, competitions: [{ id: '9', startDate: '2026-10-04T08:00Z', status: { period: 2, type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false } }, competitors: [{ athlete: { displayName: 'Carlos Alcaraz', fullName: 'Carlos Alcaraz' }, linescores: [{ value: 6, winner: true }, { value: 2, winner: false }] }, { athlete: { displayName: 'Jaume Munar', fullName: 'Jaume Munar' }, linescores: [{ value: 3, winner: false }, { value: 4, winner: true }] }] }] }, { grouping: { slug: 'mens-doubles' }, competitions: [{ id: '10', competitors: [] }] }] }] });
  assert.equal(normalizeScoreboard('tennis', { events: [{ groupings: [{ grouping: { slug: 'womens-singles' }, competitions: [{ id: '1', competitors: [{ athlete: { displayName: 'A' } }, { athlete: { displayName: 'B' } }] }] }] }] }, 'mens-singles').length, 0);
  assert.equal(matchGames(normalizeScoreboard('tennis', { events: [{ groupings: [{ grouping: { slug: 'mens-singles' }, competitions: [{ id: '2', startDate: '2026-10-05T07:00Z', competitors: [{ athlete: { displayName: 'Martin Damm', fullName: 'Martin Damm' } }, { athlete: { displayName: 'Pavel Kotov', fullName: 'Pavel Kotov' } }] }] }] }] }), [ev('Damm Jr vs Kotov', 'KXATPMATCH-26OCT05DAMKOT')]).matched.length, 1);
  assert.equal(ten.length, 1); assert.deepEqual(feedState(ten[0]).scores, { 'Carlos Alcaraz': 1, 'Jaume Munar': 1 });
  assert.equal(matchGames(ten, [ev('Alcaraz vs Munar', 'KXATPMATCH-26OCT04ALCMUN')]).matched.length, 1);
});

test('scoreboard normalisation reads team games and ESPN state', () => {
  const j = { events: [{ id: '5', shortName: 'A @ B', date: '2026-10-04T17:00Z', competitions: [{ status: { displayClock: '3:00', period: 2, type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false } }, competitors: [{ score: '7', team: team('A Aces', 'A', 'Aces', 'AA') }, { score: '3', team: team('B Bees', 'B', 'Bees', 'BB') }], situation: { lastPlay: { id: 'p1', text: 'x', type: { text: 'Rush' } } } }] }] };
  const [x] = normalizeScoreboard('team', j);
  assert.equal(x.state, 'in'); assert.deepEqual(feedState(x).scores, { Aces: 7, Bees: 3 }); assert.equal(x.play, 'p1');
});

test('sportList', () => {
  assert.equal(sportList('all').length, Object.keys(SPORTS).length);
  assert.deepEqual(sportList('nfl, mlb'), ['nfl', 'mlb']);
  assert.throws(() => sportList('curling'));
});
