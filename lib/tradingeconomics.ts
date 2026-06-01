// lib/tradingeconomics.ts
// Trading Economics Economic Calendar
//
// Strategy:
//   1. Primary  : TE paid API (TRADING_ECONOMICS_API_KEY in .env.local)
//   2. Fallback : HTML scraping of https://tradingeconomics.com/calendar
//      → The HTML includes previous/consensus/forecast in static DOM.
//        Actual values are pushed via Socket.IO when released (real-time only),
//        so upcoming events get full forecast data; recently published events
//        may show null actual (supplemented by ForexFactory/FRED for key releases).
//
// Socket.IO details (for reference):
//   URL    : https://live.tradingeconomics.com?key=sun
//   Auth   : JWT token embedded in page (epoch+IP bound, refreshes each fetch)
//   Crypto : NaCl secretbox (XSalsa20-Poly1305) + pako inflate
//   → Not used here: Socket.IO is for real-time actuals, not the snapshot we need.

import type { Currency } from "./types";
import type { EventCategory } from "@/app/api/calendar/route";

// ── Country → Currency ────────────────────────────────────────────────────────

const TE_COUNTRY_TO_CCY: Record<string, Currency> = {
  "united states":  "USD",
  "euro area":      "EUR",
  "united kingdom": "GBP",
  "japan":          "JPY",
  "switzerland":    "CHF",
  "canada":         "CAD",
  "australia":      "AUD",
  "new zealand":    "NZD",
};

// ── Category ──────────────────────────────────────────────────────────────────

// eventName = data-event attribute (titre brut TE), utilisé pour détecter les discours
// indépendamment du data-category (qui vaut souvent "interest rate" pour les speeches CB)
function teCategory(cat: string, eventName?: string): EventCategory {
  const e = (eventName ?? "").toLowerCase();
  if (/\bspeech\b|speaks?\b|testimony|\bpress\s+conf/.test(e)) return "cb_speech";
  const c = cat.toLowerCase();
  if (/\bpmi\b|purchasing\s+managers/.test(c))                                  return "pmi";
  if (/interest\s+rate|monetary\s+policy|rate\s+decision|bank\s+rate/.test(c)) return "policy_rate";
  if (/speech|speaks?|testimony|press\s+conf|central\s+bank/.test(c))          return "cb_speech";
  if (/inflation|cpi|hicp|consumer\s+price|ppi/.test(c))                       return "inflation";
  if (/\bgdp\b|gross\s+domestic|growth\s+rate/.test(c))                        return "gdp";
  if (/retail\s+sales|core\s+retail/.test(c))                                  return "retail_sales";
  if (/trade\s+balance|current\s+account|balance\s+of\s+trade/.test(c))       return "trade_balance";
  if (/employment|payrolls|nonfarm|jobless|unemployment|job\s+creation/.test(c)) return "employment";
  return "other";
}

// ── Importance (1/2/3) → impact ───────────────────────────────────────────────

function teImpact(n: number): "high" | "medium" | "low" {
  if (n >= 3) return "high";
  if (n >= 2) return "medium";
  return "low";
}

// ── 12h → ISO time ────────────────────────────────────────────────────────────
// TE times are in UTC (default when no timezone cookie is set on the server)

function to24h(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return "12:00";
  let h = parseInt(m[1]);
  const pm = m[3].toUpperCase() === "PM";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// ── Decode HTML entities ───────────────────────────────────────────────────────

function decodeHTMLEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// ── Text from HTML element ─────────────────────────────────────────────────────

function extractText(html: string, id: string): string | null {
  // Matches <span id='X'>VALUE</span> or <a id='X' ...>VALUE</a>
  const m = html.match(new RegExp(`<(?:span|a)[^>]+id=['"]${id}['"][^>]*>([^<]*)<`, "i"));
  const val = m?.[1]?.trim();
  return val && val.length > 0 ? decodeHTMLEntities(val) : null;
}

// ── Public type ───────────────────────────────────────────────────────────────

export interface TECalendarEvent {
  id:          string;
  date:        string;        // ISO with UTC time
  currency:    Currency;
  category:    EventCategory;
  title:       string;
  impact:      "high" | "medium" | "low";
  actual:      string | null;
  forecast:    string | null; // consensus preferred over TE forecast
  previous:    string | null;
  isPublished: boolean;
  teId:        string;
}

// ── HTML scraper ──────────────────────────────────────────────────────────────
// La page /calendar couvre le G20 (USD/EUR/GBP/JPY/CAD/AUD/NZD) mais PAS la Suisse (CHF).
// On fetche aussi /switzerland/calendar pour avoir les events CHF.

async function fetchOneTEPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return "";
    return res.text();
  } catch { return ""; }
}

// fromDate / toDate au format YYYY-MM-DD
export async function fetchTECalendarHTML(fromDate?: string, toDate?: string): Promise<TECalendarEvent[]> {
  const qs = fromDate && toDate ? `?startDate=${fromDate}&endDate=${toDate}` : "";
  const pages = await Promise.all([
    fetchOneTEPage(`https://tradingeconomics.com/calendar${qs}`),
    fetchOneTEPage(`https://tradingeconomics.com/switzerland/calendar${qs}`), // CHF — hors G20
  ]);

  const allEvents: TECalendarEvent[] = [];
  const seen = new Set<string>();

  for (const html of pages) {
    if (!html) continue;
    for (const ev of parseCalendarHTML(html)) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      allEvents.push(ev);
    }
  }

  allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return allEvents;
}

function parseCalendarHTML(html: string): TECalendarEvent[] {
  const events: TECalendarEvent[] = [];
  const now = new Date();

  // Split on each event row — each <tr data-url= ... data-id= ... data-country= ...>
  const rowPattern = /<tr\s+data-url="[^"]*"\s+data-id="(\d+)"\s+data-country="([^"]+)"\s+data-category="([^"]+)"\s+data-event="([^"]+)"[^>]*>([\s\S]*?)(?=<tr\s+data-url=|<\/tbody>)/g;

  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(html)) !== null) {
    const [, id, country, category, eventAttr, body] = match;

    const ccy = TE_COUNTRY_TO_CCY[country.toLowerCase()];
    if (!ccy) continue; // only our 8 currencies

    // Date: <td ... class=' 2026-06-01'>
    const dateMatch = body.match(/class=' (\d{4}-\d{2}-\d{2})'/);
    if (!dateMatch) continue;
    const dateStr = dateMatch[1];

    // Time + importance: <span class="event-52 calendar-date-3">  02:00 PM  </span>
    const timeMatch = body.match(/calendar-date-(\d)[^"]*"[^>]*>\s*([\d:]+\s*[AP]M)\s*/i);
    const importance   = timeMatch ? parseInt(timeMatch[1]) : 1;
    const timeStr      = timeMatch ? timeMatch[2].trim() : "00:00 AM";
    const time24       = to24h(timeStr);
    const isoDate      = `${dateStr}T${time24}:00Z`;
    const evDate       = new Date(isoDate);

    // Display title: <a class='calendar-event' ...>ISM Manufacturing PMI</a>
    const titleMatch = body.match(/<a\s+class='calendar-event'[^>]*>([^<]+)<\/a>/);
    const title = titleMatch ? decodeHTMLEntities(titleMatch[1]) : decodeHTMLEntities(eventAttr);

    // Reference period: <span class="calendar-reference">MAY</span>
    const refMatch = body.match(/class="calendar-reference"\s*>([^<]*)</);
    const ref = refMatch ? refMatch[1].trim() : "";

    // Values — all live in id='' span/anchor elements
    const actual    = extractText(body, "actual");
    const previous  = extractText(body, "previous");
    const consensus = extractText(body, "consensus");
    const forecast  = extractText(body, "forecast");

    const displayTitle = ref ? `${title} ${ref}` : title;

    events.push({
      id:          `te_${id}`,
      date:        isoDate,
      currency:    ccy,
      category:    teCategory(category, eventAttr),
      title:       displayTitle,
      impact:      teImpact(importance),
      actual,
      forecast:    consensus ?? forecast, // TE consensus > TE proprietary forecast
      previous,
      isPublished: actual !== null || evDate < now,
      teId:        id,
    });
  }

  // Sort by date ascending
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return events;
}

// ── Paid API (when TRADING_ECONOMICS_API_KEY is set) ─────────────────────────

export async function fetchTECalendar(
  apiKey: string,
  fromDate: string,
  toDate: string,
): Promise<TECalendarEvent[]> {
  const countries = [
    "united states", "euro area", "united kingdom", "japan",
    "switzerland", "canada", "australia", "new zealand",
  ].join(",");

  const url = [
    `https://api.tradingeconomics.com/calendar/country/${encodeURIComponent(countries)}`,
    `/${fromDate}/${toDate}`,
    `?c=${encodeURIComponent(apiKey)}&f=json`,
  ].join("");

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return [];
    const raw = await res.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) return [];

    const now = new Date();
    return raw
      .map(ev => {
        const ccy = TE_COUNTRY_TO_CCY[(ev["Country"] as string)?.toLowerCase()];
        if (!ccy) return null;
        const dateRaw  = ev["Date"] as string ?? "";
        const isoDate  = dateRaw.endsWith("Z") ? dateRaw : dateRaw + "Z";
        const evDate   = new Date(isoDate);
        const actual   = (ev["Actual"]   as string | null) || null;
        const forecast = (ev["Forecast"] as string | null) || (ev["TEForecast"] as string | null) || null;
        const previous = (ev["Previous"] as string | null) || null;
        return {
          id:          `te_${ev["CalendarId"]}`,
          date:        isoDate,
          currency:    ccy,
          category:    teCategory(ev["Category"] as string ?? ""),
          title:       (ev["Event"] as string ?? ""),
          impact:      teImpact(ev["Importance"] as number ?? 1),
          actual:      actual   !== "" ? actual   : null,
          forecast:    forecast !== "" ? forecast : null,
          previous:    previous !== "" ? previous : null,
          isPublished: actual !== null || evDate < now,
          teId:        String(ev["CalendarId"] ?? ""),
        } satisfies TECalendarEvent;
      })
      .filter((e): e is TECalendarEvent => e !== null);
  } catch {
    return [];
  }
}
