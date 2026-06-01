import { NextResponse } from "next/server";
import { fetchTEBondYields } from "@/lib/tebonds";

// ── FRED (spreads crédit + rendements) ───────────────────────────────────────
// VIX et S&P500 ne passent plus par FRED (lag 1-2j) → Yahoo Finance (temps réel)

async function fredObs(series: string, apiKey: string): Promise<number | null> {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    const res  = await fetch(url, { next: { revalidate: 3600 } }); // 1h — FRED publie 1x/jour mais réduit le délai d'affichage
    if (!res.ok) return null;
    const obs  = ((await res.json())?.observations ?? []).find(
      (o: { value: string }) => o.value !== "."
    );
    return obs ? parseFloat(obs.value) : null;
  } catch { return null; }
}

type FredResult = { value: number | null; delta: number | null; deltaPct: number | null };

// ── Yahoo Finance (VIX, S&P 500 — temps réel via regularMarketPrice) ──────────
// Query v8 chart API : meta.regularMarketPrice + meta.chartPreviousClose
// Cache 5 min → données fraîches pendant la séance boursière

async function yahooQuote(symbol: string): Promise<FredResult> {
  const empty: FredResult = { value: null, delta: null, deltaPct: null };
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      next: { revalidate: 300 }, // cache 5 min
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ForexDashboard/1.0)" },
    });
    if (!res.ok) return empty;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta as {
      regularMarketPrice?: number;
      chartPreviousClose?: number;
    } | undefined;
    const current   = meta?.regularMarketPrice ?? null;
    const prevClose = meta?.chartPreviousClose ?? null;
    if (current === null) return empty;
    const delta    = prevClose !== null ? parseFloat((current - prevClose).toFixed(2)) : null;
    const deltaPct = prevClose !== null && prevClose > 0
      ? parseFloat(((current - prevClose) / prevClose * 100).toFixed(2))
      : null;
    return { value: parseFloat(current.toFixed(2)), delta, deltaPct };
  } catch { return empty; }
}

// ── Stooq (Or XAU/USD, Argent XAG/USD — gratuit, sans clé, quasi temps réel) ─
// delta = Close - Open = variation intraday vs ouverture de session

async function stooqMetal(symbol: string): Promise<FredResult> {
  const empty: FredResult = { value: null, delta: null, deltaPct: null };
  try {
    const url = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`;
    const res  = await fetch(url, {
      next: { revalidate: 300 }, // cache 5 min
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ForexDashboard/1.0)" },
    });
    if (!res.ok) return empty;
    const text  = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return empty;
    const cols = lines[1].split(",");
    // CSV header: Symbol,Date,Time,Open,High,Low,Close,Volume
    const open  = parseFloat(cols[3]);
    const close = parseFloat(cols[6]);
    if (isNaN(close)) return empty;
    const delta    = !isNaN(open) ? parseFloat((close - open).toFixed(2)) : null;
    const deltaPct = (!isNaN(open) && open > 0)
      ? parseFloat(((close - open) / open * 100).toFixed(2))
      : null;
    return { value: parseFloat(close.toFixed(2)), delta, deltaPct };
  } catch { return empty; }
}

// ── Binance (Bitcoin — gratuit, sans clé, temps réel) ────────────────────────
// ticker/price = prix spot instantané (plus précis que ticker/24hr lastPrice)
// ticker/24hr = stats 24h pour le % de variation
async function binanceBTC(): Promise<{ value: number | null; change24h: number | null }> {
  try {
    const [priceRes, statsRes] = await Promise.all([
      fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",  { cache: "no-store" }),
      fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",   { cache: "no-store" }),
    ]);
    const price  = priceRes.ok  ? parseFloat((await priceRes.json()).price)          : NaN;
    const pctChg = statsRes.ok  ? parseFloat((await statsRes.json()).priceChangePercent) : NaN;
    return {
      value:     isNaN(price)  ? null : parseFloat(price.toFixed(2)),
      change24h: isNaN(pctChg) ? null : parseFloat(pctChg.toFixed(2)),
    };
  } catch { return { value: null, change24h: null }; }
}

// ── CoinGecko (Bitcoin fallback) ──────────────────────────────────────────────

async function coingeckoBTC(): Promise<{ value: number | null; change24h: number | null }> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
      { cache: "no-store" }
    );
    if (!res.ok) return { value: null, change24h: null };
    const d = await res.json();
    return {
      value:     d?.bitcoin?.usd             ?? null,
      change24h: d?.bitcoin?.usd_24h_change  ?? null,
    };
  } catch { return { value: null, change24h: null }; }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const fredKey = process.env.FRED_API_KEY;
  if (!fredKey) return NextResponse.json({ error: "FRED_API_KEY missing" }, { status: 500 });

  // 1. Indices — Yahoo Finance (temps réel, cache 5 min)
  //    ^VIX = CBOE Volatility Index | ^GSPC = S&P 500
  const [vixQ, sp500Q] = await Promise.all([
    yahooQuote("^VIX"),
    yahooQuote("^GSPC"),
  ]);

  // Pétrole — Stooq futures (quasi temps réel, cache 5 min, sans clé API)
  //   cl.f = WTI NYMEX | cb.f = Brent ICE  → delta = variation intraday vs ouverture
  const [brentQ, wtiQ] = await Promise.all([
    stooqMetal("cb.f"),
    stooqMetal("cl.f"),
  ]);

  // 2. Métaux précieux — Stooq (quasi temps réel, cache 5 min, sans clé API)
  //    delta = variation intraday vs ouverture de session
  const [goldQ, silverQ] = await Promise.all([
    stooqMetal("xauusd"),
    stooqMetal("xagusd"),
  ]);

  // 3. Bitcoin — Binance (temps réel), fallback CoinGecko
  const btcBin = await binanceBTC();
  const btcCg  = btcBin.value === null ? await coingeckoBTC() : { value: null, change24h: null };

  // 4. FRED — spreads crédit (cache 1h)
  //    Yields 10Y — TE bonds (cache 1h, données du jour)
  //    US 2Y — FRED DGS2 (garde pour la courbe 2-10)
  const [hyRaw, igRaw, us2y, bondYields] = await Promise.all([
    fredObs("BAMLH0A0HYM2", fredKey),
    fredObs("BAMLC0A0CM",   fredKey),
    fredObs("DGS2",         fredKey),
    fetchTEBondYields(),
  ]);

  const us10y = bondYields["USD"]?.yield10y ?? null;

  return NextResponse.json({
    // Sentiment / Risk-On
    vix:            vixQ.value,
    vixDelta:       vixQ.delta,
    sp500:          sp500Q.value,
    sp500Change:    sp500Q.delta,
    sp500ChangePct: sp500Q.deltaPct,
    btc:            btcBin.value    ?? btcCg.value,
    btcChange24h:   btcBin.change24h ?? btcCg.change24h,
    // Crédit (FRED, bps)
    hySpread: hyRaw != null ? Math.round(hyRaw * 100) : null,
    igSpread: igRaw != null ? Math.round(igRaw * 100) : null,
    // Yields 10Y par devise — TE bonds (temps réel, cache 1h)
    bondYields10y: {
      USD: bondYields["USD"]?.yield10y  ?? null,
      EUR: bondYields["EUR"]?.yield10y  ?? null,
      GBP: bondYields["GBP"]?.yield10y  ?? null,
      JPY: bondYields["JPY"]?.yield10y  ?? null,
      AUD: bondYields["AUD"]?.yield10y  ?? null,
      CAD: bondYields["CAD"]?.yield10y  ?? null,
      CHF: bondYields["CHF"]?.yield10y  ?? null,
      NZD: bondYields["NZD"]?.yield10y  ?? null,
    },
    bondYieldsDay: {
      USD: bondYields["USD"]?.dayDelta  ?? null,
      EUR: bondYields["EUR"]?.dayDelta  ?? null,
      GBP: bondYields["GBP"]?.dayDelta  ?? null,
      JPY: bondYields["JPY"]?.dayDelta  ?? null,
      AUD: bondYields["AUD"]?.dayDelta  ?? null,
      CAD: bondYields["CAD"]?.dayDelta  ?? null,
      CHF: bondYields["CHF"]?.dayDelta  ?? null,
      NZD: bondYields["NZD"]?.dayDelta  ?? null,
    },
    // Courbe USD (2Y de FRED, 10Y de TE)
    us10y,
    us2y,
    curveSlope: us10y !== null && us2y !== null ? Math.round((us10y - us2y) * 100) : null,
    // Commodités — Or/Argent intraday (Stooq), Pétrole j-1 (FRED)
    gold:        goldQ.value,
    goldDelta:   goldQ.delta,
    silver:      silverQ.value,
    silverDelta: silverQ.delta,
    brent:       brentQ.value,
    brentDelta:  brentQ.delta,
    wti:         wtiQ.value,
    wtiDelta:    wtiQ.delta,
    // Compat
    copper: null,
    timestamp: Date.now(),
  });
}
