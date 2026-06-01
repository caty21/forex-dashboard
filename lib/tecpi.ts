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
  value:    number;   // MoM %
  prev:     number;
  refMonth: string;
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

const TE_CORE_MOM_SLUG: Record<Currency, string> = {
  USD: "united-states/core-inflation-rate-mom",
  EUR: "euro-area/core-inflation-rate-mom",
  GBP: "united-kingdom/core-inflation-rate-mom",
  JPY: "japan/core-inflation-rate-mom",
  CAD: "canada/core-inflation-rate-mom",
  AUD: "australia/core-inflation-rate-mom",
  NZD: "new-zealand/core-inflation-rate-mom",
  CHF: "switzerland/core-consumer-prices", // index → MoM calculé
};

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

function parseMetaForMoM(desc: string): { value: number; prev: number } | null {
  // Pattern : "increased to X percent ... from Y percent"
  const m = desc.match(
    /(?:increased|decreased|declined|rose|fell|remained|eased|changed)\s+to\s*([\d.]+)\s+percent[^.]*from\s+([\d.]+)\s+percent/i
  );
  if (m) return { value: parseFloat(m[1]), prev: parseFloat(m[2]) };

  // Pattern alternatif pour les index : "increased to X from Y points"
  const m2 = desc.match(
    /(?:increased|decreased|declined|rose|fell|remained|eased|changed)\s+to\s*([\d.]+)\s+(?:points?|index)[^.]*from\s+([\d.]+)/i
  );
  if (m2) {
    const last = parseFloat(m2[1]);
    const prev = parseFloat(m2[2]);
    if (prev !== 0) return { value: parseFloat(((last - prev) / prev * 100).toFixed(3)), prev: prev };
  }
  return null;
}

export async function fetchTECoreCPIMoM(): Promise<MoMCPIMap> {
  const entries = await Promise.all(
    (Object.entries(TE_CORE_MOM_SLUG) as [Currency, string][]).map(async ([ccy, slug]) => {
      const desc = await fetchOneTEMeta(`https://tradingeconomics.com/${slug}`);
      const parsed = parseMetaForMoM(desc);
      if (!parsed) return null;
      // Extraire la date de référence depuis la meta (ex: "in April from ... in March of 2026")
      const dateM = desc.match(/in\s+([A-Za-z]+)\s+(?:of\s+)?(\d{4})/i);
      const MONTHS: Record<string, string> = { January:"01",February:"02",March:"03",April:"04",May:"05",June:"06",July:"07",August:"08",September:"09",October:"10",November:"11",December:"12" };
      const refMonth = dateM ? `${dateM[2]}-${MONTHS[dateM[1]] ?? "01"}-01` : "";
      return [ccy, { value: parsed.value, prev: parsed.prev, refMonth }] as [Currency, MoMCPIEntry];
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

function parseMoMHTML(html: string): MoMCPIMap {
  const result: MoMCPIMap = {};
  const seen = new Set<Currency>();
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;

  while ((m = rowPattern.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    for (const [ccy, country] of Object.entries(TE_COUNTRY_CPI) as [Currency, string][]) {
      if (seen.has(ccy)) continue;
      if (!text.startsWith(country)) continue;

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
