import { NextRequest, NextResponse } from "next/server";
import { FRED_SERIES } from "@/lib/constants";
import type { Currency } from "@/lib/types";
import cpiOverridesRaw from "@/data/cpi_overrides.json";

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

// ── ForexFactory calendar (PMI primaire) ──────────────────────────────────────

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
      title: string; country: string; actual: string; previous: string;
    }>;
    const forCcy = events.filter((e) => e.country === currency && e.actual);
    const isMfg  = (t: string) => /manufacturing\s+pmi|mfg\s+pmi/i.test(t);
    const isSvc  = (t: string) => /services?\s+pmi|ism\s+non.manufactur|composite\s+pmi/i.test(t);
    const parse  = (e: typeof forCcy[0] | undefined) => {
      if (!e?.actual) return null;
      const val  = parseFloat(e.actual);
      const prev = parseFloat(e.previous ?? "");
      return isNaN(val) ? null : { value: val, prev: isNaN(prev) ? null : prev };
    };
    return { mfg: parse(forCcy.find((e) => isMfg(e.title))), svc: parse(forCcy.find((e) => isSvc(e.title))) };
  } catch { return empty; }
}

// ── Trading Economics PMI scraping (fallback) ─────────────────────────────────

const TE_COUNTRY: Record<string, string> = {
  USD: "united-states", EUR: "euro-area", GBP: "united-kingdom",
  JPY: "japan", CHF: "switzerland", CAD: "canada", AUD: "australia", NZD: "new-zealand",
};

async function scrapePMI(
  currency: string,
  indicator: "manufacturing-pmi" | "services-pmi",
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
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ??
      html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
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
  const indicators: Record<string, IndicatorResult> = {};

  fredFields.forEach(([field], i) => {
    indicators[field] = PCT_FIELDS.has(field)
      ? toIndicatorPct(fredResults[i])
      : toIndicator(fredResults[i]);
  });

  // ── EUR alternative sources ────────────────────────────────────────────────
  if (currency === "EUR") {
    if (!indicators.cpiCore) {
      // CP0000EZCCM086NEST indisponible → fallback Eurostat prc_hicp_midx (I15 index → MoM%)
      // prc_hicp_mmr (404 depuis 2025) remplacé par prc_hicp_midx + toIndicatorPct
      const hicp = await eurostatSorted("prc_hicp_midx", {
        geo: "EA", coicop: "CP00", unit: "I15", freq: "M",
      }, 6);
      indicators.cpiCore = toIndicatorPct(hicp);
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
  // M.JP.PCPI_PC_PP_PT = CPI All Items, % change previous period (MoM%), mensuel.
  // Dernière donnée disponible : 2025-06 (délai ~2 mois vs publication MIC).
  // La série est DÉJÀ en % → toIndicator (pas toIndicatorPct).
  if (currency === "JPY" && !indicators.cpiCore) {
    const obs = await dbnomicsObs("IMF", "IFS", "M.JP.PCPI_PC_PP_PT");
    if (obs.length) indicators.cpiCore = toIndicator(obs);
  }

  // ── AUD/NZD CPI fallback — IMF/IFS (DBnomics) ────────────────────────────
  // FRED AUSCPIALLQINMEI / NZLCPIALLQINMEI = trimestriels index.
  // Si FRED échoue ou est absent, IMF/IFS fournit les données trimestrielles
  // via Q.AU.PCPI_IX / Q.NZ.PCPI_IX (index → QoQ% via toIndicatorPct).
  if (currency === "AUD" && !indicators.cpiCore) {
    const obs = await dbnomicsObs("IMF", "IFS", "Q.AU.PCPI_IX");
    if (obs.length) indicators.cpiCore = toIndicatorPct(obs);
  }
  if (currency === "NZD" && !indicators.cpiCore) {
    const obs = await dbnomicsObs("IMF", "IFS", "Q.NZ.PCPI_IX");
    if (obs.length) indicators.cpiCore = toIndicatorPct(obs);
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

  // USD — DFEDTARU = borne haute de la cible Fed (quotidien, annonce FOMC)
  if (currency === "USD") {
    const obs = await fredObs("DFEDTARU", key, 90);
    if (obs.length) indicators.policyRate = toIndicatorDeduped(obs);
  }

  // EUR — ECBDFR déjà utilisé mais mensuel → re-fetch 90j + dédupliqué
  if (currency === "EUR") {
    const obs = await fredObs("ECBDFR", key, 90);
    if (obs.length) indicators.policyRate = toIndicatorDeduped(obs);
  }

  // JPY — IRSTCB01JPM156N (taux BoJ officiel, mis à jour depuis hausses 2024)
  //       fallback IR3TIB01JPM156N (TIBOR 3M, trop élevé vs taux BoJ réel)
  if (currency === "JPY") {
    const obs = await fredObsFreshest("IRSTCB01JPM156N", "IR3TIB01JPM156N", key);
    if (obs.length) indicators.policyRate = toIndicator(obs);
  }

  // CAD — API Banque du Canada (Valet, gratuit, officiel, JSON)
  //       V80691311 = Taux directeur annoncé (pas le marché)
  if (currency === "CAD") {
    const boc = await bocRate();
    if (boc.length) indicators.policyRate = toIndicatorDeduped(boc);
  }

  // NZD — IRSTCB01NZM156N (OCR RBNZ officiel) si plus récent que IR3TIB01
  if (currency === "NZD") {
    const obs = await fredObsFreshest("IRSTCB01NZM156N", "IR3TIB01NZM156N", key);
    if (obs.length) indicators.policyRate = toIndicator(obs);
  }

  // GBP — fallback FRED si BoE API a échoué ci-dessus
  // IRSTCB01GBM156N n'existe pas sur FRED → IR3TIB01GBM156N (3M interbank mensuel, actif)
  if (currency === "GBP" && !indicators.policyRate) {
    const obs = await fredObs("IR3TIB01GBM156N", key, 6);
    if (obs.length) indicators.policyRate = toIndicator(obs);
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

  // ── PMI : ForexFactory (semaine courante) + fallback TE scraping ───────────
  const [ffPMI, pmiMfgRaw, pmiSvcRaw] = await Promise.all([
    fetchFFPMI(currency),
    scrapePMI(currency, "manufacturing-pmi"),
    scrapePMI(currency, "services-pmi"),
  ]);
  indicators.pmiMfg      = ffPMI.mfg ? toPmiIndicator(ffPMI.mfg) : toPmiIndicator(pmiMfgRaw);
  indicators.pmiServices = ffPMI.svc ? toPmiIndicator(ffPMI.svc) : toPmiIndicator(pmiSvcRaw);

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

  // Stale-if-error
  const hasAnyValue = Object.values(indicators).some((v) => v !== null);
  if (!hasAnyValue && staleCache) {
    return NextResponse.json({ ...(staleCache.data as object), stale: true });
  }

  const data = { currency, indicators, fetchedAt: new Date().toISOString() };
  _cache.set(currency, { data, ts: Date.now() });
  return NextResponse.json(data);
}
