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
