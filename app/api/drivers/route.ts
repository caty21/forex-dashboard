import { NextResponse } from "next/server";

// ── Yahoo Finance v7/quote ────────────────────────────────────────────────────
// Un seul appel pour tous les prix marchés : VIX, S&P, commodités.
// Pas de clé API. Gratuit. regularMarketChange = delta vs clôture j-1.

type YQuote = {
  symbol:                     string;
  regularMarketPrice:         number;
  regularMarketChange:        number;
  regularMarketChangePercent: number;
  regularMarketPreviousClose: number;
};

async function yahooQuotes(symbols: string[]): Promise<Record<string, YQuote>> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(",")}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose`;
    const res  = await fetch(url, {
      next: { revalidate: 3600 }, // 1h — prix de marché
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
      },
    });
    if (!res.ok) return {};
    const results: YQuote[] = (await res.json())?.quoteResponse?.result ?? [];
    return Object.fromEntries(results.map((q) => [q.symbol, q]));
  } catch { return {}; }
}

function yVal(q: YQuote | undefined): number | null {
  return q?.regularMarketPrice ?? null;
}
function yDelta(q: YQuote | undefined): number | null {
  const d = q?.regularMarketChange;
  return d != null ? parseFloat(d.toFixed(2)) : null;
}
function yDeltaPct(q: YQuote | undefined): number | null {
  const p = q?.regularMarketChangePercent;
  return p != null ? parseFloat(p.toFixed(2)) : null;
}

// ── FRED (spreads crédit + taux — 24h cache) ──────────────────────────────────

async function fredObs(series: string, apiKey: string): Promise<number | null> {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    const res  = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const obs  = ((await res.json())?.observations ?? []).find(
      (o: { value: string }) => o.value !== "."
    );
    return obs ? parseFloat(obs.value) : null;
  } catch { return null; }
}

// ── CoinGecko (Bitcoin — gratuit, sans clé, cache 1h) ────────────────────────

async function coingeckoBTC() {
  try {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true";
    const res  = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return { value: null, change24h: null };
    const d    = await res.json();
    return { value: d?.bitcoin?.usd ?? null, change24h: d?.bitcoin?.usd_24h_change ?? null };
  } catch { return { value: null, change24h: null }; }
}

// ── Alpha Vantage (S&P 500 via SPY — fallback si Yahoo échoue) ───────────────

async function avGlobalQuote(symbol: string, avKey: string) {
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${avKey}`;
    const res  = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return { value: null, changePct: null };
    const q    = (await res.json())?.["Global Quote"];
    if (!q)    return { value: null, changePct: null };
    const value     = parseFloat(q["05. price"]);
    const changePct = parseFloat((q["10. change percent"] ?? "0%").replace("%", ""));
    return {
      value:     isNaN(value)     ? null : value,
      changePct: isNaN(changePct) ? null : changePct,
    };
  } catch { return { value: null, changePct: null }; }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const fredKey = process.env.FRED_API_KEY;
  const avKey   = process.env.ALPHA_VANTAGE_KEY;
  if (!fredKey) return NextResponse.json({ error: "FRED_API_KEY missing" }, { status: 500 });

  // 1. Yahoo Finance — tout en un seul appel (VIX + S&P + commodités + BTC)
  const [quotes, btcCgRes] = await Promise.all([
    yahooQuotes(["^VIX", "^GSPC", "GC=F", "SI=F", "BZ=F", "CL=F", "BTC-USD"]),
    coingeckoBTC(), // fallback si Yahoo échoue pour BTC
  ]);

  const vix    = quotes["^VIX"];
  const sp500  = quotes["^GSPC"];
  const gold   = quotes["GC=F"];
  const silver = quotes["SI=F"];
  const brent  = quotes["BZ=F"];
  const wti    = quotes["CL=F"];
  const btcYQ  = quotes["BTC-USD"]; // Yahoo primary pour BTC

  // Fallback S&P via AV si Yahoo a échoué (rare)
  const sp500Fallback = !sp500 && avKey ? await avGlobalQuote("SPY", avKey) : null;

  // 2. FRED — spreads crédit + taux (24h cache, données macro)
  const [hyRaw, igRaw, us10y, us2y] = await Promise.all([
    fredObs("BAMLH0A0HYM2", fredKey),
    fredObs("BAMLC0A0CM",   fredKey),
    fredObs("DGS10",        fredKey),
    fredObs("DGS2",         fredKey),
  ]);

  return NextResponse.json({
    // Sentiment / Risk-On
    vix:            yVal(vix),
    vixDelta:       yDelta(vix),
    sp500:          yVal(sp500) ?? sp500Fallback?.value,
    sp500Change:    yDelta(sp500),
    sp500ChangePct: yDeltaPct(sp500) ?? sp500Fallback?.changePct,
    btc:            yVal(btcYQ) ?? btcCgRes.value,
    btcChange24h:   yDeltaPct(btcYQ) ?? btcCgRes.change24h,
    // Crédit (FRED, fraction × 100 = bps)
    hySpread: hyRaw != null ? Math.round(hyRaw * 100) : null,
    igSpread: igRaw != null ? Math.round(igRaw * 100) : null,
    // Taux (dxy injecté par page.tsx depuis /api/fx)
    us10y,
    us2y,
    curveSlope: us10y !== null && us2y !== null ? Math.round((us10y - us2y) * 100) : null,
    // Commodités — Yahoo Finance (quasi temps-réel, delta vs clôture j-1)
    gold:        yVal(gold),
    goldDelta:   yDelta(gold),
    silver:      yVal(silver),
    silverDelta: yDelta(silver),
    brent:       yVal(brent),
    brentDelta:  yDelta(brent),
    wti:         yVal(wti),
    wtiDelta:    yDelta(wti),
    // Compat
    copper: null,
    timestamp: Date.now(),
  });
}
