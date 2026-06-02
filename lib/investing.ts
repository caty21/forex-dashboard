// lib/investing.ts
// Scrape investing.com economic calendar (inflation events).
// Uses the AJAX endpoint which returns HTML inside JSON.
//
// Mapping confirmed by user:
//   "CPI (YoY)"      = Inflation Rate YoY → cpiYoY
//   "Core CPI (YoY)" = Core Inflation Rate YoY → cpiCore
//   "CPI (MoM)"      = Inflation Rate MoM → cpiMoM
//   "Core CPI (MoM)" = Core Inflation Rate MoM → cpiCoreMoM
//   "PPI (MoM)"      = PPI MoM → ppiMoM

import type { Currency } from "./types";

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

export async function fetchInvestingInflationForecasts(
  fromDate?: string,
  toDate?:   string,
): Promise<Partial<Record<Currency, InvestingInflationForecasts>>> {
  try {
    const from = fromDate ?? new Date().toISOString().slice(0, 10);
    const to   = toDate ?? (() => {
      const d = new Date(); d.setDate(d.getDate() + 21);
      return d.toISOString().slice(0, 10);
    })();

    const countryParams = Object.values(INV_COUNTRY_IDS)
      .map((id) => `country%5B%5D=${id}`).join("&");

    const reqBody = [
      countryParams,
      "importance%5B%5D=1&importance%5B%5D=2&importance%5B%5D=3",
      "category%5B%5D=_inflation",
      `dateFrom=${from}&dateTo=${to}`,
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
        body: reqBody,
      }
    );

    if (!res.ok) { console.warn("[investing] HTTP", res.status); return {}; }
    const json = await res.json() as { data?: string };
    if (!json.data) return {};

    const now = fromDate ? new Date(fromDate + "T00:00:00Z") : new Date();
    return parseInvHTML(json.data, now);
  } catch (err) {
    console.error("[investing] error:", err);
    return {};
  }
}
