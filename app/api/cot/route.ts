import { NextResponse } from "next/server";
import { inflateRawSync } from "zlib";
import { COT_CODES } from "@/lib/constants";
import type { Currency, CotEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

// ── CFTC Traders in Financial Futures (TFF) — fichier annuel ZIP ──────────────
// URL : https://www.cftc.gov/files/dea/history/fut_fin_txt_YYYY.zip
// Colonnes : 3=code, 2=date, 11=AM long, 12=AM short, 14=HF long, 15=HF short

const IDX_CODE      = 3;
const IDX_DATE      = 2;
const IDX_AM_LONG   = 11;
const IDX_AM_SHORT  = 12;
const IDX_LEV_LONG  = 14;
const IDX_LEV_SHORT = 15;

// ── CFTC Legacy COT (Non-Commercial) — via Socrata API ────────────────────────
// Dataset : 6dca-aqww  (Legacy Futures Only)
// Fields  : noncomm_positions_long_all, noncomm_positions_short_all + changes

const SODA_BASE   = "https://publicreporting.cftc.gov/resource";
const CODES_LIST  = Object.values(COT_CODES).map(c => `'${c}'`).join(",");
const SODA_WHERE  = `cftc_contract_market_code in(${CODES_LIST}) AND futonly_or_combined='FutOnly'`;

function cftcZipUrl(): string {
  return `https://www.cftc.gov/files/dea/history/fut_fin_txt_${new Date().getFullYear()}.zip`;
}

// In-memory cache — expire le vendredi suivant à 15h30 UTC (publication CFTC)
let _cache: { data: Record<string, unknown>; ts: number } | null = null;

function nextCftcRelease(): number {
  const d = new Date();
  const daysUntilFriday = (5 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilFriday);
  d.setUTCHours(15, 30, 0, 0);
  return d.getTime();
}

function cacheTtl(): number {
  return Math.min(nextCftcRelease() - Date.now(), 4 * 24 * 3600_000);
}

export type { CotEntry } from "@/lib/types";

// ── NC (Non-Commercial Legacy) via Socrata ─────────────────────────────────────

interface LegacyRow {
  cftc_contract_market_code:  string;
  report_date_as_yyyy_mm_dd:  string;
  noncomm_positions_long_all:  string;
  noncomm_positions_short_all: string;
  change_in_noncomm_long_all:  string;
  change_in_noncomm_short_all: string;
}

interface NcData {
  longs: number; shorts: number;
  longsDelta: number | null; shortsDelta: number | null;
}

async function fetchNcData(): Promise<Record<string, NcData>> {
  const url = `${SODA_BASE}/6dca-aqww.json?$where=${encodeURIComponent(SODA_WHERE)}&$limit=20&$order=report_date_as_yyyy_mm_dd DESC`;
  const rows: LegacyRow[] = await fetch(url, { cache: "no-store" }).then(r => r.json()).catch(() => []);

  // On garde max 2 semaines par devise (ordre DESC = plus récente en premier)
  const seen: Record<string, LegacyRow[]> = {};
  for (const row of rows) {
    const code = row.cftc_contract_market_code;
    if (!seen[code]) seen[code] = [];
    if (seen[code].length < 2) seen[code].push(row);
  }

  const codeMap = Object.fromEntries(
    (Object.entries(COT_CODES) as [Currency, string][]).map(([ccy, code]) => [code, ccy])
  );

  const result: Record<string, NcData> = {};
  for (const [code, weeks] of Object.entries(seen)) {
    const ccy = codeMap[code];
    if (!ccy || weeks.length === 0) continue;
    const cur  = weeks[0];
    const prev = weeks[1] ?? null;
    const longs  = parseInt(cur.noncomm_positions_long_all  ?? "0", 10) || 0;
    const shorts = parseInt(cur.noncomm_positions_short_all ?? "0", 10) || 0;
    const prevL  = prev ? parseInt(prev.noncomm_positions_long_all  ?? "0", 10) || 0 : null;
    const prevS  = prev ? parseInt(prev.noncomm_positions_short_all ?? "0", 10) || 0 : null;
    result[ccy] = {
      longs, shorts,
      longsDelta:  prevL !== null ? longs  - prevL : null,
      shortsDelta: prevS !== null ? shorts - prevS : null,
    };
  }
  return result;
}

export async function GET() {
  if (_cache && Date.now() - _cache.ts < cacheTtl()) {
    return NextResponse.json(_cache.data);
  }

  try {
    const [res, ncRaw] = await Promise.all([
      fetch(cftcZipUrl(), {
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ForexDashboard/1.0)" },
      }),
      fetchNcData(),
    ]);

    if (!res.ok) {
      return NextResponse.json({ error: `CFTC fetch failed: ${res.status}` }, { status: 502 });
    }

    const zipBuf = Buffer.from(await res.arrayBuffer());
    const text   = extractFirstFileFromZip(zipBuf);
    if (!text) return NextResponse.json({ error: "ZIP parse failed" }, { status: 502 });

    const result = parseCOT(text, ncRaw);
    _cache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

// ── ZIP parser minimal (format PKZIP, méthode 8 = deflate) ───────────────────

function extractFirstFileFromZip(buf: Buffer): string | null {
  try {
    // Find End-of-Central-Directory (PK\x05\x06)
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
        eocd = i; break;
      }
    }
    if (eocd < 0) return null;

    const localHdrOffset = buf.readUInt32LE(buf.readUInt32LE(eocd + 16) + 42);
    const lfnLen = buf.readUInt16LE(localHdrOffset + 26);
    const lexLen = buf.readUInt16LE(localHdrOffset + 28);
    const dataStart = localHdrOffset + 30 + lfnLen + lexLen;
    const compSize  = buf.readUInt32LE(localHdrOffset + 18);
    const method    = buf.readUInt16LE(localHdrOffset + 8);

    const compressed = buf.slice(dataStart, dataStart + compSize);
    const decompressed = method === 8
      ? inflateRawSync(compressed)
      : compressed; // stored (method 0)

    return decompressed.toString("utf8");
  } catch {
    return null;
  }
}

// ── Parseur CSV TFF ──────────────────────────────────────────────────────────

type RawWeek = {
  hfLongs: number; hfShorts: number;
  amLongs: number; amShorts: number;
  weekDate: string;
};

function parseCOT(csv: string, nc: Record<string, NcData>): Record<string, CotEntry> {
  const lines       = csv.split("\n");
  const targetCodes = new Set(Object.values(COT_CODES));
  const raw: Record<string, RawWeek[]> = {};

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 16) continue;

    const code = cols[IDX_CODE]?.trim();
    if (!code || !targetCodes.has(code)) continue;

    const hfLongs  = parseInt(cols[IDX_LEV_LONG]?.trim()  ?? "0", 10);
    const hfShorts = parseInt(cols[IDX_LEV_SHORT]?.trim() ?? "0", 10);
    const amLongs  = parseInt(cols[IDX_AM_LONG]?.trim()   ?? "0", 10);
    const amShorts = parseInt(cols[IDX_AM_SHORT]?.trim()  ?? "0", 10);
    if (isNaN(hfLongs) || isNaN(hfShorts) || isNaN(amLongs) || isNaN(amShorts)) continue;

    const weekDate = cols[IDX_DATE]?.trim() ?? "";
    if (!raw[code]) raw[code] = [];
    if (raw[code].length < 2) raw[code].push({ hfLongs, hfShorts, amLongs, amShorts, weekDate });
  }

  const result: Record<string, CotEntry> = {};

  for (const [code, weeks] of Object.entries(raw)) {
    const currency = (Object.entries(COT_CODES) as [Currency, string][])
      .find(([, c]) => c === code)?.[0];
    if (!currency || weeks.length === 0) continue;

    const cur  = weeks[0];
    const prev = weeks[1] ?? null;

    const hfTotal = cur.hfLongs + cur.hfShorts;
    const hfNet   = cur.hfLongs - cur.hfShorts;
    const amTotal = cur.amLongs + cur.amShorts;
    const amNet   = cur.amLongs - cur.amShorts;

    const ncEntry  = nc[currency] ?? null;
    const ncLongs  = ncEntry?.longs  ?? 0;
    const ncShorts = ncEntry?.shorts ?? 0;
    const ncTotal  = ncLongs + ncShorts;
    const ncNet    = ncLongs - ncShorts;

    result[currency] = {
      net:           hfNet,
      hfLongs:       cur.hfLongs,
      hfShorts:      cur.hfShorts,
      longPct:       hfTotal > 0 ? Math.round((cur.hfLongs  / hfTotal) * 100) : 50,
      shortPct:      hfTotal > 0 ? Math.round((cur.hfShorts / hfTotal) * 100) : 50,
      totalLev:      hfTotal,
      amNet,
      amLongs:       cur.amLongs,
      amShorts:      cur.amShorts,
      amLongPct:     amTotal > 0 ? Math.round((cur.amLongs / amTotal) * 100) : 50,
      amTotal,
      ncNet,
      ncLongs,
      ncShorts,
      ncLongPct:     ncTotal > 0 ? Math.round((ncLongs / ncTotal) * 100) : 50,
      ncTotal,
      netDelta:      prev !== null ? hfNet - (prev.hfLongs - prev.hfShorts) : null,
      longsDelta:    prev !== null ? cur.hfLongs  - prev.hfLongs  : null,
      shortsDelta:   prev !== null ? cur.hfShorts - prev.hfShorts : null,
      amNetDelta:    prev !== null ? amNet - (prev.amLongs - prev.amShorts) : null,
      amLongsDelta:  prev !== null ? cur.amLongs  - prev.amLongs  : null,
      amShortsDelta: prev !== null ? cur.amShorts - prev.amShorts : null,
      ncNetDelta:    ncEntry?.longsDelta != null && ncEntry?.shortsDelta != null ? ncEntry.longsDelta - ncEntry.shortsDelta : null,
      ncLongsDelta:  ncEntry?.longsDelta  ?? null,
      ncShortsDelta: ncEntry?.shortsDelta ?? null,
      weekDate:      cur.weekDate,
      prevWeekDate:  prev?.weekDate ?? null,
    };
  }

  return result;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}
