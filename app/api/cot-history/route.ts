import { NextResponse } from "next/server";
import { COT_CODES } from "@/lib/constants";
import type { Currency } from "@/lib/types";

const SODA_BASE = "https://publicreporting.cftc.gov/resource";
const CODES_LIST = Object.values(COT_CODES).map(c => `'${c}'`).join(",");
const WHERE      = `cftc_contract_market_code in(${CODES_LIST}) AND futonly_or_combined='FutOnly'`;
const ORDER      = "report_date_as_yyyy_mm_dd DESC";
const LIMIT      = 250; // 8 devises × 26 semaines = 208 lignes max

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CotWeek {
  weekDate:   string;
  net:        number;
  longPct:    number;
  shortPct:   number;
  totalLev:   number;
  deltaNet:   number | null; // changement net semaine en semaine (depuis l'API)
  deltaLong:  number | null; // contrats longs ajoutés/retirés
  deltaShort: number | null; // contrats shorts ajoutés/retirés
}

export interface CotHistory {
  tff:    Record<Currency, CotWeek[]>; // Leveraged Money — Hedge Funds
  legacy: Record<Currency, CotWeek[]>; // Non-Commercial — tous spéculateurs
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let _cache: { data: CotHistory; ts: number } | null = null;

function cacheTtl(): number {
  const d = new Date();
  const daysUntilFriday = (5 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilFriday);
  d.setUTCHours(15, 30, 0, 0);
  return Math.min(d.getTime() - Date.now(), 4 * 24 * 3600_000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function codeMap(): Record<string, Currency> {
  return Object.fromEntries(
    (Object.entries(COT_CODES) as [Currency, string][]).map(([ccy, code]) => [code, ccy])
  );
}

function initByCcy<T>(): Record<string, Map<string, T>> {
  return Object.fromEntries(Object.keys(COT_CODES).map(k => [k, new Map<string, T>()]));
}

function toWeeks(maps: Record<string, Map<string, CotWeek>>): Record<Currency, CotWeek[]> {
  const result = {} as Record<Currency, CotWeek[]>;
  for (const [ccy, m] of Object.entries(maps)) {
    result[ccy as Currency] = Array.from(m.values())
      .sort((a, b) => b.weekDate.localeCompare(a.weekDate))
      .slice(0, 26);
  }
  return result;
}

function int(v: string | undefined): number {
  const n = parseInt(v ?? "0", 10);
  return isNaN(n) ? 0 : n;
}

// ── Parseurs ──────────────────────────────────────────────────────────────────

interface TffRow {
  cftc_contract_market_code: string;
  report_date_as_yyyy_mm_dd: string;
  lev_money_positions_long:  string;
  lev_money_positions_short: string;
  change_in_lev_money_long:  string;
  change_in_lev_money_short: string;
}

function parseTff(rows: TffRow[]): Record<Currency, CotWeek[]> {
  const codes = codeMap();
  const maps  = initByCcy<CotWeek>();

  for (const row of rows) {
    const ccy = codes[row.cftc_contract_market_code];
    if (!ccy) continue;
    const longs  = int(row.lev_money_positions_long);
    const shorts = int(row.lev_money_positions_short);
    const total  = longs + shorts;
    const dL     = int(row.change_in_lev_money_long);
    const dS     = int(row.change_in_lev_money_short);
    const weekDate = row.report_date_as_yyyy_mm_dd?.slice(0, 10);
    if (!weekDate) continue;
    maps[ccy].set(weekDate, {
      weekDate,
      net:        longs - shorts,
      longPct:    total > 0 ? Math.round(longs  / total * 100) : 50,
      shortPct:   total > 0 ? Math.round(shorts / total * 100) : 50,
      totalLev:   total,
      deltaNet:   dL - dS,
      deltaLong:  dL,
      deltaShort: dS,
    });
  }
  return toWeeks(maps);
}

interface LegacyRow {
  cftc_contract_market_code:  string;
  report_date_as_yyyy_mm_dd:  string;
  noncomm_positions_long_all: string;
  noncomm_positions_short_all:string;
  change_in_noncomm_long_all: string;
  change_in_noncomm_short_all:string;
}

function parseLegacy(rows: LegacyRow[]): Record<Currency, CotWeek[]> {
  const codes = codeMap();
  const maps  = initByCcy<CotWeek>();

  for (const row of rows) {
    const ccy = codes[row.cftc_contract_market_code];
    if (!ccy) continue;
    const longs  = int(row.noncomm_positions_long_all);
    const shorts = int(row.noncomm_positions_short_all);
    const total  = longs + shorts;
    const dL     = int(row.change_in_noncomm_long_all);
    const dS     = int(row.change_in_noncomm_short_all);
    const weekDate = row.report_date_as_yyyy_mm_dd?.slice(0, 10);
    if (!weekDate) continue;
    maps[ccy].set(weekDate, {
      weekDate,
      net:        longs - shorts,
      longPct:    total > 0 ? Math.round(longs  / total * 100) : 50,
      shortPct:   total > 0 ? Math.round(shorts / total * 100) : 50,
      totalLev:   total,
      deltaNet:   dL - dS,
      deltaLong:  dL,
      deltaShort: dS,
    });
  }
  return toWeeks(maps);
}

// ── Route ─────────────────────────────────────────────────────────────────────

async function sodaFetch(dataset: string): Promise<unknown[]> {
  const url = `${SODA_BASE}/${dataset}.json?$where=${encodeURIComponent(WHERE)}&$limit=${LIMIT}&$order=${encodeURIComponent(ORDER)}`;
  const res = await fetch(url, { cache: "no-store", headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`SODA ${dataset} failed: ${res.status}`);
  return res.json();
}

export async function GET() {
  if (_cache && Date.now() - _cache.ts < cacheTtl()) {
    return NextResponse.json(_cache.data);
  }

  try {
    const [tffRows, legacyRows] = await Promise.all([
      sodaFetch("gpe5-46if"), // TFF Futures Only
      sodaFetch("6dca-aqww"), // Legacy Futures Only
    ]);

    const data: CotHistory = {
      tff:    parseTff(tffRows    as TffRow[]),
      legacy: parseLegacy(legacyRows as LegacyRow[]),
    };

    _cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
