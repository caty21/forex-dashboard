import { NextRequest, NextResponse } from "next/server";

// OANDA v20 API — position book (% long/short by pair)
const OANDA_BASE = "https://api-fxtrade.oanda.com/v3";

const MAJOR_PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF",
  "USD_CAD", "AUD_USD", "NZD_USD",
  "EUR_GBP", "EUR_JPY", "GBP_JPY",
  "AUD_JPY", "CAD_JPY", "NZD_JPY",
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pair = searchParams.get("pair");

  const apiKey = process.env.OANDA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OANDA_API_KEY not configured. Add it to .env.local." },
      { status: 503 }
    );
  }

  const pairsToFetch = pair ? [pair] : MAJOR_PAIRS;
  const results: Record<string, { longPct: number; shortPct: number; pair: string }> = {};

  await Promise.allSettled(
    pairsToFetch.map(async (p) => {
      try {
        const res = await fetch(
          `${OANDA_BASE}/instruments/${p}/positionBook?time=current`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            next: { revalidate: 3600 },
          }
        );
        if (!res.ok) return;
        const data = await res.json();
        const buckets: { price: string; longCountPercent: string; shortCountPercent: string }[] =
          data?.positionBook?.buckets ?? [];

        let totalLong = 0;
        let totalShort = 0;
        for (const b of buckets) {
          totalLong += parseFloat(b.longCountPercent ?? "0");
          totalShort += parseFloat(b.shortCountPercent ?? "0");
        }
        const total = totalLong + totalShort;
        if (total === 0) return;
        results[p] = {
          pair: p,
          longPct: Math.round((totalLong / total) * 100),
          shortPct: Math.round((totalShort / total) * 100),
        };
      } catch {
        // silently skip unavailable pairs
      }
    })
  );

  return NextResponse.json({ pairs: results, source: "OANDA", timestamp: Date.now() });
}
