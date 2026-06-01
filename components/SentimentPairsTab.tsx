"use client";

import { CURRENCY_META } from "@/lib/constants";
import type { Currency } from "@/lib/types";

interface MyfxSymbol {
  name: string;
  longPercentage: number;
  shortPercentage: number;
  totalPositions: number;
}

interface Props {
  symbols: MyfxSymbol[] | null;
}

// Toutes les 28 combinaisons (C(8,2)) des 8 devises — base/quote dans l'ordre standard Forex
const PAIRS: { base: Currency; quote: Currency; std: string }[] = [
  // Majeures USD
  { base: "EUR", quote: "USD", std: "EURUSD" },
  { base: "GBP", quote: "USD", std: "GBPUSD" },
  { base: "USD", quote: "JPY", std: "USDJPY" },
  { base: "USD", quote: "CHF", std: "USDCHF" },
  { base: "USD", quote: "CAD", std: "USDCAD" },
  { base: "AUD", quote: "USD", std: "AUDUSD" },
  { base: "NZD", quote: "USD", std: "NZDUSD" },
  // Crosses EUR
  { base: "EUR", quote: "GBP", std: "EURGBP" },
  { base: "EUR", quote: "JPY", std: "EURJPY" },
  { base: "EUR", quote: "CHF", std: "EURCHF" },
  { base: "EUR", quote: "CAD", std: "EURCAD" },
  { base: "EUR", quote: "AUD", std: "EURAUD" },
  { base: "EUR", quote: "NZD", std: "EURNZD" },
  // Crosses GBP
  { base: "GBP", quote: "JPY", std: "GBPJPY" },
  { base: "GBP", quote: "CHF", std: "GBPCHF" },
  { base: "GBP", quote: "CAD", std: "GBPCAD" },
  { base: "GBP", quote: "AUD", std: "GBPAUD" },
  { base: "GBP", quote: "NZD", std: "GBPNZD" },
  // Crosses AUD
  { base: "AUD", quote: "JPY", std: "AUDJPY" },
  { base: "AUD", quote: "CAD", std: "AUDCAD" },
  { base: "AUD", quote: "CHF", std: "AUDCHF" },
  { base: "AUD", quote: "NZD", std: "AUDNZD" },
  // Crosses CAD
  { base: "CAD", quote: "JPY", std: "CADJPY" },
  // Crosses CHF
  { base: "CHF", quote: "JPY", std: "CHFJPY" },
  // Crosses NZD
  { base: "NZD", quote: "JPY", std: "NZDJPY" },
  { base: "NZD", quote: "CAD", std: "NZDCAD" },
  { base: "NZD", quote: "CHF", std: "NZDCHF" },
  // Croisée manquante CAD/CHF
  { base: "CAD", quote: "CHF", std: "CADCHF" },
];

// Groupes pour l'affichage
const GROUPS = [
  { label: "Majeures USD",   pairs: ["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD"] },
  { label: "Crosses EUR",    pairs: ["EURGBP","EURJPY","EURCHF","EURCAD","EURAUD","EURNZD"] },
  { label: "Crosses GBP",    pairs: ["GBPJPY","GBPCHF","GBPCAD","GBPAUD","GBPNZD"] },
  { label: "Crosses AUD/NZD",pairs: ["AUDJPY","AUDCAD","AUDCHF","AUDNZD","NZDJPY","NZDCAD","NZDCHF"] },
  { label: "Crosses CAD/CHF",pairs: ["CADJPY","CHFJPY","CADCHF"] },
];

function SentimentBar({ longPct }: { longPct: number }) {
  const isContrarian = longPct >= 70 || longPct <= 30;
  return (
    <div className="flex items-center gap-1.5 min-w-[120px]">
      <span className={`text-[10px] tabular-nums font-medium w-8 text-right ${isContrarian ? "text-amber-600 font-bold" : "text-green-600"}`}>
        {longPct}%
      </span>
      <div className="flex h-2 w-20 rounded-full overflow-hidden">
        <div className="bg-green-400 transition-all" style={{ width: `${longPct}%` }} />
        <div className="bg-red-400 flex-1" />
      </div>
      <span className={`text-[10px] tabular-nums font-medium w-8 ${isContrarian ? "text-amber-600 font-bold" : "text-red-500"}`}>
        {100 - longPct}%
      </span>
      {isContrarian && (
        <span className="text-[9px] text-amber-500 font-semibold">⚠</span>
      )}
    </div>
  );
}

export default function SentimentPairsTab({ symbols }: Props) {
  const symMap: Record<string, MyfxSymbol> = {};
  for (const s of symbols ?? []) symMap[s.name] = s;

  const pairMap: Record<string, { base: Currency; quote: Currency }> = {};
  for (const p of PAIRS) pairMap[p.std] = { base: p.base, quote: p.quote };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-800">Sentiment retail — toutes les paires</h2>
        <p className="text-[10px] text-gray-400 mt-0.5">
          Source : Myfxbook Community Outlook · {symbols ? `${Object.keys(symMap).length} paires disponibles` : "chargement…"}
          · Long = retail haussier sur la devise de base · ⚠ = signal contrarien (&gt;70% ou &lt;30%)
        </p>
      </div>

      <div className="overflow-x-auto">
        {GROUPS.map((group) => (
          <div key={group.label}>
            {/* Group header */}
            <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100">
              <span className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider">{group.label}</span>
            </div>
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-[9px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <th className="py-1.5 px-4 text-left w-32">Paire</th>
                  <th className="py-1.5 px-4 text-left">Long L / Short S</th>
                  <th className="py-1.5 px-4 text-right w-28">Positions totales</th>
                </tr>
              </thead>
              <tbody>
                {group.pairs.map((pairName) => {
                  const def = pairMap[pairName];
                  const sym = symMap[pairName];
                  const baseMeta  = def ? CURRENCY_META[def.base]  : null;
                  const quoteMeta = def ? CURRENCY_META[def.quote] : null;

                  return (
                    <tr key={pairName} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      {/* Pair name */}
                      <td className="py-2 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm leading-none">{baseMeta?.flag}</span>
                          <span className="text-sm leading-none">{quoteMeta?.flag}</span>
                          <span className="text-xs font-semibold text-gray-800">{pairName}</span>
                        </div>
                      </td>

                      {/* Sentiment bar */}
                      <td className="py-2 px-4">
                        {sym ? (
                          <SentimentBar longPct={sym.longPercentage} />
                        ) : (
                          <span className="text-[10px] text-gray-300 italic">Non disponible sur Myfxbook</span>
                        )}
                      </td>

                      {/* Total positions */}
                      <td className="py-2 px-4 text-right">
                        {sym ? (
                          <span className="text-[10px] text-gray-500 tabular-nums">
                            {sym.totalPositions.toLocaleString("fr-FR")}
                          </span>
                        ) : (
                          <span className="text-gray-200">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
        Long % = % des positions retail haussières sur la devise de base de la paire · Données Myfxbook Community Outlook
      </div>
    </div>
  );
}
