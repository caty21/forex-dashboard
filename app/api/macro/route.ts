import { NextRequest, NextResponse } from "next/server";
import { FRED_SERIES } from "@/lib/constants";
import type { Currency } from "@/lib/types";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
// Macro data changes monthly/quarterly — cache 24h
const REVALIDATE = 86400;

// ── FRED ─────────────────────────────────────────────────────────────────────
// Note: we use original index/level URLs (no units= param) so Next.js fetch cache
// stays warm. MoM%/QoQ% are computed locally via toIndicatorPct.

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

// ── Eurostat SDMX-JSON API ────────────────────────────────────────────────────

async function eurostatObs(datasetCode: string, params: Record<string, string>) {
  try {
    const qs = new URLSearchParams({ ...params, format: "JSON" }).toString();
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

async function eurostatObsSorted(datasetCode: string, params: Record<string, string>, limit = 5) {
  const obs = await eurostatObs(datasetCode, params);
  return obs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

// ── BoE API (GBP policy rate) ─────────────────────────────────────────────────

async function boeRate() {
  try {
    // URL dynamique : fenêtre glissante de 3 ans → évite la date hardcodée
    const now = new Date();
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const td = now.getDate();
    const tm = MONTHS[now.getMonth()];
    const ty = now.getFullYear();
    const fy = ty - 3; // 3 ans d'historique suffisent
    const url = [
      "https://www.bankofengland.co.uk/boeapps/database/fromshowcolumns.asp",
      `?Travel=NIxIRx&FromSeries=1&ToSeries=50&DAT=RNG`,
      `&FD=1&FM=Jan&FY=${fy}`,
      `&TD=${td}&TM=${tm}&TY=${ty}`,
      `&VPD=Y&html.x=66&html.y=26&SeriesCodes=IUDBEDR&UnitId=GBP&CSVF=TT&csv.x=47&csv.y=26`,
    ].join("");
    const res = await fetch(url, { next: { revalidate: REVALIDATE } });
    if (!res.ok) return [];
    const text = await res.text();
    // Le CSV BoE peut avoir des guillemets et des en-têtes variables — on filtre proprement
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('"DATE"') && !l.startsWith('DATE'));
    return lines
      .reverse()
      .slice(0, 5)
      .map((line) => {
        const cols = line.split(",").map((c) => c.replace(/"/g, "").trim());
        const val = parseFloat(cols[1] ?? "NaN");
        return { date: cols[0] ?? "", value: val };
      })
      .filter((o) => o.date && !isNaN(o.value));
  } catch { return []; }
}

// ── Trading Economics PMI scraping ───────────────────────────────────────────
// URL pattern: https://tradingeconomics.com/{country}/{indicator}
// Source : balise <meta name="description"> dans le HTML
// Ex: "Manufacturing PMI in the United States increased to 55.30 points in May
//      from 54.50 points in April of 2026"

const TE_COUNTRY: Record<string, string> = {
  USD: "united-states",
  EUR: "euro-area",
  GBP: "united-kingdom",
  JPY: "japan",
  CHF: "switzerland",
  CAD: "canada",
  AUD: "australia",
  NZD: "new-zealand",
};

async function scrapePMI(
  currency: string,
  indicator: "manufacturing-pmi" | "services-pmi"
): Promise<{ value: number | null; prev: number | null }> {
  const country = TE_COUNTRY[currency];
  if (!country) return { value: null, prev: null };
  try {
    const url = `https://tradingeconomics.com/${country}/${indicator}`;
    const res  = await fetch(url, {
      next: { revalidate: 3600 }, // cache 1h — données PMI mensuelles
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return { value: null, prev: null };
    const html = await res.text();
    // Cherche la balise meta description
    const metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
                   ?? html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
    if (!metaMatch) return { value: null, prev: null };
    const desc = metaMatch[1];
    // Extraction : "...to XX.XX points in ... from YY.YY points..."
    const numRe = /(?:increased|decreased|declined|rose|fell|unchanged)\s+to\s+([\d.]+)\s+points?.+?from\s+([\d.]+)\s+points?/i;
    const m = desc.match(numRe);
    if (!m) {
      // Fallback : premier et deuxième nombre dans la description
      const nums = desc.match(/\b(\d{1,3}\.\d{1,2})\b/g);
      if (nums && nums.length >= 1) {
        return {
          value: parseFloat(nums[0]),
          prev:  nums[1] ? parseFloat(nums[1]) : null,
        };
      }
      return { value: null, prev: null };
    }
    return { value: parseFloat(m[1]), prev: parseFloat(m[2]) };
  } catch { return { value: null, prev: null }; }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

type Obs = { date: string; value: number };

/** Direct levels/rates (already in %) */
function toIndicator(obs: Obs[]) {
  if (!obs.length) return null;
  const value = obs[0].value;
  const prev  = obs[1]?.value ?? null;
  return {
    value,
    prev,
    surprise:    prev !== null ? parseFloat((value - prev).toFixed(4)) : null,
    trend:       prev !== null ? (value > prev ? "up" : value < prev ? "down" : "flat") : null,
    lastUpdated: obs[0].date,
  };
}

/**
 * Converts raw level/index observations → period-over-period % change.
 * MoM% for monthly series, QoQ% for quarterly.
 * Requires ≥2 observations (newest first).
 */
function toIndicatorPct(obs: Obs[]) {
  if (obs.length < 2) return null;
  const pctObs: Obs[] = obs.slice(0, -1).map((cur, i) => ({
    date:  cur.date,
    value: parseFloat(((cur.value / obs[i + 1].value - 1) * 100).toFixed(3)),
  }));
  return toIndicator(pctObs);
}

// ── Server-side cache ─────────────────────────────────────────────────────────

const _cache = new Map<string, { data: unknown; ts: number }>();

export async function GET(req: NextRequest) {
  const currency = (new URL(req.url).searchParams.get("currency") ?? "").toUpperCase() as Currency;
  const series   = FRED_SERIES[currency];
  if (!series) return NextResponse.json({ error: "Unknown currency" }, { status: 400 });

  const cached = _cache.get(currency);
  // Sert le cache pendant 24h sans re-fetcher
  if (cached && Date.now() - cached.ts < 86_400_000) return NextResponse.json(cached.data);
  // Garde une référence au cache précédent pour fallback stale-if-error
  const staleCache = cached ?? null;

  const key = process.env.FRED_API_KEY;
  if (!key) return NextResponse.json({ error: "FRED_API_KEY missing" }, { status: 500 });

  // Fields and which need period-over-period % conversion
  // policyRate / unemployment / retailSales → already in % → toIndicator
  //   (retailSales uses *SLRTTO01GPSAM series which report MoM% directly)
  // cpiCore / gdp / employment → index/level → toIndicatorPct (MoM% or QoQ%)
  const PCT_FIELDS = new Set(["cpiCore", "gdp", "employment"]);

  const fieldMap: Record<string, string | null> = {
    policyRate:   series.policyRate,
    cpiCore:      series.cpiCore,
    gdp:          series.gdp,
    retailSales:  series.retailSales,
    unemployment: series.unemployment,
    employment:   series.employment,
  };

  const fredFields  = Object.entries(fieldMap).filter(([, id]) => id !== null) as [string, string][];
  const fredResults = await Promise.all(fredFields.map(([, id]) => fredObs(id, key)));
  const indicators: Record<string, ReturnType<typeof toIndicator>> = {};

  fredFields.forEach(([field], i) => {
    indicators[field] = PCT_FIELDS.has(field)
      ? toIndicatorPct(fredResults[i])
      : toIndicator(fredResults[i]);
  });

  // ── EUR alternative sources ────────────────────────────────────────────────

  if (currency === "EUR") {
    // CPI: Eurostat HICP monthly rate of change (MoM%) — CP00 = all items
    if (!indicators.cpiCore) {
      const hicp = await eurostatObsSorted("prc_hicp_mmr", { geo: "EA20", coicop: "CP00" });
      indicators.cpiCore = toIndicator(hicp);
    }

    // GDP: Eurostat chained volumes → compute QoQ%
    if (!indicators.gdp) {
      const gdpRaw = await eurostatObsSorted("namq_10_gdp", { geo: "EA20", unit: "CLV10_MEUR", s_adj: "SCA", na_item: "B1GQ" }, 6);
      indicators.gdp = toIndicatorPct(gdpRaw);
    }

    // Unemployment: Eurostat monthly SA rate
    if (!indicators.unemployment) {
      const unObs = await eurostatObsSorted("une_rt_m", { geo: "EA20", s_adj: "SA", age: "TOTAL", sex: "T", unit: "PC_ACT" });
      indicators.unemployment = toIndicator(unObs);
    }

    // Retail sales for EUR: FRED uses German proxy index → apply MoM% if available
    // (already handled above via toIndicatorPct if FRED returned data)
  }

  // ── GBP alternative sources ───────────────────────────────────────────────

  if (currency === "GBP" && !indicators.policyRate) {
    const boe = await boeRate();
    indicators.policyRate = toIndicator(boe);
  }

  // Ensure all keys exist (null for missing)
  for (const field of Object.keys(fieldMap)) {
    if (!(field in indicators)) indicators[field] = null;
  }
  // ── PMI scraping (Trading Economics) ──────────────────────────────────────
  const [pmiMfgRaw, pmiSvcRaw] = await Promise.all([
    scrapePMI(currency, "manufacturing-pmi"),
    scrapePMI(currency, "services-pmi"),
  ]);

  // Convertit le résultat { value, prev } en format Indicator (surprise = diff)
  const toPmiIndicator = (raw: { value: number | null; prev: number | null }) => {
    if (raw.value === null) return null;
    const surprise = raw.prev !== null ? parseFloat((raw.value - raw.prev).toFixed(2)) : null;
    return {
      value:       raw.value,
      prev:        raw.prev,
      surprise,
      trend:       surprise !== null ? (surprise > 0 ? "up" : surprise < 0 ? "down" : "flat") as "up"|"down"|"flat" : null,
      lastUpdated: null,
    };
  };
  indicators.pmiMfg      = toPmiIndicator(pmiMfgRaw);
  indicators.pmiServices = toPmiIndicator(pmiSvcRaw);

  // Stale-if-error : si tous les indicateurs sont null (API en panne),
  // on renvoie le cache précédent plutôt que des tirets vides.
  const hasAnyValue = Object.values(indicators).some((v) => v !== null);
  if (!hasAnyValue && staleCache) {
    return NextResponse.json({ ...staleCache.data, stale: true });
  }

  const data = { currency, indicators, fetchedAt: new Date().toISOString() };
  _cache.set(currency, { data, ts: Date.now() });
  return NextResponse.json(data);
}
