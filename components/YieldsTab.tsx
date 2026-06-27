"use client";

// YieldsTab — Rendements souverains 10Y : classement, opportunités carry, divergences

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, ArrowRight } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface YieldsData {
  yields:     Record<string, number | null>;
  spreads:    Record<string, number | null>;
  dayDeltas?: Record<string, number | null>;
}

interface Props {
  yieldsData: YieldsData | null;
  fxDayPct?:  Record<string, number | null> | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CCY_FLAGS: Record<string, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵",
  AUD: "🇦🇺", CAD: "🇨🇦", CHF: "🇨🇭", NZD: "🇳🇿",
};

const CCY_COUNTRY: Record<string, string> = {
  USD: "États-Unis",   EUR: "Zone Euro",   GBP: "Royaume-Uni",
  JPY: "Japon",        AUD: "Australie",   CAD: "Canada",
  CHF: "Suisse",       NZD: "Nvl-Zélande",
};

function fmt(n: number | null, dec = 3): string {
  return n !== null ? n.toFixed(dec) + "%" : "—";
}

function deltaColor(d: number | null) {
  if (d === null || d === 0) return "text-gray-400";
  return d > 0 ? "text-green-600" : "text-red-600";
}

function deltaIcon(d: number | null) {
  if (d === null || Math.abs(d) < 0.001) return <Minus size={10} />;
  return d > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />;
}

// Niveau d'écart en bps → label d'opportunité
function carryLabel(bps: number): { label: string; color: string } {
  if (bps >= 400) return { label: "Très fort", color: "text-emerald-700 bg-emerald-50 border-emerald-200" };
  if (bps >= 200) return { label: "Fort",       color: "text-green-700  bg-green-50  border-green-200"   };
  if (bps >= 100) return { label: "Modéré",     color: "text-yellow-700 bg-yellow-50 border-yellow-200"  };
  return              { label: "Faible",    color: "text-gray-600   bg-gray-50   border-gray-200"    };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function YieldsTab({ yieldsData, fxDayPct }: Props) {
  if (!yieldsData) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Chargement des rendements…
      </div>
    );
  }

  const { yields, dayDeltas = {} } = yieldsData;

  // Filtre les devises avec données, tri décroissant
  const sorted = useMemo(() => {
    return (Object.entries(yields) as [string, number | null][])
      .filter(([, v]) => v !== null)
      .sort(([, a], [, b]) => (b as number) - (a as number)) as [string, number][];
  }, [yields]);

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Données indisponibles
      </div>
    );
  }

  const maxYield = sorted[0][1];
  const minYield = sorted[sorted.length - 1][1];

  // Top carry pairs (toutes combinaisons triées par écart décroissant)
  const carryPairs = useMemo(() => {
    const pairs: { long: string; short: string; bps: number }[] = [];
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const [cLong, yLong] = sorted[i];
        const [cShort, yShort] = sorted[j];
        pairs.push({ long: cLong, short: cShort, bps: Math.round((yLong - yShort) * 100) });
      }
    }
    return pairs.sort((a, b) => b.bps - a.bps);
  }, [sorted]);

  const topCarry   = carryPairs.slice(0, 6);
  const tightPairs = [...carryPairs].sort((a, b) => a.bps - b.bps).slice(0, 4);

  // Divergences yield/FX : yield et devise vont dans des directions opposées
  // Yield ↑ + devise ↓ → obligations vendues MAIS devise sous pression = signal de stress
  // Yield ↓ + devise ↑ → obligations achetées MAIS devise forte = safe-haven ou anomalie
  // Seuils : yield ≥ 2bp (0.02%) ET FX ≥ 0.1% pour filtrer le bruit
  const divergences = useMemo(() => {
    const YIELD_THRESHOLD = 0.02;  // 2 basis points minimum
    const FX_THRESHOLD    = 0.1;   // 0.1% FX move minimum
    const result: { ccy: string; yieldDelta: number; fxPct: number; type: "stress" | "safehaven" }[] = [];

    for (const [ccy] of sorted) {
      const yd = dayDeltas[ccy] ?? null;
      const fx = fxDayPct?.[ccy] ?? null;
      if (yd === null || fx === null) continue;
      if (Math.abs(yd) < YIELD_THRESHOLD || Math.abs(fx) < FX_THRESHOLD) continue;

      const yieldUp = yd > 0;
      const fxUp    = fx > 0;

      if (yieldUp && !fxUp) {
        // Yield monte, devise baisse → signal de stress / pression vendeuse sur dettes
        result.push({ ccy, yieldDelta: yd, fxPct: fx, type: "stress" });
      } else if (!yieldUp && fxUp) {
        // Yield baisse, devise monte → safe-haven ou anomalie (ex: JPY, CHF)
        result.push({ ccy, yieldDelta: yd, fxPct: fx, type: "safehaven" });
      }
    }

    return result.sort((a, b) => Math.abs(b.yieldDelta) + Math.abs(b.fxPct) - (Math.abs(a.yieldDelta) + Math.abs(a.fxPct)));
  }, [sorted, dayDeltas, fxDayPct]);

  // Movers du jour (triés par amplitude de variation)
  const movers = useMemo(() => {
    return sorted
      .map(([ccy]) => ({ ccy, d: dayDeltas[ccy] ?? 0 }))
      .filter(x => Math.abs(x.d) >= 0.001)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  }, [sorted, dayDeltas]);

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">
            Rendements Souverains 10Y
          </h2>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Source : Trading Economics (données du jour) · EUR = Bund allemand
          </p>
        </div>
        <div className="text-right text-[10px] text-gray-400">
          <span className="font-semibold text-green-600">{sorted[0][0]} {fmt(maxYield)} ↑ max</span>
          <span className="mx-2 text-gray-300">|</span>
          <span className="font-semibold text-blue-600">{sorted.at(-1)![0]} {fmt(minYield)} ↓ min</span>
        </div>
      </div>

      {/* ── Classement barres horizontales ──────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Classement Yield 10Y
        </p>
        <div className="space-y-2">
          {sorted.map(([ccy, yld], i) => {
            const pct   = maxYield > 0 ? (yld / maxYield) * 100 : 0;
            const delta = dayDeltas[ccy] ?? null;
            const isMax = i === 0;
            const isMin = i === sorted.length - 1;
            const barColor = isMax
              ? "bg-emerald-500"
              : isMin
              ? "bg-blue-400"
              : yld > 3.5
              ? "bg-green-400"
              : yld > 2
              ? "bg-yellow-400"
              : "bg-blue-300";

            return (
              <div key={ccy} className="flex items-center gap-3">
                {/* Devise */}
                <div className="w-24 flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-sm">{CCY_FLAGS[ccy]}</span>
                  <span className="text-xs font-semibold text-gray-700 w-7">{ccy}</span>
                  {isMax && (
                    <span className="text-[9px] font-medium bg-emerald-100 text-emerald-700 rounded-full px-1">MAX</span>
                  )}
                  {isMin && (
                    <span className="text-[9px] font-medium bg-blue-100 text-blue-700 rounded-full px-1">MIN</span>
                  )}
                </div>

                {/* Barre */}
                <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {/* Yield */}
                <div className="w-16 text-right text-xs font-mono font-semibold text-gray-800">
                  {fmt(yld)}
                </div>

                {/* Delta jour */}
                <div className={`w-16 text-right text-[10px] font-mono flex items-center justify-end gap-0.5 ${deltaColor(delta)}`}>
                  {deltaIcon(delta)}
                  {delta !== null ? (delta >= 0 ? "+" : "") + delta.toFixed(3) : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Deux colonnes : Top Carry + Spreads Étroits ─────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Top carry */}
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
            🚀 Top Carry — Écarts les plus larges
          </p>
          <div className="space-y-2">
            {topCarry.map(({ long, short, bps }) => {
              const { label, color } = carryLabel(bps);
              return (
                <div key={`${long}${short}`} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">{CCY_FLAGS[long]}</span>
                    <span className="text-xs font-semibold text-gray-700">{long}</span>
                    <ArrowRight size={10} className="text-gray-300" />
                    <span className="text-xs">{CCY_FLAGS[short]}</span>
                    <span className="text-xs font-semibold text-gray-700">{short}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-gray-800">
                      +{bps} bps
                    </span>
                    <span className={`text-[9px] font-medium border rounded-full px-1.5 py-0.5 ${color}`}>
                      {label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[9px] text-gray-400 mt-3 border-t border-gray-50 pt-2">
            Long = devise avec yield le plus élevé · Court = yield le plus faible.
            Carry = emprunter la devise bon marché pour acheter la devise chère.
          </p>
        </div>

        {/* Spreads étroits */}
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
            🔄 Convergence — Spreads les plus étroits
          </p>
          <div className="space-y-2">
            {tightPairs.map(({ long, short, bps }) => (
              <div key={`${long}${short}`} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">{CCY_FLAGS[long]}</span>
                  <span className="text-xs font-semibold text-gray-700">{long}</span>
                  <span className="text-[9px] text-gray-400">/</span>
                  <span className="text-xs">{CCY_FLAGS[short]}</span>
                  <span className="text-xs font-semibold text-gray-700">{short}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-semibold text-gray-600">
                    {bps} bps
                  </span>
                  <span className="text-[9px] font-medium border rounded-full px-1.5 py-0.5 bg-purple-50 text-purple-700 border-purple-200">
                    Range
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-400 mt-3 border-t border-gray-50 pt-2">
            Spreads étroits = peu d'avantage de taux entre les deux devises.
            La paire est davantage guidée par d'autres facteurs (sentiment, données macro).
          </p>
        </div>
      </div>

      {/* ── Divergences + Movers du jour ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Divergences yield/FX */}
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">
            ⚡ Divergences Yield / FX
          </p>
          <p className="text-[9px] text-gray-400 mb-3">
            Yield et devise vont dans des sens opposés — signal d'anomalie ou de stress
          </p>
          {!fxDayPct ? (
            <p className="text-xs text-gray-400 italic">Données FX non disponibles.</p>
          ) : divergences.length === 0 ? (
            <p className="text-xs text-gray-400 italic">
              Aucune divergence — yield et devise évoluent de façon cohérente ce jour.
            </p>
          ) : (
            <>
              <div className="space-y-2.5">
                {divergences.map(({ ccy, yieldDelta, fxPct, type }) => (
                  <div key={ccy} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs">{CCY_FLAGS[ccy]}</span>
                      <span className="text-xs font-semibold text-gray-700 w-7">{ccy}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-1 justify-end flex-wrap">
                      {/* Yield delta */}
                      <span className={`text-[10px] font-mono font-semibold flex items-center gap-0.5 ${deltaColor(yieldDelta)}`}>
                        {deltaIcon(yieldDelta)}
                        <span className="text-[9px] text-gray-400 mr-0.5">yield</span>
                        {yieldDelta >= 0 ? "+" : ""}{yieldDelta.toFixed(3)}%
                      </span>
                      <span className="text-gray-300 text-[10px]">vs</span>
                      {/* FX delta */}
                      <span className={`text-[10px] font-mono font-semibold flex items-center gap-0.5 ${deltaColor(fxPct)}`}>
                        {deltaIcon(fxPct)}
                        <span className="text-[9px] text-gray-400 mr-0.5">FX</span>
                        {fxPct >= 0 ? "+" : ""}{fxPct.toFixed(2)}%
                      </span>
                      {/* Badge type */}
                      <span className={`text-[9px] border rounded-full px-1.5 py-0.5 shrink-0 ${
                        type === "stress"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-blue-50 text-blue-700 border-blue-200"
                      }`}>
                        {type === "stress" ? "⚠ stress dette" : "🛡 safe-haven"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-400 mt-3 border-t border-gray-50 pt-2">
                Stress dette : yield ↑ + devise ↓ (obligations vendues, devise sous pression).<br />
                Safe-haven : yield ↓ + devise ↑ (capitaux attirés malgré taux bas).
              </p>
            </>
          )}
        </div>

        {/* Movers du jour */}
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
            📊 Movers du jour (variation yield)
          </p>
          {movers.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Pas de mouvement significatif ce jour.</p>
          ) : (
            <div className="space-y-2">
              {movers.map(({ ccy, d }, i) => {
                const maxDelta = Math.max(...movers.map(m => Math.abs(m.d)));
                const barW = maxDelta > 0 ? (Math.abs(d) / maxDelta) * 100 : 0;
                return (
                  <div key={ccy} className="flex items-center gap-3">
                    <div className="w-20 flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-xs">{CCY_FLAGS[ccy]}</span>
                      <span className="text-xs font-semibold text-gray-700">{ccy}</span>
                      {i === 0 && (
                        <span className="text-[9px] bg-orange-100 text-orange-700 rounded-full px-1">1er</span>
                      )}
                    </div>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${d > 0 ? "bg-green-400" : "bg-red-400"}`}
                        style={{ width: `${barW}%` }}
                      />
                    </div>
                    <div className={`w-16 text-right text-[10px] font-mono font-semibold ${deltaColor(d)}`}>
                      {d >= 0 ? "+" : ""}{d.toFixed(3)}%
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[9px] text-gray-400 mt-3 border-t border-gray-50 pt-2">
            Variation du rendement 10Y par rapport à la clôture de la veille.
            Un yield qui monte = signal hawkish / pression vendeuse sur l'obligataire.
          </p>
        </div>
      </div>

    </div>
  );
}
