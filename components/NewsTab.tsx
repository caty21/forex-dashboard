"use client";

import { useState, useMemo } from "react";
import { ExternalLink, RefreshCw, TrendingUp, TrendingDown, Minus, Loader2, Zap } from "lucide-react";
import type { NewsItem } from "@/app/api/news/route";
import type { Currency } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CCY_FLAGS: Record<Currency, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵",
  CHF: "🇨🇭", CAD: "🇨🇦", AUD: "🇦🇺", NZD: "🇳🇿",
};

const CCY_LIST: Currency[] = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];

const SOURCE_COLORS: Record<string, string> = {
  "InvestingLive":    "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "Reuters":          "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "Bloomberg Economics": "bg-sky-500/20 text-sky-400 border-sky-500/30",
  "Bloomberg CB":     "bg-sky-500/20 text-sky-400 border-sky-500/30",
  "Bloomberg FX":     "bg-sky-500/20 text-sky-400 border-sky-500/30",
};

const CAT_COLORS: Record<string, string> = {
  "Risk-Off":       "bg-red-500/15 text-red-400",
  "Risk-On":        "bg-emerald-500/15 text-emerald-400",
  "Géopolitique":   "bg-purple-500/15 text-purple-400",
  "Énergie":        "bg-yellow-500/15 text-yellow-400",
  "Banque Centrale": "bg-blue-500/15 text-blue-400",
  "Commodités":     "bg-orange-500/15 text-orange-400",
  "Chine":          "bg-red-600/15 text-red-400",
  "Données Macro":  "bg-slate-500/15 text-slate-400",
  "Commerce":       "bg-indigo-500/15 text-indigo-400",
  "Agriculture":    "bg-green-500/15 text-green-400",
  "Or":             "bg-yellow-600/15 text-yellow-400",
  "Métaux":         "bg-gray-400/15 text-gray-300",
};

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return "à l'instant";
  if (mins < 60)  return `il y a ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `il y a ${days}j`;
}

// ── Composant principal ───────────────────────────────────────────────────────

interface Props {
  items:   NewsItem[];
  loading: boolean;
  onRefresh: () => void;
}

export default function NewsTab({ items, loading, onRefresh }: Props) {
  const [filterCcy, setFilterCcy] = useState<Currency | "ALL">("ALL");
  const [filterDir, setFilterDir] = useState<"all" | "bullish" | "bearish">("all");

  const filtered = useMemo(() => {
    return items.filter(item => {
      if (filterCcy !== "ALL" && !item.impacts.some(i => i.ccy === filterCcy)) return false;
      if (filterDir !== "all") {
        const hasDir = filterCcy === "ALL"
          ? item.impacts.some(i => i.direction === filterDir)
          : item.impacts.some(i => i.ccy === filterCcy && i.direction === filterDir);
        if (!hasDir) return false;
      }
      return true;
    });
  }, [items, filterCcy, filterDir]);

  // Compter les impacts par devise pour les badges de filtre
  const ccyCount = useMemo(() => {
    const counts: Partial<Record<Currency, { bull: number; bear: number }>> = {};
    for (const item of items) {
      for (const imp of item.impacts) {
        if (!counts[imp.ccy]) counts[imp.ccy] = { bull: 0, bear: 0 };
        if (imp.direction === "bullish") counts[imp.ccy]!.bull++;
        if (imp.direction === "bearish") counts[imp.ccy]!.bear++;
      }
    }
    return counts;
  }, [items]);

  return (
    <div className="space-y-4">
      {/* Barre de filtres */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
            Filtrer par devise
          </span>
          <div className="flex items-center gap-2">
            {(["all", "bullish", "bearish"] as const).map(d => (
              <button
                key={d}
                onClick={() => setFilterDir(d)}
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors ${
                  filterDir === d
                    ? d === "bullish" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : d === "bearish" ? "bg-red-500/20 text-red-400 border border-red-500/30"
                      : "bg-slate-700 text-slate-300"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {d === "all" ? "Tous" : d === "bullish" ? "↑ Haussier" : "↓ Baissier"}
              </button>
            ))}
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 disabled:opacity-50"
            >
              <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
              {loading ? "..." : "Actualiser"}
            </button>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterCcy("ALL")}
            className={`text-[11px] px-3 py-1 rounded-full font-semibold transition-colors ${
              filterCcy === "ALL" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            Toutes ({items.length})
          </button>
          {CCY_LIST.map(ccy => {
            const cnt = ccyCount[ccy];
            if (!cnt) return null;
            const isActive = filterCcy === ccy;
            return (
              <button
                key={ccy}
                onClick={() => setFilterCcy(ccy === filterCcy ? "ALL" : ccy)}
                className={`flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full font-semibold transition-colors ${
                  isActive ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "text-slate-500 hover:text-slate-300 border border-slate-700/50"
                }`}
              >
                <span>{CCY_FLAGS[ccy]}</span>
                <span>{ccy}</span>
                <span className="flex items-center gap-0.5 text-[9px]">
                  {cnt.bull > 0 && <span className="text-emerald-400">↑{cnt.bull}</span>}
                  {cnt.bear > 0 && <span className="text-red-400">↓{cnt.bear}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Liste de news */}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-slate-600">
          <Loader2 size={20} className="animate-spin mr-2" />
          <span className="text-sm">Chargement des actualités…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-600 text-sm">
          Aucune actualité pour ce filtre.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => (
            <NewsCard key={item.id} item={item} activeCcy={filterCcy === "ALL" ? null : filterCcy} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── NewsCard ──────────────────────────────────────────────────────────────────

function NewsCard({ item, activeCcy }: { item: NewsItem; activeCcy: Currency | null }) {
  const [expanded, setExpanded] = useState(false);

  const visibleImpacts = activeCcy
    ? item.impacts.filter(i => i.ccy === activeCcy)
    : item.impacts;

  const overallDir = visibleImpacts.some(i => i.direction === "bullish") && visibleImpacts.some(i => i.direction === "bearish")
    ? "mixed"
    : visibleImpacts.some(i => i.direction === "bullish") ? "bullish"
    : visibleImpacts.some(i => i.direction === "bearish") ? "bearish"
    : "neutral";

  const borderColor =
    overallDir === "bullish" ? "border-emerald-500/20" :
    overallDir === "bearish" ? "border-red-500/20" :
    overallDir === "mixed"   ? "border-amber-500/20" :
    "border-slate-700/30";

  const bgColor =
    overallDir === "bullish" ? "bg-emerald-500/5" :
    overallDir === "bearish" ? "bg-red-500/5" :
    "bg-slate-800/30";

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} overflow-hidden`}>
      <div className="p-3">
        {/* Header : source + date */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${SOURCE_COLORS[item.source] ?? "bg-slate-700/40 text-slate-400 border-slate-700/30"}`}>
              {item.source}
            </span>
            {item.categories.slice(0, 2).map(cat => (
              <span key={cat} className={`text-[9px] px-1.5 py-0.5 rounded-full ${CAT_COLORS[cat] ?? "bg-slate-700/20 text-slate-500"}`}>
                {cat}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-slate-600 shrink-0">{formatRelativeTime(item.publishedAt)}</span>
        </div>

        {/* Titre */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start gap-1.5 hover:text-white transition-colors"
        >
          <span className="text-[12px] text-slate-200 leading-snug font-medium group-hover:text-white">
            {item.title}
          </span>
          <ExternalLink size={10} className="text-slate-600 group-hover:text-slate-400 shrink-0 mt-0.5" />
        </a>

        {/* Summary si dispo */}
        {item.summary && (
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed line-clamp-2">
            {item.summary}
          </p>
        )}

        {/* Impact badges */}
        {visibleImpacts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {visibleImpacts.map(imp => (
              <div
                key={imp.ccy}
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  imp.direction === "bullish" ? "bg-emerald-500/15 text-emerald-400" :
                  imp.direction === "bearish" ? "bg-red-500/15 text-red-400" :
                  "bg-slate-700/40 text-slate-400"
                }`}
                title={imp.reason}
              >
                {CCY_FLAGS[imp.ccy]} {imp.ccy}
                {imp.direction === "bullish" ? <TrendingUp size={9} /> :
                 imp.direction === "bearish" ? <TrendingDown size={9} /> :
                 <Minus size={9} />}
              </div>
            ))}

            {visibleImpacts.length > 0 && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-[9px] text-slate-600 hover:text-slate-400 px-1.5 py-0.5 rounded-full border border-slate-700/30"
              >
                {expanded ? "Masquer" : "Détail"}
              </button>
            )}
          </div>
        )}

        {/* Détail des raisons */}
        {expanded && visibleImpacts.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-slate-700/30 pt-2">
            {visibleImpacts.map(imp => (
              <div key={imp.ccy} className="flex items-start gap-1.5 text-[10px]">
                <span className={`shrink-0 font-bold ${
                  imp.direction === "bullish" ? "text-emerald-400" :
                  imp.direction === "bearish" ? "text-red-400" : "text-slate-500"
                }`}>
                  {CCY_FLAGS[imp.ccy]} {imp.ccy} {imp.direction === "bullish" ? "↑" : imp.direction === "bearish" ? "↓" : "→"}
                </span>
                <span className="text-slate-500 leading-relaxed">{imp.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
