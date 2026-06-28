"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

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

function fmt(n: number | null, dec = 3): string {
  return n !== null ? n.toFixed(dec) + "%" : "—";
}

function deltaColor(d: number | null) {
  if (d === null || d === 0) return "text-slate-500";
  return d > 0 ? "text-emerald-400" : "text-red-400";
}

function deltaIcon(d: number | null) {
  if (d === null || Math.abs(d) < 0.001) return <Minus size={10} />;
  return d > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />;
}

function carryStrength(bps: number): { label: string; color: string } {
  if (bps >= 400) return { label: "Très fort", color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30" };
  if (bps >= 200) return { label: "Fort",       color: "text-green-400  bg-green-500/15  border-green-500/30"   };
  if (bps >= 100) return { label: "Modéré",     color: "text-yellow-400 bg-yellow-500/15 border-yellow-500/30"  };
  return               { label: "Faible",    color: "text-slate-400  bg-slate-700/30  border-slate-600/30"  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function YieldsTab({ yieldsData, fxDayPct }: Props) {
  if (!yieldsData) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
        Chargement des rendements…
      </div>
    );
  }

  const { yields, dayDeltas = {} } = yieldsData;

  const sorted = useMemo(() => {
    return (Object.entries(yields) as [string, number | null][])
      .filter(([, v]) => v !== null)
      .sort(([, a], [, b]) => (b as number) - (a as number)) as [string, number][];
  }, [yields]);

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
        Données indisponibles
      </div>
    );
  }

  const maxYield = sorted[0][1];

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

  const topCarry = carryPairs.slice(0, 4);

  const movers = useMemo(() => {
    return sorted
      .map(([ccy, yld]) => ({ ccy, yld, d: dayDeltas[ccy] ?? 0 }))
      .filter(x => Math.abs(x.d) >= 0.001)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  }, [sorted, dayDeltas]);

  return (
    <div className="space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Rendements Souverains 10Y</h2>
          <p className="text-[10px] text-slate-600 mt-0.5">Trading Economics · EUR = Bund allemand</p>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-emerald-400 font-semibold">{sorted[0][0]} {fmt(maxYield)} ↑ max</span>
          <span className="text-slate-700">|</span>
          <span className="text-sky-400 font-semibold">{sorted.at(-1)![0]} {fmt(sorted.at(-1)![1])} ↓ min</span>
          {topCarry[0] && (
            <>
              <span className="text-slate-700">|</span>
              <span className="text-amber-400 font-semibold">
                ★ Top carry : {topCarry[0].long}→{topCarry[0].short} +{topCarry[0].bps}bp
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Classement Yield 10Y + Movers côte à côte ──────────────────────── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Classement Yield 10Y */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
            Classement Yield 10Y
          </p>
          <div className="space-y-2.5">
            {sorted.map(([ccy, yld], i) => {
              const pct   = maxYield > 0 ? (yld / maxYield) * 100 : 0;
              const delta = dayDeltas[ccy] ?? null;
              const isMax = i === 0;
              const isMin = i === sorted.length - 1;
              const barColor = isMax
                ? "bg-emerald-500"
                : isMin
                ? "bg-sky-400"
                : yld > 3.5 ? "bg-green-500"
                : yld > 2   ? "bg-yellow-500"
                : "bg-sky-500";

              return (
                <div key={ccy} className="flex items-center gap-3">
                  <div className="w-20 flex items-center gap-1.5 shrink-0">
                    <span className="text-sm">{CCY_FLAGS[ccy]}</span>
                    <span className="text-[11px] font-semibold text-slate-300 w-7">{ccy}</span>
                    {isMax && <span className="text-[8px] font-medium bg-emerald-500/20 text-emerald-400 rounded-full px-1.5">MAX</span>}
                    {isMin && <span className="text-[8px] font-medium bg-sky-500/20 text-sky-400 rounded-full px-1.5">MIN</span>}
                  </div>

                  <div className="flex-1 bg-slate-700/40 rounded-full h-2 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>

                  <div className="w-14 text-right text-[11px] font-mono font-semibold text-slate-200">
                    {fmt(yld)}
                  </div>

                  <div className={`w-14 text-right text-[10px] font-mono flex items-center justify-end gap-0.5 ${deltaColor(delta)}`}>
                    {deltaIcon(delta)}
                    {delta !== null ? (delta >= 0 ? "+" : "") + delta.toFixed(3) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Movers du jour */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest mb-3">
            📊 Movers du Jour — Yield 10Y
          </p>
          {movers.length === 0 ? (
            <p className="text-[11px] text-slate-600 italic">Aucun mouvement significatif.</p>
          ) : (
            <div className="space-y-2.5">
              {movers.map(({ ccy, yld, d }, i) => {
                const maxAbs = Math.max(...movers.map(m => Math.abs(m.d)));
                const barW   = maxAbs > 0 ? (Math.abs(d) / maxAbs) * 100 : 0;
                const isTop  = i === 0;
                return (
                  <div key={ccy} className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]">{CCY_FLAGS[ccy]}</span>
                      <span className={`text-[10px] font-semibold ${isTop ? "text-slate-100" : "text-slate-300"}`}>
                        {ccy}
                      </span>
                      {isTop && (
                        <span className="text-[8px] bg-orange-500/20 text-orange-400 rounded-full px-1.5">1er</span>
                      )}
                      <span className="ml-auto text-[9px] font-mono text-slate-500">{fmt(yld)}</span>
                      <span className={`text-[10px] font-mono font-bold w-16 text-right ${deltaColor(d)}`}>
                        {d >= 0 ? "+" : ""}{d.toFixed(3)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 pl-5">
                      <div className="flex-1 bg-slate-800 rounded-full h-1 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${d > 0 ? "bg-emerald-500" : "bg-red-500"}`}
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[8px] text-slate-700 mt-3 pt-2 border-t border-slate-800">
            Variation vs clôture veille · Yield ↑ = signal hawkish / pression vendeuse
          </p>
        </div>

      </div>
    </div>
  );
}
