"use client";

import { useState } from "react";
import { CURRENCY_META } from "@/lib/constants";
import type { Currency } from "@/lib/types";

interface MyfxSymbol {
  name:           string;
  longPercentage: number;
  shortPercentage:number;
  longVolume:     number;
  shortVolume:    number;
  longPositions:  number;
  shortPositions: number;
  totalPositions: number;
  avgLongPrice?:  number;
  avgShortPrice?: number;
}

interface Props {
  symbols: MyfxSymbol[] | null;
}

const PAIRS: { base: Currency; quote: Currency; std: string }[] = [
  { base: "EUR", quote: "USD", std: "EURUSD" },
  { base: "GBP", quote: "USD", std: "GBPUSD" },
  { base: "USD", quote: "JPY", std: "USDJPY" },
  { base: "USD", quote: "CHF", std: "USDCHF" },
  { base: "USD", quote: "CAD", std: "USDCAD" },
  { base: "AUD", quote: "USD", std: "AUDUSD" },
  { base: "NZD", quote: "USD", std: "NZDUSD" },
  { base: "EUR", quote: "GBP", std: "EURGBP" },
  { base: "EUR", quote: "JPY", std: "EURJPY" },
  { base: "EUR", quote: "CHF", std: "EURCHF" },
  { base: "EUR", quote: "CAD", std: "EURCAD" },
  { base: "EUR", quote: "AUD", std: "EURAUD" },
  { base: "EUR", quote: "NZD", std: "EURNZD" },
  { base: "GBP", quote: "JPY", std: "GBPJPY" },
  { base: "GBP", quote: "CHF", std: "GBPCHF" },
  { base: "GBP", quote: "CAD", std: "GBPCAD" },
  { base: "GBP", quote: "AUD", std: "GBPAUD" },
  { base: "GBP", quote: "NZD", std: "GBPNZD" },
  { base: "AUD", quote: "JPY", std: "AUDJPY" },
  { base: "AUD", quote: "CAD", std: "AUDCAD" },
  { base: "AUD", quote: "CHF", std: "AUDCHF" },
  { base: "AUD", quote: "NZD", std: "AUDNZD" },
  { base: "CAD", quote: "JPY", std: "CADJPY" },
  { base: "CHF", quote: "JPY", std: "CHFJPY" },
  { base: "NZD", quote: "JPY", std: "NZDJPY" },
  { base: "NZD", quote: "CAD", std: "NZDCAD" },
  { base: "NZD", quote: "CHF", std: "NZDCHF" },
  { base: "CAD", quote: "CHF", std: "CADCHF" },
];

const GROUPS = [
  { label: "Majeures USD",    pairs: ["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD"] },
  { label: "Crosses EUR",     pairs: ["EURGBP","EURJPY","EURCHF","EURCAD","EURAUD","EURNZD"] },
  { label: "Crosses GBP",     pairs: ["GBPJPY","GBPCHF","GBPCAD","GBPAUD","GBPNZD"] },
  { label: "Crosses AUD/NZD", pairs: ["AUDJPY","AUDCAD","AUDCHF","AUDNZD","NZDJPY","NZDCAD","NZDCHF"] },
  { label: "Crosses CAD/CHF", pairs: ["CADJPY","CHFJPY","CADCHF"] },
];

function fmtVol(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}

function fmtPos(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Barre Long/Short % ────────────────────────────────────────────────────────
function PctBar({ longPct }: { longPct: number }) {
  const extreme = longPct >= 70 || longPct <= 30;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[11px] tabular-nums font-semibold w-8 text-right ${extreme ? "text-amber-400" : "text-emerald-400"}`}>
        {longPct}%
      </span>
      <div className="relative flex h-2.5 w-24 rounded-full overflow-hidden bg-slate-700">
        <div
          className={`h-full transition-all rounded-full ${extreme ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${longPct}%` }}
        />
        <div className="absolute inset-0 flex">
          <div style={{ width: `${longPct}%` }} />
          <div className="flex-1 bg-red-500/70 rounded-r-full" />
        </div>
      </div>
      <span className={`text-[11px] tabular-nums font-semibold w-8 ${extreme ? "text-amber-400" : "text-red-400"}`}>
        {100 - longPct}%
      </span>
      {extreme && <span className="text-amber-400 text-[11px] font-bold" title="Signal contrarien">⚡</span>}
    </div>
  );
}

// ── Barre Volume ──────────────────────────────────────────────────────────────
function VolBar({ longVol, shortVol }: { longVol: number; shortVol: number }) {
  const total   = longVol + shortVol || 1;
  const longPct = Math.round((longVol / total) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] tabular-nums text-emerald-400 w-10 text-right">{fmtVol(longVol)}</span>
      <div className="relative flex h-1.5 w-20 rounded-full overflow-hidden bg-slate-700">
        <div className="h-full bg-emerald-500/70" style={{ width: `${longPct}%` }} />
        <div className="flex-1 bg-red-500/60" />
      </div>
      <span className="text-[10px] tabular-nums text-red-400 w-10">{fmtVol(shortVol)}</span>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────
function PairRow({ pairName, sym, base, quote, showVol }: {
  pairName: string;
  sym:      MyfxSymbol | undefined;
  base:     Currency;
  quote:    Currency;
  showVol:  boolean;
}) {
  const baseMeta  = CURRENCY_META[base];
  const quoteMeta = CURRENCY_META[quote];
  const extreme   = sym && (sym.longPercentage >= 70 || sym.longPercentage <= 30);

  return (
    <tr className={`border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors ${extreme ? "bg-amber-500/5" : ""}`}>
      {/* Paire */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <span className="text-base leading-none">{baseMeta?.flag}</span>
          <span className="text-base leading-none">{quoteMeta?.flag}</span>
          <span className={`text-xs font-bold ${extreme ? "text-amber-300" : "text-slate-200"}`}>{pairName}</span>
        </div>
      </td>

      {/* % Long/Short */}
      <td className="py-2.5 px-3">
        {sym
          ? <PctBar longPct={sym.longPercentage} />
          : <span className="text-[10px] text-slate-700 italic">N/D</span>}
      </td>

      {/* Volume lots */}
      {showVol && (
        <td className="py-2.5 px-3">
          {sym
            ? <VolBar longVol={sym.longVolume} shortVol={sym.shortVolume} />
            : <span className="text-[10px] text-slate-700">—</span>}
        </td>
      )}

      {/* Positions (traders) */}
      <td className="py-2.5 px-3 whitespace-nowrap">
        {sym ? (
          <div className="flex items-center gap-1 text-[10px] tabular-nums">
            <span className="text-emerald-400">{fmtPos(sym.longPositions)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-red-400">{fmtPos(sym.shortPositions)}</span>
          </div>
        ) : <span className="text-slate-700">—</span>}
      </td>

      {/* Prix moy. */}
      <td className="py-2.5 px-3 text-right hidden lg:table-cell">
        {sym?.avgLongPrice ? (
          <div className="text-[9px] tabular-nums space-y-0.5">
            <div className="text-emerald-400/70">{sym.avgLongPrice.toFixed(4)}</div>
            <div className="text-red-400/70">{sym.avgShortPrice?.toFixed(4) ?? "—"}</div>
          </div>
        ) : <span className="text-slate-700 text-[10px]">—</span>}
      </td>
    </tr>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SentimentPairsTab({ symbols }: Props) {
  const [showVol, setShowVol] = useState(true);

  const symMap: Record<string, MyfxSymbol> = {};
  for (const s of symbols ?? []) symMap[s.name] = s;

  const pairMap: Record<string, { base: Currency; quote: Currency }> = {};
  for (const p of PAIRS) pairMap[p.std] = { base: p.base, quote: p.quote };

  // Paires avec signal contrarien pour le résumé
  const contrarians = PAIRS
    .map(p => ({ ...p, sym: symMap[p.std] }))
    .filter(p => p.sym && (p.sym.longPercentage >= 70 || p.sym.longPercentage <= 30))
    .sort((a, b) => {
      const scoreA = Math.abs((a.sym!.longPercentage) - 50);
      const scoreB = Math.abs((b.sym!.longPercentage) - 50);
      return scoreB - scoreA;
    });

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Sentiment Retail — Myfxbook Community Outlook
          </h2>
          <p className="text-[11px] text-slate-600 mt-0.5">
            {symbols ? `${Object.keys(symMap).length} paires` : "chargement…"}
            {" "}· Long % = traders retail haussiers sur la devise de base
            {" "}· ⚡ signal contrarien (&gt;70% ou &lt;30%)
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showVol}
            onChange={e => setShowVol(e.target.checked)}
            className="w-3 h-3 accent-amber-500"
          />
          Afficher volumes (lots)
        </label>
      </div>

      {/* Résumé signaux contrarien */}
      {contrarians.length > 0 && (
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-2">
            ⚡ {contrarians.length} signal{contrarians.length > 1 ? "s" : ""} contrarien{contrarians.length > 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {contrarians.slice(0, 8).map(p => {
              const dir = p.sym!.longPercentage >= 70 ? "short" : "long";
              return (
                <div key={p.std} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${
                  dir === "short"
                    ? "bg-red-500/10 border-red-500/20 text-red-300"
                    : "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                }`}>
                  <span>{CURRENCY_META[p.base]?.flag}{CURRENCY_META[p.quote]?.flag}</span>
                  <span className="font-bold">{p.std}</span>
                  <span className="text-[10px] opacity-70">
                    {p.sym!.longPercentage}%L → signal {dir === "short" ? "↓ SELL" : "↑ BUY"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tables par groupe */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
        {GROUPS.map((group, gi) => (
          <div key={group.label}>
            {/* Group header */}
            <div className={`px-4 py-2 border-b border-slate-800 ${gi > 0 ? "border-t border-t-slate-700" : ""} bg-slate-900/60`}>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                {group.label}
              </span>
            </div>

            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="text-[9px] text-slate-600 uppercase tracking-wider border-b border-slate-800/60">
                  <th className="py-1.5 px-3 text-left w-32">Paire</th>
                  <th className="py-1.5 px-3 text-left">% Long / Short (retail)</th>
                  {showVol && <th className="py-1.5 px-3 text-left">Volume lots (L / S)</th>}
                  <th className="py-1.5 px-3 text-left">Traders (L / S)</th>
                  <th className="py-1.5 px-3 text-right hidden lg:table-cell">Prix moy. entrée</th>
                </tr>
              </thead>
              <tbody>
                {group.pairs.map(pairName => {
                  const def = pairMap[pairName];
                  return (
                    <PairRow
                      key={pairName}
                      pairName={pairName}
                      sym={symMap[pairName]}
                      base={def?.base ?? "USD"}
                      quote={def?.quote ?? "EUR"}
                      showVol={showVol}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-800 text-[10px] text-slate-600 flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Long
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Short
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-amber-400">⚡</span> Contrarien (&gt;70% ou &lt;30%)
          </span>
          <span className="ml-auto hidden sm:inline">Source : Myfxbook Community Outlook · ~50k traders retail trackés</span>
        </div>
      </div>
    </div>
  );
}
