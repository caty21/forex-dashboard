// app/api/scenario-spreads/route.ts
// Spreads utilisés par l'onglet Scénario (simulateur type CME SOFRWatch /
// €STRWatch) pour traduire un taux directeur hypothétique en taux de
// référence overnight implicite :
//   USD : SOFR ≈ borne basse Fed + (EFFR − borne basse) + (SOFR − EFFR)
//   EUR : €STR ≈ DFR + (€STR − DFR)
//   GBP : SONIA ≈ Bank Rate + (SONIA − Bank Rate)
//
// CME calcule ces spreads à partir de prix de futures/options (SR1−ZQ pour
// SOFR ; pas d'équivalent public pour €STR/SONIA). On les approxime tous avec
// la moyenne réalisée historique (FRED, gratuit) — un proxy raisonnable tant
// que le taux directeur n'a pas bougé récemment, mais pas un prix
// forward-looking.

import { NextRequest, NextResponse } from "next/server";
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

function avgSpread(ref: FredObs[], target: number | null): number | null {
  if (target === null || !ref.length) return null;
  return ref.reduce((s, o) => s + (o.value - target), 0) / ref.length;
}

export interface ScenarioSpread {
  label: string;       // "EFFR − borne basse", "€STR − DFR", "SONIA − Bank Rate"…
  bps:   number | null;
}

export interface ScenarioSpreads {
  currency:        "USD" | "EUR" | "GBP";
  asOf:            string;
  targetRate:      number | null;  // borne basse (USD), DFR (EUR), Bank Rate (GBP)
  targetLabel:     string;
  refRateLabel:    string;         // "SOFR" | "€STR" | "SONIA"
  // Offset fixe pour convertir l'impliedRate déjà exposé par /api/rate-probabilities
  // (convention borne haute pour USD, MRO pour EUR, Bank Rate direct pour GBP)
  // vers la même échelle que targetRate — permet au front de comparer le
  // scénario utilisateur au marché sans dupliquer les conventions par devise.
  marketConversionOffset: number;
  spreads:         ScenarioSpread[];
  windowDays:      number;
  note:            string;
}

type RateDecisions = Array<{ decisions: Record<string, { current: number }> }>;

// Fenêtre courte (≈2 semaines ouvrées) plutôt que longue : une fenêtre large
// (60j) peut chevaucher un changement de taux directeur récent et fausser la
// moyenne en mélangeant l'ancien et le nouveau régime (constaté sur l'EUR :
// la BCE a bougé le 17 juin 2026, une fenêtre 60j donnait un spread €STR-DFR
// de -26bps au lieu des ~-7bps réels une fois restreint à l'après-hausse).
const SPREAD_WINDOW = 10;

async function buildUsd(key: string): Promise<ScenarioSpreads | { error: string }> {
  const [effr, sofr] = await Promise.all([fredObs("EFFR", key, SPREAD_WINDOW), fredObs("SOFR", key, SPREAD_WINDOW)]);
  if (!effr.length || !sofr.length) return { error: "Données FRED EFFR/SOFR indisponibles" };

  const rateDec = (rateDecisionsData as RateDecisions)[0];
  const upperBound = rateDec?.decisions?.USD?.current ?? null;
  const lowerBound = upperBound !== null ? parseFloat((upperBound - 0.25).toFixed(2)) : null;

  const effrSpread = avgSpread(effr, lowerBound);
  const effrByDate = new Map(effr.map(o => [o.date, o.value]));
  const pairedDiffs = sofr.filter(o => effrByDate.has(o.date)).map(o => o.value - effrByDate.get(o.date)!);
  const sofrEffrSpread = pairedDiffs.length ? pairedDiffs.reduce((s, d) => s + d, 0) / pairedDiffs.length : null;

  return {
    currency: "USD",
    asOf: new Date().toISOString().slice(0, 10),
    targetRate: lowerBound,
    targetLabel: "Fourchette Fed (borne basse)",
    refRateLabel: "SOFR",
    marketConversionOffset: -0.25, // impliedRate (borne haute) -> borne basse
    spreads: [
      { label: "EFFR − borne basse", bps: effrSpread !== null ? Math.round(effrSpread * 100) : null },
      { label: "SOFR − EFFR",        bps: sofrEffrSpread !== null ? Math.round(sofrEffrSpread * 100) : null },
    ],
    windowDays: effr.length,
    note: "Spreads = moyennes réalisées historiques EFFR/SOFR (FRED, fenêtre glissante ~2 semaines) — approximation du spread forward-looking SR1−ZQ utilisé par CME SOFRWatch (données de marché propriétaires non accessibles gratuitement).",
  };
}

async function buildEur(key: string): Promise<ScenarioSpreads | { error: string }> {
  const estr = await fredObs("ECBESTRVOLWGTTRMDMNRT", key, SPREAD_WINDOW);
  if (!estr.length) return { error: "Données FRED €STR indisponibles" };

  const rateDec = (rateDecisionsData as RateDecisions)[0];
  const mro = rateDec?.decisions?.EUR?.current ?? null; // rate_decisions.json stocke le MRO
  const dfr = mro !== null ? parseFloat((mro - 0.15).toFixed(2)) : null; // corridor ECB: MRO = DFR+15bps

  const estrSpread = avgSpread(estr, dfr);

  return {
    currency: "EUR",
    asOf: new Date().toISOString().slice(0, 10),
    targetRate: dfr,
    targetLabel: "DFR (taux de dépôt BCE)",
    refRateLabel: "€STR",
    marketConversionOffset: -0.15, // impliedRate (MRO) -> DFR
    spreads: [
      { label: "€STR − DFR", bps: estrSpread !== null ? Math.round(estrSpread * 100) : null },
    ],
    windowDays: estr.length,
    note: "Spread = moyenne réalisée historique €STR/DFR (FRED, fenêtre glissante ~2 semaines) — approximation ; pas d'équivalent public d'un spread forward-looking type SR1−ZQ pour l'EUR.",
  };
}

async function buildGbp(key: string): Promise<ScenarioSpreads | { error: string }> {
  const sonia = await fredObs("IUDSOIA", key, SPREAD_WINDOW);
  if (!sonia.length) return { error: "Données FRED SONIA indisponibles" };

  const rateDec = (rateDecisionsData as RateDecisions)[0];
  const bankRate = rateDec?.decisions?.GBP?.current ?? null;

  const soniaSpread = avgSpread(sonia, bankRate);

  return {
    currency: "GBP",
    asOf: new Date().toISOString().slice(0, 10),
    targetRate: bankRate,
    targetLabel: "Bank Rate (BoE)",
    refRateLabel: "SONIA",
    marketConversionOffset: 0, // impliedRate déjà en convention Bank Rate directe
    spreads: [
      { label: "SONIA − Bank Rate", bps: soniaSpread !== null ? Math.round(soniaSpread * 100) : null },
    ],
    windowDays: sonia.length,
    note: "Spread = moyenne réalisée historique SONIA/Bank Rate (FRED, fenêtre glissante ~2 semaines) — approximation ; la BoE a arrêté de publier ses propres fonctions de densité de probabilité implicites par options (short sterling), donc pas de spread forward-looking public disponible.",
  };
}

export async function GET(req: NextRequest) {
  const key = process.env.FRED_API_KEY;
  if (!key) return NextResponse.json({ error: "FRED_API_KEY missing" }, { status: 500 });

  const currency = (req.nextUrl.searchParams.get("currency") ?? "USD").toUpperCase();
  const builder = currency === "EUR" ? buildEur : currency === "GBP" ? buildGbp : buildUsd;

  const result = await builder(key);
  if ("error" in result) return NextResponse.json(result, { status: 502 });

  return NextResponse.json(result, { headers: { "Cache-Control": "s-maxage=21600, stale-while-revalidate=43200" } });
}
