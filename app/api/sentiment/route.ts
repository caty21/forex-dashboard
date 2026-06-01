import { NextResponse } from "next/server";

// ── Myfxbook Community Outlook API ────────────────────────────────────────────
// Source : https://www.myfxbook.com/community/outlook
// Auth   : login.json → session token → get-community-outlook.json
// Session TTL : ~24h ; on la garde en mémoire le temps du process server.

const MYFXBOOK_BASE = "https://www.myfxbook.com/api";

// Server-side session cache
let _session: string | null = null;
let _sessionTs = 0;
const SESSION_TTL = 20 * 3600_000; // 20h

// Data cache (1h)
let _cache: { data: MyfxbookSentiment; ts: number } | null = null;
const DATA_TTL = 3600_000;

interface MyfxbookSymbol {
  name: string;           // "EURUSD"
  longPercentage: number;
  shortPercentage: number;
  longVolume: number;
  shortVolume: number;
  longPositions: number;
  shortPositions: number;
  totalPositions: number;
}

interface MyfxbookSentiment {
  symbols: MyfxbookSymbol[];
  source: "myfxbook";
  timestamp: number;
}

// ── Map pair → base currency (long = haussier base) ─────────────────────────
// Pour les paires USD/* on inverse (short = haussier base non-USD)
const PAIR_TO_CCY: Record<string, { ccy: string; inverse: boolean }> = {
  EURUSD:  { ccy: "EUR", inverse: false },
  GBPUSD:  { ccy: "GBP", inverse: false },
  USDJPY:  { ccy: "JPY", inverse: true  },
  USDCHF:  { ccy: "CHF", inverse: true  },
  USDCAD:  { ccy: "CAD", inverse: true  },
  AUDUSD:  { ccy: "AUD", inverse: false },
  NZDUSD:  { ccy: "NZD", inverse: false },
  XAUUSD:  { ccy: "XAU", inverse: false },
};

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(): Promise<string | null> {
  const email    = process.env.MYFXBOOK_EMAIL;
  const password = process.env.MYFXBOOK_PASSWORD;
  if (!email || !password) return null;

  try {
    const url = `${MYFXBOOK_BASE}/login.json?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) {
      console.error("[sentiment] Myfxbook login error:", data.message);
      return null;
    }
    _session  = data.session;
    _sessionTs = Date.now();
    return data.session;
  } catch (e) {
    console.error("[sentiment] Myfxbook login exception:", e);
    return null;
  }
}

async function getSession(): Promise<string | null> {
  if (_session && Date.now() - _sessionTs < SESSION_TTL) return _session;
  return login();
}

// ── Fetch community outlook ───────────────────────────────────────────────────

async function fetchOutlook(session: string): Promise<MyfxbookSymbol[] | null> {
  try {
    const url = `${MYFXBOOK_BASE}/get-community-outlook.json?session=${session}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) {
      // Session expired → force re-login next time
      if (data.message?.toLowerCase().includes("session")) _session = null;
      return null;
    }
    return (data.symbols ?? []) as MyfxbookSymbol[];
  } catch {
    return null;
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  // Return cached data if fresh
  if (_cache && Date.now() - _cache.ts < DATA_TTL) {
    return NextResponse.json(_cache.data);
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "MYFXBOOK_EMAIL / MYFXBOOK_PASSWORD manquants dans .env.local — créez un compte gratuit sur myfxbook.com" },
      { status: 503 }
    );
  }

  let symbols = await fetchOutlook(session);

  // Session expired → try once more with fresh login
  if (!symbols) {
    _session = null;
    const fresh = await login();
    if (fresh) symbols = await fetchOutlook(fresh);
  }

  if (!symbols) {
    return NextResponse.json({ error: "Myfxbook community outlook unavailable" }, { status: 502 });
  }

  const result: MyfxbookSentiment = { symbols, source: "myfxbook", timestamp: Date.now() };
  _cache = { data: result, ts: Date.now() };
  return NextResponse.json(result);
}

// ── Helper interne : traduit symbols[] en {CCY: {longPct, shortPct}} ─────────
function symbolsToCurrencyMap(symbols: MyfxbookSymbol[]): Record<string, { longPct: number; shortPct: number; pair: string }> {
  const result: Record<string, { longPct: number; shortPct: number; pair: string }> = {};
  for (const sym of symbols) {
    const mapping = PAIR_TO_CCY[sym.name];
    if (!mapping) continue;
    const { ccy, inverse } = mapping;
    result[ccy] = {
      pair:     sym.name,
      longPct:  inverse ? sym.shortPercentage : sym.longPercentage,
      shortPct: inverse ? sym.longPercentage  : sym.shortPercentage,
    };
  }
  return result;
}
