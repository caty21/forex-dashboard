// lib/tecpi.ts
// Scrape deux pages TE country-list en parallèle :
//   - core-inflation-rate  → cpiCore YoY
//   - inflation-rate-mom   → cpiMoM
// Une seule requête HTTP par page (cache 6h) — remplace les séries FRED mensuelles
// qui avaient jusqu'à 1.5 an de retard (GBP/JPY/CHF/CAD/AUD/NZD stale FRED).

import type { Currency } from "./types";

const TE_COUNTRY_CPI: Record<Currency, string> = {
  USD: "United States",
  EUR: "Euro Area",
  GBP: "United Kingdom",
  JPY: "Japan",
  CHF: "Switzerland",
  CAD: "Canada",
  AUD: "Australia",
  NZD: "New Zealand",
};

export interface CoreCPIEntry {
  value:    number;   // YoY %
  prev:     number;   // valeur précédente
  refMonth: string;   // "2026-04-01"
}

export type CoreCPIMap = Partial<Record<Currency, CoreCPIEntry>>;

export interface MoMCPIEntry {
  value:    number;         // MoM % (ou QoQ pour AUD/NZD)
  prev:     number | null;  // période précédente (null si calculé depuis index)
  refMonth: string;
  isQoQ?:   boolean;        // true pour AUD et NZD (données trimestrielles)
}

export type MoMCPIMap = Partial<Record<Currency, MoMCPIEntry>>;

// Convertit "Apr/26" → "2026-04-01"
function parseRefDate(raw: string): string {
  const MONTHS: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const m = raw.match(/([A-Za-z]+)\/(\d{2})/);
  if (!m) return "";
  const month = MONTHS[m[1]] ?? "01";
  const year  = `20${m[2]}`;
  return `${year}-${month}-01`;
}

export async function fetchTECoreInflation(): Promise<CoreCPIMap> {
  try {
    const res = await fetch(
      "https://tradingeconomics.com/country-list/core-inflation-rate?continent=world",
      {
        next: { revalidate: 21600 }, // 6h — données mensuelles, inutile de re-fetcher trop souvent
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) {
      console.warn("[tecpi] HTTP", res.status);
      return {};
    }
    const html = await res.text();
    return parseCoreInflationHTML(html);
  } catch (err) {
    console.error("[tecpi] error:", err);
    return {};
  }
}

// ── Inflation Rate YoY (headline) ────────────────────────────────────────────

export async function fetchTEInflationYoY(): Promise<CoreCPIMap> {
  try {
    const res = await fetch(
      "https://tradingeconomics.com/country-list/inflation-rate?continent=world",
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) { console.warn("[tecpi-yoy] HTTP", res.status); return {}; }
    const html = await res.text();
    return parseCoreInflationHTML(html); // même structure de parsing
  } catch (err) {
    console.error("[tecpi-yoy] error:", err);
    return {};
  }
}

// ── CPI Index → MoM% ─────────────────────────────────────────────────────────
// Scrape country-list/consumer-price-index-cpi
// Calcule MoM% = (Last - Previous) / Previous × 100
// Retourne aussi les valeurs brutes pour le tooltip

export interface CPIIndexEntry {
  momPct:   number;   // MoM% calculé
  rawLast:  number;   // valeur brute (index points)
  rawPrev:  number;
  refMonth: string;
}

export type CPIIndexMap = Partial<Record<Currency, CPIIndexEntry>>;

export async function fetchTECPIIndex(): Promise<CPIIndexMap> {
  try {
    const res = await fetch(
      "https://tradingeconomics.com/country-list/consumer-price-index-cpi?continent=world",
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) { console.warn("[tecpi-idx] HTTP", res.status); return {}; }
    const html = await res.text();
    return parseCPIIndexHTML(html, TE_COUNTRY_CPI);
  } catch (err) {
    console.error("[tecpi-idx] error:", err);
    return {};
  }
}

function parseCPIIndexHTML(html: string, countryMap: Record<Currency, string>): CPIIndexMap {
  const result: CPIIndexMap = {};
  const seen = new Set<Currency>();
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;

  while ((m = rowPattern.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    for (const [ccy, country] of Object.entries(countryMap) as [Currency, string][]) {
      if (seen.has(ccy)) continue;
      if (!text.startsWith(country)) continue;

      const nums      = text.match(/-?\d+(?:\.\d+)?/g);
      const dateMatch = text.match(/([A-Za-z]{3}\/\d{2})/);

      if (nums && nums.length >= 2) {
        const rawLast = parseFloat(nums[0]);
        const rawPrev = parseFloat(nums[1]);
        if (rawPrev !== 0) {
          result[ccy] = {
            momPct:   parseFloat(((rawLast - rawPrev) / rawPrev * 100).toFixed(3)),
            rawLast,
            rawPrev,
            refMonth: dateMatch ? parseRefDate(dateMatch[1]) : "",
          };
          seen.add(ccy);
        }
      }
      break;
    }
    if (seen.size === 8) break;
  }
  return result;
}

// ── Core Consumer Prices index → MoM% (depuis pages individuelles) ───────────
// La country-list arrondit à l'entier → 0% faux pour CAD/JPY/CHF.
// On scrape la meta description de chaque page individuelle (décimales disponibles).
// Format meta : "...increased to 0.40 percent in April from 0.20 percent..."
// Pour CHF on utilise /switzerland/core-consumer-prices (pas de page -mom)

// Pages existantes avec % direct : USD, EUR, GBP, CAD
// Pages index seulement (calcul delta) : JPY, CHF, AUD (QoQ), NZD (QoQ)
const TE_CORE_MOM_SLUG: Record<Currency, string> = {
  USD: "united-states/core-inflation-rate-mom",
  EUR: "euro-area/core-inflation-rate-mom",
  GBP: "united-kingdom/core-inflation-rate-mom",
  JPY: "japan/core-consumer-prices",        // pas de page -mom directe
  CAD: "canada/core-inflation-rate-mom",
  AUD: "australia/core-consumer-prices",    // QoQ (données trimestrielles)
  NZD: "new-zealand/core-consumer-prices",  // QoQ (données trimestrielles)
  CHF: "switzerland/core-consumer-prices",  // index → delta calculé
};

// Devises publiées en QoQ (trimestriel) plutôt que MoM
export const CORE_CPI_QOQ: Set<Currency> = new Set<Currency>(["AUD", "NZD"]);

async function fetchOneTEMeta(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 21600 },
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return "";
    const html = await res.text();
    const m = html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i)
           ?? html.match(/content=["']([^"']+)["'][^>]*name=["']description["']/i);
    return m?.[1] ?? "";
  } catch { return ""; }
}

function parseMetaForMoM(desc: string): { value: number; prev: number; isIndex?: boolean } | null {
  // Pattern 1 : "increased/decreased to X percent from Y percent"
  const p1 = desc.match(
    /(?:increased|decreased|declined|rose|fell|eased|changed)\s+to\s*([\d.]+)\s+percent[^.]*?from\s+([\d.]+)\s+percent/i
  );
  if (p1) return { value: parseFloat(p1[1]), prev: parseFloat(p1[2]) };

  // Pattern 2 : "remained unchanged at X percent" → current = prev = X, delta = 0
  const p2 = desc.match(/(?:remained unchanged at|is unchanged at)\s*([\d.]+)\s+percent/i);
  if (p2) { const v = parseFloat(p2[1]); return { value: v, prev: v }; }

  // Pattern 3 : "increased to X points from Y points" → calcul MoM% = (X-Y)/Y*100
  const p3 = desc.match(
    /(?:increased|decreased|declined|rose|fell|eased|changed)\s+to\s*([\d.]+)\s+points?[^.]*?from\s+([\d.]+)\s+points?/i
  );
  if (p3) {
    const last = parseFloat(p3[1]);
    const prev = parseFloat(p3[2]);
    if (prev !== 0) return { value: parseFloat(((last - prev) / prev * 100).toFixed(3)), prev, isIndex: true };
  }

  // Pattern 4 : "remained unchanged at X points" → delta = 0, on retourne 0
  const p4 = desc.match(/(?:remained unchanged at|is unchanged at)\s*([\d.]+)\s+points?/i);
  if (p4) return { value: 0, prev: parseFloat(p4[1]), isIndex: true };

  return null;
}

export async function fetchTECoreCPIMoM(): Promise<MoMCPIMap> {
  const entries = await Promise.all(
    (Object.entries(TE_CORE_MOM_SLUG) as [Currency, string][]).map(async ([ccy, slug]) => {
      const desc = await fetchOneTEMeta(`https://tradingeconomics.com/${slug}`);
      const parsed = parseMetaForMoM(desc);
      if (!parsed) return null;
      const MONTHS: Record<string, string> = { January:"01",February:"02",March:"03",April:"04",May:"05",June:"06",July:"07",August:"08",September:"09",October:"10",November:"11",December:"12" };
      const QUARTERS: Record<string, string> = { first:"01",second:"04",third:"07",fourth:"10" };
      const curYear = new Date().getFullYear().toString();
      // Mois courant = premier "to/at X [points/percent] in [Month]" dans la description
      const dateCurrM = desc.match(/(?:to|at)\s+[\d.]+\s+(?:points?|percent)\s+in\s+([A-Za-z]+)/i);
      // Année = "of [Year]" n'importe où
      const yearM    = desc.match(/\bof\s+(\d{4})\b/);
      // Trimestriel NZD
      const dateQ    = desc.match(/in\s+the\s+(first|second|third|fourth)\s+quarter\s+of\s+(\d{4})/i);
      let refMonth = "";
      if (dateQ) {
        refMonth = `${dateQ[2]}-${QUARTERS[dateQ[1].toLowerCase()]}-01`;
      } else if (dateCurrM) {
        const mn  = dateCurrM[1];
        const cap = mn.charAt(0).toUpperCase() + mn.slice(1).toLowerCase();
        if (MONTHS[cap]) refMonth = `${yearM?.[1] ?? curYear}-${MONTHS[cap]}-01`;
      }
      const entry: MoMCPIEntry = {
        value:   parsed.value,
        // Pour les devises index-only (JPY/CHF/AUD/NZD), parsed.prev est la valeur brute
        // de l'index, pas le MoM% précédent → on met null
        prev:    parsed.isIndex ? null : parsed.prev,
        refMonth,
        isQoQ:   CORE_CPI_QOQ.has(ccy) || undefined,
      };
      return [ccy, entry] as [Currency, MoMCPIEntry];
    })
  );

  const result: MoMCPIMap = {};
  for (const entry of entries) {
    if (entry) result[entry[0]] = entry[1];
  }
  return result;
}

// ── Core Consumer Prices index (for tooltip raw values alongside CoreMoM) ────

export async function fetchTECoreConsumerPricesIndex(): Promise<CPIIndexMap> {
  try {
    const res = await fetch(
      "https://tradingeconomics.com/country-list/core-consumer-prices?continent=world",
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) return {};
    const html = await res.text();
    return parseCPIIndexHTML(html, TE_COUNTRY_CPI);
  } catch { return {}; }
}

// ── MoM inflation rate ────────────────────────────────────────────────────────

export async function fetchTEMoMInflation(): Promise<MoMCPIMap> {
  try {
    const res = await fetch(
      "https://tradingeconomics.com/country-list/inflation-rate-mom?continent=world",
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) { console.warn("[tecpi-mom] HTTP", res.status); return {}; }
    const html = await res.text();
    return parseMoMHTML(html);
  } catch (err) {
    console.error("[tecpi-mom] error:", err);
    return {};
  }
}

function parseMoMHTML(html: string, countryMap: Record<Currency, string> = TE_COUNTRY_CPI): MoMCPIMap {
  const result: MoMCPIMap = {};
  const seen = new Set<Currency>();
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;

  while ((m = rowPattern.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const textLower = text.toLowerCase();

    for (const [ccy, country] of Object.entries(countryMap) as [Currency, string][]) {
      if (seen.has(ccy)) continue;
      if (!textLower.startsWith(country.toLowerCase())) continue;

      const nums      = text.match(/-?\d+\.?\d*/g);
      const dateMatch = text.match(/([A-Za-z]{3}\/\d{2})/);

      if (nums && nums.length >= 2) {
        result[ccy] = {
          value:    parseFloat(nums[0]),
          prev:     parseFloat(nums[1]),
          refMonth: dateMatch ? parseRefDate(dateMatch[1]) : "",
        };
        seen.add(ccy);
      }
      break;
    }
    if (seen.size === 8) break;
  }
  return result;
}

// ── PPI MoM ──────────────────────────────────────────────────────────────────

export async function fetchTEPPIMoM(): Promise<MoMCPIMap> {
  try {
    const res = await fetch(
      "https://tradingeconomics.com/country-list/producer-price-inflation-mom?continent=world",
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) { console.warn("[tecpi-ppi] HTTP", res.status); return {}; }
    const html = await res.text();
    return parseMoMHTML(html); // case-insensitive → "Euro area" matche "Euro Area"
  } catch (err) {
    console.error("[tecpi-ppi] error:", err);
    return {};
  }
}

// ── Core YoY ──────────────────────────────────────────────────────────────────

function parseCoreInflationHTML(html: string): CoreCPIMap {
  const result: CoreCPIMap = {};
  const seen = new Set<Currency>();

  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;

  while ((m = rowPattern.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    for (const [ccy, country] of Object.entries(TE_COUNTRY_CPI) as [Currency, string][]) {
      if (seen.has(ccy)) continue;
      if (!text.startsWith(country)) continue;

      // Format : "Country  Last  Previous  Mon/YY  %"
      // Last / Previous peuvent être négatifs (ex : Morocco -0.3)
      const nums = text.match(/-?\d+\.?\d*/g);
      // Chercher la date de référence (format Mon/YY)
      const dateMatch = text.match(/([A-Za-z]{3}\/\d{2})/);

      if (nums && nums.length >= 2) {
        result[ccy] = {
          value:    parseFloat(nums[0]),
          prev:     parseFloat(nums[1]),
          refMonth: dateMatch ? parseRefDate(dateMatch[1]) : "",
        };
        seen.add(ccy);
      }
      break;
    }

    if (seen.size === 8) break;
  }

  return result;
}

// ── Core CPI YoY individuel (valeur précise + consensus via TEForecast) ───────
// Utilisé pour EUR (fiabilité) et JPY (consensus).
// Retourne { value, consensus, refMonth } — prev reste fourni par le country-list.

export interface CoreCPIPageEntry {
  value:     number;
  consensus: number | null;  // TEForecast[0] si disponible
  refMonth:  string;
}

const TE_CORE_YOY_SLUG: Partial<Record<Currency, string>> = {
  EUR: "euro-area/core-inflation-rate",
  JPY: "japan/core-inflation-rate",
};

// Pages individuelles pour Inflation Rate YoY (headline) — plus à jour que le country-list
const TE_INFLATION_YOY_SLUG: Partial<Record<Currency, string>> = {
  EUR: "euro-area/inflation-cpi",
  GBP: "united-kingdom/inflation-cpi",
  JPY: "japan/inflation-cpi",
};


export async function fetchTECoreInflationPages(): Promise<Partial<Record<Currency, CoreCPIPageEntry>>> {
  const MONTHS: Record<string, string> = { January:"01",February:"02",March:"03",April:"04",May:"05",June:"06",July:"07",August:"08",September:"09",October:"10",November:"11",December:"12" };

  const entries = await Promise.all(
    (Object.entries(TE_CORE_YOY_SLUG) as [Currency, string][]).map(async ([ccy, slug]) => {
      try {
        const res = await fetch(`https://tradingeconomics.com/${slug}`, {
          next: { revalidate: 21600 },
          headers: {
            "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
            "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        if (!res.ok) return null;
        const html = await res.text();

        // Meta description → valeur courante
        const metaM = html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i)
                   ?? html.match(/content=["']([^"']+)["'][^>]*name=["']description["']/i);
        const desc = metaM?.[1] ?? "";
        const valM = desc.match(/(?:increased|decreased|declined|rose|fell|eased|remained unchanged at)\s+([\d.]+)\s+percent/i);
        if (!valM) return null;
        const value = parseFloat(valM[1]);

        // Date : "in [Month] of [Year]"
        const dateM = desc.match(/in\s+([A-Za-z]+)\s+of\s+(\d{4})/i);
        let refMonth = "";
        if (dateM && MONTHS[dateM[1]]) refMonth = `${dateM[2]}-${MONTHS[dateM[1]]}-01`;

        // Consensus = TEForecast[0]
        let consensus: number | null = null;
        const fcM = html.match(/TEForecast\s*=\s*\[\s*([\d.,\s]+)\]/);
        if (fcM) {
          const first = fcM[1].split(",")[0].trim();
          if (first) consensus = parseFloat(first);
        }

        return [ccy, { value, consensus, refMonth }] as [Currency, CoreCPIPageEntry];
      } catch { return null; }
    })
  );

  const result: Partial<Record<Currency, CoreCPIPageEntry>> = {};
  for (const e of entries) if (e) result[e[0]] = e[1];
  return result;
}

// ── Inflation Rate YoY individuel (EUR valeur à jour + GBP/JPY consensus) ────
// Meta format : "increased to X.XX percent in [Month] from Y.YY percent in [PrevMonth] of [Year]"

export interface InflationYoYPageEntry {
  value:     number;
  prev:      number | null;
  consensus: number | null;
  refMonth:  string;
}

export async function fetchTEInflationYoYPages(): Promise<Partial<Record<Currency, InflationYoYPageEntry>>> {
  const MONTHS: Record<string, string> = { January:"01",February:"02",March:"03",April:"04",May:"05",June:"06",July:"07",August:"08",September:"09",October:"10",November:"11",December:"12" };

  const entries = await Promise.all(
    (Object.entries(TE_INFLATION_YOY_SLUG) as [Currency, string][]).map(async ([ccy, slug]) => {
      try {
        const res = await fetch(`https://tradingeconomics.com/${slug}`, {
          next: { revalidate: 21600 },
          headers: {
            "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
            "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        if (!res.ok) return null;
        const html = await res.text();

        const metaM = html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i)
                   ?? html.match(/content=["']([^"']+)["'][^>]*name=["']description["']/i);
        const desc = metaM?.[1] ?? "";

        // "increased/decreased to X percent in [Month] from Y percent in [PrevMonth] of [Year]"
        const p1 = desc.match(
          /(?:increased|decreased|declined|rose|fell|eased|changed)\s+to\s+([\d.]+)\s+percent[^.]*?from\s+([\d.]+)\s+percent/i
        );
        // "remained unchanged at X percent in [Month]"
        const p2 = !p1 ? desc.match(/(?:remained unchanged at|is unchanged at)\s*([\d.]+)\s+percent/i) : null;

        const value = p1 ? parseFloat(p1[1]) : p2 ? parseFloat(p2[1]) : null;
        const prev  = p1 ? parseFloat(p1[2]) : p2 ? parseFloat(p2[1]) : null;
        if (value === null) return null;

        // Date : current month + year
        const dateCurrM = desc.match(/(?:to|at)\s+[\d.]+\s+percent\s+in\s+([A-Za-z]+)/i);
        const yearM     = desc.match(/\bof\s+(\d{4})\b/);
        const curYear   = new Date().getFullYear().toString();
        let refMonth = "";
        if (dateCurrM) {
          const mn  = dateCurrM[1];
          const cap = mn.charAt(0).toUpperCase() + mn.slice(1).toLowerCase();
          if (MONTHS[cap]) refMonth = `${yearM?.[1] ?? curYear}-${MONTHS[cap]}-01`;
        }

        // Consensus = TEForecast[0]
        let consensus: number | null = null;
        const fcM = html.match(/TEForecast\s*=\s*\[\s*([\d.,\s]+)\]/);
        if (fcM) {
          const first = fcM[1].split(",")[0].trim();
          if (first) consensus = parseFloat(first);
        }

        return [ccy, { value, prev, consensus, refMonth }] as [Currency, InflationYoYPageEntry];
      } catch { return null; }
    })
  );

  const result: Partial<Record<Currency, InflationYoYPageEntry>> = {};
  for (const e of entries) if (e) result[e[0]] = e[1];
  return result;
}

// ── AUD Commodity Prices YoY ─────────────────────────────────────────────────
// Indicateur spécifique AUD : https://tradingeconomics.com/australia/commodity-prices-yoy
// Format meta : "increased to X.XX percent in [Month] from Y.YY percent in [PrevMonth] of [Year]"

export async function fetchTEAUDCommodityYoY(): Promise<InflationYoYPageEntry | null> {
  const MONTHS: Record<string, string> = { January:"01",February:"02",March:"03",April:"04",May:"05",June:"06",July:"07",August:"08",September:"09",October:"10",November:"11",December:"12" };
  try {
    const res = await fetch("https://tradingeconomics.com/australia/commodity-prices-yoy", {
      next: { revalidate: 21600 },
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const metaM = html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i)
               ?? html.match(/content=["']([^"']+)["'][^>]*name=["']description["']/i);
    const desc = metaM?.[1] ?? "";

    const p1 = desc.match(/(?:increased|decreased|declined|rose|fell|eased|changed)\s+to\s+([\d.]+)\s+percent[^.]*?from\s+([\d.]+)\s+percent/i);
    const p2 = !p1 ? desc.match(/(?:remained unchanged at|is unchanged at)\s*([\d.]+)\s+percent/i) : null;
    const value = p1 ? parseFloat(p1[1]) : p2 ? parseFloat(p2[1]) : null;
    const prev  = p1 ? parseFloat(p1[2]) : p2 ? parseFloat(p2[1]) : null;
    if (value === null) return null;

    const dateCurrM = desc.match(/(?:to|at)\s+[\d.]+\s+percent\s+in\s+([A-Za-z]+)/i);
    const yearM     = desc.match(/\bof\s+(\d{4})\b/);
    const curYear   = new Date().getFullYear().toString();
    let refMonth = "";
    if (dateCurrM) {
      const mn  = dateCurrM[1];
      const cap = mn.charAt(0).toUpperCase() + mn.slice(1).toLowerCase();
      if (MONTHS[cap]) refMonth = `${yearM?.[1] ?? curYear}-${MONTHS[cap]}-01`;
    }

    let consensus: number | null = null;
    const fcM = html.match(/TEForecast\s*=\s*\[\s*([\d.,\s]+)\]/);
    if (fcM) {
      const first = fcM[1].split(",")[0].trim();
      if (first) consensus = parseFloat(first);
    }

    return { value, prev, consensus, refMonth };
  } catch { return null; }
}

// ── Unemployment Rate ─────────────────────────────────────────────────────────
// Source : https://tradingeconomics.com/country-list/unemployment-rate?continent=world
// Une seule requête HTTP (cache 6h) pour les 8 devises.
// Donne le taux national officiel (ex : SECO ~3% pour CHF) au lieu du taux ILO harmonisé
// FRED qui peut être de 2-3 pp supérieur (ex : LRHUTTTTCHQ156S ~5% pour CHF).

export async function fetchTEUnemploymentRate(): Promise<CoreCPIMap> {
  try {
    const res = await fetch(
      "https://tradingeconomics.com/country-list/unemployment-rate?continent=world",
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) { console.warn("[tecpi-une] HTTP", res.status); return {}; }
    const html = await res.text();
    return parseCoreInflationHTML(html);
  } catch (err) {
    console.error("[tecpi-une] error:", err);
    return {};
  }
}

// ── STIR — Taux interbancaire 3 mois ─────────────────────────────────────────
// Source : https://tradingeconomics.com/country-list/3-month-interbank-rate
// Donne le taux de marché à 3 mois (SOFR 3M, EURIBOR 3M, SONIA 3M, TIBOR 3M…)
// pour les 8 devises en une seule requête.
// Interprétation :
//   STIR > taux directeur  → marché price des hausses → signal hawkish
//   STIR < taux directeur  → marché price des baisses → signal dovish
//   STIR en hausse         → conditions de crédit plus restrictives (prêter = plus risqué/cher)
//   STIR en baisse         → conditions de crédit plus souples (prêter = plus sûr/moins cher)

export async function fetchTESTIRRate(): Promise<CoreCPIMap> {
  try {
    const res = await fetch(
      "https://tradingeconomics.com/country-list/3-month-interbank-rate?continent=world",
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) { console.warn("[tecpi-stir] HTTP", res.status); return {}; }
    const html = await res.text();
    return parseCoreInflationHTML(html);
  } catch (err) {
    console.error("[tecpi-stir] error:", err);
    return {};
  }
}

// ── GDP Growth Rate QoQ% ──────────────────────────────────────────────────────
// Source : https://tradingeconomics.com/country-list/gdp-growth-rate
// Une seule requête HTTP (cache 6h) couvre les 8 devises.
// Remplace les séries FRED qui retournent souvent un indice niveau à la place
// du QoQ% réel, et qui sont en retard d'1 à 4 trimestres selon la devise.

export async function fetchTEGDPGrowthRate(): Promise<CoreCPIMap> {
  try {
    const res = await fetch(
      "https://tradingeconomics.com/country-list/gdp-growth-rate?continent=world",
      {
        next: { revalidate: 21600 },
        headers: {
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) { console.warn("[tecpi-gdp] HTTP", res.status); return {}; }
    const html = await res.text();
    return parseCoreInflationHTML(html);
  } catch (err) {
    console.error("[tecpi-gdp] error:", err);
    return {};
  }
}

// ── Employment Change — pages individuelles TradingEconomics ─────────────────
// USD : /united-states/non-farm-payrolls → en milliers, MoM
// GBP : /united-kingdom/employment-change → en milliers, MoM (3 mois glissants)
// AUD : /australia/employment-change → en personnes → /1000
// EUR : /euro-area/employment-change → QoQ%

export interface TEEmploymentEntry {
  value: number;   // k pour USD/GBP/AUD, QoQ% pour EUR
  prev:  number | null;
}

const TE_EMP_CONFIG: Partial<Record<Currency, { slug: string; unitKw: string; divisor: number; precision: number }>> = {
  USD: { slug: "united-states/non-farm-payrolls",    unitKw: "thousand", divisor: 1,    precision: 0 },
  GBP: { slug: "united-kingdom/employment-change",   unitKw: "thousand", divisor: 1,    precision: 0 },
  AUD: { slug: "australia/employment-change",         unitKw: "person",   divisor: 1000, precision: 1 },
  EUR: { slug: "euro-area/employment-change",         unitKw: "percent",  divisor: 1,    precision: 2 },
};

export async function fetchTEEmploymentChange(): Promise<Partial<Record<Currency, TEEmploymentEntry>>> {
  const headers = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const entries = await Promise.all(
    (Object.entries(TE_EMP_CONFIG) as [Currency, NonNullable<typeof TE_EMP_CONFIG[Currency]>][])
      .map(async ([ccy, { slug, unitKw, divisor, precision }]) => {
        try {
          const res = await fetch(`https://tradingeconomics.com/${slug}`, {
            next: { revalidate: 21600 },
            headers,
          });
          if (!res.ok) return null;
          const html = await res.text();

          // Current value from meta description
          const metaM = html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i)
                     ?? html.match(/content=["']([^"']+)["'][^>]*name=["']description["']/i);
          const desc = metaM?.[1] ?? "";
          const incrM = desc.match(/increased\s+by\s+([\d,]+\.?\d*)/i);
          const decrM = desc.match(/decreased\s+by\s+([\d,]+\.?\d*)/i);
          if (!incrM && !decrM) return null;

          const sign    = incrM ? 1 : -1;
          const absVal  = parseFloat((incrM?.[1] ?? decrM![1]).replace(/,/g, ""));
          const curRaw  = sign * absVal;

          // Find previous from table: groups of (value, prev, unit-label)
          const tdVals: string[] = [];
          const tdRe = /<td[^>]*>([^<]+)<\/td>/g;
          let m: RegExpExecArray | null;
          while ((m = tdRe.exec(html)) !== null) tdVals.push(m[1].trim());

          let prevRaw: number | null = null;
          for (let i = 0; i < tdVals.length - 2; i++) {
            const a = parseFloat(tdVals[i].replace(/,/g, ""));
            const b = parseFloat(tdVals[i + 1].replace(/,/g, ""));
            const c = tdVals[i + 2].toLowerCase();
            if (isNaN(a) || isNaN(b) || !c.includes(unitKw)) continue;
            const tol = Math.max(1, Math.abs(curRaw) * 0.02);
            if (Math.abs(a - curRaw) <= tol) { prevRaw = b; break; }
          }

          return [ccy, {
            value: parseFloat((curRaw  / divisor).toFixed(precision)),
            prev:  prevRaw !== null ? parseFloat((prevRaw / divisor).toFixed(precision)) : null,
          }] as [Currency, TEEmploymentEntry];
        } catch { return null; }
      })
  );

  const result: Partial<Record<Currency, TEEmploymentEntry>> = {};
  for (const e of entries) if (e) result[e[0]] = e[1];
  return result;
}
