// lib/fxstreetCalendar.ts
// Calendrier économique investingLive (investinglive.com/EconomicCalendar).
//
// investingLive n'a pas d'API JSON publique : la page embarque le widget
// FXStreet (calendar.fxstreet.com), chargé via /fxstreet-calendar.js sur
// investinglive.com. On appelle directement l'endpoint HTML de ce widget —
// c'est le même appel que fait le navigateur quand on visite
// investinglive.com/EconomicCalendar (Referer investingLive requis).
//
// Endpoint : GET https://calendar.fxstreet.com/EventDateWidget/GetMain
//   ?culture=en-US&timezone=UTC&start=YYYYMMDD&end=YYYYMMDD&view=range
//   &rows=5000&countrycode=US,UK,EMU,JP,...
// → retourne un fragment HTML (table <tr class="fxst-dateRow"> + <tr ...fxit-eventrow>)
//   couvrant les 45 pays de CALENDAR_COUNTRIES (bien au-delà des 8 devises majeures).

import type { EventCategory } from "@/app/api/calendar/route";
import { FXSTREET_COUNTRYCODES, FX_NAME_TO_CURRENCY, FX_NAME_TO_CODE } from "./calendar-countries";
import { classifyOtherTitle } from "./calendar-taxonomy";

export interface WideCalendarEvent {
  id:          string;
  date:        string;        // ISO UTC
  currency:    string;        // ISO 4217 (univers élargi, pas seulement les 8 majeures)
  countryCode: string;        // code pays (ex. "US", "EMU", "CN")
  category:    EventCategory;
  title:       string;
  impact:      "high" | "medium" | "low";
  actual:      string | null;
  forecast:    string | null;
  previous:    string | null;
  isPublished: boolean;
}

// ── Catégorie (mêmes heuristiques que teCategory/invCategory) ────────────────

function fxCategory(title: string): EventCategory {
  const t = title.toLowerCase();
  if (/\bspeech\b|speaks?\b|testimony|\bpress\s+conf/.test(t))              return "cb_speech";
  if (/\bpmi\b|purchasing\s+managers/.test(t))                              return "pmi";
  if (/interest\s+rate|monetary\s+policy|rate\s+decision|bank\s+rate/.test(t)) return "policy_rate";
  if (/inflation|\bcpi\b|\bhicp\b|consumer\s+price|\bppi\b|producer\s+price/.test(t)) return "inflation";
  if (/\bgdp\b|gross\s+domestic|growth\s+rate/.test(t))                     return "gdp";
  if (/retail\s+sales|core\s+retail|household\s+spending/.test(t))          return "retail_sales";
  if (/trade\s+balance|current\s+account|balance\s+of\s+trade/.test(t))     return "trade_balance";
  if (/employment|payrolls|nonfarm|jobless|unemployment|job\s+creation|\badp\b|jolts|job\s+openings|job\s+quits|ism\s+\w+\s+employ/.test(t)) return "employment";
  return classifyOtherTitle(title);
}

function impactFromVolatility(n: number): "high" | "medium" | "low" {
  if (n >= 3) return "high";
  if (n >= 2) return "medium";
  return "low";
}

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

function stripTags(s: string): string {
  return decodeHTMLEntities(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// ── Parsing ────────────────────────────────────────────────────────────────

function parseFXStreetHTML(html: string, fromDate: string): WideCalendarEvent[] {
  const events: WideCalendarEvent[] = [];
  const now = new Date();

  let currentYear = parseInt(fromDate.slice(0, 4), 10);
  let lastMonth = -1;
  let currentDateStr: string | null = null; // YYYY-MM-DD

  const rowRe =
    /<tr class="fxst-dateRow">\s*<td colspan="9">([^<]+)<\/td>\s*<\/tr>|<tr class="fxst-tr-event[^"]*"\s+data-eventdateid="([^"]*)"\s+data-actual="([^"]*)"\s+data-unit="([^"]*)"\s+data-precision="([^"]*)"\s+data-pot="([^"]*)"\s+data-isbetter="([^"]*)"\s+data-countryname="([^"]+)">([\s\S]*?)<\/tr>/g;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    if (m[1] !== undefined) {
      // ── Ligne séparateur de date : "Wednesday, Jul 01" ──────────────────
      const dm = m[1].match(/([A-Za-z]+)\s+(\d{1,2})/);
      if (!dm) continue;
      const monIdx = MONTHS[dm[1].slice(0, 3).toLowerCase()];
      if (monIdx === undefined) continue;
      const day = parseInt(dm[2], 10);
      if (lastMonth !== -1 && monIdx < lastMonth) currentYear += 1; // rollover déc → jan
      lastMonth = monIdx;
      currentDateStr = `${currentYear}-${String(monIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      continue;
    }

    // ── Ligne événement ────────────────────────────────────────────────────
    const [, , eventDateId, , , , , , countryName, body] = m;
    if (!currentDateStr) continue;

    const ccy = FX_NAME_TO_CURRENCY[countryName];
    const code = FX_NAME_TO_CODE[countryName];
    if (!ccy || !code) continue;

    const cells = Array.from(body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), c => c[1]);
    if (cells.length < 7) continue;

    const timeM = cells[0].match(/(\d{1,2}):(\d{2})/);
    const time24 = timeM ? `${timeM[1].padStart(2, "0")}:${timeM[2]}` : "00:00";
    const isoDate = `${currentDateStr}T${time24}:00Z`;
    const evDate = new Date(isoDate);

    const title = stripTags(cells[2]);
    if (!title) continue;

    const volM = stripTags(cells[3]).match(/\d+/);
    const impact = impactFromVolatility(volM ? parseInt(volM[0], 10) : 0);

    const actual = stripTags(cells[4]) || null;
    const forecast = stripTags(cells[5]) || null;
    const previous = stripTags(cells[6]) || null;

    events.push({
      id:          `il_${eventDateId}`,
      date:        isoDate,
      currency:    ccy,
      countryCode: code,
      category:    fxCategory(title),
      title,
      impact,
      actual,
      forecast,
      previous,
      isPublished: actual !== null || evDate < now,
    });
  }

  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return events;
}

// ── Fetch ──────────────────────────────────────────────────────────────────
// fromDate / toDate au format YYYY-MM-DD

export async function fetchFXStreetCalendar(fromDate: string, toDate: string): Promise<WideCalendarEvent[]> {
  const start = fromDate.replace(/-/g, "");
  const end   = toDate.replace(/-/g, "");

  const url =
    `https://calendar.fxstreet.com/EventDateWidget/GetMain` +
    `?culture=en-US&timezone=UTC&start=${start}&end=${end}&view=range&rows=5000` +
    `&countrycode=${FXSTREET_COUNTRYCODES}`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer":         "https://investinglive.com/EconomicCalendar",
      },
    });
    if (!res.ok) { console.warn("[fxstreet] HTTP", res.status); return []; }
    const html = await res.text();
    return parseFXStreetHTML(html, fromDate);
  } catch (err) {
    console.error("[fxstreet] error:", err);
    return [];
  }
}
