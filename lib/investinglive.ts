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

// ── URL discovery ─────────────────────────────────────────────────────────────
// Try the last 14 days to find the most recently published article.

async function findLatestArticleUrl(): Promise<{ url: string; dateStr: string } | null> {
  for (let daysAgo = 0; daysAgo <= 14; daysAgo++) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    const yyyymmdd = d.toISOString().slice(0, 10).replace(/-/g, "");
    const url = `https://investinglive.com/news/how-have-interest-rate-expectations-changed-after-this-weeks-event-${yyyymmdd}/`;
    try {
      const res = await fetch(url, {
        method:  "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36" },
        next:    { revalidate: 21600 }, // re-check every 6h
      });
      if (res.ok) return { url, dateStr: `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}` };
    } catch { /* try next day */ }
  }
  return null;
}

// ── Article parser ─────────────────────────────────────────────────────────────
// The structured data JSON-LD "articleBody" contains the raw text we need.

function parseArticleBody(text: string, publishedDate: string): ILExpectationsMap {
  const result: ILExpectationsMap = {};

  // Matches: "RBNZ: 75 bps (79% probability of rate hike at the next meeting)"
  //          "Fed: 13 bps (99% probability of no change at the next meeting)"
  //          "ECB: 53 bps (99% probability of rate cut at the next meeting)"
  // Note: bps value in the article is always unsigned — sign is inferred from direction.
  //   rate hike  → positive bps (rate going up)
  //   rate cut   → negative bps (rate going down)
  //   no change  → keep unsigned (residual expectation for later meetings)
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

    // Apply sign: if direction is cut and value is positive, negate it
    let bpsYearEnd = parseInt(bpsStr);
    if (nextMeetingIsCut && bpsYearEnd > 0) bpsYearEnd = -bpsYearEnd;

    // Probability of change = 100 - probNoChange  OR  directProb if it's a hike/cut
    const nextMeetingProbPct = nextMeetingIsNoChange ? 100 - probPct : probPct;

    result[ccy] = {
      currency:              ccy,
      nextMeetingProbPct,
      nextMeetingIsHike,
      nextMeetingIsNoChange,
      bpsYearEnd,
      publishedDate,
    };
  }

  return result;
}

// ── Main fetch ────────────────────────────────────────────────────────────────

export async function fetchILExpectations(): Promise<ILExpectationsMap> {
  try {
    const found = await findLatestArticleUrl();
    if (!found) {
      console.warn("[IL] No recent rate-expectations article found (last 14 days)");
      return {};
    }

    const res = await fetch(found.url, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      next: { revalidate: 21600 }, // cache 6h — new article only published after major events
    });
    if (!res.ok) {
      console.warn("[IL] Fetch failed:", res.status);
      return {};
    }

    const html = await res.text();

    // Extract articleBody from JSON-LD structured data
    const jsonLdMatch = html.match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!jsonLdMatch) {
      console.warn("[IL] articleBody not found in JSON-LD");
      return {};
    }

    const articleBody = jsonLdMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\u003c/g, "<")
      .replace(/\\u003e/g, ">");

    const parsed = parseArticleBody(articleBody, found.dateStr);
    const count = Object.keys(parsed).length;
    console.log(`[IL] Parsed ${count} CBs from article dated ${found.dateStr}`);
    return parsed;
  } catch (err) {
    console.error("[IL] error:", err);
    return {};
  }
}
