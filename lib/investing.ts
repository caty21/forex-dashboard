// lib/investing.ts
// Investing.com Economic Calendar — POST API (JSON avec HTML interne)
// Endpoint : POST https://fr.investing.com/economic-calendar/Service/getCalendarFilteredData
// Auth     : aucune — Cloudflare peut rate-limiter en test mais pas en prod avec cache 30min
// Timezone : 55 = UTC

import type { Currency } from "./types";
import type { EventCategory } from "@/app/api/calendar/route";

// ── Country IDs (Investing.com internal) ─────────────────────────────────────

const INV_COUNTRY_IDS: Record<Currency, number> = {
  USD: 5,
  GBP: 4,
  AUD: 25,
  CAD: 6,
  EUR: 72,  // Euro Area aggregate
  NZD: 43,
  JPY: 35,
  CHF: 12,
};

// ── Currency code → Currency type ─────────────────────────────────────────────

const INV_CCY_MAP: Record<string, Currency> = {
  USD: "USD", GBP: "GBP", AUD: "AUD", CAD: "CAD",
  EUR: "EUR", NZD: "NZD", JPY: "JPY", CHF: "CHF",
};

// ── Category detection (noms en français) ─────────────────────────────────────

function invCategory(title: string): EventCategory {
  const t = title.toLowerCase();
  if (/\bpmi\b|purchasing\s+managers/.test(t))                                             return "pmi";
  if (/taux d.intér|décision.*taux|politique monétaire|bank\s+rate/.test(t))               return "policy_rate";
  if (/discours|allocution|s.exprime|parole|communiqué|banque central/.test(t))            return "cb_speech";
  if (/\bipc\b|\bcpi\b|\bhicp\b|\bipch\b|inflation|prix à la conso|prix\s+consom/.test(t)) return "inflation";
  if (/\bpib\b|\bgdp\b|croissance économ/.test(t))                                         return "gdp";
  if (/ventes au détail|retail\s+sales/.test(t))                                           return "retail_sales";
  if (/balance commerc|balance des paiements|exportations|importations/.test(t))           return "trade_balance";
  if (/emploi|chômage|payrolls|nonfarm|chomage|travail|emplois créés/.test(t))             return "employment";
  return "other";
}

// ── Importance (bull1/2/3 → impact) ───────────────────────────────────────────

function invImpact(bull: string): "high" | "medium" | "low" {
  if (bull === "bull3") return "high";
  if (bull === "bull2") return "medium";
  return "low";
}

// ── Normalise valeurs numériques françaises ──────────────────────────────────
// "0,6%" → "0.6%"  |  "52,3" → "52.3"  |  "&nbsp;" → null

function normVal(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/&nbsp;/g, "").trim();
  if (!s || s === "–" || s === "-") return null;
  return s.replace(",", ".");
}

// ── Public type ───────────────────────────────────────────────────────────────

export interface InvCalendarEvent {
  id:          string;
  date:        string;        // ISO UTC
  currency:    Currency;
  category:    EventCategory;
  title:       string;
  impact:      "high" | "medium" | "low";
  actual:      string | null;
  forecast:    string | null;
  previous:    string | null;
  isPublished: boolean;
}

// ── Parse HTML dans la réponse JSON de l'API ──────────────────────────────────

function parseInvestingHTML(html: string): InvCalendarEvent[] {
  const events: InvCalendarEvent[] = [];
  const now = new Date();

  // Sépare chaque ligne événement
  const ROW = /<tr\s+id="eventRowId_(\d+)"\s+class="js-event-item[^"]*"\s+event_attr_ID="(\d+)"\s+data-event-datetime="([^"]+)"[^>]*>([\s\S]*?)(?=<tr\s+id="eventRowId_|<\/tbody>)/g;

  let m: RegExpExecArray | null;
  while ((m = ROW.exec(html)) !== null) {
    const [, rowId, , dateRaw, body] = m;

    // Devise : " AUD" après le span ceFlags
    const ccyMatch = body.match(/class="ceFlags[^"]*"[^>]*>&nbsp;<\/span>\s*([A-Z]{2,4})/);
    if (!ccyMatch) continue;
    const ccy = INV_CCY_MAP[ccyMatch[1].trim()];
    if (!ccy) continue;

    // DateTime UTC  "2026/06/01 01:00:00" → "2026-06-01T01:00:00Z"
    const isoDate = dateRaw.replace(/\//g, "-").replace(" ", "T") + "Z";
    const evDate  = new Date(isoDate);

    // Importance : data-img_key="bull1/2/3"
    const bullMatch = body.match(/data-img_key="(bull\d)"/);
    const impact = bullMatch ? invImpact(bullMatch[1]) : "low";

    // Nom de l'événement : texte dans <a href="/economic-calendar/...">
    const nameMatch = body.match(/<a\s+href="\/economic-calendar\/[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
    const title = nameMatch
      ? nameMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : "";
    if (!title) continue;

    // Valeurs dans les td id="eventActual_XXX", eventForecast_XXX, eventPrevious_XXX
    const actualRaw  = body.match(new RegExp(`id="eventActual_${rowId}"[^>]*>([^<]*)<`));
    const forecastRaw = body.match(new RegExp(`id="eventForecast_${rowId}"[^>]*>([^<]*)<`));
    const prevSpan   = body.match(new RegExp(`id="eventPrevious_${rowId}"[^>]*>\\s*(?:<span[^>]*>)?([^<]*)(?:<\\/span>)?`));

    const actual   = normVal(actualRaw?.[1]);
    const forecast = normVal(forecastRaw?.[1]);
    const previous = normVal(prevSpan?.[1]);

    events.push({
      id:          `inv_${rowId}`,
      date:        isoDate,
      currency:    ccy,
      category:    invCategory(title),
      title,
      impact,
      actual,
      forecast,
      previous,
      isPublished: actual !== null || evDate < now,
    });
  }

  return events;
}

// ── Fetch depuis l'API Investing.com ─────────────────────────────────────────

export async function fetchInvestingCalendar(
  fromDate: string,
  toDate:   string,
): Promise<InvCalendarEvent[]> {
  // Paramètres : toutes les devises + toutes les importances
  const countryParams = Object.values(INV_COUNTRY_IDS)
    .map(id => `country%5B%5D=${id}`)
    .join("&");

  const body = [
    countryParams,
    "importance%5B%5D=1&importance%5B%5D=2&importance%5B%5D=3",
    "timeZone=55",                          // UTC
    "timeFilter=timeRemain",
    "currentTab=custom",
    `dateFrom=${fromDate}&dateTo=${toDate}`,
    "submitFilters=1",
    "limit_from=0",
  ].join("&");

  try {
    const res = await fetch(
      "https://fr.investing.com/economic-calendar/Service/getCalendarFilteredData",
      {
        method:  "POST",
        next:    { revalidate: 1800 }, // cache 30 min
        headers: {
          "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "X-Requested-With": "XMLHttpRequest",
          "Referer":          "https://fr.investing.com/economic-calendar/",
          "Origin":           "https://fr.investing.com",
          "Content-Type":     "application/x-www-form-urlencoded",
          "Accept":           "application/json, text/javascript, */*; q=0.01",
        },
        body,
      }
    );
    if (!res.ok) {
      console.warn("[Investing] HTTP", res.status);
      return [];
    }
    const json = await res.json() as { data?: string };
    if (!json?.data) return [];
    return parseInvestingHTML(json.data);
  } catch (err) {
    console.warn("[Investing] fetch error:", err);
    return [];
  }
}
