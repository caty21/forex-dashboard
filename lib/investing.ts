// lib/investing.ts
// Scrape investing.com economic calendar.
// Uses the AJAX endpoint: POST /economic-calendar/Service/getCalendarFilteredData
//
// Inflation mapping:
//   "CPI (YoY)"      = Inflation Rate YoY → cpiYoY
//   "Core CPI (YoY)" = Core Inflation Rate YoY → cpiCore
//   "CPI (MoM)"      = Inflation Rate MoM → cpiMoM
//   "Core CPI (MoM)" = Core Inflation Rate MoM → cpiCoreMoM
//   "PPI (MoM)"      = PPI MoM → ppiMoM

import type { Currency } from "./types";
import type { TECalendarEvent } from "./tradingeconomics";
import type { EventCategory } from "@/app/api/calendar/route";

// Category detection from event name
function invCategory(name: string): EventCategory {
  const n = name.toLowerCase();
  if (/\bpmi\b|purchasing\s+managers/i.test(n))                   return "pmi";
  if (/inflation|cpi|hicp|consumer\s+price|ppi/i.test(n))         return "inflation";
  if (/\bgdp\b|gross\s+domestic|growth\s+rate/i.test(n))          return "gdp";
  if (/retail\s+sales|core\s+retail/i.test(n))                    return "retail_sales";
  if (/employment|payrolls|nonfarm|jobless|unemployment/i.test(n)) return "employment";
  if (/trade\s+balance|current\s+account/i.test(n))               return "trade_balance";
  if (/interest\s+rate|rate\s+decision|bank\s+rate/i.test(n))     return "policy_rate";
  if (/speech|speaks?|testimony|press\s+conf/i.test(n))           return "cb_speech";
  return "other";
}

function cleanVal(s: string): string | null {
  const v = s.replace(/&nbsp;/g, "").trim();
  return v.length > 0 ? v : null;
}

function to24h(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "00:00";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

const INV_COUNTRY_IDS: Record<Currency, number> = {
  USD: 5, EUR: 22, GBP: 4, JPY: 25, CHF: 35, CAD: 32, AUD: 6, NZD: 36,
};

const INV_CCY_TO_CCY: Record<string, Currency> = {
  USD: "USD", EUR: "EUR", GBP: "GBP", JPY: "JPY",
  CHF: "CHF", CAD: "CAD", AUD: "AUD", NZD: "NZD",
};

export interface InvestingInflationForecasts {
  cpiYoY:     string | null;
  cpiCore:    string | null;
  cpiMoM:     string | null;
  cpiCoreMoM: string | null;
  ppiMoM:     string | null;
}

function parseInvHTML(html: string, now: Date): Partial<Record<Currency, InvestingInflationForecasts>> {
  const result: Partial<Record<Currency, InvestingInflationForecasts>> = {};
  const rowPat = /eventRowId_(\d+)[^>]+data-event-datetime="([^"]+)"[^>]*>([\s\S]*?)(?=eventRowId_|$)/g;
  let m: RegExpExecArray | null;

  while ((m = rowPat.exec(html)) !== null) {
    const [, rowId, dtStr, body] = m;
    const evDate = new Date(dtStr.replace(/\//g, "-"));
    if (evDate <= now) continue;

    const ccyM = body.match(/ceFlags[^>]*>&nbsp;<\/span>\s*(\w+)/);
    if (!ccyM) continue;
    const ccy = INV_CCY_TO_CCY[ccyM[1].trim()];
    if (!ccy) continue;

    // Event name (skip country-specific EU sub-events like French/German CPI)
    const nameM = body.match(/target="_blank">\s*([^<\n]+?)\s*<\/a>/);
    if (!nameM) continue;
    const name = nameM[1].trim();
    if (/\bfrench\b|\bgerman\b|\bitalian\b|\bspanish\b|\bdutch\b|\bbelgian\b/i.test(name)) continue;

    // Forecast value
    const foreM = body.match(new RegExp(`eventForecast_${rowId}">([^<]+)`));
    const fore = foreM ? foreM[1].replace(/&nbsp;/g, "").trim() : "";
    if (!fore) continue;

    if (!result[ccy]) result[ccy] = { cpiYoY: null, cpiCore: null, cpiMoM: null, cpiCoreMoM: null, ppiMoM: null };
    const r = result[ccy]!;
    const n = name.toLowerCase();

    if      (!r.ppiMoM     && /\bppi\b.*\bmom\b/i.test(n))          r.ppiMoM     = fore;
    else if (!r.cpiCoreMoM && /core\s+cpi.*mom/i.test(n))            r.cpiCoreMoM = fore;
    else if (!r.cpiCore    && /core\s+cpi.*yoy/i.test(n))            r.cpiCore    = fore;
    else if (!r.cpiMoM     && /^cpi\b.*mom/i.test(n))                r.cpiMoM     = fore;
    else if (!r.cpiYoY     && /^cpi\b.*yoy/i.test(n))                r.cpiYoY     = fore;
  }

  return result;
}

// ── Full calendar events (same shape as TECalendarEvent) ─────────────────────

function parseInvCalendarHTML(html: string): TECalendarEvent[] {
  const events: TECalendarEvent[] = [];
  const now = new Date();
  const rowPat = /eventRowId_(\d+)[^>]+data-event-datetime="([^"]+)"[^>]*>([\s\S]*?)(?=eventRowId_|$)/g;
  let m: RegExpExecArray | null;

  while ((m = rowPat.exec(html)) !== null) {
    const [, rowId, dtStr, body] = m;

    const ccyM = body.match(/ceFlags[^>]*>&nbsp;<\/span>\s*(\w+)/);
    if (!ccyM) continue;
    const ccy = INV_CCY_TO_CCY[ccyM[1].trim()];
    if (!ccy) continue;

    const nameM = body.match(/target="_blank">\s*([^<\n]+?)\s*<\/a>/);
    if (!nameM) continue;
    const name = nameM[1].trim();

    // Date: "2026/06/10 14:30:00" → ISO
    const [datePart, timePart = "00:00:00"] = dtStr.split(" ");
    const isoDate = `${datePart.replace(/\//g, "-")}T${to24h(timePart)}:00Z`;
    const evDate  = new Date(isoDate);

    // Importance from bull icons count
    const bulls = (body.match(/grayFullBullishIcon/g) ?? []).length;
    const impact = bulls >= 3 ? "high" : bulls >= 2 ? "medium" : "low";

    // Values
    const actual   = cleanVal((body.match(new RegExp(`eventActual_${rowId}">([^<]+)`))   ?? [])[1] ?? "");
    const forecast = cleanVal((body.match(new RegExp(`eventForecast_${rowId}">([^<]+)`)) ?? [])[1] ?? "");
    const previous = cleanVal((body.match(new RegExp(`eventPrevious_${rowId}">([^<]+)`)) ?? [])[1] ?? "");

    events.push({
      id:          `inv_${rowId}`,
      date:        isoDate,
      currency:    ccy,
      category:    invCategory(name),
      title:       name,
      impact,
      actual,
      forecast,
      previous,
      isPublished: actual !== null || evDate < now,
      teId:        rowId,
    });
  }

  return events;
}

async function fetchInvestingRawHTML(fromDate: string, toDate: string): Promise<string | null> {
  try {
    const countryParams = Object.values(INV_COUNTRY_IDS).map((id) => `country%5B%5D=${id}`).join("&");
    const body = [
      countryParams,
      "importance%5B%5D=1&importance%5B%5D=2&importance%5B%5D=3",
      `dateFrom=${fromDate}&dateTo=${toDate}`,
      "currentTab=custom&submitFilters=1&limit_from=0",
    ].join("&");

    const res = await fetch(
      "https://www.investing.com/economic-calendar/Service/getCalendarFilteredData",
      {
        method: "POST",
        next:   { revalidate: 1800 },
        headers: {
          "Content-Type":     "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          "Referer":          "https://www.investing.com/economic-calendar/",
          "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept-Language":  "en-US,en;q=0.9",
        },
        body,
      }
    );
    if (!res.ok) { console.warn("[investing] HTTP", res.status); return null; }
    const json = await res.json() as { data?: string };
    return json.data ?? null;
  } catch (err) {
    console.error("[investing] error:", err);
    return null;
  }
}

export async function fetchInvestingCalendar(
  fromDate?: string,
  toDate?:   string,
): Promise<TECalendarEvent[]> {
  const from = fromDate ?? new Date().toISOString().slice(0, 10);
  const to   = toDate ?? (() => {
    const d = new Date(); d.setDate(d.getDate() + 21);
    return d.toISOString().slice(0, 10);
  })();
  const html = await fetchInvestingRawHTML(from, to);
  return html ? parseInvCalendarHTML(html) : [];
}

// Reuses the raw HTML from the general calendar fetch (no category filter here
// so we get inflation data alongside other events in one request)
export async function fetchInvestingInflationForecasts(
  fromDate?: string,
  toDate?:   string,
): Promise<Partial<Record<Currency, InvestingInflationForecasts>>> {
  const from = fromDate ?? new Date().toISOString().slice(0, 10);
  const to   = toDate ?? (() => {
    const d = new Date(); d.setDate(d.getDate() + 21);
    return d.toISOString().slice(0, 10);
  })();
  const html = await fetchInvestingRawHTML(from, to);
  if (!html) return {};
  const now = fromDate ? new Date(fromDate + "T00:00:00Z") : new Date();
  return parseInvHTML(html, now);
}
