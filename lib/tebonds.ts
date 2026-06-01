// lib/tebonds.ts
// Scrape tradingeconomics.com/bonds pour les rendements 10Y souverains des 8 devises.
// Source : HTML statique de la page (données du jour, pas de Socket.IO nécessaire)
// EUR benchmark = Allemagne (Bund 10Y)
// Cache : 1h (la page TE est mise à jour en continu mais le cache évite l'abus)

import type { Currency } from "./types";

const TE_BOND_COUNTRIES: Record<Currency, string> = {
  USD: "United States",
  EUR: "Germany",
  GBP: "United Kingdom",
  JPY: "Japan",
  AUD: "Australia",
  CAD: "Canada",
  CHF: "Switzerland",
  NZD: "New Zealand",
};

export interface BondYield {
  yield10y:  number;   // rendement 10Y en %
  dayDelta:  number;   // variation journalière en points
}

export type BondYields = Partial<Record<Currency, BondYield>>;

export async function fetchTEBondYields(): Promise<BondYields> {
  try {
    const res = await fetch("https://tradingeconomics.com/bonds", {
      next: { revalidate: 3600 },
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      console.warn("[tebonds] HTTP", res.status);
      return {};
    }
    const html = await res.text();
    return parseBondsHTML(html);
  } catch (err) {
    console.error("[tebonds] error:", err);
    return {};
  }
}

function parseBondsHTML(html: string): BondYields {
  const result: BondYields = {};
  const seen = new Set<Currency>();

  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;

  while ((m = rowPattern.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    for (const [ccy, country] of Object.entries(TE_BOND_COUNTRIES) as [Currency, string][]) {
      if (seen.has(ccy)) continue;
      if (!text.startsWith(country)) continue;

      // Ligne format : "Country  Yield  DayDelta  WeekPct  ..."
      // On cherche les deux premiers nombres avec 3+ décimales
      const nums = text.match(/(\d+\.\d{3,4})/g);
      if (nums && nums.length >= 2) {
        result[ccy] = {
          yield10y: parseFloat(nums[0]),
          dayDelta: parseFloat(nums[1]),
        };
        seen.add(ccy);
      }
      break;
    }

    if (seen.size === 8) break; // toutes les devises trouvées
  }

  return result;
}
