import { NextResponse } from "next/server";

const CURRENCIES = ["EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "SEK"];
const AV_BASE    = "https://www.alphavantage.co/query";

// ICE DXY official weights (USD as base, weights sum to 1)
// EUR and GBP are quote currencies in their conventional pairs (EURUSD, GBPUSD)
// so their rates from Frankfurter/AV (USD→CCY) are already the inverse → positive exponents
const DXY_WEIGHTS = {
  EUR: 0.576,
  JPY: 0.136,
  GBP: 0.119,
  CAD: 0.091,
  SEK: 0.042,
  CHF: 0.036,
};

function computeDxy(rates: Record<string, number>): number | null {
  const required = ["EUR", "GBP", "JPY", "CAD", "CHF", "SEK"];
  if (required.some((ccy) => rates[ccy] == null || Number.isNaN(rates[ccy]))) return null;
  const { EUR, GBP, JPY, CAD, CHF, SEK } = rates;
  return parseFloat(
    (50.14348112 *
      Math.pow(EUR, DXY_WEIGHTS.EUR) *
      Math.pow(JPY, DXY_WEIGHTS.JPY) *
      Math.pow(GBP, DXY_WEIGHTS.GBP) *
      Math.pow(CAD, DXY_WEIGHTS.CAD) *
      Math.pow(SEK, DXY_WEIGHTS.SEK) *
      Math.pow(CHF, DXY_WEIGHTS.CHF)
    ).toFixed(2)
  );
}

// ── Yahoo Finance — DX=F (ICE Dollar Index Futures, temps réel) ──────────────
async function fetchYahooDXY(): Promise<{ value: number | null; delta: number | null }> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent("DX=F")}?interval=1d&range=2d`;
    const res = await fetch(url, {
      next: { revalidate: 300 },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ForexDashboard/1.0)" },
    });
    if (!res.ok) return { value: null, delta: null };
    const data  = await res.json();
    const meta  = data?.chart?.result?.[0]?.meta as {
      regularMarketPrice?: number;
      chartPreviousClose?: number;
      regularMarketPreviousClose?: number;
      previousClose?: number;
    } | undefined;
    const current   = meta?.regularMarketPrice ?? null;
    const prevClose = meta?.chartPreviousClose
                   ?? meta?.regularMarketPreviousClose
                   ?? meta?.previousClose
                   ?? null;
    if (current == null) return { value: null, delta: null };
    const delta = prevClose != null ? parseFloat((current - prevClose).toFixed(2)) : null;
    return { value: parseFloat(current.toFixed(2)), delta };
  } catch { return { value: null, delta: null }; }
}

// ── Alpha Vantage — taux FX (cache 5 min) ────────────────────────────────────
async function fetchAVRates(apiKey: string): Promise<Record<string, number> | null> {
  const rates: Record<string, number> = {};
  for (const ccy of CURRENCIES) {
    try {
      const url = `${AV_BASE}?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=${ccy}&apikey=${apiKey}`;
      const res  = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) continue;
      const json = await res.json();
      const rate = json?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"];
      if (rate) rates[ccy] = parseFloat(rate);
    } catch { /* skip */ }
  }
  return Object.keys(rates).length >= 4 ? rates : null;
}

// ── Frankfurter (ECB daily fixing) — fallback ─────────────────────────────────
async function fetchFrankfurterRates(): Promise<{ rates: Record<string, number>; date: string } | null> {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = await res.json();
    return { rates: data.rates as Record<string, number>, date: data.date as string };
  } catch { return null; }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET() {
  // Fetch Yahoo DXY in parallel with AV rates setup
  const [yahooDxy] = await Promise.all([fetchYahooDXY()]);

  const avKey = process.env.ALPHA_VANTAGE_KEY;
  let rates: Record<string, number> = {};
  let source = "none";
  let date: string | undefined;

  if (avKey) {
    const avRates = await fetchAVRates(avKey);
    if (avRates) { rates = avRates; source = "alphavantage"; }
  }
  if (Object.keys(rates).length < 4) {
    const ff = await fetchFrankfurterRates();
    if (ff) { rates = ff.rates; source = "frankfurter"; date = ff.date; }
  }

  // DXY : source directe Yahoo Finance (futures DX=F), proxy calculé en fallback
  const dxy      = yahooDxy.value ?? computeDxy(rates);
  const dxyDelta = yahooDxy.delta ?? null;

  if (dxy === null) {
    return NextResponse.json({ error: "Unable to compute DXY — données FX insuffisantes" }, { status: 502 });
  }

  return NextResponse.json({
    rates,
    dxy,
    dxyDelta,
    dxySource: yahooDxy.value != null ? "Yahoo Finance DX=F" : "ICE proxy calculé",
    basket: ["EUR", "JPY", "GBP", "CAD", "SEK", "CHF"],
    base: "USD",
    source,
    ...(date && { date }),
    timestamp: Date.now(),
  });
}
