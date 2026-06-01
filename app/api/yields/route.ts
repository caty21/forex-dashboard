import { NextResponse } from "next/server";
import { fetchTEBondYields } from "@/lib/tebonds";

// 10Y sovereign yields — source unique : tradingeconomics.com/bonds (HTML statique)
// Remplace les sources précédentes (FRED DGS10 + IRLTLT01XXM156N mensuel + ECB/BoE APIs)
// qui avaient des décalages allant de 1 jour (FRED daily) à 1 mois (FRED monthly JPY/CHF/AUD/NZD).
// TE bonds = données du jour pour les 8 devises, cache 1h.

export async function GET() {
  const bondData = await fetchTEBondYields();

  const yields: Record<string, number | null> = {
    USD: bondData.USD?.yield10y ?? null,
    EUR: bondData.EUR?.yield10y ?? null,
    GBP: bondData.GBP?.yield10y ?? null,
    JPY: bondData.JPY?.yield10y ?? null,
    CHF: bondData.CHF?.yield10y ?? null,
    CAD: bondData.CAD?.yield10y ?? null,
    AUD: bondData.AUD?.yield10y ?? null,
    NZD: bondData.NZD?.yield10y ?? null,
  };

  const dayDeltas: Record<string, number | null> = {
    USD: bondData.USD?.dayDelta ?? null,
    EUR: bondData.EUR?.dayDelta ?? null,
    GBP: bondData.GBP?.dayDelta ?? null,
    JPY: bondData.JPY?.dayDelta ?? null,
    CHF: bondData.CHF?.dayDelta ?? null,
    CAD: bondData.CAD?.dayDelta ?? null,
    AUD: bondData.AUD?.dayDelta ?? null,
    NZD: bondData.NZD?.dayDelta ?? null,
  };

  // Spread vs USD (bps)
  const usd = yields.USD;
  const spreads: Record<string, number | null> = {};
  for (const [ccy, yld] of Object.entries(yields)) {
    if (ccy === "USD" || yld === null || usd === null) {
      spreads[ccy] = null;
    } else {
      spreads[ccy] = Math.round((yld - usd) * 100);
    }
  }

  return NextResponse.json({ yields, spreads, dayDeltas, timestamp: Date.now() });
}
