"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Database, Activity, Maximize2, Minimize2, X, BarChart2 } from "lucide-react";
import { CURRENCIES, CURRENCY_META } from "@/lib/constants";
import type { Currency, DriverData, SentimentEntry, CotEntry, MacroSection } from "@/lib/types";
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
import { TvAdvancedChart } from "@/components/TvChart";
import type { CalendarEvent } from "@/app/api/calendar/route";
import type { NewsItem } from "@/app/api/news/route";
import type { CotHistory } from "@/app/api/cot-history/route";

const REFRESH_MS = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL_MS ?? "3600000");

export default function Dashboard() {
  const [drivers,      setDrivers]      = useState<DriverData | null>(null);
  const [expectations, setExpectations] = useState<Record<string, unknown> | null>(null);
  const [yields,       setYields]       = useState<{ yields: Record<string, number | null>; spreads: Record<string, number | null>; dayDeltas?: Record<string, number | null>; fxDayPct?: Record<string, number | null> } | null>(null);
  const [sentiment,    setSentiment]    = useState<Record<string, SentimentEntry> | null>(null);
  const [cot,          setCot]          = useState<Record<string, CotEntry> | null>(null);
  const [calEvents,    setCalEvents]    = useState<CalendarEvent[]>([]);
  const [nextWeekAvail, setNextWeekAvail] = useState(false);
  const [activeTab,    setActiveTab]    = useState<"dashboard" | "calendar" | "pairs" | "yields" | "news" | "cot" | "report" | "markets">("dashboard");
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
  const [macroSection,      setMacroSection]      = useState<MacroSection>("all");
  const [comparisonOpen,    setComparisonOpen]    = useState(false);
  const [comparisonSection, setComparisonSection] = useState<Exclude<MacroSection,"all">>("inflation");
  const [comparisonCurrencies, setComparisonCurrencies] = useState<Currency[] | "all">("all");
  const [focusCurrency,     setFocusCurrency]     = useState<Currency | "all">("all");
  const [globalMacroSlide,   setGlobalMacroSlide]   = useState<"mon"|"infl"|"cro"|"empl">("mon");
  const [globalCardTab,      setGlobalCardTab]      = useState<"overview"|"mispricing"|"focus">("overview");
  const [globalSignauxSlide, setGlobalSignauxSlide] = useState<"ois"|"cot"|"sent">("ois");
  const [globalOisChartTab,  setGlobalOisChartTab]  = useState<"curve"|"implied"|"scenarios">("scenarios");
  const [macroSyncEnabled,   setMacroSyncEnabled]   = useState(false);

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
      const NO_CACHE = { cache: "no-store" } as const;
      const [driversRes, expectRes, yieldsRes, fxRes, sentimentRes, cotRes, calRes, rateProbRes] = await Promise.allSettled([
        fetch("/api/drivers",           NO_CACHE).then((r) => r.json()),
        fetch("/api/expectations",      NO_CACHE).then((r) => r.json()),
        fetch("/api/yields",            NO_CACHE).then((r) => r.json()),
        fetch("/api/fx",                NO_CACHE).then((r) => r.json()),
        fetch("/api/sentiment",         NO_CACHE).then((r) => r.json()),
        fetch("/api/cot",               NO_CACHE).then((r) => r.json()),
        fetch("/api/calendar",          NO_CACHE).then((r) => r.json()),
        fetch("/api/rate-probabilities",NO_CACHE).then((r) => r.json()),
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
            <span className="text-sm font-bold text-white tracking-tight" suppressHydrationWarning>
              {new Date().getHours() < 18 ? "Bonjour" : "Bonsoir"} 👋
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {driversFromCache && driversCacheAge && (
              <span className="flex items-center gap-0.5 text-amber-500" title="Marchés depuis le cache local">
                <Database size={11} />
                <span>cache {driversCacheAge}</span>
              </span>
            )}
            <span suppressHydrationWarning>{lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
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
        {(["dashboard", "markets", "calendar", "pairs", "yields", "news", "cot", "report"] as const).map((tab) => (
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
              : tab === "markets"  ? "🌍 Marchés"
              : tab === "calendar" ? "📅 Calendrier"
              : tab === "pairs"   ? "↕ Paires"
              : tab === "yields"  ? "📈 Yields 10Y"
              : tab === "news"    ? "📰 Actualités"
              : tab === "cot"    ? "📊 COT"
              : "📋 Rapport"}
          </button>
        ))}
      </div>

      {/* Global drivers bar — uniquement sur le dashboard */}
      {activeTab === "dashboard" && drivers && <DriversBar drivers={drivers} />}

      {activeTab === "dashboard" && (
        <>
          {/* ── Barre de contrôle : Sync + Comparer uniquement ────────────── */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <button
              onClick={() => setMacroSyncEnabled(v => !v)}
              className={`text-[11px] font-medium px-3 py-1 rounded-full border transition-all flex items-center gap-1.5 ${
                macroSyncEnabled
                  ? "bg-violet-500/15 border-violet-500/30 text-violet-400"
                  : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600"
              }`}
              title="Synchroniser l'onglet macro affiché sur toutes les cartes"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${macroSyncEnabled ? "bg-violet-400" : "bg-slate-600"}`} />
              Sync
            </button>
            <button
              onClick={() => setComparisonOpen(v => !v)}
              className={`text-[11px] font-medium px-3 py-1 rounded-full border transition-all flex items-center gap-1.5 ${
                comparisonOpen
                  ? "bg-sky-500/15 border-sky-500/30 text-sky-400"
                  : "border-slate-700 text-slate-500 hover:text-sky-400 hover:border-sky-500/40"
              }`}
            >
              <BarChart2 size={11} />
              Comparer
            </button>
            {/* Badges actifs (section filtre + focus devise) */}
            {macroSection !== "all" && (
              <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 rounded-full px-2.5 py-1">
                <span className="text-[10px] text-amber-400 font-medium">
                  {{ inflation:"📊 Inflation", pmi:"🏭 PMI", employment:"👷 Emploi", gdp:"📈 PIB", policy:"🏦 Politique" }[macroSection]}
                </span>
                <button onClick={() => { setMacroSection("all"); }} className="text-amber-500/50 hover:text-amber-400 transition-colors text-[10px] leading-none">✕</button>
              </div>
            )}
            {focusCurrency !== "all" && (
              <div className="flex items-center gap-1 bg-sky-500/10 border border-sky-500/20 rounded-full px-2.5 py-1">
                <span className="text-[10px] text-sky-400 font-medium">{CURRENCY_META[focusCurrency].flag} {focusCurrency}</span>
                <button onClick={() => { setFocusCurrency("all"); setComparisonCurrencies("all"); }} className="text-sky-500/50 hover:text-sky-400 transition-colors text-[10px] leading-none">✕</button>
              </div>
            )}
          </div>

          {/* ── Comparison panel ──────────────────────────────────────────── */}
          {comparisonOpen && (() => {
            type IndSnap = { value: number | null; trend: string | null; surprise: number | null } | null;
            type CacheData = { indicators: Record<string, IndSnap> };
            const COMP_SECTIONS: { id: Exclude<MacroSection,"all">; label: string }[] = [
              { id: "inflation",  label: "📊 Inflation" },
              { id: "pmi",        label: "🏭 PMI" },
              { id: "employment", label: "👷 Emploi" },
              { id: "gdp",        label: "📈 PIB" },
              { id: "policy",     label: "🏦 Politique" },
            ];
            const SECTION_FIELDS: Record<Exclude<MacroSection,"all">, { key: string; label: string; unit?: string; inv?: boolean }[]> = {
              inflation:  [{ key:"cpiYoY", label:"CPI YoY", unit:"%" }, { key:"cpiCore", label:"Core CPI", unit:"%" }, { key:"cpiMoM", label:"CPI MoM", unit:"%" }],
              pmi:        [{ key:"pmiComposite", label:"PMI Comp." }, { key:"pmiMfg", label:"PMI Mfg" }, { key:"pmiServices", label:"PMI Svc" }],
              employment: [{ key:"unemployment", label:"Chômage", unit:"%", inv:true }, { key:"employment", label:"Emploi", unit:"k" }],
              gdp:        [{ key:"gdp", label:"PIB QoQ", unit:"%" }, { key:"retailSales", label:"Retail Sales", unit:"%" }],
              policy:     [{ key:"policyRate", label:"Taux dir.", unit:"%" }],
            };
            const fields = SECTION_FIELDS[comparisonSection];
            const activeCurrencies = comparisonCurrencies === "all" ? CURRENCIES : comparisonCurrencies;
            const rows = activeCurrencies.map(c => {
              const cached = loadCache<CacheData>(`macro_${c}`);
              const inds = cached?.data?.indicators ?? {};
              return { currency: c, inds };
            });
            const trendColor = (t: string | null, inv = false) => {
              if (!t) return "text-slate-500";
              return (t === "up") !== inv ? "text-emerald-400" : "text-red-400";
            };
            const surpriseColor = (s: number | null, inv = false) => {
              if (s === null) return "text-slate-500";
              return (s > 0) !== inv ? "text-emerald-400" : "text-red-400";
            };
            const toggleCurrency = (c: Currency) => {
              setComparisonCurrencies(prev => {
                const current = prev === "all" ? [...CURRENCIES] : [...prev];
                const next = current.includes(c) ? current.filter(x => x !== c) : [...current, c];
                const result = next.length === CURRENCIES.length ? "all" : next.length === 0 ? "all" : next;
                // 1 devise sélectionnée → zoom sur cette carte dans la grille
                if (Array.isArray(result) && result.length === 1) setFocusCurrency(result[0]);
                else setFocusCurrency("all");
                return result;
              });
            };
            const resetCurrencies = () => { setComparisonCurrencies("all"); setFocusCurrency("all"); };
            return (
              <div className="mb-4 bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Comparaison</span>
                  <button onClick={() => { setComparisonOpen(false); setMacroSection("all"); }} className="text-slate-600 hover:text-slate-400">
                    <X size={14} />
                  </button>
                </div>
                {/* Config row */}
                <div className="px-4 py-2.5 border-b border-slate-800 flex flex-wrap gap-3 items-center">
                  {/* Section picker */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {COMP_SECTIONS.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { setComparisonSection(s.id); setMacroSection(s.id); }}
                        className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition-all ${
                          comparisonSection === s.id
                            ? "bg-sky-500/15 border-sky-500/30 text-sky-400"
                            : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="w-px bg-slate-800 self-stretch hidden sm:block" />
                  {/* Currency picker — Toutes = tableau complet | 1 seule = zoom carte */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {Array.isArray(comparisonCurrencies) && comparisonCurrencies.length === 1 && (
                      <span className="text-[9px] text-sky-400/60 mr-0.5">zoom ↓</span>
                    )}
                    <button
                      onClick={resetCurrencies}
                      className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition-all ${
                        comparisonCurrencies === "all"
                          ? "bg-slate-700 border-slate-600 text-slate-200"
                          : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      Toutes
                    </button>
                    {CURRENCIES.map(c => {
                      const active = comparisonCurrencies === "all" || comparisonCurrencies.includes(c);
                      return (
                        <button
                          key={c}
                          onClick={() => toggleCurrency(c)}
                          className={`text-[10px] font-medium px-2 py-1 rounded-full border transition-all ${
                            active
                              ? "bg-slate-700 border-slate-600 text-slate-200"
                              : "border-slate-700/50 text-slate-600 hover:text-slate-400"
                          }`}
                        >
                          {CURRENCY_META[c].flag} {c}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="text-left px-4 py-2 text-slate-600 font-medium w-20">Devise</th>
                        {fields.map(f => (
                          <th key={f.key} className="text-right px-3 py-2 text-slate-600 font-medium">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ currency: c, inds }) => (
                        <tr key={c} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                          <td className="px-4 py-2 font-semibold text-slate-300">
                            {CURRENCY_META[c].flag} {c}
                          </td>
                          {fields.map(f => {
                            const ind = inds[f.key] as IndSnap;
                            const val = ind?.value ?? null;
                            const fmtVal = val !== null ? `${val % 1 === 0 ? val : val.toFixed(2)}${f.unit ?? ""}` : "—";
                            const tArrow = ind?.trend === "up" ? "↑" : ind?.trend === "down" ? "↓" : "";
                            return (
                              <td key={f.key} className="text-right px-3 py-2">
                                <span className={`font-semibold tabular-nums ${val !== null ? trendColor(ind?.trend ?? null, f.inv) : "text-slate-600"}`}>
                                  {fmtVal}
                                </span>
                                {tArrow && (
                                  <span className={`ml-0.5 text-[10px] ${trendColor(ind?.trend ?? null, f.inv)}`}>{tArrow}</span>
                                )}
                                {ind?.surprise !== null && ind?.surprise !== undefined && (
                                  <span className={`ml-1 text-[9px] ${surpriseColor(ind.surprise, f.inv)}`}>
                                    {ind.surprise > 0 ? "▲" : "▼"}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* Currency cards grid */}
          <div className={`grid gap-3 ${focusCurrency !== "all" ? "grid-cols-1 max-w-xl" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
            {CURRENCIES.filter(c => focusCurrency === "all" || c === focusCurrency).map((currency) => (
              <CurrencyCard
                key={currency}
                currency={currency}
                expectations={expectations}
                yields={yields}
                sentiment={sentiment?.[currency] ?? null}
                cot={cot?.[currency] ?? null}
                ratePath={rateProbabilities?.[currency] ?? null}
                onDivergenceUpdate={handleDivergenceUpdate}
                calEvents={calEvents}
                macroSection={macroSection}
                syncMacroSlide={macroSyncEnabled ? globalMacroSlide : undefined}
                onMacroSlideChange={macroSyncEnabled ? setGlobalMacroSlide : undefined}
                syncCardTab={macroSyncEnabled ? globalCardTab : undefined}
                onCardTabChange={macroSyncEnabled ? (setGlobalCardTab as (id: "overview"|"mispricing"|"focus") => void) : undefined}
                syncSignauxSlide={macroSyncEnabled ? globalSignauxSlide : undefined}
                onSignauxSlideChange={macroSyncEnabled ? setGlobalSignauxSlide : undefined}
                syncOisChartTab={macroSyncEnabled ? globalOisChartTab : undefined}
                onOisChartTabChange={macroSyncEnabled ? setGlobalOisChartTab : undefined}
                isLoading={loading}
              />
            ))}
          </div>
        </>
      )}

      {activeTab === "markets" && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-sky-500/20" />
            <span className="text-sky-400 text-xs font-bold uppercase tracking-[0.3em]">Vue d&apos;ensemble · Marchés Globaux</span>
            <div className="h-px flex-1 bg-sky-500/20" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <TvAdvancedChart symbol="FOREXCOM:SPXUSD" label="S&P 500"          interval="D" height={220} />
            <TvAdvancedChart symbol="PEPPERSTONE:VIX" label="VIX"              interval="D" height={220} />
            <TvAdvancedChart symbol="CAPITALCOM:DXY"  label="DXY Dollar Index" interval="W" height={220} />
            <TvAdvancedChart symbol="TVC:GOLD"        label="Or (XAU/USD)"     interval="W" height={220} />
          </div>
        </div>
      )}

      {activeTab === "calendar" && (
        <CalendarTab events={calEvents} loading={loading} nextWeekAvail={nextWeekAvail} />
      )}

      {activeTab === "pairs" && (
        <SentimentPairsTab symbols={rawSymbols} />
      )}

      {activeTab === "yields" && (
        <YieldsTab yieldsData={yields} fxDayPct={yields?.fxDayPct ?? null} />
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

      {/* Padding bas pour éviter que le contenu s'arrête brutalement au scroll */}
      <div className="pb-12" />
    </div>
  );
}
