import { NextResponse } from "next/server";

// ── Cache mémoire serveur ──────────────────────────────────────────────────────
// Évite de retaper AV à chaque requête page. Ne cache les succès que (jamais null).
const _cache = new Map<string, { v: unknown; ts: number }>();
const TTL_24H = 86_400_000;
const TTL_1H  =  3_600_000;

// ── Alpha Vantage GLOBAL_QUOTE ────────────────────────────────────────────────
// Clé existante. 25 req/jour gratuit.
// Symboles utilisés : ^VIX, ^GSPC, GC=F, SI=F, BZ=F, CL=F → 6 req/jour.
// Séquentiels pour respecter 5 req/min.

type AVQ = { value: number | null; delta: number | null; deltaPct: number | null };

async function avQuote(symbol: string, avKey: string): Promise<AVQ> {
  const cacheKey = `av_${symbol}`;
  const hit = _cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL_24H) return hit.v as AVQ;

  const empty: AVQ = { value: null, delta: null, deltaPct: null };
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${avKey}`;
    const res  = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return empty;
    const json = await res.json();
    const q    = json?.["Global Quote"];
    // AV rate-limit renvoie {"Note":"..."} avec un "Global Quote" vide
    if (!q || !q["05. price"]) return empty;

    const value    = parseFloat(q["05. price"]);
    const delta    = parseFloat(q["09. change"]);
    const deltaPct = parseFloat((q["10. change percent"] ?? "0%").replace("%", ""));
    const result: AVQ = {
      value:    isNaN(value)    ? null : parseFloat(value.toFixed(2)),
      delta:    isNaN(delta)    ? null : parseFloat(delta.toFixed(2)),
      deltaPct: isNaN(deltaPct) ? null : parseFloat(deltaPct.toFixed(2)),
    };
    _cache.set(cacheKey, { v: result, ts: Date.now() }); // cache uniquement si succès
    return result;
  } catch { return empty; }
}

// ── Binance (Bitcoin — gratuit, sans clé, temps réel) ────────────────────────

async function binanceBTC(): Promise<{ value: number | null; change24h: number | null }> {
  const k   = "binance_btc";
  const hit = _cache.get(k);
  if (hit && Date.now() - hit.ts < TTL_1H) return hit.v as { value: number | null; change24h: number | null };

  try {
    const res    = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT", { cache: "no-store" });
    if (!res.ok) return { value: null, change24h: null };
    const d      = await res.json();
    const price  = parseFloat(d.lastPrice);
    const pctChg = parseFloat(d.priceChangePercent);
    const result = {
      value:     isNaN(price)  ? null : Math.round(price),
      change24h: isNaN(pctChg) ? null : parseFloat(pctChg.toFixed(2)),
    };
    _cache.set(k, { v: result, ts: Date.now() });
    return result;
  } catch { return { value: null, change24h: null }; }
}

// ── CoinGecko (Bitcoin — fallback si Binance échoue) ─────────────────────────

async function coingeckoBTC(): Promise<{ value: number | null; change24h: number | null }> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
      { cache: "no-store" }
    );
    if (!res.ok) return { value: null, change24h: null };
    const d = await res.json();
    return {
      value:     d?.bitcoin?.usd           ?? null,
      change24h: d?.bitcoin?.usd_24h_change ?? null,
    };
  } catch { return { value: null, change24h: null }; }
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

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const fredKey = process.env.FRED_API_KEY;
  const avKey   = process.env.ALPHA_VANTAGE_KEY;
  if (!fredKey) return NextResponse.json({ error: "FRED_API_KEY missing" }, { status: 500 });
  if (!avKey)   return NextResponse.json({ error: "ALPHA_VANTAGE_KEY missing" }, { status: 500 });

  // 1. Indices + commodités — Alpha Vantage GLOBAL_QUOTE (cache 24h mémoire)
  //    Appels séquentiels → respect limite 5 req/min AV
  const vixQ    = await avQuote("^VIX",  avKey);
  const sp500Q  = await avQuote("^GSPC", avKey);
  const goldQ   = await avQuote("GC=F",  avKey);
  const silverQ = await avQuote("SI=F",  avKey);
  const brentQ  = await avQuote("BZ=F",  avKey);
  const wtiQ    = await avQuote("CL=F",  avKey);

  // 2. Bitcoin — Binance (temps réel, sans clé), fallback CoinGecko
  const btcBin = await binanceBTC();
  const btcCg  = btcBin.value === null ? await coingeckoBTC() : { value: null, change24h: null };

  // 3. FRED — spreads crédit + taux directeurs (cache 24h)
  const [hyRaw, igRaw, us10y, us2y] = await Promise.all([
    fredObs("BAMLH0A0HYM2", fredKey),
    fredObs("BAMLC0A0CM",   fredKey),
    fredObs("DGS10",        fredKey),
    fredObs("DGS2",         fredKey),
  ]);

  return NextResponse.json({
    // Sentiment / Risk-On
    vix:            vixQ.value,
    vixDelta:       vixQ.delta,
    sp500:          sp500Q.value,
    sp500Change:    sp500Q.delta,
    sp500ChangePct: sp500Q.deltaPct,
    btc:            btcBin.value    ?? btcCg.value,
    btcChange24h:   btcBin.change24h ?? btcCg.change24h,
    // Crédit (FRED, % × 100 = bps)
    hySpread: hyRaw != null ? Math.round(hyRaw * 100) : null,
    igSpread: igRaw != null ? Math.round(igRaw * 100) : null,
    // Taux (DXY injecté par page.tsx depuis /api/fx)
    us10y,
    us2y,
    curveSlope: us10y !== null && us2y !== null ? Math.round((us10y - us2y) * 100) : null,
    // Commodités — delta = variation vs clôture veille
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
