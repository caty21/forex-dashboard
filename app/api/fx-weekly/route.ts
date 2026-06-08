import { NextResponse } from "next/server";

// Calcule la performance hebdomadaire G10 en % vs USD
// en comparant le vendredi de la semaine en cours au vendredi précédent

export interface FxWeeklyEntry {
  ccy:      string;
  pct:      number;       // % change vs USD, positif = a apprécié
  current:  number | null; // taux actuel (unités par USD)
  prev:     number | null; // taux semaine précédente
}

export interface FxWeeklyData {
  weekFrom: string;   // "YYYY-MM-DD" — début de semaine (lundi)
  weekTo:   string;   // "YYYY-MM-DD" — fin de semaine (vendredi)
  prevFri:  string;   // "YYYY-MM-DD" — vendredi précédent
  currencies: FxWeeklyEntry[];
}

const G10_CCYS = ["EUR","GBP","JPY","CHF","CAD","AUD","NZD"];
// DXY basket weights pour USD
const DXY_WEIGHTS: Record<string, number> = {
  EUR: 0.576, JPY: 0.136, GBP: 0.119, CAD: 0.091, SEK: 0.042, CHF: 0.036,
};

let _cache: { data: FxWeeklyData; ts: number; key: string } | null = null;
const TTL = 3600_000; // 1h

// Renvoie le vendredi de la semaine complétée la plus récente.
// Dimanche → vendredi d'avant-hier (la semaine lun-ven vient de se terminer).
// Lundi…jeudi → vendredi de la semaine précédente (la semaine courante n'est pas finie).
// Vendredi → aujourd'hui. Samedi → hier.
function lastFriday(from?: Date): Date {
  const d   = from ? new Date(from) : new Date();
  const day = d.getDay(); // 0=dim … 6=sam
  const sub = (day - 5 + 7) % 7; // 0 si ven, 1 si sam, 2 si dim, 3 si lun, …, 6 si jeu
  d.setDate(d.getDate() - sub);
  d.setHours(0, 0, 0, 0);
  return d;
}

function prevFridayFrom(fri: Date): Date {
  const d = new Date(fri);
  d.setDate(d.getDate() - 7);
  return d;
}

function toISO(d: Date): string { return d.toISOString().slice(0, 10); }

async function fetchRates(date: string): Promise<Record<string, number> | null> {
  try {
    const ccys = [...G10_CCYS, "SEK"].join(",");
    const res  = await fetch(
      `https://api.frankfurter.app/${date}?from=USD&to=${ccys}`,
      { next: { revalidate: 3600 }, headers: { "Accept": "application/json" } }
    );
    if (!res.ok) return null;
    const json = await res.json() as { rates?: Record<string, number> };
    return json.rates ?? null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Optionnel : ?weekTo=YYYY-MM-DD pour forcer la semaine
  const forcedFriday = searchParams.get("weekTo");

  const thisFri = forcedFriday ? new Date(forcedFriday) : lastFriday();
  const prevFri = prevFridayFrom(thisFri);
  const cacheKey = toISO(thisFri);

  if (_cache && _cache.key === cacheKey && Date.now() - _cache.ts < TTL) {
    return NextResponse.json(_cache.data);
  }

  const [currRates, prevRates] = await Promise.all([
    fetchRates(toISO(thisFri)),
    fetchRates(toISO(prevFri)),
  ]);

  if (!currRates || !prevRates) {
    return NextResponse.json({ error: "Frankfurter unavailable" }, { status: 502 });
  }

  // Calcul % pour chaque devise G10
  const entries: FxWeeklyEntry[] = G10_CCYS.map(ccy => {
    const curr = currRates[ccy] ?? null;
    const prev = prevRates[ccy] ?? null;
    let pct = 0;
    if (curr && prev && prev > 0) {
      // rate = units of CCY per 1 USD
      // Si rate diminue → CCY apprécie → pct positif
      pct = ((prev - curr) / prev) * 100;
    }
    return { ccy, pct: Math.round(pct * 10) / 10, current: curr, prev };
  });

  // USD : inverse pondéré du panier DXY
  let usdPct = 0;
  let totalWeight = 0;
  for (const [ccy, w] of Object.entries(DXY_WEIGHTS)) {
    const entry = entries.find(e => e.ccy === ccy);
    if (entry) { usdPct -= entry.pct * w; totalWeight += w; }
  }
  if (totalWeight > 0) usdPct /= totalWeight;
  entries.unshift({ ccy: "USD", pct: Math.round(usdPct * 10) / 10, current: 1, prev: 1 });

  // Trier du plus fort au plus faible
  entries.sort((a, b) => b.pct - a.pct);

  // Lundi de la semaine thisFri
  const monday = new Date(thisFri);
  monday.setDate(thisFri.getDate() - 4);

  const data: FxWeeklyData = {
    weekFrom: toISO(monday),
    weekTo:   toISO(thisFri),
    prevFri:  toISO(prevFri),
    currencies: entries,
  };

  _cache = { data, ts: Date.now(), key: cacheKey };
  return NextResponse.json(data);
}
