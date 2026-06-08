"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Zap, Database, Activity, Maximize2, Minimize2 } from "lucide-react";
import { CURRENCIES, CURRENCY_META } from "@/lib/constants";
import type { Currency, DriverData, SentimentEntry, CotEntry } from "@/lib/types";
import type { RateProbData } from "@/lib/rateprobability";
import { saveCache, loadCache, formatCacheDate } from "@/lib/localCache";
import CurrencyCard from "@/components/CurrencyCard";
import DriversBar from "@/components/DriversBar";
import CalendarTab from "@/components/CalendarTab";
import SentimentPairsTab from "@/components/SentimentPairsTab";
import YieldsTab from "@/components/YieldsTab";
import NewsTab from "@/components/NewsTab";
import CotTab from "@/components/CotTab";
import ReportTab from "@/components/ReportTab";
import type { CalendarEvent } from "@/app/api/calendar/route";
import type { NewsItem } from "@/app/api/news/route";
import type { CotHistory } from "@/app/api/cot-history/route";

const REFRESH_MS = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL_MS ?? "3600000");

export default function Dashboard() {
  const [drivers,      setDrivers]      = useState<DriverData | null>(null);
  const [expectations, setExpectations] = useState<Record<string, unknown> | null>(null);
  const [yields,       setYields]       = useState<{ yields: Record<string, number | null>; spreads: Record<string, number | null>; dayDeltas?: Record<string, number | null> } | null>(null);
  const [sentiment,    setSentiment]    = useState<Record<string, SentimentEntry> | null>(null);
  const [cot,          setCot]          = useState<Record<string, CotEntry> | null>(null);
  const [calEvents,    setCalEvents]    = useState<CalendarEvent[]>([]);
  const [nextWeekAvail, setNextWeekAvail] = useState(false);
  const [activeTab,    setActiveTab]    = useState<"dashboard" | "calendar" | "pairs" | "yields" | "news" | "cot" | "report">("dashboard");
  const [newsItems,    setNewsItems]    = useState<NewsItem[]>([]);
  const [newsLoading,  setNewsLoading]  = useState(false);
  const [cotHistory,   setCotHistory]   = useState<CotHistory | null>(null);
  const [cotLoading,   setCotLoading]   = useState(false);
  const [rawSymbols,   setRawSymbols]   = useState<Array<{ name: string; longPercentage: number; shortPercentage: number; longVolume: number; shortVolume: number; longPositions: number; shortPositions: number; totalPositions: number; avgLongPrice?: number; avgShortPrice?: number }> | null>(null);
  const [rateProbabilities, setRateProbabilities] = useState<RateProbData | null>(null);
  const [lastRefresh,  setLastRefresh]  = useState<Date>(new Date());
  const [loading,      setLoading]      = useState(true);
  const [activeDivergences, setActiveDivergences] = useState<{ currency: Currency; score: number }[]>([]);
  const [driversFromCache,  setDriversFromCache]  = useState(false);
  const [driversCacheAge,   setDriversCacheAge]   = useState<string | null>(null);
  const [isFullscreen,      setIsFullscreen]      = useState(false);

  // ── Sentiment multi-paires Myfxbook → {CCY: {longPct, shortPct, pair}} ──────
  // Pour chaque devise, on calcule le % "long CCY" en moyenne pondérée (par volume)
  // sur toutes les paires disponibles où cette devise apparaît (base ou cotation).
  //   - Si CCY est la BASE     (ex: EUR dans EURUSD) → longPct = sym.longPercentage
  //   - Si CCY est la COTATION (ex: JPY dans USDJPY) → longPct = sym.shortPercentage
  //     (être short la paire = être long la monnaie de cotation)
  function parseSentimentSymbols(symbols: Array<{ name: string; longPercentage: number; shortPercentage: number; totalPositions: number }>): Record<string, SentimentEntry> {
    // base → long base currency; quote → long = short base = long quote
    // Format: { base: "EUR", quote: "USD" }
    const PAIR_DEF: Record<string, { base: string; quote: string }> = {
      // Majeures
      EURUSD: { base: "EUR", quote: "USD" },
      GBPUSD: { base: "GBP", quote: "USD" },
      USDJPY: { base: "USD", quote: "JPY" },
      USDCHF: { base: "USD", quote: "CHF" },
      USDCAD: { base: "USD", quote: "CAD" },
      AUDUSD: { base: "AUD", quote: "USD" },
      NZDUSD: { base: "NZD", quote: "USD" },
      // Crosses EUR
      EURJPY: { base: "EUR", quote: "JPY" },
      EURGBP: { base: "EUR", quote: "GBP" },
      EURCHF: { base: "EUR", quote: "CHF" },
      EURCAD: { base: "EUR", quote: "CAD" },
      EURAUD: { base: "EUR", quote: "AUD" },
      EURNZD: { base: "EUR", quote: "NZD" },
      // Crosses GBP
      GBPJPY: { base: "GBP", quote: "JPY" },
      GBPCHF: { base: "GBP", quote: "CHF" },
      GBPCAD: { base: "GBP", quote: "CAD" },
      GBPAUD: { base: "GBP", quote: "AUD" },
      GBPNZD: { base: "GBP", quote: "NZD" },
      // Crosses AUD
      AUDJPY: { base: "AUD", quote: "JPY" },
      AUDCAD: { base: "AUD", quote: "CAD" },
      AUDCHF: { base: "AUD", quote: "CHF" },
      AUDNZD: { base: "AUD", quote: "NZD" },
      // Crosses CAD
      CADJPY: { base: "CAD", quote: "JPY" },
      // Crosses CHF
      CHFJPY: { base: "CHF", quote: "JPY" },
      // Crosses NZD
      NZDJPY: { base: "NZD", quote: "JPY" },
      NZDCAD: { base: "NZD", quote: "CAD" },
      NZDCHF: { base: "NZD", quote: "CHF" },
    };

    const OUR_CCYS = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];
    const longWeighted: Record<string, number>  = {};
    const totalPos:     Record<string, number>  = {};
    const pairCount:    Record<string, number>  = {};

    for (const sym of symbols) {
      const def = PAIR_DEF[sym.name];
      if (!def || sym.totalPositions <= 0) continue;
      const { base, quote } = def;

      // Base currency : long la paire = long la base
      if (OUR_CCYS.includes(base)) {
        longWeighted[base] = (longWeighted[base] ?? 0) + sym.longPercentage * sym.totalPositions;
        totalPos[base]     = (totalPos[base]     ?? 0) + sym.totalPositions;
        pairCount[base]    = (pairCount[base]    ?? 0) + 1;
      }
      // Quote currency : long la paire = short la cotation → long cotation = shortPercentage
      if (OUR_CCYS.includes(quote)) {
        longWeighted[quote] = (longWeighted[quote] ?? 0) + sym.shortPercentage * sym.totalPositions;
        totalPos[quote]     = (totalPos[quote]     ?? 0) + sym.totalPositions;
        pairCount[quote]    = (pairCount[quote]    ?? 0) + 1;
      }
    }

    const result: Record<string, SentimentEntry> = {};
    for (const ccy of OUR_CCYS) {
      const total = totalPos[ccy] ?? 0;
      if (total === 0) continue;
      const n       = pairCount[ccy] ?? 1;
      const longPct = Math.round(longWeighted[ccy] / total);
      // Label : "DXY (7 paires)" pour USD, "EUR (6 paires)" pour EUR, etc.
      const label   = ccy === "USD" ? `DXY (${n} paires)` : `${ccy} (${n} paire${n > 1 ? "s" : ""})`;
      result[ccy]   = { pair: label, longPct, shortPct: 100 - longPct };
    }

    return result;
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [driversRes, expectRes, yieldsRes, fxRes, sentimentRes, cotRes, calRes, rateProbRes] = await Promise.allSettled([
        fetch("/api/drivers").then((r) => r.json()),
        fetch("/api/expectations").then((r) => r.json()),
        fetch("/api/yields").then((r) => r.json()),
        fetch("/api/fx").then((r) => r.json()),
        fetch("/api/sentiment").then((r) => r.json()),
        fetch("/api/cot").then((r) => r.json()),
        fetch("/api/calendar").then((r) => r.json()),
        fetch("/api/rate-probabilities").then((r) => r.json()),
      ]);

      // ── Drivers ───────────────────────────────────────────────────────────
      if (driversRes.status === "fulfilled" && !driversRes.value?.error) {
        const driversData = driversRes.value as DriverData;
        if (fxRes.status === "fulfilled" && fxRes.value?.dxy != null) {
          driversData.dxy      = fxRes.value.dxy;
          driversData.dxyDelta = fxRes.value.dxyDelta ?? null;
        }
        setDrivers(driversData);
        setDriversFromCache(false);
        setDriversCacheAge(null);
        saveCache("drivers", driversData);
      } else {
        const cached = loadCache<DriverData>("drivers");
        if (cached) {
          setDrivers(cached.data);
          setDriversFromCache(true);
          setDriversCacheAge(formatCacheDate(cached.savedAt));
        }
      }

      // ── Attentes de taux ──────────────────────────────────────────────────
      if (expectRes.status === "fulfilled" && !expectRes.value?.error) {
        setExpectations(expectRes.value);
        saveCache("expectations", expectRes.value);
      } else {
        const cached = loadCache<Record<string, unknown>>("expectations");
        if (cached) setExpectations(cached.data);
      }

      // ── Rendements obligataires ───────────────────────────────────────────
      if (yieldsRes.status === "fulfilled" && !yieldsRes.value?.error) {
        setYields(yieldsRes.value);
        saveCache("yields", yieldsRes.value);
      } else {
        const cached = loadCache<typeof yields>("yields");
        if (cached && cached.data) setYields(cached.data);
      }

      // ── Sentiment Myfxbook ────────────────────────────────────────────────
      if (sentimentRes.status === "fulfilled" && !sentimentRes.value?.error && sentimentRes.value?.symbols) {
        const syms = sentimentRes.value.symbols as Array<{ name: string; longPercentage: number; shortPercentage: number; longVolume: number; shortVolume: number; longPositions: number; shortPositions: number; totalPositions: number; avgLongPrice?: number; avgShortPrice?: number }>;
        setRawSymbols(syms);
        const mapped = parseSentimentSymbols(syms);
        setSentiment(mapped);
        saveCache("sentiment", mapped);
      } else {
        const cached = loadCache<Record<string, SentimentEntry>>("sentiment");
        if (cached) setSentiment(cached.data);
      }

      // ── COT CFTC ─────────────────────────────────────────────────────────
      if (cotRes.status === "fulfilled" && !cotRes.value?.error && Object.keys(cotRes.value ?? {}).length > 0) {
        setCot(cotRes.value as Record<string, CotEntry>);
        saveCache("cot", cotRes.value);
      } else {
        const cached = loadCache<Record<string, CotEntry>>("cot");
        if (cached) setCot(cached.data);
      }

      // ── Calendrier économique ─────────────────────────────────────────────
      if (calRes.status === "fulfilled" && Array.isArray(calRes.value?.events)) {
        setCalEvents(calRes.value.events as CalendarEvent[]);
        setNextWeekAvail(calRes.value.nextWeekAvail === true);
      }

      // ── Probabilités de taux (rateprobability.com OIS) ───────────────────
      if (rateProbRes.status === "fulfilled" && rateProbRes.value?.data) {
        setRateProbabilities(rateProbRes.value.data as RateProbData);
      }

      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const refreshNews = useCallback(async () => {
    setNewsLoading(true);
    try {
      const res = await fetch("/api/news");
      if (res.ok) {
        const json = await res.json();
        setNewsItems(json.items ?? []);
      }
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "news" && newsItems.length === 0) refreshNews();
  }, [activeTab, newsItems.length, refreshNews]);

  const refreshCotHistory = useCallback(async () => {
    setCotLoading(true);
    try {
      const res = await fetch("/api/cot-history");
      if (res.ok) {
        const json = await res.json();
        if (!json.error) setCotHistory(json as CotHistory);
      }
    } finally {
      setCotLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "cot" && !cotHistory) refreshCotHistory();
  }, [activeTab, cotHistory, refreshCotHistory]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const handleDivergenceUpdate = useCallback((currency: Currency, score: number) => {
    setActiveDivergences((prev) => {
      const filtered = prev.filter((d) => d.currency !== currency);
      if (Math.abs(score) >= 2) return [...filtered, { currency, score }];
      return filtered;
    });
  }, []);

  const divergenceCount = activeDivergences.filter((d) => Math.abs(d.score) >= 2).length;

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-4">
      {/* Header */}
      <header className="flex items-center justify-between mb-4 bg-slate-950/80 border border-slate-800 rounded-xl px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
            <Activity size={15} className="text-black" />
          </div>
          <div>
            <span className="text-sm font-bold text-white tracking-tight">
              {new Date().getHours() < 18 ? "Bonjour" : "Bonsoir"} 👋
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {divergenceCount > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1.5">
              <Zap size={12} className="text-amber-400" />
              <span className="text-xs font-medium text-amber-400">
                {divergenceCount} divergence{divergenceCount > 1 ? "s" : ""} active{divergenceCount > 1 ? "s" : ""}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {driversFromCache && driversCacheAge && (
              <span className="flex items-center gap-0.5 text-amber-500" title="Marchés depuis le cache local">
                <Database size={11} />
                <span>cache {driversCacheAge}</span>
              </span>
            )}
            <span>{lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>

          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            {loading ? "Chargement…" : "Rafraîchir"}
          </button>

          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors border border-slate-800 hover:border-slate-600 rounded-md px-2 py-1"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </header>

      {/* Tab navigation */}
      <div className="flex gap-0 border-b border-slate-800 mb-4">
        {(["dashboard", "calendar", "pairs", "yields", "news", "cot", "report"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab === "dashboard" ? "Dashboard"
              : tab === "calendar" ? "📅 Calendrier"
              : tab === "pairs"   ? "↕ Paires"
              : tab === "yields"  ? "📈 Yields 10Y"
              : tab === "news"    ? "📰 Actualités"
              : tab === "cot"    ? "📊 COT"
              : "📋 Rapport"}
          </button>
        ))}
      </div>

      {/* Global drivers bar — visible sur les deux onglets */}
      {drivers && <DriversBar drivers={drivers} />}

      {activeTab === "dashboard" && (
        <>
          {/* Active divergences summary */}
          {activeDivergences.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {activeDivergences
                .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
                .map(({ currency, score }) => (
                  <div
                    key={currency}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium ${
                      score < 0
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    }`}
                  >
                    <Zap size={10} />
                    {CURRENCY_META[currency].flag} {currency} SD:{score > 0 ? "+" : ""}{score}
                  </div>
                ))}
            </div>
          )}

          {/* Currency cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {CURRENCIES.map((currency) => (
              <CurrencyCard
                key={currency}
                currency={currency}
                expectations={expectations}
                yields={yields}
                sentiment={sentiment?.[currency] ?? null}
                cot={cot?.[currency] ?? null}
                ratePath={rateProbabilities?.[currency] ?? null}
                onDivergenceUpdate={handleDivergenceUpdate}
              />
            ))}
          </div>
        </>
      )}

      {activeTab === "calendar" && (
        <CalendarTab events={calEvents} loading={loading} nextWeekAvail={nextWeekAvail} />
      )}

      {activeTab === "pairs" && (
        <SentimentPairsTab symbols={rawSymbols} />
      )}

      {activeTab === "yields" && (
        <YieldsTab yieldsData={yields} />
      )}

      {activeTab === "news" && (
        <NewsTab items={newsItems} loading={newsLoading} onRefresh={refreshNews} />
      )}

      {activeTab === "cot" && (
        <CotTab history={cotHistory} loading={cotLoading} />
      )}

      {activeTab === "report" && (
        <ReportTab calEvents={calEvents} drivers={drivers} cotHistory={cotHistory} />
      )}

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-5 flex-wrap text-[10px] text-slate-600">
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" /> Haussier / Sous-évalué</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0" /> Baissier / Sur-évalué</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" /> Ambigu / Divergence</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" /> Neutre / Pas de signal</div>
        <span className="text-slate-700">·</span>
        <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" /> Donnée critique</div>
        <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" /> Donnée importante</div>
        <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" /> Donnée secondaire</div>
        <div className="ml-auto text-slate-700 hidden sm:block">Cliquer sur chaque signal pour voir l'analyse détaillée</div>
      </div>

      {/* Footer */}
      <footer className="mt-4 text-center text-xs text-slate-600 space-y-1">
        <p>
          Sources: FRED · ECB · BoE · BoC · CFTC · Frankfurter · Myfxbook · ForexFactory
        </p>
        <p>
          LLM: Groq (Llama 3.1) · Données à titre informatif uniquement — pas de conseil financier
        </p>
      </footer>
    </div>
  );
}
