/**
 * The NWS Daily Climate Report (CLI product), the document Kalshi's temperature markets settle on (The Weather
 * Company reports it). Pure parsing, plus a reader for the latest report of one climate site.
 *
 * A site issues a report in the afternoon ("VALID TODAY AS OF 0500 PM LOCAL TIME": the day so far) and a final one
 * after the climate day ends ("...SUMMARY FOR <DATE>..." with no "AS OF"). Both carry the official whole-degree
 * MAXIMUM and MINIMUM. The day's final maximum cannot fall below the afternoon's, nor its minimum rise above it,
 * so an afternoon report decides every bracket on the far side exactly, with no observation rounding.
 */
import { NWS_API, NWS_USER_AGENT } from './station-observations.mjs';

const MONTHS = { JANUARY: '01', FEBRUARY: '02', MARCH: '03', APRIL: '04', MAY: '05', JUNE: '06', JULY: '07', AUGUST: '08', SEPTEMBER: '09', OCTOBER: '10', NOVEMBER: '11', DECEMBER: '12' };

/**
 * @param {string} text the product text
 * @param {string} issued the product's issuance time (ISO)
 * @returns {{date: string, final: boolean, max: number|null, min: number|null, issued: string} | null}
 */
export function parseClimateReport(text, issued) {
  const head = /SUMMARY FOR ([A-Z]+) (\d{1,2}) (\d{4})/u.exec(text);
  if (!head || !MONTHS[head[1]]) return null;
  const date = `${head[3]}-${MONTHS[head[1]]}-${head[2].padStart(2, '0')}`;
  const final = !/VALID TODAY AS OF/u.test(text);
  const temperature = text.split(/TEMPERATURE \(F\)/u)[1]?.split(/PRECIPITATION/u)[0] ?? '';
  const value = (label) => { const m = new RegExp(`^\\s*${label}\\s+(-?\\d+|MM)`, 'mu').exec(temperature); return m && m[1] !== 'MM' ? Number(m[1]) : null; };
  return { date, final, max: value('MAXIMUM'), min: value('MINIMUM'), issued };
}

/** The latest climate report for `site` (the CLI code without "CLI", e.g. OKC) covering `date`, or null. */
export async function latestClimateReport({ site, date }, { fetchImpl = fetch, baseUrl = NWS_API, userAgent = NWS_USER_AGENT } = {}) {
  const get = async (url) => { const res = await fetchImpl(url, { headers: { 'user-agent': userAgent, accept: 'application/ld+json' }, signal: AbortSignal.timeout(10000) }); if (!res.ok) throw new Error(`${url}: ${res.status}`); return res.json(); };
  const listing = await get(`${baseUrl}/products/types/CLI/locations/${site}`);
  for (const item of (listing['@graph'] ?? []).slice(0, 3)) {
    const report = parseClimateReport((await get(`${baseUrl}/products/${item.id}`)).productText, item.issuanceTime);
    if (report?.date === date) return report;
  }
  return null;
}
