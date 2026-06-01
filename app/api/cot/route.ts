import { NextResponse } from "next/server";
import { COT_CODES } from "@/lib/constants";
import type { Currency, CotEntry } from "@/lib/types";

// ── CFTC Traders in Financial Futures (TFF) — format legacy CSV sans header ──
// URL : https://www.cftc.gov/dea/newcot/FinFutWk.txt (mis à jour chaque vendredi)
//
// Colonnes (0-based, séparées par virgule) :
//   0  Market_and_Exchange_Names
//   1  As_of_Date_In_Form_YYMMDD
//   2  Report_Date_as_YYYY-MM-DD
//   3  CFTC_Contract_Market_Code
//   4  CFTC_Market_Code
//   5  CFTC_Region_Code
//   6  CFTC_Commodity_Code
//   7  Open_Interest_All
//   8  Dealer_Positions_Long_All
//   9  Dealer_Positions_Short_All
//  10  Dealer_Positions_Spreading_All
//  11  Asset_Mgr_Positions_Long_All
//  12  Asset_Mgr_Positions_Short_All
//  13  Asset_Mgr_Positions_Spreading_All
//  14  Lev_Money_Positions_Long_All   ← hedge funds (positions spéculatives)
//  15  Lev_Money_Positions_Short_All
//  16  Lev_Money_Positions_Spreading_All
//  ...

const CFTC_URL = "https://www.cftc.gov/dea/newcot/FinFutWk.txt";
const IDX_CODE     = 3;
const IDX_LEV_LONG  = 14;
const IDX_LEV_SHORT = 15;
const IDX_DATE     = 2;

// In-memory cache (1 semaine)
let _cache: { data: Record<string, unknown>; ts: number } | null = null;
const TTL = 7 * 24 * 3600_000;

export type { CotEntry } from "@/lib/types";

export async function GET() {
  if (_cache && Date.now() - _cache.ts < TTL) {
    return NextResponse.json(_cache.data);
  }

  try {
    const res = await fetch(CFTC_URL, {
      next: { revalidate: 86400 * 7 },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ForexDashboard/1.0)" },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `CFTC fetch failed: ${res.status}` }, { status: 502 });
    }

    const text   = await res.text();
    const result = parseCOT(text);

    _cache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

function parseCOT(csv: string): Record<string, CotEntry> {
  const lines    = csv.split("\n");
  const targetCodes = new Set(Object.values(COT_CODES));
  const result: Record<string, CotEntry> = {};

  for (const line of lines) {
    if (!line.trim()) continue;

    // Split respectant les guillemets
    const cols = splitCsvLine(line);
    if (cols.length < 16) continue;

    const code = cols[IDX_CODE]?.trim();
    if (!code || !targetCodes.has(code)) continue;

    const longs  = parseInt(cols[IDX_LEV_LONG]?.trim()  ?? "0", 10);
    const shorts = parseInt(cols[IDX_LEV_SHORT]?.trim() ?? "0", 10);
    if (isNaN(longs) || isNaN(shorts)) continue;

    const total   = longs + shorts;
    const net     = longs - shorts;
    const weekDate = cols[IDX_DATE]?.trim() ?? "";

    const currency = (Object.entries(COT_CODES) as [Currency, string][])
      .find(([, c]) => c === code)?.[0];
    if (!currency) continue;

    result[currency] = {
      net,
      longPct:  total > 0 ? Math.round((longs  / total) * 100) : 50,
      shortPct: total > 0 ? Math.round((shorts / total) * 100) : 50,
      totalLev: total,
      weekDate,
    };
  }

  return result;
}

/** Gère les champs entourés de guillemets doubles dans un CSV */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
