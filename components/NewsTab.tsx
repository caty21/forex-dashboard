"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  ExternalLink, RefreshCw, TrendingUp, TrendingDown, Minus,
  Loader2, Radio, AlertTriangle, Landmark, Globe, BarChart2, Zap,
} from "lucide-react";
import type { NewsItem } from "@/app/api/news/route";
import type { Currency } from "@/lib/types";

// ── Constantes ────────────────────────────────────────────────────────────────

const CCY_FLAGS: Record<Currency, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵",
  CHF: "🇨🇭", CAD: "🇨🇦", AUD: "🇦🇺", NZD: "🇳🇿",
};
const CCY_LIST: Currency[] = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];

// Catégories prioritaires avec icône et couleur
const CATEGORY_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  "Discours BC":       { icon: <Landmark size={11} />,    color: "bg-blue-500/20 text-blue-400 border-blue-500/30",    label: "Discours BC" },
  "Chef d'État":       { icon: <Globe size={11} />,        color: "bg-violet-500/20 text-violet-400 border-violet-500/30", label: "Chef d'État" },
  "Décision Taux":     { icon: <Radio size={11} />,        color: "bg-amber-500/20 text-amber-400 border-amber-500/30",  label: "Décision Taux" },
  "Probabilités Taux": { icon: <BarChart2 size={11} />,    color: "bg-sky-500/20 text-sky-400 border-sky-500/30",       label: "OIS / Proba Taux" },
  "Données Clés":      { icon: <BarChart2 size={11} />,    color: "bg-slate-400/20 text-slate-300 border-slate-500/30", label: "Données Clés" },
  "Emploi":            { icon: <BarChart2 size={11} />,    color: "bg-slate-400/20 text-slate-300 border-slate-500/30", label: "Emploi" },
  "Inflation":         { icon: <Zap size={11} />,          color: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "Inflation" },
  "Crise":             { icon: <AlertTriangle size={11} />, color: "bg-red-600/20 text-red-400 border-red-500/30",      label: "Crise" },
  "Guerre":            { icon: <AlertTriangle size={11} />, color: "bg-red-700/20 text-red-400 border-red-600/30",      label: "Guerre" },
  "Géopolitique":      { icon: <Globe size={11} />,        color: "bg-purple-500/20 text-purple-400 border-purple-500/30", label: "Géopolitique" },
  "Risk-Off":          { icon: <TrendingDown size={11} />, color: "bg-red-500/20 text-red-400 border-red-500/30",       label: "Risk-Off" },
  "Risk-On":           { icon: <TrendingUp size={11} />,   color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Risk-On" },
  "Énergie":           { icon: <Zap size={11} />,          color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "Énergie" },
  "Banque Centrale":   { icon: <Landmark size={11} />,     color: "bg-blue-500/20 text-blue-400 border-blue-500/30",   label: "Banque Centrale" },
  "Commodités":        { icon: <BarChart2 size={11} />,    color: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "Commodités" },
  "Chine":             { icon: <Globe size={11} />,        color: "bg-red-600/20 text-red-400 border-red-600/30",      label: "Chine" },
};

// Ordre d'affichage des filtres catégorie (par priorité signal)
const PRIORITY_CATS = [
  "Discours BC", "Décision Taux", "Probabilités Taux",
  "Chef d'État", "Données Clés", "Emploi", "Inflation",
  "Crise", "Guerre", "Géopolitique", "Risk-Off", "Risk-On",
  "Énergie", "Commodités", "Chine",
];

const SOURCE_COLORS: Record<string, string> = {
  "InvestingLive":       "bg-amber-500/20 text-amber-400",
  "Reuters":             "bg-orange-500/20 text-orange-400",
  "Bloomberg Economics": "bg-sky-500/20 text-sky-400",
  "Bloomberg CB":        "bg-sky-500/20 text-sky-400",
  "Bloomberg FX":        "bg-sky-500/20 text-sky-400",
};

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return "à l'instant";
  if (mins < 60)  return `il y a ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `il y a ${hrs}h`;
  return `il y a ${Math.floor(hrs / 24)}j`;
}

// ── Composant principal ───────────────────────────────────────────────────────

interface Props {
  items:     NewsItem[];
  loading:   boolean;
  onRefresh: () => void;
}

export default function NewsTab({ items, loading, onRefresh }: Props) {
  const [filterCcy,      setFilterCcy]      = useState<Currency | "ALL">("ALL");
  const [filterCat,      setFilterCat]      = useState<string | "ALL">("ALL");
  const [filterDir,      setFilterDir]      = useState<"all" | "bullish" | "bearish">("all");
  const [priorityOnly,   setPriorityOnly]   = useState(false);
  const [autoRefresh,    setAutoRefresh]    = useState(true);
  const [lastRefreshAt,  setLastRefreshAt]  = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh toutes les 5 minutes
  useEffect(() => {
    if (!autoRefresh) { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => { onRefresh(); setLastRefreshAt(new Date()); }, 5 * 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, onRefresh]);

  const isPriorityItem = (item: NewsItem) =>
    item.categories.some(c => ["Discours BC", "Décision Taux", "Crise", "Guerre", "Chef d'État", "Probabilités Taux"].includes(c));

  const filtered = useMemo(() => items.filter(item => {
    if (priorityOnly && !isPriorityItem(item)) return false;
    if (filterCcy !== "ALL" && !item.impacts.some(i => i.ccy === filterCcy)) return false;
    if (filterCat !== "ALL" && !item.categories.includes(filterCat)) return false;
    if (filterDir !== "all" && filterCcy !== "ALL") {
      if (!item.impacts.some(i => i.ccy === filterCcy && i.direction === filterDir)) return false;
    }
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items, filterCcy, filterCat, filterDir, priorityOnly]);

  // Catégories présentes dans le feed actuel
  const activeCats = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) item.categories.forEach(c => set.add(c));
    return PRIORITY_CATS.filter(c => set.has(c));
  }, [items]);

  // Comptage par devise
  const ccyCount = useMemo(() => {
    const counts: Partial<Record<Currency, { bull: number; bear: number; total: number }>> = {};
    for (const item of items) {
      for (const imp of item.impacts) {
        if (!counts[imp.ccy]) counts[imp.ccy] = { bull: 0, bear: 0, total: 0 };
        counts[imp.ccy]!.total++;
        if (imp.direction === "bullish") counts[imp.ccy]!.bull++;
        if (imp.direction === "bearish") counts[imp.ccy]!.bear++;
      }
    }
    return counts;
  }, [items]);

  // Résumé par devise (pour headline)
  const ccySummary = useMemo(() => {
    const summary: Partial<Record<Currency, "bullish" | "bearish" | "mixed" | "neutral">> = {};
    for (const [ccy, cnt] of Object.entries(ccyCount) as [Currency, { bull: number; bear: number }][]) {
      if (cnt.bull > cnt.bear * 1.5) summary[ccy] = "bullish";
      else if (cnt.bear > cnt.bull * 1.5) summary[ccy] = "bearish";
      else if (cnt.bull > 0 && cnt.bear > 0) summary[ccy] = "mixed";
      else summary[ccy] = "neutral";
    }
    return summary;
  }, [ccyCount]);

  return (
    <div className="space-y-3">
      {/* ── Headline résumé par devise ──────────────────────────────────────── */}
      {!loading && items.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
              Biais actualités par devise
            </span>
            <div className="flex items-center gap-2">
              {/* Bouton Prioritaires */}
              <button onClick={() => setPriorityOnly(p => !p)}
                className={`flex items-center gap-1 text-[9px] px-2.5 py-1 rounded-full font-semibold border transition-colors ${
                  priorityOnly ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "text-slate-500 border-slate-700/40 hover:text-slate-300"
                }`}>
                <Zap size={9} /> ⚡ Prioritaires
              </button>
              {/* Auto-refresh */}
              <button onClick={() => setAutoRefresh(a => !a)}
                className={`flex items-center gap-1 text-[9px] px-2 py-1 rounded-full border transition-colors ${
                  autoRefresh ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-slate-600 border-slate-700/30"
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-slate-600"}`} />
                {autoRefresh ? "Live 5min" : "Pause"}
              </button>
              <button onClick={() => { onRefresh(); setLastRefreshAt(new Date()); }} disabled={loading}
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 disabled:opacity-50">
                <RefreshCw size={9} className={loading ? "animate-spin" : ""} />
                {lastRefreshAt ? lastRefreshAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "Actualiser"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {CCY_LIST.map(ccy => {
              const cnt     = ccyCount[ccy];
              const summary = ccySummary[ccy] ?? "neutral";
              const bgCls   = summary === "bullish" ? "bg-emerald-500/10 border-emerald-500/20"
                            : summary === "bearish" ? "bg-red-500/10 border-red-500/20"
                            : summary === "mixed"   ? "bg-amber-500/10 border-amber-500/20"
                            : "bg-slate-800/40 border-slate-700/30";
              const arrow   = summary === "bullish" ? "↑" : summary === "bearish" ? "↓"
                            : summary === "mixed"   ? "↕" : "→";
              const arrowCls = summary === "bullish" ? "text-emerald-400" : summary === "bearish" ? "text-red-400"
                             : summary === "mixed" ? "text-amber-400" : "text-slate-600";
              return (
                <button key={ccy} onClick={() => setFilterCcy(filterCcy === ccy ? "ALL" : ccy)}
                  className={`flex flex-col items-center gap-0.5 p-2 rounded-lg border transition-all ${bgCls} ${filterCcy === ccy ? "ring-1 ring-amber-500/50" : ""}`}>
                  <span className="text-base">{CCY_FLAGS[ccy]}</span>
                  <span className="text-[10px] font-bold text-slate-300">{ccy}</span>
                  <span className={`text-[11px] font-bold ${arrowCls}`}>{arrow}</span>
                  {cnt && (
                    <span className="text-[8px] text-slate-600">{cnt.bull}↑ {cnt.bear}↓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filtres ─────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
        {/* Direction */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-slate-600 uppercase tracking-wider w-16 shrink-0">Direction</span>
          <div className="flex gap-1.5">
            {(["all", "bullish", "bearish"] as const).map(d => (
              <button key={d} onClick={() => setFilterDir(d)}
                className={`text-[10px] px-2.5 py-1 rounded-full font-semibold transition-colors border ${
                  filterDir === d
                    ? d === "bullish" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : d === "bearish" ? "bg-red-500/20 text-red-400 border-red-500/30"
                      : "bg-slate-700 text-slate-300 border-slate-600"
                    : "text-slate-500 border-slate-700/40 hover:text-slate-300"
                }`}>
                {d === "all" ? "Tous" : d === "bullish" ? "↑ Haussier" : "↓ Baissier"}
              </button>
            ))}
          </div>
        </div>

        {/* Catégories */}
        {activeCats.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider w-16 shrink-0 pt-1">Catégorie</span>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => setFilterCat("ALL")}
                className={`text-[10px] px-2.5 py-1 rounded-full font-semibold border transition-colors ${
                  filterCat === "ALL" ? "bg-slate-700 text-slate-300 border-slate-600" : "text-slate-600 border-slate-700/40 hover:text-slate-400"
                }`}>
                Toutes
              </button>
              {activeCats.map(cat => {
                const meta = CATEGORY_META[cat];
                const isActive = filterCat === cat;
                return (
                  <button key={cat} onClick={() => setFilterCat(filterCat === cat ? "ALL" : cat)}
                    className={`flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-semibold border transition-colors ${
                      isActive ? (meta?.color ?? "bg-slate-700 text-slate-300 border-slate-600")
                               : "text-slate-600 border-slate-700/40 hover:text-slate-400"
                    }`}>
                    {meta?.icon}
                    {meta?.label ?? cat}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Compteur résultats ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-slate-600">
          {loading ? "Chargement…" : `${filtered.length} article${filtered.length > 1 ? "s" : ""}`}
          {filterCcy !== "ALL" && ` · ${CCY_FLAGS[filterCcy]} ${filterCcy}`}
          {filterCat !== "ALL" && ` · ${filterCat}`}
        </span>
        {(filterCcy !== "ALL" || filterCat !== "ALL" || filterDir !== "all") && (
          <button onClick={() => { setFilterCcy("ALL"); setFilterCat("ALL"); setFilterDir("all"); }}
            className="text-[10px] text-slate-600 hover:text-slate-400">
            Effacer filtres ×
          </button>
        )}
      </div>

      {/* ── Liste ───────────────────────────────────────────────────────────── */}
      {loading && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-600 gap-3">
          <Loader2 size={24} className="animate-spin" />
          <span className="text-sm">Chargement des actualités…</span>
          <span className="text-[11px] text-slate-700">InvestingLive · Reuters · Bloomberg</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-600 text-sm">
          Aucune actualité pour ce filtre.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => (
            <NewsCard
              key={item.id}
              item={item}
              activeCcy={filterCcy === "ALL" ? null : filterCcy}
            />
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

  const overallDir =
    visibleImpacts.some(i => i.direction === "bullish") && visibleImpacts.some(i => i.direction === "bearish") ? "mixed"
    : visibleImpacts.some(i => i.direction === "bullish") ? "bullish"
    : visibleImpacts.some(i => i.direction === "bearish") ? "bearish"
    : "neutral";

  // Détecter les catégories prioritaires
  const isPriority = item.categories.some(c =>
    ["Discours BC", "Décision Taux", "Crise", "Guerre", "Chef d'État"].includes(c)
  );

  const borderCls =
    overallDir === "bullish" ? "border-emerald-500/25" :
    overallDir === "bearish" ? "border-red-500/25" :
    overallDir === "mixed"   ? "border-amber-500/20" :
    "border-slate-700/30";

  const bgCls =
    overallDir === "bullish" ? "bg-emerald-500/5" :
    overallDir === "bearish" ? "bg-red-500/5" :
    "bg-slate-800/30";

  // Catégorie la plus prioritaire
  const topCat = PRIORITY_CATS.find(p => item.categories.includes(p));
  const topMeta = topCat ? CATEGORY_META[topCat] : null;

  return (
    <div className={`rounded-xl border ${borderCls} ${bgCls} overflow-hidden ${isPriority ? "ring-1 ring-offset-0 ring-amber-500/20" : ""}`}>
      <div className="p-3">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[item.source] ?? "bg-slate-700/40 text-slate-400"}`}>
            {item.source}
          </span>
          {topMeta && topCat && (
            <span className={`flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full border ${topMeta.color}`}>
              {topMeta.icon}
              {topMeta.label}
            </span>
          )}
          {isPriority && (
            <span className="text-[9px] text-amber-500 font-bold">⚡ Prioritaire</span>
          )}
          <span className="ml-auto text-[10px] text-slate-600 shrink-0">{formatRelativeTime(item.publishedAt)}</span>
        </div>

        {/* Titre */}
        <a href={item.url} target="_blank" rel="noopener noreferrer"
          className="group flex items-start gap-1.5 mb-1.5">
          <span className="text-[12px] text-slate-200 leading-snug font-medium group-hover:text-white transition-colors">
            {item.title}
          </span>
          <ExternalLink size={10} className="text-slate-600 group-hover:text-slate-400 shrink-0 mt-0.5" />
        </a>

        {/* Résumé */}
        {item.summary && (
          <p className="text-[11px] text-slate-500 mb-1.5 leading-relaxed line-clamp-2">
            {item.summary}
          </p>
        )}

        {/* Impact badges + bouton détail */}
        {visibleImpacts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {visibleImpacts.map(imp => (
              <div key={imp.ccy} title={imp.reason}
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  imp.direction === "bullish" ? "bg-emerald-500/15 text-emerald-400" :
                  imp.direction === "bearish" ? "bg-red-500/15 text-red-400" :
                  "bg-slate-700/40 text-slate-400"
                }`}>
                {CCY_FLAGS[imp.ccy]} {imp.ccy}
                {imp.direction === "bullish" ? <TrendingUp size={9} /> :
                 imp.direction === "bearish" ? <TrendingDown size={9} /> :
                 <Minus size={9} />}
              </div>
            ))}
            <button onClick={() => setExpanded(e => !e)}
              className="text-[9px] text-slate-600 hover:text-slate-400 px-1.5 py-0.5 rounded-full border border-slate-700/30 ml-auto">
              {expanded ? "▲" : "▼ Analyse"}
            </button>
          </div>
        )}

        {/* Détail des raisons */}
        {expanded && visibleImpacts.length > 0 && (
          <div className="mt-2 space-y-1.5 border-t border-slate-700/30 pt-2">
            {visibleImpacts.map(imp => (
              <div key={imp.ccy} className="flex items-start gap-2 text-[10px]">
                <span className={`shrink-0 font-bold whitespace-nowrap ${
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
