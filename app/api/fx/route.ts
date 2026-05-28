import { NextResponse } from "next/server";

// AV primary (real-time) → Frankfurter fallback (ECB daily)
// AV free plan: 25 req/day, 5 req/min
// With revalidate:86400, server fetches each URL at most once per day → 7 calls/day total
const CURRENCIES = ["EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];
const AV_BASE    = "https://www.alphavantage.co/query";

export async function GET() {
  const avKey = process.env.ALPHA_VANTAGE_KEY;
  if (avKey) {
    const result = await fetchAV(avKey);
    if (result) return NextResponse.json(result);
  }
  return fetchFrankfurter();
}

async function fetchAV(apiKey: string) {
  // Sequential (not parallel) to respect AV's 5 req/min limit
  const rates: Record<string, number> = {};
  for (const ccy of CURRENCIES) {
    try {
      const url = `${AV_BASE}?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=${ccy}&apikey=${apiKey}`;
      const res  = await fetch(url, { next: { revalidate: 86400 } }); // 24h server cache
      if (!res.ok) continue;
      const json = await res.json();
      const rate = json?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"];
      if (rate) rates[ccy] = parseFloat(rate);
    } catch { /* skip on error */ }
  }
  if (Object.keys(rates).length < 4) return null; // too many failures → fall back
  // DXY = 50.14 × EURUSD^-0.576 × USDJPY^0.136 × GBPUSD^-0.119 × USDCAD^0.091 × USDCHF^0.036
  // AV from_currency=USD → e=USD/EUR, j=JPY/USD, g=USD/GBP, c=CAD/USD, ch=CHF/USD
  // ⟹ EURUSD=1/e → e^0.576 ; USDJPY=j → j^0.136 ; GBPUSD=1/g → g^0.119
  //    USDCAD=c → c^0.091 ; USDCHF=ch → ch^0.036
  const e = rates.EUR, g = rates.GBP, j = rates.JPY, c = rates.CAD, ch = rates.CHF;
  const dxy = (e && g && j && c && ch)
    ? parseFloat((50.14348112 * Math.pow(e,0.576) * Math.pow(j,0.136) * Math.pow(g,0.119) * Math.pow(c,0.091) * Math.pow(ch,0.036)).toFixed(2))
    : null;
  return { rates, dxy, base: "USD", source: "alphavantage", timestamp: Date.now() };
}

async function fetchFrankfurter() {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", { next: { revalidate: 86400 } });
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
    const data  = await res.json();
    const rates = data.rates as Record<string, number>;

    // DXY approximé depuis les taux ECB (même formule que la branche AV)
    // rates.X = "1 USD = X unités" — même convention que AV
    const e = rates.EUR, g = rates.GBP, j = rates.JPY, c = rates.CAD, ch = rates.CHF;
    // DXY = 50.14 × EURUSD^-0.576 × USDJPY^0.136 × GBPUSD^-0.119 × USDCAD^0.091 × USDCHF^0.036
    // Frankfurter from=USD → e=USD/EUR, j=JPY/USD, g=USD/GBP, c=CAD/USD, ch=CHF/USD
    // ⟹ EURUSD=1/e → e^0.576 ; USDJPY=j → j^0.136 ; GBPUSD=1/g → g^0.119
    //   USDCAD=c → c^0.091 ; USDCHF=ch → ch^0.036
    const dxy = (e && g && j && c && ch)
      ? parseFloat((50.14348112 * Math.pow(e,0.576) * Math.pow(j,0.136) * Math.pow(g,0.119) * Math.pow(c,0.091) * Math.pow(ch,0.036)).toFixed(2))
      : null;

    return NextResponse.json({ rates, dxy, base: "USD", source: "frankfurter", date: data.date });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
