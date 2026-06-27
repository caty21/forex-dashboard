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

// ── investing.com — BTC/USD temps réel (data-test attributes, cache 1 min) ────
// Sélecteurs stables : data-test="instrument-price-last/change/change-percent"
async function investingBTC(): Promise<{ value: number | null; delta: number | null; deltaPct: number | null }> {
  const empty = { value: null, delta: null, deltaPct: null };
  try {
    const res = await fetch("https://www.investing.com/crypto/bitcoin/btc-usd", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      next: { revalidate: 60 },
    });
    if (!res.ok) return empty;
    const html = await res.text();

    // "61,307.0" → 61307
    const priceMatch = html.match(/data-test="instrument-price-last">([^<]+)/);
    const deltaMatch = html.match(/data-test="instrument-price-change">([^<]+)/);
    // "(-0.75%)" → -0.75
    const pctMatch   = html.match(/data-test="instrument-price-change-percent">\(([^)%]+)%\)/);

    if (!priceMatch) return empty;
    const value = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (isNaN(value)) return empty;

    const delta    = deltaMatch ? parseFloat(deltaMatch[1].replace(/,/g, "")) : null;
    const deltaPct = pctMatch   ? parseFloat(pctMatch[1])
                   : delta !== null && value > 0 ? parseFloat(((delta / (value - delta)) * 100).toFixed(2))
                   : null;

    return {
      value:    Math.round(value),
      delta:    delta !== null && !isNaN(delta) ? Math.round(delta) : null,
      deltaPct: deltaPct !== null && !isNaN(deltaPct) ? deltaPct : null,
    };
  } catch { return empty; }
}

// ── Business Insider Markets — WTI & S&P 500 (JSON inline, cache 1 min) ──────
// JSON pattern dans le HTML : "currentValue":XX.XX et "previousClose":XX.XX
async function biMarket(url: string): Promise<{ value: number | null; delta: number | null; deltaPct: number | null }> {
  const empty = { value: null, delta: null, deltaPct: null };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return empty;
    const html = await res.text();
    const curMatch  = html.match(/"currentValue":([\d.]+)/);
    const prevMatch = html.match(/"previousClose":([\d.]+)/);
    if (!curMatch) return empty;
    const value = parseFloat(curMatch[1]);
    const prev  = prevMatch ? parseFloat(prevMatch[1]) : null;
    if (isNaN(value)) return empty;
    const delta    = prev !== null ? parseFloat((value - prev).toFixed(2)) : null;
    const deltaPct = delta !== null && prev !== null && prev > 0
      ? parseFloat(((delta / prev) * 100).toFixed(2)) : null;
    return { value: parseFloat(value.toFixed(2)), delta, deltaPct };
  } catch { return empty; }
}

// ── abcbourse.com — Brent spot temps réel (Six Financial Information) ────────
// Sélecteurs HTML stables : id="lastcx" (cours), id="veille" (clôture J-1), id="varcx" (%)
async function abcbourseBrent(): Promise<{ value: number | null; delta: number | null; deltaPct: number | null }> {
  const empty = { value: null, delta: null, deltaPct: null };
  try {
    const res = await fetch("https://www.abcbourse.com/cotation/XBRUSDu", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return empty;
    const html = await res.text();

    const priceMatch = html.match(/id="lastcx">([^<]+)/);
    const prevMatch  = html.match(/id="veille">([^<]+)/);
    const pctMatch   = html.match(/id="varcx"[^>]*>([^<]+)/);

    if (!priceMatch) return empty;

    // "96,70 $" → 96.70
    const value = parseFloat(priceMatch[1].replace(/[^\d,]/g, "").replace(",", "."));
    if (isNaN(value)) return empty;

    const prev  = prevMatch ? parseFloat(prevMatch[1].replace(",", ".").trim()) : null;
    const delta = prev !== null && !isNaN(prev) ? parseFloat((value - prev).toFixed(2)) : null;

    let deltaPct: number | null = null;
    if (pctMatch) {
      // &#x2B; = "+" ; &#x2212; ou &minus; = "−"
      const pctStr = pctMatch[1]
        .replace(/&#x2[Bb];/g, "+")
        .replace(/&#x2212;|&minus;/g, "-")
        .replace("%", "")
        .replace(",", ".")
        .trim();
      const pctNum = parseFloat(pctStr);
      if (!isNaN(pctNum)) deltaPct = pctNum;
    } else if (delta !== null && prev !== null && prev > 0) {
      deltaPct = parseFloat(((delta / prev) * 100).toFixed(2));
    }

    return { value, delta, deltaPct };
  } catch { return empty; }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const fredKey = process.env.FRED_API_KEY;
  if (!fredKey) return NextResponse.json({ error: "FRED_API_KEY missing" }, { status: 500 });

  // 1. Indices — Business Insider (JSON inline, cache 1 min) + fallback Yahoo Finance
  //    VIX reste Yahoo (Business Insider n'a pas VIX)
  const [vixQ, sp500Raw] = await Promise.all([
    yahooQuote("^VIX"),
    biMarket("https://markets.businessinsider.com/index/s%26p_500"),
  ]);
  const sp500Q = sp500Raw.value !== null ? sp500Raw : await yahooQuote("^GSPC");

  // Brent — abcbourse.com (Six Financial Information, temps réel, cache 1 min)
  //   Fallback : Yahoo Finance BZ=F si le scraping échoue
  // WTI — Business Insider (JSON inline, cache 1 min) + fallback Yahoo Finance CL=F
  const [brentRaw, wtiRaw] = await Promise.all([
    abcbourseBrent(),
    biMarket("https://markets.businessinsider.com/commodities/oil-price?type=wti"),
  ]);
  const brentQ = brentRaw.value !== null ? brentRaw : await yahooQuote("BZ=F").then(q => ({
    value: q.value, delta: q.delta, deltaPct: q.deltaPct,
  }));
  const wtiQ = wtiRaw.value !== null ? wtiRaw : await yahooQuote("CL=F");

  // 2. Métaux précieux — Business Insider (JSON inline, cache 1 min) + fallback Yahoo Finance
  const [goldRaw, silverRaw] = await Promise.all([
    biMarket("https://markets.businessinsider.com/commodities/gold-price"),
    biMarket("https://markets.businessinsider.com/commodities/silver-price"),
  ]);
  const goldQ   = goldRaw.value   !== null ? goldRaw   : await yahooQuote("GC=F");
  const silverQ = silverRaw.value !== null ? silverRaw : await yahooQuote("SI=F");

  // 3. BTC/USD — investing.com (data-test attrs, cache 1 min) + fallback Binance/CoinGecko
  const btcRaw = await investingBTC();
  const btcBin = btcRaw.value === null ? await binanceBTC() : { value: null, change24h: null };
  const btcCg  = btcRaw.value === null && btcBin.value === null ? await coingeckoBTC() : { value: null, change24h: null };

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
    btc:            btcRaw.value    ?? btcBin.value    ?? btcCg.value,
    btcChange24h:   btcBin.change24h ?? btcCg.change24h,
    btcDeltaPct:    btcRaw.deltaPct,
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
    // Commodités — Business Insider (cache 1 min) + fallback Yahoo Finance
    gold:           goldQ.value,
    goldDelta:      goldQ.delta,
    goldDeltaPct:   goldQ.deltaPct,
    silver:         silverQ.value,
    silverDelta:    silverQ.delta,
    silverDeltaPct: silverQ.deltaPct,
    brent:          brentQ.value,
    brentDelta:     brentQ.delta,
    brentDeltaPct:  brentQ.deltaPct,
    wti:         wtiQ.value,
    wtiDelta:    wtiQ.delta,
    wtiDeltaPct: wtiQ.deltaPct,
    // Compat
    copper: null,
    timestamp: Date.now(),
  });
}
