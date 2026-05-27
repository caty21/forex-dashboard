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
  // Approximate DXY from fetched pairs (no extra AV call needed)
  // DXY = 50.14 × EUR^0.576 × (1/JPY)^0.136 × GBP^0.119 × (1/CAD)^0.091 × (1/CHF)^0.036
  const e = rates.EUR, g = rates.GBP, j = rates.JPY, c = rates.CAD, ch = rates.CHF;
  const dxy = (e && g && j && c && ch)
    ? parseFloat((50.14348112 * Math.pow(e,0.576) * Math.pow(1/j,0.136) * Math.pow(g,0.119) * Math.pow(1/c,0.091) * Math.pow(1/ch,0.036)).toFixed(3))
    : null;
  return { rates, dxy, base: "USD", source: "alphavantage", timestamp: Date.now() };
}

async function fetchFrankfurter() {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", { next: { revalidate: 86400 } });
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
    const data = await res.json();
    return NextResponse.json({ rates: data.rates, dxy: null, base: "USD", source: "frankfurter", date: data.date });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
