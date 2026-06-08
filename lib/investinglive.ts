// lib/investinglive.ts
// Scrapes Giuseppe Dellamotta's recurring rate-expectations article on investinglive.com
// URL pattern: /news/how-have-interest-rate-expectations-changed-after-this-weeks-event-YYYYMMDD/
// Published after major market events (typically on Fridays or post-CB-decision)
//
// Data format in articleBody JSON-LD:
//   "CB: XX bps (YY% probability of rate hike/no change at the next meeting)"
// Covers all 8 CBs including SNB — the only free public source with CHF OIS-equivalent data.

import type { Currency } from "./types";

// ── CB name → Currency ────────────────────────────────────────────────────────

const CB_TO_CCY: Record<string, Currency> = {
  "fed":  "USD",
  "fomc": "USD",
  "ecb":  "EUR",
  "boe":  "GBP",
  "boj":  "JPY",
  "boc":  "CAD",
  "rba":  "AUD",
  "rbnz": "NZD",
  "snb":  "CHF",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ILRateExpectation {
  currency:              Currency;
  nextMeetingProbPct:    number;   // probability of change at next meeting (0–100)
  nextMeetingIsHike:     boolean;  // true = hike, false = cut (no-change → isHike stays false)
  nextMeetingIsNoChange: boolean;
  bpsYearEnd:            number;   // cumulative bps priced in by year-end
  publishedDate:         string;   // YYYY-MM-DD
}

export type ILExpectationsMap = Partial<Record<Currency, ILRateExpectation>>;

export interface ILExpectationsWithHistory {
  current:  ILExpectationsMap;
  prev:     ILExpectationsMap;
  prevDate: string | null;
}

// ── URL discovery ─────────────────────────────────────────────────────────────

interface ArticleRef { url: string; dateStr: string; daysAgo: number; }

async function tryUrl(daysAgo: number): Promise<ArticleRef | null> {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const yyyymmdd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const dateStr  = `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`;
  const url = `https://investinglive.com/news/how-have-interest-rate-expectations-changed-after-this-weeks-event-${yyyymmdd}/`;
  try {
    const res = await fetch(url, {
      method:  "HEAD",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36" },
      next:    { revalidate: 21600 },
    });
    return res.ok ? { url, dateStr, daysAgo } : null;
  } catch { return null; }
}

// Find current article (last 14 days) + previous article (14 days before current, up to 21 days)
async function findArticleRefs(): Promise<{ current: ArticleRef | null; previous: ArticleRef | null }> {
  let current: ArticleRef | null = null;

  for (let d = 0; d <= 14; d++) {
    const found = await tryUrl(d);
    if (found) { current = found; break; }
  }

  if (!current) return { current: null, previous: null };

  let previous: ArticleRef | null = null;
  // Start the day after the current article and look up to 21 days further back
  for (let d = current.daysAgo + 1; d <= current.daysAgo + 21; d++) {
    const found = await tryUrl(d);
    if (found) { previous = found; break; }
  }

  return { current, previous };
}

// ── Article fetch + parse ─────────────────────────────────────────────────────

async function fetchAndParse(ref: ArticleRef): Promise<ILExpectationsMap> {
  try {
    const res = await fetch(ref.url, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      next: { revalidate: 21600 },
    });
    if (!res.ok) return {};

    const html = await res.text();
    const jsonLdMatch = html.match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!jsonLdMatch) {
      console.warn("[IL] articleBody not found:", ref.url);
      return {};
    }

    const body = jsonLdMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\u003c/g, "<")
      .replace(/\\u003e/g, ">");

    const result = parseArticleBody(body, ref.dateStr);
    console.log(`[IL] Parsed ${Object.keys(result).length} CBs from article dated ${ref.dateStr}`);
    return result;
  } catch (err) {
    console.error("[IL] fetch error:", err);
    return {};
  }
}

// ── Article parser ─────────────────────────────────────────────────────────────

function parseArticleBody(text: string, publishedDate: string): ILExpectationsMap {
  const result: ILExpectationsMap = {};

  // Matches: "RBNZ: 75 bps (79% probability of rate hike at the next meeting)"
  //          "Fed: 13 bps (99% probability of no change at the next meeting)"
  //          "ECB: 53 bps (99% probability of rate cut at the next meeting)"
  const linePattern = /([A-Za-z]+)\s*:\s*(-?\d+)\s*bps\s*\(\s*(\d+)%\s*probability\s+of\s+(rate\s+(?:hike|cut)|no\s+change)\s+at\s+the\s+next\s+meeting\)/gi;

  let m: RegExpExecArray | null;
  while ((m = linePattern.exec(text)) !== null) {
    const [, cbRaw, bpsStr, probStr, directionRaw] = m;
    const ccy = CB_TO_CCY[cbRaw.toLowerCase()];
    if (!ccy) continue;

    const probPct               = parseInt(probStr);
    const direction             = directionRaw.toLowerCase();
    const nextMeetingIsNoChange = direction === "no change";
    const nextMeetingIsHike     = !nextMeetingIsNoChange && direction.includes("hike");
    const nextMeetingIsCut      = !nextMeetingIsNoChange && direction.includes("cut");

    let bpsYearEnd = parseInt(bpsStr);
    if (nextMeetingIsCut && bpsYearEnd > 0) bpsYearEnd = -bpsYearEnd;

    const nextMeetingProbPct = nextMeetingIsNoChange ? 100 - probPct : probPct;

    result[ccy] = {
      currency: ccy,
      nextMeetingProbPct,
      nextMeetingIsHike,
      nextMeetingIsNoChange,
      bpsYearEnd,
      publishedDate,
    };
  }

  return result;
}

// ── Exports ───────────────────────────────────────────────────────────────────

/** Retourne uniquement l'article le plus récent (compatibilité descendante). */
export async function fetchILExpectations(): Promise<ILExpectationsMap> {
  const { current } = await findArticleRefs();
  if (!current) {
    console.warn("[IL] No recent rate-expectations article found (last 14 days)");
    return {};
  }
  return fetchAndParse(current);
}

/** Retourne l'article courant ET l'article précédent pour calcul de delta semaine/semaine. */
export async function fetchILExpectationsWithHistory(): Promise<ILExpectationsWithHistory> {
  const { current, previous } = await findArticleRefs();

  if (!current) {
    console.warn("[IL] No recent rate-expectations article found (last 14 days)");
    return { current: {}, prev: {}, prevDate: null };
  }

  const [currentData, prevData] = await Promise.all([
    fetchAndParse(current),
    previous ? fetchAndParse(previous) : Promise.resolve({} as ILExpectationsMap),
  ]);

  return { current: currentData, prev: prevData, prevDate: previous?.dateStr ?? null };
}
