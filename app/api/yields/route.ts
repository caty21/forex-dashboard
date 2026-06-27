import { NextResponse } from "next/server";
import { fetchTEBondYields } from "@/lib/tebonds";

export const dynamic = "force-dynamic";

// Variation % d'un pair FX vs clôture J-1 (Yahoo Finance, cache 5 min)
// Valeur positive = devise X plus forte vs USD (ou USD plus fort si pair inversé)
async function fxChangePct(symbol: string, invert = false): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
      { next: { revalidate: 300 }, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return null;
    const meta = (await res.json())?.chart?.result?.[0]?.meta as { regularMarketPrice?: number; chartPreviousClose?: number } | undefined;
    const cur  = meta?.regularMarketPrice ?? null;
    const prev = meta?.chartPreviousClose ?? null;
    if (cur === null || prev === null || prev === 0) return null;
    const pct = (cur - prev) / prev * 100;
    return parseFloat((invert ? -pct : pct).toFixed(3));
  } catch { return null; }
}

// 10Y sovereign yields — source unique : tradingeconomics.com/bonds (HTML statique)
// Remplace les sources précédentes (FRED DGS10 + IRLTLT01XXM156N mensuel + ECB/BoE APIs)
// qui avaient des décalages allant de 1 jour (FRED daily) à 1 mois (FRED monthly JPY/CHF/AUD/NZD).
// TE bonds = données du jour pour les 8 devises, cache 1h.

export async function GET() {
  const [bondData, fxResults] = await Promise.all([
    fetchTEBondYields(),
    Promise.all([
      fxChangePct("EURUSD=X"),          // EUR: positif = EUR fort
      fxChangePct("GBPUSD=X"),          // GBP: positif = GBP fort
      fxChangePct("USDJPY=X", true),    // JPY: inversé (USD/JPY haut = JPY faible)
      fxChangePct("USDCHF=X", true),    // CHF: inversé
      fxChangePct("USDCAD=X", true),    // CAD: inversé
      fxChangePct("AUDUSD=X"),          // AUD: positif = AUD fort
      fxChangePct("NZDUSD=X"),          // NZD: positif = NZD fort
    ]),
  ]);
  const [eurFx, gbpFx, jpyFx, chfFx, cadFx, audFx, nzdFx] = fxResults;

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

  // Variation FX journalière par devise (positif = devise forte vs USD)
  const fxDayPct: Record<string, number | null> = {
    USD: 0,
    EUR: eurFx,
    GBP: gbpFx,
    JPY: jpyFx,
    CHF: chfFx,
    CAD: cadFx,
    AUD: audFx,
    NZD: nzdFx,
  };

  return NextResponse.json({ yields, spreads, dayDeltas, fxDayPct, timestamp: Date.now() });
}
