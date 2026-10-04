/**
 * The Kalshi market research brief: one typed record per Kalshi event that
 * carries everything the house knows about it, so that research and bids share
 * one artefact.
 *
 * Everything on Kalshi is pressure for what Koios.News should write about. For
 * an event (often closing within 24 hours) the house derives its own
 * intelligence -- the rule and settlement source, the book, the
 * market-implied probability per bracket, the house's own probability where a
 * house model applies, the base rate of the category, and what would move the
 * odds -- and that one record feeds two consumers:
 *
 *   1. the Kalshi desk's lanes, as allocator opportunities (below), and
 *   2. Koios.News, whose source adapter (koios-news-services-section
 *      src/news/kalshi-market-wire.mjs) turns a brief into an article draft
 *      that explains the market and links to it.
 *
 * Public information only: every field comes from Kalshi's unauthenticated
 * market-data API, NOAA's open data, the NWS observation API, or the house's
 * own measured base rates. Nothing here claims advice, a human author, or a
 * guarantee.
 *
 * ## Shape (schema: content/schemas/kalshi-market-brief.schema.json)
 *
 *   type "KalshiMarketBrief", version 1, briefId, asOf
 *   event       eventTicker, seriesTicker, title, subTitle, category, frequency,
 *               mutuallyExclusive, closesAt, expectedSettleAt, settlesOn,
 *               hoursToClose (to the earlier of close and expected settlement), url (Kalshi web page), seriesUrl, tags
 *   rules       primary, secondary, contractTermsUrl (verbatim from Kalshi, from the lead
 *               market; perMarket is true when brackets' rules differ only by strike)
 *   settlementSource  primary {name,url}|null, all [{name,url}]
 *   markets[]   ticker, label, title (the market's own question), strike, yesBidCents, yesAskCents, noBidCents,
 *               noAskCents, lastCents, bidSize, askSize, volume, volume24h,
 *               openInterest, impliedYes (mid, 0..1), impliedYesNormalized
 *               (mid / sum of mids when brackets are mutually exclusive),
 *               house {probability, ...}|null, baseRate {...}|null
 *   book        markets, volume24h, openInterest, midSum (overround when > 1)
 *   house       model id|null, status "priced"|"unpriced"|"no-model", reason,
 *               evidence [{label, value, url?}], usableAs
 *   baseRate    category summary at the nearest measured horizon, or null
 *   whatWouldMoveIt  [string]
 *   opportunities    allocator opportunities (see below)
 *   provenance  [{what, url, fetchedAt}]
 *   disclosure  fixed statement: public information, not advice
 *
 * ## The bids consumer contract: allocator opportunity
 *
 * The desk's lanes (kalshi-stake-path-service; lane table in
 * content/config/weather-desk-policy.json) consume `brief.opportunities[]`.
 * One entry is one contract the house would hold to settlement, on one side of
 * one market; the lane decides size, the allocator decides whether it fits the
 * envelope. Fields (all per contract, whole cents):
 *
 *   marketTicker       Kalshi market ticker
 *   eventTicker        its event
 *   lane               the measured rule that produced it (content/config/kalshi-house-lanes.json)
 *   side               "yes" | "no": the contract to BUY (selling YES == buying NO)
 *   priceCents         what a taker pays now for that side (the side's ask)
 *   restingPriceCents  where a maker would rest the same buy (one cent inside the book
 *                      when the spread has room, else joining the best bid); null if none
 *   payoffCents        net profit if the side wins: 100 - priceCents
 *   winProbability     the probability the side settles in our favour that the LANE is
 *                      allowed to claim (a conservative bound, not the point estimate)
 *   point              the house's point probability for that side, when a model gives one
 *   feeCents           expected taker fee per contract at priceCents
 *   edgeCents          winProbability * 100 - priceCents - feeCents (expected profit per contract)
 *   settlesOn          YYYY-MM-DD the event settles; the desk's perSettlementDate budget key
 *   settlesAt          ISO instant the market expects to expire
 *   correlation        {event, series, settlementDate}: opportunities sharing `event` are
 *                      mutually exclusive brackets of one outcome (one risk); sharing
 *                      `series`+`settlementDate` share a settlement source and move together.
 *                      These are exactly the desk's perEvent and perSettlementDate limits.
 *   briefId, asOf      so a fill can be scored back against the brief that proposed it
 *
 * An opportunity is emitted only when `edgeCents >= minEdgeCents` (the lanes
 * file) after the taker fee. A brief with no opportunity is still a research
 * brief; Koios consumes it all the same.
 *
 * ## House-model hooks
 *
 * `HOUSE_MODEL_HOOKS` is the typed extension point. A hook is
 * `{id, coversSeries(seriesTicker) -> boolean, applies({event, series}) -> boolean,
 * estimate(context, io) -> HouseView}`
 * where `HouseView` is
 * `{model, status, reason?, evidence[], moves[], usableAs, perMarket: Record<ticker,
 * {probability, ...detail}>}`. `estimate` may fetch (it is the effectful half); the
 * builder takes its result as plain data and stays pure. Temperature is the first
 * hook; add the next model by appending to the array.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { priceTemperatureBracket, eventDate, temperatureSeries, TEMPERATURE_MARKETS } from './temperature-market-model.mjs';
import { latestStationGuidance } from './nbm-station-guidance.mjs';
import { observedExtremes } from './station-observations.mjs';

export const BRIEF_TYPE = 'KalshiMarketBrief';
export const BRIEF_VERSION = 1;
export const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';
export const KALSHI_WEB = 'https://kalshi.com';

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
export const BASE_RATES = readJson('../content/config/kalshi-category-base-rates.json');
export const LANES = readJson('../content/config/kalshi-house-lanes.json');

export const DISCLOSURE = 'Built from public information (Kalshi market data, the contract rules, and public data sources). Odds are a snapshot, not a prediction of the future and not financial advice. Prediction-market contracts can lose their entire price.';

const num = (value) => (value === undefined || value === null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const cents = (dollars) => (num(dollars) === null ? null : Math.round(Number(dollars) * 100));
const round = (value, places = 4) => (value === null ? null : Math.round(value * 10 ** places) / 10 ** places);
const iso = (value) => new Date(value).toISOString();

/** Lowercase URL-safe words, as Kalshi writes the title segment of a market page. */
export const slugify = (text) => String(text ?? '').toLowerCase().replace(/['’]/gu, '').replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');

/**
 * The public Kalshi web URLs for an event. The event page is
 * `https://kalshi.com/markets/{series}/{series-title-slug}/{event}`, tickers
 * lowercase (the form Kalshi's own pages carry in search indexes, for example
 * /markets/kxhighny/highest-temperature-in-nyc/kxhighny-26sep21); the series page
 * `/markets/{series}` is the fallback that always resolves. kalshi.com answers
 * unattended clients with a bot challenge, so the form is checked against
 * published pages, not by fetching.
 */
export function kalshiUrls({ seriesTicker, seriesTitle, eventTicker }) {
  const series = String(seriesTicker).toLowerCase();
  const seriesUrl = `${KALSHI_WEB}/markets/${series}`;
  const slug = slugify(seriesTitle);
  return { url: slug ? `${seriesUrl}/${slug}/${String(eventTicker).toLowerCase()}` : seriesUrl, seriesUrl };
}

// ---------------------------------------------------------------- base rates

const nearestHorizon = (horizons, hoursToClose) => {
  const sorted = horizons.map(Number).sort((a, b) => a - b);
  return String(sorted.find((h) => h >= hoursToClose) ?? sorted.at(-1));
};

/** The family row a series ticker belongs to ("KXAAAGASDOH" -> "KXAAAGASD*"), or null. */
export function baseRateFamily(seriesTicker, rates = BASE_RATES) {
  return Object.keys(rates.families).find((name) => name.endsWith('*') && seriesTicker.startsWith(name.slice(0, -1))) ?? null;
}

/** Category base rates at the measured horizon at or above hoursToClose (else the longest), or null. */
export function categoryBaseRate(category, hoursToClose, rates = BASE_RATES) {
  const row = rates.categories[category];
  if (!row) return null;
  const horizon = nearestHorizon(Object.keys(row), Math.max(hoursToClose, 0));
  return { category, horizonHours: Number(horizon), ...row[horizon], source: 'content/config/kalshi-category-base-rates.json', window: rates.window };
}

/** Family (published-series) base rates at the nearest measured horizon, or null. */
export function familyBaseRate(seriesTicker, hoursToClose, rates = BASE_RATES) {
  const name = baseRateFamily(seriesTicker, rates);
  if (!name) return null;
  const horizon = nearestHorizon(Object.keys(rates.families[name]), Math.max(hoursToClose, 1));
  return { family: name, horizonHours: Number(horizon), ...rates.families[name][horizon], source: 'content/config/kalshi-category-base-rates.json', window: rates.window };
}

/** The base-rate band a quoted market falls in, or null: the sample rate of markets quoted like it. */
function marketBand(market, category, family) {
  if (market.yesAskCents === null || market.yesBidCents === null) return null;
  if (family && market.yesBidCents >= 94 && market.yesBidCents <= 98) return { band: 'favorite', scope: 'family', ...family.favorite, family: family.family, horizonHours: family.horizonHours };
  if (family && market.yesAskCents >= 2 && market.yesAskCents <= 6) return { band: 'longshot', scope: 'family', ...family.longshot, family: family.family, horizonHours: family.horizonHours };
  if (!category) return null;
  if (market.yesAskCents <= 5) return { band: 'longshot', scope: 'category', category: category.category, horizonHours: category.horizonHours, ...category.longshot };
  if (market.yesAskCents >= 95) return { band: 'favorite', scope: 'category', category: category.category, horizonHours: category.horizonHours, ...category.favorite };
  return null;
}

// ---------------------------------------------------------------- what would move it

const MOVES = {
  'Climate and Weather': ['A new National Blend of Models or National Weather Service forecast run, issued hourly.', 'For a same-day high, the maximum already observed at the station (the day\'s high cannot settle below it); for a low, the minimum so far.', 'A correction or late revision to the NWS Daily Climate Report that settles the market.'],
  Economics: ['The release of the named data series (the settlement source), or a revision to it.', 'For daily published series such as gas prices, the latest published value relative to the strike: these series move a fraction of a cent a day, so the odds only swing when the value sits near a strike.'],
  Financials: ['The index or asset level versus the strike as the close approaches.', 'Scheduled macro releases and central-bank remarks before the close; volatility moves the odds most when the level is near the strike.'],
  Crypto: ['The spot price on the named reference feed versus the strike, and realised volatility into the close.', 'Exchange or benchmark outages that change the reference value.'],
  Sports: ['Lineup and injury news, and the live game state once play starts.', 'Postponement or cancellation under the rules\' fair-price clause.'],
  Mentions: ['Whether the speaker\'s agenda and expected remarks make the phrase likely; the market resolves on the transcript, so exact wording and word form matter.', 'The length and format of the event: more airtime means more chances for the phrase.'],
  Politics: ['New polling, official announcements or filings, and statements by the named officials.', 'The publication schedule of the named poll or tracker.'],
  Elections: ['New polls, official results as they are reported, and certification timelines.'],
  Entertainment: ['The daily or weekly chart the market settles on, as the platform publishes it, and in-day movement on the ranked item.'],
  Commodities: ['The settlement price on the named exchange and the news that moves the underlying (inventories, supply decisions, weather).'],
  'Science and Technology': ['Official announcements from the named organisation and its published schedule.'],
};
const COMMON_MOVES = ['A rules clarification or settlement-source change published by Kalshi on the market page.', 'Order-book depth: thin books move on small orders, so a large price move on little volume says little.'];

/** The standing list of what moves the odds for a category, plus the model's own items. */
export function whatWouldMoveIt(category, extra = []) {
  return [...extra, ...(MOVES[category] ?? ['New public information about the named subject, ahead of the close.']), ...COMMON_MOVES];
}

// ---------------------------------------------------------------- house-model hooks

const localDate = (timeZone, at) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

/**
 * The daily-temperature hook: NBM station guidance through the fitted Student-t
 * (temperature-market-model.mjs). Its documented use is far-tail certification
 * only: out of sample it loses to the market near the money, so the brief reports
 * the model probability as evidence and never as the house's headline view for a
 * bracket near the money.
 */
export const temperatureHouseModel = {
  id: 'nbm-student-t-temperature',
  coversSeries: (seriesTicker) => Boolean(temperatureSeries(seriesTicker)),
  applies: ({ series }) => Boolean(temperatureSeries(series.ticker)),
  async estimate({ event, series, markets, now }, io = {}) {
    const row = temperatureSeries(series.ticker);
    const targetDate = eventDate(event.event_ticker);
    const base = { model: 'nbm-student-t-temperature', usableAs: 'far-tail certification only (see content/config/kalshi-house-lanes.json weather-tail-premium)', moves: [], perMarket: {} };
    if (!io.guidanceCacheDir) return { ...base, status: 'unpriced', reason: 'no guidance cache directory supplied', evidence: [] };
    let guidance;
    try {
      guidance = await latestStationGuidance({ stations: [...new Set(TEMPERATURE_MARKETS.series.map((entry) => entry.station))], now, cacheDir: io.guidanceCacheDir }, { fetchImpl: io.fetchImpl });
    } catch (error) {
      return { ...base, status: 'unpriced', reason: `NBM guidance unavailable: ${error.message}`, evidence: [] };
    }
    let observed = null;
    if (targetDate === localDate(row.timeZone, now)) {
      observed = await observedExtremes({ station: row.station, date: targetDate, timeZone: row.timeZone, now }, { fetchImpl: io.fetchImpl }).catch(() => null);
    }
    const perMarket = {};
    let sample = null;
    for (const market of markets) {
      const priced = priceTemperatureBracket(
        { seriesTicker: series.ticker, eventTicker: event.event_ticker, strikeType: market.strike_type, floorStrike: market.floor_strike, capStrike: market.cap_strike },
        { guidance, observed, now });
      if (!priced.priced) { perMarket[market.ticker] = { probability: null, reason: priced.reason }; continue; }
      sample ??= priced;
      perMarket[market.ticker] = { probability: round(priced.probability, 5), kind: priced.kind };
    }
    if (!sample) return { ...base, status: 'unpriced', reason: Object.values(perMarket)[0]?.reason ?? 'no bracket priced', evidence: [], perMarket };
    const evidence = [
      { label: 'Settlement station', value: `${row.station} (NWS Daily Climate Report ${row.climateReport})`, url: `https://forecast.weather.gov/product.php?site=NWS&product=CLI&issuedby=${row.climateReport.slice(3)}` },
      { label: `National Blend of Models ${sample.kind === 'high' ? 'daytime maximum' : 'overnight minimum'} guidance`, value: `${sample.txn} F with NBM spread ${sample.xnd} F, run ${sample.runtime}, ${sample.leadHours} hours ahead`, url: guidance.source },
      { label: 'House error model', value: `location ${sample.mean.toFixed(1)} F, scale ${sample.scale.toFixed(2)} F, Student-t with ${sample.nu} degrees of freedom, fitted on 2026-08-05..10-02 (content/config/temperature-markets.json)` },
      ...(observed && observed.count > 0 ? [{ label: 'Observed so far today', value: `${observed.count} station observations since the climate day began; maximum ${observed.maxF?.toFixed(1)} F, minimum ${observed.minF?.toFixed(1)} F (as of ${observed.latest})`, url: `${io.nwsApi ?? 'https://api.weather.gov'}/stations/${row.station}/observations` }] : []),
      { label: 'Measured skill', value: 'Out of sample the model alone lost to the Kalshi mid near the money (Brier 0.138-0.164 vs 0.119-0.130); it is used to certify far tails, where brackets asked at 5c or less with model p of 1% or less settled yes on 0 of 296 high markets (data/records/2026-10-03-kalshi-temperature-tail-backtest).' },
    ];
    const moves = [
      `The next NBM run (hourly; the current run is ${sample.runtime}).`,
      ...(observed && observed.count > 0 ? [`The ${sample.kind === 'high' ? 'highest' : 'lowest'} temperature ${row.station} has already recorded today (${sample.kind === 'high' ? observed.maxF?.toFixed(1) : observed.minF?.toFixed(1)} F so far): brackets on the wrong side of it are already settled.`] : []),
    ];
    return { ...base, status: 'priced', evidence, moves, perMarket, station: row.station, kind: sample.kind };
  },
};

export const HOUSE_MODEL_HOOKS = Object.freeze([temperatureHouseModel]);

/** The first hook that applies to this event, run against its markets; { status: "no-model" } when none does. */
export async function estimateHouseView(context, io = {}, hooks = HOUSE_MODEL_HOOKS) {
  const hook = hooks.find((candidate) => candidate.applies(context));
  if (!hook) return { model: null, status: 'no-model', reason: 'the house has no model for this market; the brief carries market-implied odds and the category base rate', evidence: [], moves: [], usableAs: null, perMarket: {} };
  return hook.estimate(context, io);
}

// ---------------------------------------------------------------- allocator opportunities

/** Kalshi's quadratic taker fee per contract in cents, on a 10-lot, scaled by the series multiplier. */
export function takerFeeCents(priceCents, multiplier = 1, lanes = LANES) {
  const p = priceCents / 100;
  return (Math.ceil(lanes.feeModel.rate * multiplier * 10 * p * (1 - p) * 100 - 1e-9) / 10);
}

const restingBuyCents = (bidCents, askCents) => (bidCents === null || askCents === null ? null : askCents - bidCents >= 2 ? bidCents + 1 : bidCents);

function opportunity(brief, market, { lane, side, winProbability, point = null, multiplier }) {
  const priceCents = side === 'yes' ? market.yesAskCents : market.noAskCents;
  if (priceCents === null || priceCents <= 0 || priceCents >= 100) return null;
  const feeCents = takerFeeCents(priceCents, multiplier);
  const edgeCents = round(winProbability * 100 - priceCents - feeCents, 2);
  if (edgeCents < LANES.minEdgeCents) return null;
  return {
    marketTicker: market.ticker, eventTicker: brief.event.eventTicker, lane, side, priceCents,
    restingPriceCents: side === 'yes' ? restingBuyCents(market.yesBidCents, market.yesAskCents) : restingBuyCents(market.noBidCents, market.noAskCents),
    payoffCents: 100 - priceCents, winProbability: round(winProbability, 4), point: point === null ? null : round(point, 4), feeCents, edgeCents,
    settlesOn: brief.event.settlesOn, settlesAt: brief.event.expectedSettleAt,
    correlation: { event: brief.event.eventTicker, series: brief.event.seriesTicker, settlementDate: brief.event.settlesOn },
    briefId: brief.briefId, asOf: brief.asOf,
  };
}

/**
 * The allocator opportunities a brief supports under the house lanes
 * (content/config/kalshi-house-lanes.json). Pure.
 * @param {object} brief a KalshiMarketBrief without (or with) opportunities
 * @param {{multiplier?: number, lanes?: object}} [options] multiplier is the series fee_multiplier
 * @returns {object[]} see the contract in this module's header
 */
export function allocatorOpportunities(brief, { multiplier = brief.event.feeMultiplier ?? 1, lanes = LANES } = {}) {
  const out = [];
  const tail = lanes.lanes['weather-tail-premium'];
  const favorite = lanes.lanes['published-series-favorite'];
  for (const market of brief.markets) {
    if (brief.house.status === 'priced' && market.house?.probability !== null && market.house?.probability !== undefined && market.house.kind) {
      const p = market.house.probability, kind = market.house.kind;
      const ask = market.yesAskCents === null ? null : market.yesAskCents / 100;
      if (ask !== null && p <= tail.maxModelProbability[kind] && ask >= tail.yesAskBand[0] && ask <= tail.yesAskBand[1]) {
        const found = opportunity(brief, market, { lane: 'weather-tail-premium', side: 'no', winProbability: 1 - tail.lossRateFloor[kind], point: 1 - p, multiplier });
        if (found) out.push(found);
      }
    }
    const band = market.baseRate;
    if (band && band.scope === 'family' && band.band === 'favorite' && brief.event.hoursToClose <= favorite.maxHoursToClose
      && market.yesBidCents / 100 >= favorite.yesBidBand[0] && market.yesBidCents / 100 <= favorite.yesBidBand[1] && band.yesRate95?.[0] != null) {
      const found = opportunity(brief, market, { lane: 'published-series-favorite', side: 'yes', winProbability: band.yesRate95[0], point: band.yesRate, multiplier });
      if (found) out.push(found);
    }
  }
  return out.sort((a, b) => b.edgeCents - a.edgeCents);
}

// ---------------------------------------------------------------- the builder

const bookLine = (market) => ({
  ticker: market.ticker,
  label: market.yes_sub_title || market.subtitle || market.title,
  title: market.title ?? '',
  strike: { type: market.strike_type ?? null, floor: num(market.floor_strike), cap: num(market.cap_strike) },
  yesBidCents: cents(market.yes_bid_dollars), yesAskCents: cents(market.yes_ask_dollars),
  noBidCents: cents(market.no_bid_dollars), noAskCents: cents(market.no_ask_dollars),
  lastCents: cents(market.last_price_dollars),
  bidSize: num(market.yes_bid_size_fp), askSize: num(market.yes_ask_size_fp),
  volume: num(market.volume_fp) ?? 0, volume24h: num(market.volume_24h_fp) ?? 0, openInterest: num(market.open_interest_fp) ?? 0,
});

/** The market-implied YES probability: the mid of a two-sided book, else the last trade, else null. */
export function impliedYes(line) {
  if (line.yesBidCents !== null && line.yesAskCents !== null && line.yesAskCents > 0) return (line.yesBidCents + line.yesAskCents) / 200;
  return line.lastCents !== null ? line.lastCents / 100 : null;
}

/**
 * Build one brief from Kalshi's own records and the house view. Pure: the caller
 * fetched `event`, `series` and `markets` (Kalshi API shapes) and ran
 * `estimateHouseView`.
 * @param {{event: object, series: object, markets: object[], now: number|string|Date, house?: object|null, rates?: object}} input
 * @returns {object} KalshiMarketBrief
 */
export function buildKalshiMarketBrief({ event, series, markets, now, house = null, rates = BASE_RATES }) {
  const asOf = iso(now);
  const live = markets.filter((market) => market.status === 'active' || market.status === 'open');
  if (live.length === 0) throw new TypeError(`kalshi-market-brief: ${event.event_ticker} has no open market`);
  const closes = live.map((market) => Date.parse(market.close_time)).filter(Number.isFinite);
  const expects = live.map((market) => Date.parse(market.expected_expiration_time ?? market.close_time)).filter(Number.isFinite);
  const closesAt = iso(Math.min(...closes));
  const settleCandidates = expects.filter((at) => at >= Date.parse(asOf));
  const expectedSettleAt = iso(settleCandidates.length ? Math.min(...settleCandidates) : Math.min(...closes));
  // Hours to the earlier of close and expected settlement: a game or a weekly series closes long after it settles.
  const hoursToClose = round((Math.min(Date.parse(closesAt), Date.parse(expectedSettleAt)) - Date.parse(asOf)) / 3600_000, 2);
  const category = event.category ?? series?.category ?? 'Unknown';
  const lines = live.map(bookLine);
  const mids = lines.map(impliedYes);
  const midSum = mids.reduce((sum, p) => sum + (p ?? 0), 0);
  const exclusive = Boolean(event.mutually_exclusive);
  const categoryRate = categoryBaseRate(category, hoursToClose, rates);
  const familyRate = familyBaseRate(event.series_ticker ?? series.ticker, hoursToClose, rates);
  const houseView = house ?? { model: null, status: 'no-model', reason: 'no house model was run', evidence: [], moves: [], usableAs: null, perMarket: {} };

  const markets_ = lines.map((line, index) => {
    const mid = mids[index];
    const priced = houseView.perMarket?.[line.ticker];
    return {
      ...line,
      impliedYes: mid === null ? null : round(mid, 4),
      impliedYesNormalized: mid === null || !exclusive || midSum <= 0 ? null : round(mid / midSum, 4),
      house: priced ? { probability: priced.probability, kind: priced.kind ?? null, ...(priced.reason ? { reason: priced.reason } : {}), model: houseView.model } : null,
      baseRate: marketBand(line, categoryRate, familyRate),
    };
  }).sort((a, b) => b.volume24h - a.volume24h || (b.impliedYes ?? 0) - (a.impliedYes ?? 0));

  const urls = kalshiUrls({ seriesTicker: event.series_ticker ?? series.ticker, seriesTitle: series?.title ?? event.title, eventTicker: event.event_ticker });
  const sources = (event.settlement_sources?.length ? event.settlement_sources : series?.settlement_sources ?? []).map(({ name, url }) => ({ name, url }));
  const primarySource = sources.find((source) => source.url && !/^https?:\/\/(www\.)?kalshi\.com\/?$/u.test(source.url)) ?? null;
  // Each bracket's rule names its own strike; the brief carries the lead (most traded) market's rule as the example.
  const first = live.find((market) => market.ticker === markets_[0].ticker) ?? live[0];
  const rulesVary = new Set(live.map((market) => market.rules_primary)).size > 1;
  const settlesOn = temperatureSeries(event.series_ticker ?? series.ticker) ? eventDate(event.event_ticker) : expectedSettleAt.slice(0, 10);

  const brief = {
    type: BRIEF_TYPE, version: BRIEF_VERSION,
    briefId: `${event.event_ticker}@${asOf.replace(/[-:.]/gu, '').slice(0, 15)}Z`,
    asOf,
    event: {
      eventTicker: event.event_ticker, seriesTicker: event.series_ticker ?? series.ticker, title: event.title, subTitle: event.sub_title ?? '',
      category, frequency: series?.frequency ?? null, mutuallyExclusive: exclusive, tags: series?.tags ?? [],
      closesAt, expectedSettleAt, settlesOn, hoursToClose,
      feeMultiplier: num(series?.fee_multiplier) ?? 1,
      url: urls.url, seriesUrl: urls.seriesUrl,
    },
    rules: { primary: first.rules_primary ?? '', secondary: first.rules_secondary ?? '', contractTermsUrl: series?.contract_terms_url ?? null, leadMarket: first.ticker, perMarket: rulesVary },
    settlementSource: { primary: primarySource, all: sources },
    markets: markets_,
    book: { markets: markets_.length, volume24h: round(lines.reduce((s, l) => s + l.volume24h, 0), 2), openInterest: round(lines.reduce((s, l) => s + l.openInterest, 0), 2), midSum: round(midSum, 4) },
    house: { model: houseView.model, status: houseView.status, ...(houseView.reason ? { reason: houseView.reason } : {}), evidence: houseView.evidence ?? [], usableAs: houseView.usableAs ?? null },
    baseRate: categoryRate ? { category: categoryRate, family: familyRate } : null,
    whatWouldMoveIt: whatWouldMoveIt(category, houseView.moves ?? []),
    opportunities: [],
    provenance: [
      { what: 'Kalshi market data (event, markets, series)', url: `${KALSHI_API}/events/${event.event_ticker}`, fetchedAt: asOf },
      ...(houseView.status === 'priced' ? [{ what: 'House model evidence', url: houseView.evidence.find((row) => row.url)?.url ?? null, fetchedAt: asOf }] : []),
      { what: 'Category base rates', url: null, fetchedAt: rates.derivedAt },
    ],
    disclosure: DISCLOSURE,
  };
  brief.opportunities = allocatorOpportunities(brief);
  return brief;
}

// ---------------------------------------------------------------- validation

const isString = (v) => typeof v === 'string' && v.length > 0;
const isNumOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));

/**
 * Check a brief against the shape in content/schemas/kalshi-market-brief.schema.json
 * (the required structure; the schema file is the contract for other languages).
 * @returns {string[]} problems; empty when the brief is well formed
 */
export function validateKalshiMarketBrief(brief) {
  const problems = [];
  const need = (ok, message) => { if (!ok) problems.push(message); };
  need(brief?.type === BRIEF_TYPE && brief?.version === BRIEF_VERSION, 'type/version');
  need(isString(brief?.briefId) && Number.isFinite(Date.parse(brief?.asOf)), 'briefId/asOf');
  const event = brief?.event ?? {};
  for (const key of ['eventTicker', 'seriesTicker', 'title', 'category', 'url', 'seriesUrl', 'closesAt', 'expectedSettleAt', 'settlesOn']) need(isString(event[key]), `event.${key}`);
  need(typeof event.hoursToClose === 'number', 'event.hoursToClose');
  need(typeof brief?.rules?.primary === 'string', 'rules.primary');
  need(Array.isArray(brief?.settlementSource?.all), 'settlementSource.all');
  need(Array.isArray(brief?.markets) && brief.markets.length > 0, 'markets');
  for (const market of brief?.markets ?? []) {
    need(isString(market.ticker) && isString(market.label), `market ${market.ticker} ticker/label`);
    for (const key of ['yesBidCents', 'yesAskCents', 'noBidCents', 'noAskCents', 'lastCents', 'impliedYes']) need(isNumOrNull(market[key]), `market ${market.ticker}.${key}`);
    need(typeof market.volume24h === 'number', `market ${market.ticker}.volume24h`);
  }
  need(['priced', 'unpriced', 'no-model'].includes(brief?.house?.status), 'house.status');
  need(Array.isArray(brief?.whatWouldMoveIt) && brief.whatWouldMoveIt.length > 0, 'whatWouldMoveIt');
  for (const o of brief?.opportunities ?? []) {
    for (const key of ['priceCents', 'payoffCents', 'winProbability', 'edgeCents']) need(typeof o[key] === 'number', `opportunity ${o.marketTicker}.${key}`);
    need(isString(o.settlesOn) && isString(o.correlation?.event), `opportunity ${o.marketTicker} settlesOn/correlation`);
    need(o.side === 'yes' || o.side === 'no', `opportunity ${o.marketTicker}.side`);
  }
  need(isString(brief?.disclosure), 'disclosure');
  return problems;
}

/** The records directory for a day's briefs under a package root. */
export const briefsDirectory = (packageRoot, date) => join(packageRoot, 'data', 'records', 'kalshi-market-briefs', date);
