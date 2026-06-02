import { NextRequest, NextResponse } from "next/server";
import { FRED_SERIES } from "@/lib/constants";
import type { Currency } from "@/lib/types";
import cpiOverridesRaw   from "@/data/cpi_overrides.json";
import rateDecisionsRaw  from "@/data/rate_decisions.json";
import { fetchFFThisWeek, fetchFFEvents } from "@/lib/forexfactory";
import type { FFEvent } from "@/lib/forexfactory";
import { fetchTECoreInflation, fetchTEMoMInflation, fetchTEInflationYoY, fetchTECoreCPIMoM, fetchTECoreConsumerPricesIndex, fetchTEPPIMoM, fetchTECoreInflationPages, fetchTEInflationYoYPages } from "@/lib/tecpi";
import { fetchTEInflationForecasts } from "@/lib/tradingeconomics";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const REVALIDATE = 86400; // cache 24h

// ── FRED ─────────────────────────────────────────────────────────────────────

async function fredObs(seriesId: string, apiKey: string, limit = 5) {
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE } });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.observations ?? [])
      .filter((o: { value: string }) => o.value !== ".")
      .map((o: { date: string; value: string }) => ({ date: o.date, value: parseFloat(o.value) }));
  } catch { return []; }
}

/**
 * Récupère deux séries FRED en parallèle et retourne celle avec la date la plus récente.
 * Utilisé pour choisir la meilleure source disponible (ex: IRSTCB01 vs IR3TIB01).
 */
async function fredObsFreshest(s1: string, s2: string, apiKey: string, limit = 5): Promise<Obs[]> {
  const [a, b] = await Promise.all([fredObs(s1, apiKey, limit), fredObs(s2, apiKey, limit)]);
  if (!a.length) return b;
  if (!b.length) return a;
  return a[0].date >= b[0].date ? a : b;
}

// ── Banque du Canada — Valet API ──────────────────────────────────────────────
// V80691311 = Taux d'intérêt directeur de la Banque du Canada (quotidien officiel)
// Source fiable, gratuite, sans clé, JSON structuré.

async function bocRate(): Promise<Obs[]> {
  try {
    const url = "https://www.bankofcanada.ca/valet/observations/V80691311/json?recent=10";
    const res  = await fetch(url, { next: { revalidate: REVALIDATE } });
    if (!res.ok) return [];
    const json = await res.json();
    type BoCObs = Record<string, unknown> & { d?: unknown; V80691311?: { v: string } };
    return ((json?.observations ?? []) as BoCObs[])
      .filter((o) => typeof o.V80691311?.v === "string")
      .map((o)    => ({ date: String(o.d ?? ""), value: parseFloat(o.V80691311!.v) }))
      .filter((o) => o.date && !isNaN(o.value))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first
  } catch { return []; }
}

// ── Eurostat SDMX-JSON API ─────────────────────────────────────────────────────
// IMPORTANT : toutes les dimensions non-temporelles DOIVENT avoir une valeur
// unique dans les params (freq, unit, s_adj…) → position value[]=timeIndex correct.

async function eurostatObs(datasetCode: string, params: Record<string, string>) {
  try {
    const qs  = new URLSearchParams({ ...params, format: "JSON" }).toString();
    const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${datasetCode}?${qs}`;
    const res = await fetch(url, { next: { revalidate: REVALIDATE } });
    if (!res.ok) return [];
    const json = await res.json();
    const timeIndex = json?.dimension?.time?.category?.index ?? {};
    const values    = json?.value ?? {};
    return Object.entries(timeIndex)
      .map(([period, idx]) => ({ date: period, value: values[idx as number] as number | null }))
      .filter((o) => o.value !== null && o.value !== undefined) as { date: string; value: number }[];
  } catch { return []; }
}

async function eurostatSorted(
  datasetCode: string,
  params: Record<string, string>,
  limit = 5,
): Promise<Obs[]> {
  let obs = await eurostatObs(datasetCode, params);
  // Fallback automatique EA20 → EA19 pour les agrégats zone euro
  if (!obs.length && params.geo === "EA20") {
    obs = await eurostatObs(datasetCode, { ...params, geo: "EA19" });
  }
  return obs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

// ── BoE API (GBP policy rate) ─────────────────────────────────────────────────

async function boeRate(): Promise<Obs[]> {
  try {
    const now    = new Date();
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const td = now.getDate();
    const tm = MONTHS[now.getMonth()];
    const ty = now.getFullYear();
    const fy = ty - 3;
    const url = [
      "https://www.bankofengland.co.uk/boeapps/database/fromshowcolumns.asp",
      `?Travel=NIxIRx&FromSeries=1&ToSeries=50&DAT=RNG`,
      `&FD=1&FM=Jan&FY=${fy}`,
      `&TD=${td}&TM=${tm}&TY=${ty}`,
      `&VPD=Y&html.x=66&html.y=26&SeriesCodes=IUDBEDR&UnitId=GBP&CSVF=TT&csv.x=47&csv.y=26`,
    ].join("");
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) return [];
    const text  = await res.text();
    const lines = text.trim().split(/\r?\n/).filter(
      (l) => l.trim() && !l.startsWith('"DATE"') && !l.startsWith("DATE")
    );
    return lines
      .reverse()
      .slice(0, 5)
      .map((line) => {
        const cols = line.split(",").map((c) => c.replace(/"/g, "").trim());
        return { date: cols[0] ?? "", value: parseFloat(cols[1] ?? "NaN") };
      })
      .filter((o) => o.date && !isNaN(o.value));
  } catch { return []; }
}

// ── DBnomics API (agrégateur IMF/IFS, BIS, OECD…) ────────────────────────────
// Format : https://api.db.nomics.world/v22/series/{provider}/{dataset}/{code}?observations=1
// Utilisé pour les séries absentes de FRED : JPY CPI, AUD/NZD CPI fallback
// Réponse : series.docs[0].period[] + series.docs[0].value[]

async function dbnomicsObs(provider: string, dataset: string, seriesCode: string, limit = 8): Promise<Obs[]> {
  try {
    const url = `https://api.db.nomics.world/v22/series/${provider}/${dataset}/${seriesCode}?observations=1`;
    const res = await fetch(url, { next: { revalidate: REVALIDATE } });
    if (!res.ok) return [];
    const json = await res.json();
    const s = json?.series?.docs?.[0] as { period?: string[]; value?: (number | null)[] } | undefined;
    const periods = s?.period ?? [];
    const values  = s?.value  ?? [];
    const obs: Obs[] = [];
    for (let i = periods.length - 1; i >= 0 && obs.length < limit; i--) {
      const v = values[i];
      if (v !== null && v !== undefined && !isNaN(Number(v))) {
        obs.push({ date: periods[i], value: Number(v) });
      }
    }
    return obs;
  } catch { return []; }
}

// ── ForexFactory — fetchFFThisWeek importé depuis @/lib/forexfactory ───────────

async function fetchFFPMI(currency: string): Promise<{
  mfg:       { value: number; prev: number | null } | null;
  svc:       { value: number; prev: number | null } | null;
  composite: { value: number; prev: number | null } | null;
}> {
  const empty = { mfg: null, svc: null, composite: null };
  try {
    const events = await fetchFFThisWeek();
    const forCcy      = events.filter((e) => e.country === currency && e.actual);
    const isMfg       = (t: string) => /manufacturing\s+pmi|mfg\s+pmi/i.test(t);
    const isComposite = (t: string) => /composite\s+pmi/i.test(t);
    const isSvc       = (t: string) => /services?\s+pmi|ism\s+non.manufactur/i.test(t);
    const parse = (e: FFEvent | undefined) => {
      if (!e?.actual) return null;
      const val  = parseFloat(e.actual);
      const prev = parseFloat(e.previous ?? "");
      return isNaN(val) ? null : { value: val, prev: isNaN(prev) ? null : prev };
    };
    return {
      mfg:       parse(forCcy.find((e) => isMfg(e.title))),
      svc:       parse(forCcy.find((e) => isSvc(e.title))),
      composite: parse(forCcy.find((e) => isComposite(e.title))),
    };
  } catch { return empty; }
}

// ── ForexFactory — consensus + surprise post-publication ─────────────────────
//
// Règle :
//   • Événement UPCOMING (forecast non vide, actual vide)
//     → afficher le consensus (forecast) dans la colonne "Cons."
//   • Événement RÉCENT (forecast + actual, release ≤ 5 jours)
//     → afficher la surprise = actual − forecast dans la colonne "Surpr."
//   • Événement ANCIEN (> 5 jours) ou sans forecast
//     → null (rien à afficher)

interface FFForecasts {
  cpi:                    number | null;
  cpiSurprise:            number | null;
  unemployment:           number | null;
  unemploymentSurprise:   number | null;
  pmiMfg:                 number | null;
  pmiMfgSurprise:         number | null;
  pmiSvc:                 number | null;
  pmiSvcSurprise:         number | null;
  pmiComposite:           number | null;  // PMI Composite — séparé des Services
  pmiCompositeSurprise:   number | null;
  retailSales:            number | null;
  retailSalesSurprise:    number | null;
  gdp:                    number | null;
  gdpSurprise:            number | null;
  employment:             number | null;
  employmentSurprise:     number | null;
}

async function fetchFFForecasts(currency: string): Promise<FFForecasts> {
  const empty: FFForecasts = {
    cpi: null, cpiSurprise: null,
    unemployment: null, unemploymentSurprise: null,
    pmiMfg: null, pmiMfgSurprise: null,
    pmiSvc: null, pmiSvcSurprise: null,
    pmiComposite: null, pmiCompositeSurprise: null,
    retailSales: null, retailSalesSurprise: null,
    gdp: null, gdpSurprise: null,
    employment: null, employmentSurprise: null,
  };
  try {
    const events = await fetchFFEvents(); // cette semaine + semaine prochaine
    // EUR : ForexFactory tague country="EUR" pour TOUS les pays de la zone (Italie, Espagne…).
    // On garde uniquement les événements dont le titre commence par "Euro Zone" ou "Euro Area"
    // pour éviter de matcher Italian Unemployment, Spanish CPI, etc. à la place des données agrégées.
    const forCcy = currency === "EUR"
      ? events.filter((e) => e.country === "EUR" && /^euro(?:zone|[\s-](?:zone|area))/i.test(e.title))
      : events.filter((e) => e.country === currency);

    const parseNum = (raw: string, min: number, max: number): number | null => {
      if (!raw) return null;
      const v = parseFloat(raw.replace(/[^0-9.-]/g, ""));
      return isNaN(v) || v < min || v > max ? null : v;
    };

    /** Premier event dont le titre correspond au pattern ET qui a un forecast. */
    const find = (re: RegExp) => forCcy.find((e) => re.test(e.title) && e.forecast);

    /** Calcul du nombre de jours depuis la date FF de l'événement. */
    const daysSince = (e: FFEvent): number => {
      const d = new Date(e.date);
      return Math.floor((Date.now() - d.getTime()) / 86_400_000);
    };

    /**
     * Retourne { forecast, surprise } pour un event FF :
     *   - upcoming  : forecast = consensus, surprise = null
     *   - ≤5j après : forecast = null, surprise = actual − forecast
     *   - >5j après : forecast = null, surprise = null
     */
    const classify = (e: FFEvent | undefined, min: number, max: number): { forecast: number | null; surprise: number | null } => {
      if (!e) return { forecast: null, surprise: null };
      const fc = parseNum(e.forecast, min, max);
      if (fc === null) return { forecast: null, surprise: null };
      if (!e.actual) {
        // Upcoming : pas encore publié → afficher le consensus
        return { forecast: fc, surprise: null };
      }
      const ac = parseNum(e.actual, min, max);
      if (ac === null) return { forecast: null, surprise: null };
      if (daysSince(e) <= 5) {
        // Publié récemment : afficher la surprise (actual − forecast)
        return { forecast: null, surprise: parseFloat((ac - fc).toFixed(2)) };
      }
      return { forecast: null, surprise: null };
    };

    // CPI y/y — pour JPY on exclut Tokyo/Flash (≠ CPI national)
    const cpiEvent = currency === "JPY"
      ? find(/(?:national|all\s+items).*\bcpi\b.*y\s*\/\s*y|\bcpi\b.*(?:national|all\s+items).*y\s*\/\s*y/i)
      : find(/\bcpi\b.*y\s*\/\s*y|y\s*\/\s*y.*\bcpi\b/i);
    const cpiC = classify(cpiEvent, -5, 20);

    // Chômage
    const uneEvent = currency === "EUR"
      ? find(/unemployment\s+rate/i)
      : find(/unemployment\s+rate|jobless\s+rate/i);
    const uneC = classify(uneEvent, 0.5, 25);

    // PMI Mfg
    const pmiMfgEvent = find(/manufacturing\s+pmi|flash\s+manufacturing\s+pmi|mfg\s+pmi/i);
    const pmiMfgC = classify(pmiMfgEvent, 20, 80);

    // PMI Services (strict : exclut composite)
    const pmiSvcEvent = find(/services?\s+pmi|ism\s+non.manufactur/i);
    const pmiSvcC = classify(pmiSvcEvent, 20, 80);

    // PMI Composite (séparé du Services)
    const pmiCompositeEvent = find(/composite\s+pmi/i);
    const pmiCompositeC = classify(pmiCompositeEvent, 20, 80);

    // Retail Sales m/m
    const rsEvent = find(/retail\s+sales/i);
    const rsC = classify(rsEvent, -10, 10);

    // PIB (GDP q/q%) : généralement entre -5% et +5%
    const gdpEvent = find(/\bgdp\b.*q\s*\/\s*q|q\s*\/\s*q.*\bgdp\b|gdp\s+growth/i);
    const gdpC = classify(gdpEvent, -5, 5);

    // Emploi Δk — NFP, Employment Change, ADP : en milliers (-500k à +1000k)
    // ForexFactory affiche souvent les valeurs avec "K" ex: "185K"
    const empEvent = find(/non.?farm\s+payrolls|nfp\b|employment\s+change|adp\s+non.?farm/i);
    const empC = classify(empEvent, -500, 1000);

    return {
      cpi:                    cpiC.forecast,
      cpiSurprise:            cpiC.surprise,
      unemployment:           uneC.forecast,
      unemploymentSurprise:   uneC.surprise,
      pmiMfg:                 pmiMfgC.forecast,
      pmiMfgSurprise:         pmiMfgC.surprise,
      pmiSvc:                 pmiSvcC.forecast,
      pmiSvcSurprise:         pmiSvcC.surprise,
      pmiComposite:           pmiCompositeC.forecast,
      pmiCompositeSurprise:   pmiCompositeC.surprise,
      retailSales:            rsC.forecast,
      retailSalesSurprise:    rsC.surprise,
      gdp:                    gdpC.forecast,
      gdpSurprise:            gdpC.surprise,
      employment:             empC.forecast,
      employmentSurprise:     empC.surprise,
    };
  } catch { return empty; }
}

// ── Trading Economics PMI scraping (fallback) ─────────────────────────────────

const TE_COUNTRY: Record<string, string> = {
  USD: "united-states", EUR: "euro-area", GBP: "united-kingdom",
  JPY: "japan", CHF: "switzerland", CAD: "canada", AUD: "australia", NZD: "new-zealand",
};

async function scrapePMI(
  currency: string,
  indicator: "manufacturing-pmi" | "services-pmi" | "composite-pmi",
): Promise<{ value: number | null; prev: number | null }> {
  const country = TE_COUNTRY[currency];
  if (!country) return { value: null, prev: null };
  try {
    const res = await fetch(`https://tradingeconomics.com/${country}/${indicator}`, {
      next: { revalidate: 3600 },
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Cache-Control":   "no-cache",
        "Sec-Fetch-Dest":  "document",
        "Sec-Fetch-Mode":  "navigate",
        "Sec-Fetch-Site":  "none",
        "Pragma":          "no-cache",
      },
    });
    if (!res.ok) return { value: null, prev: null };
    const html     = await res.text();
    const metaMatch =
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (!metaMatch) return { value: null, prev: null };
    const desc  = metaMatch[1];
    const numRe = /(?:increased|decreased|declined|rose|fell|eased)\s+to\s*([\d.]+)\s+points?.+?from\s+([\d.]+)\s+points?/i;
    const m     = desc.match(numRe);
    if (m) return { value: parseFloat(m[1]), prev: parseFloat(m[2]) };
    const nums = desc.match(/\b(\d{1,3}\.\d{1,2})\b/g);
    if (nums?.length) return { value: parseFloat(nums[0]), prev: nums[1] ? parseFloat(nums[1]) : null };
    return { value: null, prev: null };
  } catch { return { value: null, prev: null }; }
}

// ── Trading Economics — taux directeur officiel ───────────────────────────────
// Scrape la meta description de la page interest-rate, ex :
// "The benchmark interest rate in Japan was last recorded at 0.75 percent."

async function scrapeTeRate(country: string): Promise<number | null> {
  try {
    const res = await fetch(`https://tradingeconomics.com/${country}/interest-rate`, {
      next: { revalidate: 3600 },
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    if (!res.ok) return null;
    const html  = await res.text();
    const meta  = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
               ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (!meta) return null;
    const m = meta[1].match(/at\s+([\d.]+)\s*percent/i);
    return m ? parseFloat(m[1]) : null;
  } catch { return null; }
}

// ── Trading Economics — GDP QoQ% (pays dont FRED est stale) ─────────────────
// Meta description : "GDP Growth Rate in X increased to 0.3 percent in Q4 2025 from 0.2 percent..."
// Retourne { value, prev } directement depuis la description TE.

async function scrapeTeGdp(country: string): Promise<{ value: number | null; prev: number | null }> {
  const empty = { value: null, prev: null };
  try {
    // TE utilise "gdp-growth" (pas "gdp-growth-rate") pour le taux QoQ
    const res = await fetch(`https://tradingeconomics.com/${country}/gdp-growth`, {
      next: { revalidate: 3600 },
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    if (!res.ok) return empty;
    const html = await res.text();
    const meta = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
               ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (!meta) return empty;
    const desc = meta[1];
    // Format TE GDP : "expanded 0.50 percent in Q1 2026 over the previous quarter"
    //                 "contracted 0.1 percent in Q3 2025 from 0.9 percent"
    const m1 = desc.match(
      /(?:expanded|contracted|grew|grew by|declined|increased|decreased|rose|fell)\s+(?:by\s+)?([-\d.]+)\s*percent.{0,120}?from\s+([-\d.]+)\s*percent/i
    );
    if (m1) return { value: parseFloat(m1[1]), prev: parseFloat(m1[2]) };
    const m2 = desc.match(
      /(?:expanded|contracted|grew|declined|increased|decreased|rose|fell)\s+(?:by\s+)?([-\d.]+)\s*percent/i
    );
    if (m2) return { value: parseFloat(m2[1]), prev: null };
    return empty;
  } catch { return empty; }
}

// ── Trading Economics — Balance commerciale (niveau, normalisé en Milliards devise locale)
// Format meta TE :
//   "X recorded a trade deficit/surplus of Y.YY EUR/USD/etc. Billion/Million in Month of Year"
// Normalisation : Million → diviser par 1000 → Milliards
// Signe : déficit = négatif, surplus = positif
async function scrapeTeTradeBalance(country: string): Promise<{ value: number | null; prev: number | null }> {
  const empty = { value: null, prev: null };
  try {
    const res = await fetch(`https://tradingeconomics.com/${country}/balance-of-trade`, {
      next: { revalidate: 3600 },
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    if (!res.ok) return empty;
    const html = await res.text();
    const meta = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
               ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (!meta) return empty;
    const desc = meta[1];
    // "recorded a trade deficit of 60.31 USD Billion" / "recorded a trade surplus of 7820.60 EUR Million"
    const m = desc.match(
      /recorded a trade (deficit|surplus) of ([\d,.]+)\s+\w+\s+(Billion|Million)/i
    );
    if (!m) return empty;
    const rawVal    = parseFloat(m[2].replace(/,/g, ""));
    const inBillion = m[3].toLowerCase() === "billion";
    const sign      = m[1].toLowerCase() === "surplus" ? 1 : -1;
    const value     = parseFloat((sign * (inBillion ? rawVal : rawVal / 1000)).toFixed(2));
    return { value, prev: null }; // TE meta ne donne pas le mois précédent
  } catch { return empty; }
}

function buildGdpFromTe(te: { value: number; prev: number | null }, date: string): IndicatorResult {
  const surprise = te.prev !== null ? parseFloat((te.value - te.prev).toFixed(4)) : null;
  return {
    value:       te.value,
    prev:        te.prev,
    surprise,
    trend:       surprise !== null ? (surprise > 0 ? "up" : surprise < 0 ? "down" : "flat") : null,
    lastUpdated: date,
  };
}

// ── rate_decisions.json — taux officiels des CB (actuel + précédent) ──────────
// Mettre à jour data/rate_decisions.json après chaque décision CB.

type RateDecision = { current: number; prev: number };

function getRateDecision(ccy: string): RateDecision | null {
  type RdRaw = [{ decisions: Record<string, RateDecision> }];
  const entry = (rateDecisionsRaw as unknown as RdRaw)[0];
  return entry?.decisions?.[ccy] ?? null;
}

/** Construit un IndicatorResult à partir de la valeur TE + prev de l'override */
function buildRateIndicator(current: number, prev: number, today: string): IndicatorResult {
  const surprise = parseFloat((current - prev).toFixed(4));
  return {
    value:       current,
    prev,
    surprise,
    trend:       surprise > 0 ? "up" : surprise < 0 ? "down" : "flat",
    lastUpdated: today,
  };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

type Obs = { date: string; value: number };

// Type commun pour tous les indicateurs (toIndicator, toPmiIndicator, overrides)
type IndicatorResult = {
  value: number;
  prev: number | null;
  surprise: number | null;
  trend: "up" | "down" | "flat" | null;
  lastUpdated: string | null;
} | null;

function toIndicator(obs: Obs[]): IndicatorResult {
  if (!obs.length) return null;
  const value = obs[0].value;
  const prev  = (obs[1]?.value ?? null) as number | null;
  return {
    value,
    prev,
    surprise:    prev !== null ? parseFloat((value - prev).toFixed(4)) : null,
    trend:       prev !== null ? (value > prev ? "up" : value < prev ? "down" : "flat") : null,
    lastUpdated: obs[0].date,
  };
}

/**
 * Pour les séries quotidiennes de taux directeurs (DFEDTARU, ECBDFR…),
 * supprime les doublons consécutifs pour n'avoir que les dates de décision.
 * prev = taux avant la dernière décision (pas hier).
 */
function toIndicatorDeduped(obs: Obs[]) {
  const deduped: Obs[] = [];
  let last = NaN;
  for (const o of obs) {
    if (o.value !== last) { deduped.push(o); last = o.value; }
  }
  return toIndicator(deduped);
}

function toIndicatorPct(obs: Obs[]) {
  if (obs.length < 2) return null;
  const pctObs: Obs[] = obs.slice(0, -1).map((cur, i) => ({
    date:  cur.date,
    value: parseFloat(((cur.value / obs[i + 1].value - 1) * 100).toFixed(3)),
  }));
  return toIndicator(pctObs);
}

/**
 * Calcul glissement annuel (Year-over-Year) depuis un indice niveau.
 * periods = 12 pour mensuel (M/M-12), 4 pour trimestriel (Q/Q-4).
 * obs[0] = plus récent, obs[periods] = même période an passé.
 * Si données insuffisantes, fallback sur toIndicatorPct (MoM/QoQ).
 */
function toIndicatorYoY(obs: Obs[], periods = 12): IndicatorResult {
  if (obs.length < periods + 1) return toIndicatorPct(obs); // fallback MoM si pas assez de données
  const curr    = obs[0];
  const yearAgo = obs[periods];
  const yoy = parseFloat(((curr.value / yearAgo.value - 1) * 100).toFixed(2));

  // Calcul du YoY précédent (mois/trimestre d'avant) pour surprise & trend
  const prevYoY = obs.length >= periods + 2
    ? parseFloat(((obs[1].value / obs[periods + 1].value - 1) * 100).toFixed(2))
    : null;

  const surprise = prevYoY !== null ? parseFloat((yoy - prevYoY).toFixed(4)) : null;
  return {
    value:       yoy,
    prev:        prevYoY,
    surprise,
    trend:       surprise !== null ? (yoy > prevYoY! ? "up" : yoy < prevYoY! ? "down" : "flat") : null,
    lastUpdated: curr.date,
  };
}

/**
 * Calcul du changement absolu en milliers de personnes pour Employment Change.
 * personsToK = true si la série FRED est en personnes réelles (pas en milliers).
 * USD PAYEMS est déjà en milliers → personsToK=false.
 * AUD/CAD/JPY LFEMTTTT* sont en personnes → personsToK=true.
 */
function toIndicatorDeltaK(obs: Obs[], personsToK: boolean): IndicatorResult {
  if (obs.length < 2) return null;
  const raw  = obs[0].value - obs[1].value;
  const valK = personsToK
    ? parseFloat((raw / 1000).toFixed(1))
    : parseFloat(raw.toFixed(1));
  return {
    value:       valK,
    prev:        null,
    surprise:    valK,           // surprise = la valeur elle-même (signe = direction)
    trend:       valK > 0 ? "up" : valK < 0 ? "down" : "flat",
    lastUpdated: obs[0].date,
  };
}

function toPmiIndicator(raw: { value: number | null; prev: number | null }): IndicatorResult {
  if (raw.value === null) return null;
  const surprise = raw.prev !== null ? parseFloat((raw.value - raw.prev).toFixed(2)) : null;
  return {
    value:       raw.value,
    prev:        raw.prev,
    surprise,
    trend:       surprise !== null ? (surprise > 0 ? "up" : surprise < 0 ? "down" : "flat") : null,
    lastUpdated: null,
  };
}

// ── Parser forecast string TE ("2.8%" ou "0.4") → number ─────────────────────
function parseTeF(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace("%", "").trim());
  return isNaN(n) ? null : n;
}

// ── Server-side cache ─────────────────────────────────────────────────────────

const _cache = new Map<string, { data: unknown; ts: number }>();

export async function GET(req: NextRequest) {
  const currency = (new URL(req.url).searchParams.get("currency") ?? "").toUpperCase() as Currency;
  const series   = FRED_SERIES[currency];
  if (!series) return NextResponse.json({ error: "Unknown currency" }, { status: 400 });

  const cached     = _cache.get(currency);
  const staleCache = cached ?? null;
  if (cached && Date.now() - cached.ts < 86_400_000) return NextResponse.json(cached.data);

  const key = process.env.FRED_API_KEY;
  if (!key) return NextResponse.json({ error: "FRED_API_KEY missing" }, { status: 500 });

  // Limites de fetch par champ :
  //   cpiCore → 14 obs (12 mois YoY + 1 pour prev YoY + 1 tampon)
  //   cpiCore AUD/NZD (quarterly) → 6 obs (4 trimestres YoY + 1 prev + 1 tampon)
  //   gdp / employment → 6 obs (QoQ/MoM avec prev)
  //   autres → 5 obs (valeur + prev)
  const isQuarterlyCpi = (currency === "AUD" || currency === "NZD");
  const FIELD_LIMITS: Record<string, number> = {
    cpiCore:    isQuarterlyCpi ? 7 : 16, // +2 tampon pour les valeurs "." filtrées par FRED
    gdp:        6,
    employment: 6,
  };

  const fieldMap: Record<string, string | null> = {
    policyRate:   series.policyRate,
    cpiCore:      series.cpiCore,
    cpiHeadline:  series.cpiHeadline,  // headline pour MoM — peut être = cpiCore pour GBP
    gdp:          series.gdp,
    retailSales:  series.retailSales,
    unemployment: series.unemployment,
    employment:   series.employment,
  };

  const fredFields  = Object.entries(fieldMap).filter(([, id]) => id !== null) as [string, string][];
  const fredResults = await Promise.all(
    fredFields.map(([field, id]) => fredObs(id, key, FIELD_LIMITS[field] ?? 5))
  );
  const indicators: Record<string, IndicatorResult> = {};
  let _cpiCoreObs: Obs[] = []; // sauvegarde obs brutes pour fallback cpiMoM

  fredFields.forEach(([field], i) => {
    if (field === "cpiCore") {
      _cpiCoreObs = fredResults[i]; // sauvegarder pour le fallback
      // YoY : 12 périodes pour mensuel, 4 pour trimestriel (AUD/NZD)
      indicators[field] = toIndicatorYoY(fredResults[i], isQuarterlyCpi ? 4 : 12);
    } else if (field === "cpiHeadline") {
      // MoM% : variation mensuelle headline (ou QoQ pour AUD/NZD trimestriel)
      // Si la série headline FRED est identique à cpiCore (GBP) ou manquante (CHF/CAD) :
      // le fallback ci-dessous prendra le relais avec les obs cpiCore
      if (fredResults[i].length >= 2) indicators["cpiMoM"] = toIndicatorPct(fredResults[i]);
    } else if (field === "gdp") {
      // NZD NAEXKP01NZQ657S = déjà en QoQ% → toIndicator
      // Autres = indice niveau → toIndicatorPct (calcul QoQ)
      indicators[field] = currency === "NZD"
        ? toIndicator(fredResults[i])
        : toIndicatorPct(fredResults[i]);
    } else if (field === "employment") {
      // Delta absolu en milliers. USD PAYEMS = déjà en milliers. Autres = personnes → /1000.
      const personsToK = currency !== "USD";
      indicators[field] = toIndicatorDeltaK(fredResults[i], personsToK);
    } else {
      indicators[field] = toIndicator(fredResults[i]);
    }
  });

  // ── EUR alternative sources ────────────────────────────────────────────────
  if (currency === "EUR") {
    if (!indicators.cpiCore) {
      // CP0000EZCCM086NEST indisponible → fallback Eurostat prc_hicp_midx (I15 index → YoY%)
      const hicp = await eurostatSorted("prc_hicp_midx", {
        geo: "EA", coicop: "CP00", unit: "I15", freq: "M",
      }, 14);
      indicators.cpiCore = toIndicatorYoY(hicp, 12);
      // cpiMoM depuis mêmes obs Eurostat HICP
      if (!indicators.cpiMoM) indicators.cpiMoM = toIndicatorPct(hicp);
    } else if (!indicators.cpiMoM) {
      // cpiCore disponible depuis FRED → recalculer MoM depuis mêmes obs
      // On re-fetch avec limite réduite (2 obs suffisent pour MoM)
      const hicpMoM = await fredObs("CP0000EZCCM086NEST", key, 3);
      if (hicpMoM.length) indicators.cpiMoM = toIndicatorPct(hicpMoM);
    }
    if (!indicators.gdp) {
      // Essayer EA20 d'abord (données 2023-2025), puis EA19 (fallback automatique via eurostatSorted)
      const gdpObs = await eurostatSorted("namq_10_gdp", {
        geo: "EA20", unit: "CLV_PCH_PRE", s_adj: "SCA", na_item: "B1GQ", freq: "Q",
      }, 6);
      indicators.gdp = toIndicator(gdpObs);
    }
    if (!indicators.unemployment) {
      // EA21 = code actuel Eurostat pour Zone Euro 21 pays (depuis 2026)
      // Fallback EA20 si EA21 vide (transition de nomenclature)
      let unObs = await eurostatSorted("une_rt_m", {
        geo: "EA21", s_adj: "SA", age: "TOTAL", sex: "T", unit: "PC_ACT", freq: "M",
      });
      if (!unObs.length) {
        unObs = await eurostatSorted("une_rt_m", {
          geo: "EA20", s_adj: "SA", age: "TOTAL", sex: "T", unit: "PC_ACT", freq: "M",
        });
      }
      indicators.unemployment = toIndicator(unObs);
    }
  }

  // ── JPY CPI — IMF/IFS (DBnomics) ─────────────────────────────────────────
  // FRED n'a pas de série JPY CPI mensuelle récente.
  // M.JP.PCPI_IX = CPI All Items, indice niveau mensuel → YoY% via toIndicatorYoY
  // Fallback : M.JP.PCPI_PC_PP_PT = MoM% déjà calculé (si index indisponible)
  if (currency === "JPY" && !indicators.cpiCore) {
    const obsIdx = await dbnomicsObs("IMF", "IFS", "M.JP.PCPI_IX", 14);
    if (obsIdx.length >= 13) {
      indicators.cpiCore = toIndicatorYoY(obsIdx, 12);
      indicators.cpiMoM  = toIndicatorPct(obsIdx);   // MoM depuis mêmes obs
    } else {
      const obsMoM = await dbnomicsObs("IMF", "IFS", "M.JP.PCPI_PC_PP_PT");
      if (obsMoM.length) { indicators.cpiCore = toIndicator(obsMoM); indicators.cpiMoM = toIndicator(obsMoM); }
    }
  }

  // ── AUD/NZD CPI fallback — IMF/IFS (DBnomics) ────────────────────────────
  // Si FRED échoue, IMF/IFS Q.AU.PCPI_IX / Q.NZ.PCPI_IX → YoY% trimestriel
  if (currency === "AUD" && !indicators.cpiCore) {
    const obs = await dbnomicsObs("IMF", "IFS", "Q.AU.PCPI_IX", 6);
    if (obs.length) indicators.cpiCore = toIndicatorYoY(obs, 4);
  }
  if (currency === "NZD" && !indicators.cpiCore) {
    const obs = await dbnomicsObs("IMF", "IFS", "Q.NZ.PCPI_IX", 6);
    if (obs.length) indicators.cpiCore = toIndicatorYoY(obs, 4);
  }

  // ── GBP BoE policy rate ───────────────────────────────────────────────────
  if (currency === "GBP" && !indicators.policyRate) {
    const boe = await boeRate();
    indicators.policyRate = toIndicator(boe);
  }

  // Ensure all keys exist (null for missing)
  for (const field of Object.keys(fieldMap)) {
    if (!(field in indicators)) indicators[field] = null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── TAUX DIRECTEURS : sources corrigées ───────────────────────────────────
  //
  // Problème : les séries mensuelles (FEDFUNDS) ont un lag d'1 mois,
  //            les séries IR3TIB01 sont des taux interbancaires 3M (≠ taux CB).
  //
  // Solution  :
  //   • Séries quotidiennes (DFEDTARU, ECBDFR, IRSTCB01GBM156N)
  //     → toIndicatorDeduped : prev = avant-dernière décision, pas hier
  //   • IRSTCB01 (OCDE) : taux CB officiel, plus fiable que IR3TIB01
  //   • Banque du Canada Valet API : taux annoncé exact (V80691311)
  // ══════════════════════════════════════════════════════════════════════════

  const today = new Date().toISOString().slice(0, 10);

  // USD — midpoint de la fourchette cible (DFEDTARU + DFEDTARL) / 2
  // Rateprobability.com / marchés quotent le midpoint (3.625%) pas l'upper bound (3.75%)
  // USD — TE scraping (taux Fed upper bound officiel = 3.75%)
  //       Ancien calcul midpoint FRED (DFEDTARU+DFEDTARL)/2 = 3.625% → pas le taux annoncé
  if (currency === "USD") {
    const te  = await scrapeTeRate(TE_COUNTRY.USD);
    const ovr = getRateDecision("USD");
    if (te !== null && ovr) {
      indicators.policyRate = buildRateIndicator(te, ovr.prev, today);
    } else if (te !== null) {
      indicators.policyRate = { value: te, prev: null, surprise: null, trend: null, lastUpdated: today };
    }
    // Fallback FRED upper bound (jamais le midpoint)
    if (!indicators.policyRate) {
      const upper = await fredObs("DFEDTARU", key, 365);
      if (upper.length) {
        indicators.policyRate = toIndicatorDeduped(upper);
        if (indicators.policyRate && ovr)
          indicators.policyRate = buildRateIndicator(indicators.policyRate.value!, ovr.prev, today);
      }
    }
  }

  // EUR — ECBDFR (365j) → on affiche le taux MRO = DFR + 0.15
  // Depuis sep 2024 : corridor ECB = DFR | MRO = DFR+15bps | MLF = DFR+40bps
  // Investing.com / Trading Economics affichent le MRO comme "taux BCE"
  if (currency === "EUR") {
    const obs = await fredObs("ECBDFR", key, 365);
    if (obs.length) {
      const base = toIndicatorDeduped(obs);
      if (base) {
        // Convertit DFR → MRO pour correspondre aux sources de référence
        const mro: typeof base = {
          ...base,
          value:    parseFloat((base.value + 0.15).toFixed(2)),
          prev:     base.prev !== null ? parseFloat((base.prev + 0.15).toFixed(2)) : null,
        };
        indicators.policyRate = mro;
        if (mro.prev === null) {
          const ovr = getRateDecision("EUR");
          if (ovr) indicators.policyRate = buildRateIndicator(mro.value!, ovr.prev + 0.15, today);
        }
      }
    }
  }

  // GBP — TE scraping en primaire (taux BoE officiel 3.75%)
  // IUDBEDR (BoE API) = taux SONIA effective, légèrement différent du taux annoncé
  // IR3TIB01GBM156N = LIBOR 3M UK → incorrect
  if (currency === "GBP") {
    const te  = await scrapeTeRate(TE_COUNTRY.GBP);
    const ovr = getRateDecision("GBP");
    if (te !== null && ovr) {
      indicators.policyRate = buildRateIndicator(te, ovr.prev, today);
    } else if (te !== null) {
      indicators.policyRate = { value: te, prev: null, surprise: null, trend: null, lastUpdated: today };
    }
    // Fallback : BoE API puis FRED
    if (!indicators.policyRate) {
      const boe = await boeRate();
      if (boe.length) indicators.policyRate = toIndicator(boe);
    }
    if (!indicators.policyRate) {
      const obs = await fredObs("IR3TIB01GBM156N", key, 6);
      if (obs.length) indicators.policyRate = toIndicator(obs);
    }
  }

  // JPY — TE scraping (taux BoJ officiel exact) + prev depuis rate_decisions.json
  //       IRSTCB01JPM156N est stale (données arrêtées fin 2023 sur FRED)
  //       IR3TIB01JPM156N = TIBOR 3M (~1.27%) ≠ taux BoJ réel (~0.75%)
  if (currency === "JPY") {
    const te  = await scrapeTeRate(TE_COUNTRY.JPY);
    const ovr = getRateDecision("JPY");
    if (te !== null && ovr) {
      indicators.policyRate = buildRateIndicator(te, ovr.prev, today);
    } else if (te !== null) {
      indicators.policyRate = { value: te, prev: null, surprise: null, trend: null, lastUpdated: today };
    }
    // Fallback FRED si TE indisponible
    if (!indicators.policyRate) {
      const obs = await fredObsFreshest("IRSTCB01JPM156N", "IR3TIB01JPM156N", key);
      if (obs.length) indicators.policyRate = toIndicator(obs);
    }
  }

  // CHF — TE scraping (taux SNB officiel exact = 0.00%)
  //       IR3TIB01CHM156N = SARON 3M (~-0.04%) ≠ taux SNB officiel
  if (currency === "CHF") {
    const te  = await scrapeTeRate(TE_COUNTRY.CHF);
    const ovr = getRateDecision("CHF");
    if (te !== null && ovr) {
      indicators.policyRate = buildRateIndicator(te, ovr.prev, today);
    } else if (te !== null) {
      indicators.policyRate = { value: te, prev: null, surprise: null, trend: null, lastUpdated: today };
    }
  }

  // CAD — TE scraping (taux BoC cible officiel = 2.25%)
  //       V80691311 = taux marché overnight (4.45%) ≠ cible BoC
  if (currency === "CAD") {
    const te  = await scrapeTeRate(TE_COUNTRY.CAD);
    const ovr = getRateDecision("CAD");
    if (te !== null && ovr) {
      indicators.policyRate = buildRateIndicator(te, ovr.prev, today);
    } else if (te !== null) {
      indicators.policyRate = { value: te, prev: null, surprise: null, trend: null, lastUpdated: today };
    } else {
      // Fallback BoC Valet
      const boc = await bocRate();
      if (boc.length) indicators.policyRate = toIndicatorDeduped(boc);
    }
  }

  // AUD — TE scraping (taux RBA officiel exact = 4.35%)
  //       IR3TIB01AUM156N = taux interbancaire 3M (~4.34%) légèrement différent
  if (currency === "AUD") {
    const te  = await scrapeTeRate(TE_COUNTRY.AUD);
    const ovr = getRateDecision("AUD");
    if (te !== null && ovr) {
      indicators.policyRate = buildRateIndicator(te, ovr.prev, today);
    } else if (te !== null) {
      indicators.policyRate = { value: te, prev: null, surprise: null, trend: null, lastUpdated: today };
    }
  }

  // NZD — TE scraping (taux RBNZ officiel exact = 2.25%)
  //       IRSTCB01NZM156N n'existe pas sur FRED ; IR3TIB01NZM156N = taux marché
  if (currency === "NZD") {
    const te  = await scrapeTeRate(TE_COUNTRY.NZD);
    const ovr = getRateDecision("NZD");
    if (te !== null && ovr) {
      indicators.policyRate = buildRateIndicator(te, ovr.prev, today);
    } else if (te !== null) {
      indicators.policyRate = { value: te, prev: null, surprise: null, trend: null, lastUpdated: today };
    } else {
      const obs = await fredObsFreshest("IRSTCB01NZM156N", "IR3TIB01NZM156N", key);
      if (obs.length) indicators.policyRate = toIndicator(obs);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── CHÔMAGE : sources corrigées ───────────────────────────────────────────
  //
  // CHF — LRHUTTTTCHQ156S = taux OCDE harmonisé ILO (~5%) ≠ taux SECO (~2.3%)
  //       On tente la série CHEUNP01CHQ661S (taux national CH sur FRED)
  //       puis Eurostat geo=CH (Suisse incluse dans les datasets statistiques)
  //
  // GBP — On tente Eurostat geo=UK (UK inclus dans datasets Eurostat post-Brexit
  //       pour comparabilité statistique) avant LRHUTTTTGBM156S
  // ══════════════════════════════════════════════════════════════════════════

  if (currency === "CHF") {
    const national = await fredObs("CHEUNP01CHQ661S", key);
    if (national.length) {
      indicators.unemployment = toIndicator(national);
    } else {
      // Eurostat geo=CH : taux ILO mensuel (plus récent que FRED trimestriel)
      const eurostatCH = await eurostatSorted("une_rt_m", {
        geo: "CH", s_adj: "SA", age: "TOTAL", sex: "T", unit: "PC_ACT", freq: "M",
      });
      if (eurostatCH.length) indicators.unemployment = toIndicator(eurostatCH);
      // Else: on garde LRHUTTTTCHQ156S (harmonisé OCDE) déjà calculé ci-dessus
    }
  }

  // GBP unemployment: Eurostat UK retiré — données stoppées en sept. 2020 (Brexit).
  // On conserve LRHUTTTTGBM156S (FRED, ILO harmonisé, mis à jour mensuellement).

  // ── GDP : sources TE pour CHF et NZD (FRED stale depuis 2023) ───────────────
  // CHNGDPNQDSMEI / NAEXKP01NZQ661S dernière obs = 2023-07-01 → utiliser TE
  if (currency === "CHF" || currency === "NZD") {
    const te = await scrapeTeGdp(TE_COUNTRY[currency]);
    if (te.value !== null) indicators.gdp = buildGdpFromTe(te as { value: number; prev: number | null }, today);
  }

  // ── Fallback cpiMoM : si cpiHeadline FRED absent/vide (CHF/CAD/AUD/NZD)
  // → calculer MoM depuis les obs cpiCore déjà disponibles (Core MoM ou QoQ trimestriel)
  if (!indicators.cpiMoM && _cpiCoreObs.length >= 2) {
    indicators.cpiMoM = toIndicatorPct(_cpiCoreObs);
  }

  // ── PMI (Mfg + Services + Composite) + consensus FF ──────────────────────────
  const toDateObj = new Date();
  toDateObj.setDate(toDateObj.getDate() + 21);
  const toDate = toDateObj.toISOString().slice(0, 10);

  const [ffPMI, pmiMfgRaw, pmiSvcRaw, pmiCompositeRaw, ffForecasts, teForecastMap] = await Promise.all([
    fetchFFPMI(currency),
    scrapePMI(currency, "manufacturing-pmi"),
    scrapePMI(currency, "services-pmi"),
    scrapePMI(currency, "composite-pmi"),
    fetchFFForecasts(currency),
    fetchTEInflationForecasts(today, toDate),
  ]);

  const teCpiForecast = teForecastMap[currency];
  // FF en priorité (forecast + actual) ; TE en fallback
  indicators.pmiMfg       = ffPMI.mfg       ? toPmiIndicator(ffPMI.mfg)       : toPmiIndicator(pmiMfgRaw);
  indicators.pmiServices  = ffPMI.svc       ? toPmiIndicator(ffPMI.svc)       : toPmiIndicator(pmiSvcRaw);
  indicators.pmiComposite = ffPMI.composite ? toPmiIndicator(ffPMI.composite) : toPmiIndicator(pmiCompositeRaw);

  // ── Balance commerciale — Trading Economics (MoM, en milliards) ───────────
  {
    const country = TE_COUNTRY[currency];
    if (country) {
      const tb = await scrapeTeTradeBalance(country);
      if (tb.value !== null) {
        const surprise = tb.prev !== null ? parseFloat((tb.value - tb.prev).toFixed(3)) : null;
        indicators.tradeBalance = {
          value:       tb.value,
          prev:        tb.prev,
          surprise,
          trend:       surprise !== null ? (surprise > 0 ? "up" : surprise < 0 ? "down" : "flat") : null,
          lastUpdated: today,
        };
      }
    }
  }

  // ── Overrides manuels CPI (investing.com) ─────────────────────────────────
  // Appliqués quand la source automatique (FRED/DBnomics) est en retard.
  // Règle : l'override est retenu ssi sa date > lastUpdated de la source auto.
  // Mettre à jour data/cpi_overrides.json après chaque publication trimestrielle.
  {
    type OvrField = { value: number; prev: number | null; surprise: number | null; trend: string | null; lastUpdated: string; source?: string };
    type OvrMap  = Record<string, Record<string, OvrField>>;
    const entry     = (cpiOverridesRaw as unknown as [{ overrides: OvrMap }])[0];
    const ovrFields = entry?.overrides?.[currency];
    if (ovrFields) {
      for (const [field, ovr] of Object.entries(ovrFields)) {
        const auto = indicators[field];
        const autoDate = auto?.lastUpdated ?? "";
        if (!auto || autoDate < ovr.lastUpdated) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { source: _src, ...rest } = ovr;
          indicators[field] = {
            ...rest,
            trend: rest.trend as "up" | "down" | "flat" | null,
          };
        }
      }
    }
  }

  // ── TE CPI override (priorité maximale — données du jour, toutes devises) ───
  // Remplace séries FRED stale/erronées.
  // Nouvelles données : cpiYoY headline, cpiCoreMoM (pages individuelles), ppiMoM
  {
    const [teCoreMap, teMoMMap, teYoYMap, teCoreMoMMap, teCoreIdxMap, tePPIMap, teCorePages, teYoYPages] = await Promise.all([
      fetchTECoreInflation(),
      fetchTEMoMInflation(),
      fetchTEInflationYoY(),
      fetchTECoreCPIMoM(),
      fetchTECoreConsumerPricesIndex(),
      fetchTEPPIMoM(),
      fetchTECoreInflationPages(),   // EUR valeur précise + JPY consensus via TEForecast
      fetchTEInflationYoYPages(),    // EUR valeur à jour + GBP/JPY consensus
    ]);

    const teCore     = teCoreMap[currency];
    const teCorePage = teCorePages[currency]; // EUR: valeur précise; JPY: + consensus
    const coreValue  = teCorePage?.value ?? teCore?.value ?? null;
    if (coreValue !== null) {
      const prev      = teCore?.prev ?? null;
      const refMonth  = teCorePage?.refMonth || teCore?.refMonth || "";
      const surprise  = prev !== null ? parseFloat((coreValue - prev).toFixed(3)) : null;
      const consensus = teCorePage?.consensus ?? null;
      indicators.cpiCore = {
        value:       coreValue,
        prev,
        surprise,
        trend:       prev !== null ? (coreValue > prev ? "up" : coreValue < prev ? "down" : "flat") : null,
        lastUpdated: refMonth,
        ...(consensus !== null ? { consensus } : {}),
      };
    }

    const teMoM = teMoMMap[currency];
    if (teMoM) {
      const surprise = teMoM.prev !== null
        ? parseFloat((teMoM.value - teMoM.prev).toFixed(3))
        : null;
      indicators.cpiMoM = {
        value:       teMoM.value,
        prev:        teMoM.prev,
        surprise,
        trend:       teMoM.value > 0 ? "up" : teMoM.value < 0 ? "down" : "flat",
        lastUpdated: teMoM.refMonth,
      };
    }

    // Inflation Rate YoY (headline) — pages individuelles prioritaires pour EUR/GBP/JPY
    const teYoY     = teYoYMap[currency];
    const teYoYPage = teYoYPages[currency];
    const yoyValue  = teYoYPage?.value ?? teYoY?.value ?? null;
    if (yoyValue !== null) {
      const yoyPrev    = teYoYPage?.prev ?? teYoY?.prev ?? null;
      const yoyRef     = teYoYPage?.refMonth || teYoY?.refMonth || "";
      const yoySurp    = yoyPrev !== null ? parseFloat((yoyValue - yoyPrev).toFixed(3)) : null;
      const yoyCons    = teYoYPage?.consensus ?? null;
      indicators.cpiYoY = {
        value:       yoyValue,
        prev:        yoyPrev,
        surprise:    yoySurp,
        trend:       yoySurp !== null ? (yoySurp > 0 ? "up" : yoySurp < 0 ? "down" : "flat") : null,
        lastUpdated: yoyRef,
        ...(yoyCons !== null ? { consensus: yoyCons } : {}),
      };
    }

    // Core CPI MoM (pages individuelles, décimales précises)
    const teCoreMoM = teCoreMoMMap[currency];
    if (teCoreMoM) {
      // prev=null pour les devises index-only (JPY/CHF/AUD/NZD)
      const surprise = teCoreMoM.prev !== null
        ? parseFloat((teCoreMoM.value - teCoreMoM.prev).toFixed(3))
        : null;
      indicators.cpiCoreMoM = {
        value:       teCoreMoM.value,
        prev:        teCoreMoM.prev,
        surprise,
        trend:       teCoreMoM.value > 0 ? "up" : teCoreMoM.value < 0 ? "down" : "flat",
        lastUpdated: teCoreMoM.refMonth,
      };
    }

    // PPI MoM
    const tePPI = tePPIMap[currency];
    if (tePPI) {
      const surprise = tePPI.prev !== null
        ? parseFloat((tePPI.value - tePPI.prev).toFixed(3))
        : null;
      indicators.ppiMoM = {
        value:       tePPI.value,
        prev:        tePPI.prev,
        surprise,
        trend:       tePPI.value > 0 ? "up" : tePPI.value < 0 ? "down" : "flat",
        lastUpdated: tePPI.refMonth,
      };
    }

    // Raw Core CPI index values for tooltip on cpiCoreMoM
    const teRawCore = teCoreIdxMap[currency];
    const rawCoreIndex = teRawCore ? { last: teRawCore.rawLast, prev: teRawCore.rawPrev, refMonth: teRawCore.refMonth } : null;
    if (indicators.cpiCoreMoM && rawCoreIndex) (indicators.cpiCoreMoM as Record<string,unknown>)["_raw"] = rawCoreIndex;
  }

  // Stale-if-error
  const hasAnyValue = Object.values(indicators).some((v) => v !== null);
  if (!hasAnyValue && staleCache) {
    return NextResponse.json({ ...(staleCache.data as object), stale: true });
  }

  const data = {
    currency, indicators,
    forecasts: {
      // CPI — TE calendar forecast (priorité) puis ForexFactory
      // Les forecasts TE sont des strings "2.8%" → parseFloat les convertit en number
      cpi:                    parseTeF(teCpiForecast?.cpiYoY)  ?? ffForecasts.cpi  ?? null,
      cpiCore:                parseTeF(teCpiForecast?.cpiCore) ?? null,
      cpiMoM:                 parseTeF(teCpiForecast?.cpiMoM)  ?? null,
      cpiSurprise:            ffForecasts.cpiSurprise,
      unemployment:           ffForecasts.unemployment,
      unemploymentSurprise:   ffForecasts.unemploymentSurprise,
      pmiMfg:                 ffForecasts.pmiMfg,
      pmiMfgSurprise:         ffForecasts.pmiMfgSurprise,
      pmiSvc:                 ffForecasts.pmiSvc,
      pmiSvcSurprise:         ffForecasts.pmiSvcSurprise,
      pmiComposite:           ffForecasts.pmiComposite,
      pmiCompositeSurprise:   ffForecasts.pmiCompositeSurprise,
      retailSales:            ffForecasts.retailSales,
      retailSalesSurprise:    ffForecasts.retailSalesSurprise,
      gdp:                    ffForecasts.gdp,
      gdpSurprise:            ffForecasts.gdpSurprise,
      employment:             ffForecasts.employment,
      employmentSurprise:     ffForecasts.employmentSurprise,
    },
    fetchedAt: new Date().toISOString(),
  };
  _cache.set(currency, { data, ts: Date.now() });
  return NextResponse.json(data);
}
