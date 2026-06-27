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

const CATEGORY_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  "Discours BC":       { icon: <Landmark size={11} />,     color: "bg-blue-500/20 text-blue-400 border-blue-500/30",       label: "Discours BC" },
  "Chef d'État":       { icon: <Globe size={11} />,         color: "bg-violet-500/20 text-violet-400 border-violet-500/30", label: "Chef d'État" },
  "Décision Taux":     { icon: <Radio size={11} />,         color: "bg-amber-500/20 text-amber-400 border-amber-500/30",   label: "Décision Taux" },
  "Probabilités Taux": { icon: <BarChart2 size={11} />,     color: "bg-sky-500/20 text-sky-400 border-sky-500/30",         label: "OIS / Proba Taux" },
  "Données Clés":      { icon: <BarChart2 size={11} />,     color: "bg-slate-400/20 text-slate-300 border-slate-500/30",   label: "Données Clés" },
  "Emploi":            { icon: <BarChart2 size={11} />,     color: "bg-slate-400/20 text-slate-300 border-slate-500/30",   label: "Emploi" },
  "Inflation":         { icon: <Zap size={11} />,           color: "bg-orange-500/20 text-orange-400 border-orange-500/30",label: "Inflation" },
  "Crise":             { icon: <AlertTriangle size={11} />,  color: "bg-red-600/20 text-red-400 border-red-500/30",         label: "Crise" },
  "Guerre":            { icon: <AlertTriangle size={11} />,  color: "bg-red-700/20 text-red-400 border-red-600/30",         label: "Guerre" },
  "Géopolitique":      { icon: <Globe size={11} />,         color: "bg-purple-500/20 text-purple-400 border-purple-500/30",label: "Géopolitique" },
  "Risk-Off":          { icon: <TrendingDown size={11} />,  color: "bg-red-500/20 text-red-400 border-red-500/30",         label: "Risk-Off" },
  "Risk-On":           { icon: <TrendingUp size={11} />,    color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Risk-On" },
  "Énergie":           { icon: <Zap size={11} />,           color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",label: "Énergie" },
  "Banque Centrale":   { icon: <Landmark size={11} />,      color: "bg-blue-500/20 text-blue-400 border-blue-500/30",      label: "Banque Centrale" },
  "Commodités":        { icon: <BarChart2 size={11} />,     color: "bg-orange-500/20 text-orange-400 border-orange-500/30",label: "Commodités" },
  "Chine":             { icon: <Globe size={11} />,         color: "bg-red-600/20 text-red-400 border-red-600/30",         label: "Chine" },
};

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
  const [filterCat,    setFilterCat]    = useState<string | "ALL">("ALL");
  const [filterDir,    setFilterDir]    = useState<"all" | "bullish" | "bearish">("all");
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [autoRefresh,  setAutoRefresh]  = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh toutes les 1 minute quand actif
  useEffect(() => {
    if (!autoRefresh) { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => { onRefresh(); setLastRefreshAt(new Date()); }, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, onRefresh]);

  const isPriorityItem = (item: NewsItem) =>
    item.categories.some(c => ["Discours BC", "Décision Taux", "Crise", "Guerre", "Chef d'État", "Probabilités Taux"].includes(c));

  const filtered = useMemo(() => items.filter(item => {
    if (priorityOnly && !isPriorityItem(item)) return false;
    if (filterCat !== "ALL" && !item.categories.includes(filterCat)) return false;
    if (filterDir !== "all" && !item.impacts.some(i => i.direction === filterDir)) return false;
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items, filterCat, filterDir, priorityOnly]);

  const activeCats = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) item.categories.forEach(c => set.add(c));
    return PRIORITY_CATS.filter(c => set.has(c));
  }, [items]);

  const anyFilter = filterCat !== "ALL" || filterDir !== "all" || priorityOnly;
  const clearFilters = () => { setFilterCat("ALL"); setFilterDir("all"); setPriorityOnly(false); };

  return (
    <div className="space-y-3">
      {/* ── Barre filtres ──────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 space-y-2">

        {/* Ligne 1 : contrôles + direction + prioritaire */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Live 1min */}
          <button onClick={() => setAutoRefresh(a => !a)}
            className={`flex items-center gap-1.5 text-[9px] px-2 py-1 rounded-full border transition-colors shrink-0 ${
              autoRefresh
                ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                : "text-slate-600 border-slate-700/30 hover:text-slate-400"
            }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-slate-600"}`} />
            {autoRefresh ? "Live 1min" : "Pause"}
          </button>

          {/* Actualiser */}
          <button onClick={() => { onRefresh(); setLastRefreshAt(new Date()); }} disabled={loading}
            className="flex items-center gap-1 text-[9px] text-slate-500 hover:text-slate-300 disabled:opacity-40 shrink-0 transition-colors">
            <RefreshCw size={9} className={loading ? "animate-spin" : ""} />
            {lastRefreshAt
              ? lastRefreshAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
              : "Actualiser"}
          </button>

          <div className="w-px h-3 bg-slate-700/60 shrink-0" />

          {/* Label Direction */}
          <span className="text-[9px] text-amber-400 uppercase tracking-wider font-semibold shrink-0">
            Direction
          </span>

          {/* Boutons direction */}
          {(["all", "bullish", "bearish"] as const).map(d => (
            <button key={d} onClick={() => setFilterDir(d)}
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors border shrink-0 ${
                filterDir === d
                  ? d === "bullish" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : d === "bearish" ? "bg-red-500/20 text-red-400 border-red-500/30"
                    : "bg-slate-700 text-slate-300 border-slate-600"
                  : "text-slate-500 border-slate-700/40 hover:text-slate-300"
              }`}>
              {d === "all" ? "Tous" : d === "bullish" ? "↑ Haussier" : "↓ Baissier"}
            </button>
          ))}

          <div className="w-px h-3 bg-slate-700/60 shrink-0" />

          {/* Prioritaire toggle */}
          <button onClick={() => setPriorityOnly(p => !p)}
            className={`flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-semibold border transition-colors shrink-0 ${
              priorityOnly
                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                : "text-slate-500 border-slate-700/40 hover:text-slate-300"
            }`}>
            <Zap size={9} /> Prioritaire
          </button>

          {/* Compteur + effacer */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-slate-600">
              {loading ? "…" : `${filtered.length} article${filtered.length !== 1 ? "s" : ""}`}
            </span>
            {anyFilter && (
              <button onClick={clearFilters}
                className="text-[9px] text-slate-600 hover:text-slate-400 transition-colors">
                × Effacer
              </button>
            )}
          </div>
        </div>

        {/* Ligne 2 : catégories */}
        {activeCats.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] text-amber-400 uppercase tracking-wider font-semibold shrink-0">
              Catégorie
            </span>
            <button onClick={() => setFilterCat("ALL")}
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border transition-colors shrink-0 ${
                filterCat === "ALL"
                  ? "bg-slate-700 text-slate-300 border-slate-600"
                  : "text-slate-500 border-slate-700/40 hover:text-slate-300"
              }`}>
              Toutes
            </button>
            {activeCats.map(cat => {
              const meta = CATEGORY_META[cat];
              const isActive = filterCat === cat;
              return (
                <button key={cat} onClick={() => setFilterCat(isActive ? "ALL" : cat)}
                  className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border transition-colors shrink-0 ${
                    isActive
                      ? (meta?.color ?? "bg-slate-700 text-slate-300 border-slate-600")
                      : "text-slate-500 border-slate-700/40 hover:text-slate-300"
                  }`}>
                  {meta?.icon}
                  {meta?.label ?? cat}
                </button>
              );
            })}
          </div>
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
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── NewsCard ──────────────────────────────────────────────────────────────────

function NewsCard({ item }: { item: NewsItem }) {
  const [expanded, setExpanded] = useState(false);

  const overallDir =
    item.impacts.some(i => i.direction === "bullish") && item.impacts.some(i => i.direction === "bearish") ? "mixed"
    : item.impacts.some(i => i.direction === "bullish") ? "bullish"
    : item.impacts.some(i => i.direction === "bearish") ? "bearish"
    : "neutral";

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

  const topCat  = PRIORITY_CATS.find(p => item.categories.includes(p));
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

        {/* Impact badges + heure + bouton analyse */}
        {item.impacts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {item.impacts.map(imp => (
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
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-slate-600">{formatRelativeTime(item.publishedAt)}</span>
              <button onClick={() => setExpanded(e => !e)}
                className="text-[9px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded-full border border-slate-700/30 transition-colors">
                {expanded ? "▲" : "▼ Analyse"}
              </button>
            </div>
          </div>
        )}

        {/* Détail des raisons */}
        {expanded && item.impacts.length > 0 && (
          <div className="mt-2 space-y-1.5 border-t border-slate-700/30 pt-2">
            {item.impacts.map(imp => (
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
