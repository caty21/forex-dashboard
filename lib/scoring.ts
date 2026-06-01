import type { CurrencyIndicators, BiasPhase, COTData, STIRData, Bond10YData } from "./types";
import { INDICATOR_WEIGHTS, PHASE_MULTIPLIERS } from "./constants";

function signalFromSurprise(surprise: number | null): number {
  if (surprise === null) return 0;
  if (surprise > 0.3) return 1;
  if (surprise < -0.3) return -1;
  return 0;
}

// Employment change est en milliers (Δk) → seuil 10k pour signal
function signalFromDeltaK(deltaK: number | null): number {
  if (deltaK === null) return 0;
  if (deltaK > 10)  return 1;
  if (deltaK < -10) return -1;
  return 0;
}

// §4 macro score: -16 to +16
export function calcMacroScore(
  indicators: CurrencyIndicators,
  phase: BiasPhase
): number {
  const mult = PHASE_MULTIPLIERS[phase] ?? PHASE_MULTIPLIERS.transition;

  const signals: { key: keyof typeof INDICATOR_WEIGHTS; signal: number }[] = [
    { key: "policyRate",   signal: signalFromSurprise(indicators.policyRate.surprise) },
    { key: "cpiCore",      signal: signalFromSurprise(indicators.cpiCore.surprise) },
    { key: "pmiMfg",       signal: indicators.pmiMfg.value !== null ? (indicators.pmiMfg.value > 50 ? 1 : -1) : 0 },
    { key: "pmiServices",  signal: indicators.pmiServices.value !== null ? (indicators.pmiServices.value > 50 ? 1 : -1) : 0 },
    { key: "gdp",          signal: signalFromSurprise(indicators.gdp.surprise) },
    { key: "retailSales",  signal: signalFromSurprise(indicators.retailSales.surprise) },
    { key: "unemployment", signal: signalFromSurprise(indicators.unemployment.surprise) * -1 }, // inversion : chômage bas = haussier
    { key: "employment",   signal: signalFromDeltaK(indicators.employment.surprise) },
  ];

  let total = 0;
  for (const { key, signal } of signals) {
    const weight = INDICATOR_WEIGHTS[key];
    const multiplier = signal > 0 ? mult.bull : signal < 0 ? mult.bear : 1;
    total += signal * weight * multiplier;
  }

  return Math.round(Math.max(-16, Math.min(16, total)));
}

// §6.5 divergence score: -5 to +5
export function calcDivergenceScore(params: {
  retailLongPct: number | null;
  cotPercentile: number | null;
  cotDeltaWoW: number | null;
  stirDeltaWoW: number | null;
  bondSpreadDeltaWoW: number | null;
  macroScore: number;
}): number {
  const { retailLongPct, cotPercentile, cotDeltaWoW, stirDeltaWoW, bondSpreadDeltaWoW, macroScore } = params;
  let sd = 0;

  // Retail vs STIR
  if (retailLongPct !== null && stirDeltaWoW !== null) {
    if (retailLongPct > 70 && stirDeltaWoW < -0.5) sd -= 1; // retail long + STIR dovish
    if (retailLongPct < 30 && stirDeltaWoW > 0.5)  sd += 1; // retail short + STIR hawkish
  }

  // Retail vs Bonds 10Y
  if (retailLongPct !== null && bondSpreadDeltaWoW !== null) {
    if (retailLongPct > 70 && bondSpreadDeltaWoW < -5)  sd -= 1;
    if (retailLongPct < 30 && bondSpreadDeltaWoW > 5)   sd += 1;
  }

  // COT vs Retail
  if (cotPercentile !== null && cotDeltaWoW !== null && retailLongPct !== null) {
    const cotBearish = cotPercentile < 50 || cotDeltaWoW < 0;
    const cotBullish = cotPercentile > 50 && cotDeltaWoW > 0;
    if (cotBearish && retailLongPct > 60)  sd -= 1;
    if (cotBullish && retailLongPct < 40)  sd += 1;
  }

  // COT vs STIR
  if (cotDeltaWoW !== null && stirDeltaWoW !== null) {
    if (cotDeltaWoW > 0 && stirDeltaWoW < -0.5)  sd -= 0.5;
    if (cotDeltaWoW < 0 && stirDeltaWoW > 0.5)   sd += 0.5;
  }

  // STIR vs Bonds (yield curve coherence)
  if (stirDeltaWoW !== null && bondSpreadDeltaWoW !== null) {
    if (stirDeltaWoW < -0.5 && bondSpreadDeltaWoW > 5)  sd -= 0.5; // dovish short, hawkish long
    if (stirDeltaWoW > 0.5 && bondSpreadDeltaWoW < -5)  sd += 0.5;
  }

  // Retail extreme vs macro
  if (retailLongPct !== null) {
    if (retailLongPct > 80 && macroScore <= -2) sd -= 1;
    if (retailLongPct < 20 && macroScore >= 2)  sd += 1;
  }

  return Math.round(Math.max(-5, Math.min(5, sd)));
}

export function biasLabel(score: number): "ACHETEUR" | "NEUTRE" | "VENDEUR" {
  if (score >= 4)  return "ACHETEUR";
  if (score <= -4) return "VENDEUR";
  return "NEUTRE";
}

export function biasColor(score: number): string {
  if (score >= 4)  return "text-green-600";
  if (score <= -4) return "text-red-600";
  return "text-gray-500";
}
