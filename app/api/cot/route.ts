import { NextResponse } from "next/server";
import { COT_CODES } from "@/lib/constants";
import type { Currency } from "@/lib/types";

// CFTC CSV URL — updated weekly on Fridays
const CFTC_URL =
  "https://www.cftc.gov/files/dea/history/fut_fin_txt_2024.zip";
// Current year CSV (plain text, no zip)
const CFTC_CURRENT =
  "https://www.cftc.gov/sites/default/files/files/dea/cotarchives/2024/futures/FinFutWk062824.txt";

// In-memory cache (server lifetime)
let cotCache: { data: Record<string, unknown>; ts: number } | null = null;
const TTL = 7 * 24 * 3600_000; // 1 week

export async function GET() {
  if (cotCache && Date.now() - cotCache.ts < TTL) {
    return NextResponse.json(cotCache.data);
  }

  try {
    // Fetch latest COT "Disaggregated" or "Financial" futures CSV
    // The public URL pattern for the most recent weekly file:
    const now = new Date();
    const year = now.getFullYear();
    const csvUrl = `https://www.cftc.gov/files/dea/history/fut_fin_txt_${year}.zip`;

    // Simpler approach: use the non-compressed annual file (available for current year)
    const res = await fetch(
      `https://www.cftc.gov/dea/newcot/FinFutWk.txt`,
      { next: { revalidate: 86400 * 7 } }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `CFTC fetch failed: ${res.status}`, note: "COT data may be unavailable temporarily." },
        { status: 502 }
      );
    }

    const text = await res.text();
    const result = parseCOT(text);
    cotCache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

function parseCOT(csv: string): Record<string, unknown> {
  const lines = csv.split("\n");
  if (lines.length < 2) return {};

  const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const result: Record<string, { net: number; longPct: number; shortPct: number }> = {};

  const targetCodes = new Set(Object.values(COT_CODES));

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",").map((v) => v.replace(/"/g, "").trim());
    if (row.length < 10) continue;

    const codeIdx = header.indexOf("CFTC_Contract_Market_Code");
    const longIdx = header.indexOf("NonComm_Positions_Long_All");
    const shortIdx = header.indexOf("NonComm_Positions_Short_All");

    if (codeIdx < 0 || longIdx < 0 || shortIdx < 0) continue;
    const code = row[codeIdx];
    if (!targetCodes.has(code)) continue;

    const longs = parseInt(row[longIdx] ?? "0", 10);
    const shorts = parseInt(row[shortIdx] ?? "0", 10);
    const total = longs + shorts;
    const net = longs - shorts;

    const currency = (Object.entries(COT_CODES) as [Currency, string][]).find(
      ([, c]) => c === code
    )?.[0];
    if (!currency) continue;

    result[currency] = {
      net,
      longPct: total > 0 ? Math.round((longs / total) * 100) : 50,
      shortPct: total > 0 ? Math.round((shorts / total) * 100) : 50,
    };
  }

  return result;
}
