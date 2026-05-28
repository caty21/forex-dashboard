import { NextRequest, NextResponse } from "next/server";
import { FRED_SERIES } from "@/lib/constants";
import type { Currency } from "@/lib/types";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
// Macro data changes monthly/quarterly — cache 24h
const REVALIDATE = 86400;

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

// ── Eurostat SDMX-JSON API ─────────────────────────────────────────────────────
// IMPORTANT: toutes les dimensions non-temporelles DOIVENT avoir une valeur unique
// dans les paramètres (freq, unit, s_adj, coicop…) sinon la correspondance
// position → indice temporel est fausse et on obtient des NaN.

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
): Promise<{ date: string; value: number }[]> {
  // Essaie d'abord les params fournis, puis fallback geo EA20→EA19
  let obs = await eurostatObs(datasetCode, params);
  if (!obs.length && params.geo === "EA20") {
    obs = await eurostatObs(datasetCode, { ...params, geo: "EA19" });
  }
  return obs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

// ── BoE API (GBP policy rate) ─────────────────────────────────────────────────

async function boeRate() {
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
        // Sans User-Agent le BoE redirige vers une page HTML au lieu du CSV
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
        const val  = parseFloat(cols[1] ?? "NaN");
        return { date: cols[0] ?? "", value: val };
      })
      .filter((o) => o.date && !isNaN(o.value));
  } catch { return []; }
}

// ── ForexFactory calendar (PMI source primaire) ───────────────────────────────
// JSON structuré, pas de scraping, ~98 événements/semaine avec actual/previous/forecast.
// Limité à la semaine courante — complété par le scraping TE si l'event n'est pas encore publié.

async function fetchFFPMI(currency: string): Promise<{
  mfg: { value: number; prev: number | null } | null;
  svc: { value: number; prev: number | null } | null;
}> {
  const empty = { mfg: null, svc: null };
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
      next: { revalidate: 3600 },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ForexDashboard/1.0)" },
    });
    if (!res.ok) return empty;
    const events = await res.json() as Array<{
      title: string; country: string; actual: string; previous: string; forecast: string;
    }>;

    const forCcy = events.filter((e) => e.country === currency && e.actual);
    const isMfg  = (t: string) => /manufacturing\s+pmi|mfg\s+pmi|s&p.*manufacturing/i.test(t);
    const isSvc  = (t: string) => /services?\s+pmi|ism\s+non.manufactur|composite\s+pmi/i.test(t);

    const mfgEv = forCcy.find((e) => isMfg(e.title));
    const svcEv = forCcy.find((e) => isSvc(e.title));

    const parse = (e: typeof mfgEv) => {
      if (!e?.actual) return null;
      const val  = parseFloat(e.actual);
      const prev = parseFloat(e.previous ?? "");
      if (isNaN(val)) return null;
      return { value: val, prev: isNaN(prev) ? null : prev };
    };

    return { mfg: parse(mfgEv), svc: parse(svcEv) };
  } catch { return empty; }
}

// ── Trading Economics PMI scraping (fallback) ─────────────────────────────────
// Quand ForexFactory n'a pas l'event de la semaine courante, on scrape TE.
// Extrait la valeur et le précédent depuis la balise <meta name="description">.

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
  indicator: "manufacturing-pmi" | "services-pmi",
): Promise<{ value: number | null; prev: number | null }> {
  const country = TE_COUNTRY[currency];
  if (!country) return { value: null, prev: null };
  try {
    const url = `https://tradingeconomics.com/${country}/${indicator}`;
    const res = await fetch(url, {
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
    const html = await res.text();
    // Meta description : "Manufacturing PMI in X increased to 55.30 points in May from 54.50 points in April"
    const metaMatch =
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ??
      html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
    if (!metaMatch) return { value: null, prev: null };
    const desc  = metaMatch[1];
    const numRe = /(?:increased|decreased|declined|rose|fell|eased|stood)\s+(?:at\s+)?to?\s*([\d.]+)\s+points?.+?from\s+([\d.]+)\s+points?/i;
    const m     = desc.match(numRe);
    if (m) return { value: parseFloat(m[1]), prev: parseFloat(m[2]) };
    // Fallback numérique : deux premiers décimaux dans la description
    const nums = desc.match(/\b(\d{1,3}\.\d{1,2})\b/g);
    if (nums?.length) return { value: parseFloat(nums[0]), prev: nums[1] ? parseFloat(nums[1]) : null };
    return { value: null, prev: null };
  } catch { return { value: null, prev: null }; }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

type Obs = { date: string; value: number };

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

function toIndicatorPct(obs: Obs[]) {
  if (obs.length < 2) return null;
  const pctObs: Obs[] = obs.slice(0, -1).map((cur, i) => ({
    date:  cur.date,
    value: parseFloat(((cur.value / obs[i + 1].value - 1) * 100).toFixed(3)),
  }));
  return toIndicator(pctObs);
}

function toPmiIndicator(raw: { value: number | null; prev: number | null }) {
  if (raw.value === null) return null;
  const surprise = raw.prev !== null ? parseFloat((raw.value - raw.prev).toFixed(2)) : null;
  return {
    value:       raw.value,
    prev:        raw.prev,
    surprise,
    trend:       surprise !== null ? (surprise > 0 ? "up" : surprise < 0 ? "down" : "flat") as "up"|"down"|"flat" : null,
    lastUpdated: null as string | null,
  };
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

  // policyRate / unemployment / retailSales → already % → toIndicator
  // cpiCore / gdp / employment → index/level → toIndicatorPct
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
    // CPI: Eurostat HICP MoM% (RCH_MOM = rate of change month-on-month, déjà en %)
    // freq=M et unit=RCH_MOM garantissent que chaque dimension ≤ 1 valeur
    // → position dans value[] = indice temporel, pas de décalage multi-dim.
    if (!indicators.cpiCore) {
      const hicp = await eurostatSorted("prc_hicp_mmr", {
        geo: "EA20", coicop: "CP00", unit: "RCH_MOM", freq: "M",
      });
      indicators.cpiCore = toIndicator(hicp);
    }

    // GDP: Eurostat QoQ% directement (CLV_PCH_PRE = % variation vs période précédente)
    // → toIndicator suffit, pas besoin de toIndicatorPct
    if (!indicators.gdp) {
      const gdpObs = await eurostatSorted("namq_10_gdp", {
        geo: "EA20", unit: "CLV_PCH_PRE", s_adj: "SCA", na_item: "B1GQ", freq: "Q",
      }, 6);
      indicators.gdp = toIndicator(gdpObs);
    }

    // Unemployment: Eurostat monthly SA rate
    if (!indicators.unemployment) {
      const unObs = await eurostatSorted("une_rt_m", {
        geo: "EA20", s_adj: "SA", age: "TOTAL", sex: "T", unit: "PC_ACT", freq: "M",
      });
      indicators.unemployment = toIndicator(unObs);
    }
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

  // ── PMI : ForexFactory (semaine courante) + fallback TE scraping ───────────
  const [ffPMI, pmiMfgRaw, pmiSvcRaw] = await Promise.all([
    fetchFFPMI(currency),
    scrapePMI(currency, "manufacturing-pmi"),
    scrapePMI(currency, "services-pmi"),
  ]);

  indicators.pmiMfg      = ffPMI.mfg  ? toPmiIndicator(ffPMI.mfg)  : toPmiIndicator(pmiMfgRaw);
  indicators.pmiServices = ffPMI.svc  ? toPmiIndicator(ffPMI.svc)  : toPmiIndicator(pmiSvcRaw);

  // Stale-if-error : si tous les indicateurs sont null (panne API), renvoie le cache précédent
  const hasAnyValue = Object.values(indicators).some((v) => v !== null);
  if (!hasAnyValue && staleCache) {
    return NextResponse.json({ ...staleCache.data, stale: true });
  }

  const data = { currency, indicators, fetchedAt: new Date().toISOString() };
  _cache.set(currency, { data, ts: Date.now() });
  return NextResponse.json(data);
}
