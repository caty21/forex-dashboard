import { NextResponse } from "next/server";

// ── FRED (toutes données marché + macro) ──────────────────────────────────────
// limit=1 → valeur seule. limit=2 → valeur + précédente (pour calculer le delta).

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

type FredResult = { value: number | null; delta: number | null; deltaPct: number | null };

/** Fetche les 2 dernières obs pour calculer valeur + delta vs session précédente */
async function fredObsDelta(series: string, apiKey: string): Promise<FredResult> {
  const empty: FredResult = { value: null, delta: null, deltaPct: null };
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=2`;
    const res  = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return empty;
    const obs: number[] = ((await res.json())?.observations ?? [])
      .filter((o: { value: string }) => o.value !== ".")
      .map((o: { value: string }) => parseFloat(o.value));
    if (!obs.length) return empty;
    const value    = obs[0];
    const prev     = obs[1] ?? null;
    const delta    = prev !== null ? parseFloat((value - prev).toFixed(2)) : null;
    const deltaPct = prev !== null ? parseFloat(((value - prev) / prev * 100).toFixed(2)) : null;
    return { value, delta, deltaPct };
  } catch { return empty; }
}

// ── Binance (Bitcoin — gratuit, sans clé, temps réel) ────────────────────────

async function binanceBTC(): Promise<{ value: number | null; change24h: number | null }> {
  try {
    const res    = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT", { cache: "no-store" });
    if (!res.ok) return { value: null, change24h: null };
    const d      = await res.json();
    const price  = parseFloat(d.lastPrice);
    const pctChg = parseFloat(d.priceChangePercent);
    return {
      value:     isNaN(price)  ? null : Math.round(price),
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

  // 1. Marchés — FRED (données fin de journée, cache 24h)
  //    VIXCLS = VIX clôture CBOE | SP500 = S&P 500 | GOLDPMGBD228NLBM = Or LBMA
  //    SLVPRUSD = Argent LBMA | DCOILBRENTEU = Brent | DCOILWTICO = WTI
  const [vixQ, sp500Q, goldQ, silverQ, brentQ, wtiQ] = await Promise.all([
    fredObsDelta("VIXCLS",           fredKey),
    fredObsDelta("SP500",            fredKey),
    fredObsDelta("GOLDPMGBD228NLBM", fredKey),
    fredObsDelta("SLVPRUSD",         fredKey),
    fredObsDelta("DCOILBRENTEU",     fredKey),
    fredObsDelta("DCOILWTICO",       fredKey),
  ]);

  // 2. Bitcoin — Binance (temps réel), fallback CoinGecko
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
    vixDelta:       vixQ.delta,                           // pts vs clôture j-1
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
    // Commodités — delta = variation vs clôture j-1
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
