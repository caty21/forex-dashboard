// app/api/scenario-spreads/route.ts
// Spreads EFFR/SOFR utilisés par l'onglet Scénario (simulateur type CME
// SOFRWatch) pour traduire une fourchette cible Fed hypothétique en niveau de
// SOFR implicite : SOFR ≈ lowerBound + (EFFR − lowerBound) + (SOFR − EFFR).
//
// CME SOFRWatch calcule ces deux spreads à partir des prix des futures SOFR
// 1 mois vs Fed Funds (SR1−ZQ), des données de marché propriétaires. On les
// approxime ici avec la moyenne réalisée historique EFFR/SOFR (FRED, gratuit),
// ce qui est un proxy raisonnable tant que la Fed n'a pas bougé récemment
// (spread stable), mais reste un proxy — pas un prix forward-looking.

import { NextResponse } from "next/server";
import rateDecisionsData from "@/data/rate_decisions.json";

export const dynamic = "force-dynamic";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
const REVALIDATE = 6 * 3600;

interface FredObs { date: string; value: number; }

async function fredObs(seriesId: string, apiKey: string, limit = 60): Promise<FredObs[]> {
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE } });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.observations ?? [])
      .filter((o: { value: string }) => o.value !== ".")
      .map((o: { date: string; value: string }) => ({ date: o.date, value: parseFloat(o.value) }));
  } catch { return []; }
}

export interface ScenarioSpreads {
  asOf:              string;
  lowerBound:         number | null;
  upperBound:         number | null;
  effrSpreadBps:      number | null;  // EFFR − lowerBound, moyenne réalisée
  sofrEffrSpreadBps:  number | null;  // SOFR − EFFR, moyenne réalisée (apparié par date)
  windowDays:         number;
  note:               string;
}

export async function GET() {
  const key = process.env.FRED_API_KEY;
  if (!key) return NextResponse.json({ error: "FRED_API_KEY missing" }, { status: 500 });

  const [effr, sofr] = await Promise.all([
    fredObs("EFFR", key, 60),
    fredObs("SOFR", key, 60),
  ]);
  if (!effr.length || !sofr.length) {
    return NextResponse.json({ error: "Données FRED EFFR/SOFR indisponibles" }, { status: 502 });
  }

  const rateDec = (rateDecisionsData as Array<{ decisions: Record<string, { current: number }> }>)[0];
  const upperBound = rateDec?.decisions?.USD?.current ?? null;
  const lowerBound = upperBound !== null ? parseFloat((upperBound - 0.25).toFixed(2)) : null;

  const effrSpread = lowerBound !== null
    ? effr.reduce((s, o) => s + (o.value - lowerBound), 0) / effr.length
    : null;

  const effrByDate = new Map(effr.map(o => [o.date, o.value]));
  const pairedDiffs = sofr
    .filter(o => effrByDate.has(o.date))
    .map(o => o.value - effrByDate.get(o.date)!);
  const sofrEffrSpread = pairedDiffs.length
    ? pairedDiffs.reduce((s, d) => s + d, 0) / pairedDiffs.length
    : null;

  const data: ScenarioSpreads = {
    asOf: new Date().toISOString().slice(0, 10),
    lowerBound,
    upperBound,
    effrSpreadBps:     effrSpread !== null ? Math.round(effrSpread * 100) : null,
    sofrEffrSpreadBps: sofrEffrSpread !== null ? Math.round(sofrEffrSpread * 100) : null,
    windowDays: effr.length,
    note: "Spreads = moyennes réalisées historiques EFFR/SOFR (FRED, fenêtre glissante ~60j) — approximation du spread forward-looking SR1−ZQ utilisé par CME SOFRWatch (données de marché propriétaires non accessibles gratuitement).",
  };
  return NextResponse.json(data, { headers: { "Cache-Control": "s-maxage=21600, stale-while-revalidate=43200" } });
}
