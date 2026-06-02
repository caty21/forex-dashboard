"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, Minus, Loader2, Database,
  BarChart2, Activity, Target, Zap, Eye, Layers,
  ChevronRight, ArrowUpRight, ArrowDownRight, AlertTriangle,
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, ResponsiveContainer,
  Tooltip, XAxis,
} from "recharts";
import { CURRENCY_META, COUNTRY_PROFILES } from "@/lib/constants";
import { biasLabel, calcMacroScore } from "@/lib/scoring";
import { saveCache, loadCache, formatCacheDate } from "@/lib/localCache";
import type { Currency, BiasPhase, RateExpectation } from "@/lib/types";
import type { CBRatePath } from "@/lib/rateprobability";
import type { SentimentEntry, CotEntry } from "@/lib/types";
import NarrativeButton from "./NarrativeButton";

// ─── Types internes ───────────────────────────────────────────────────────────

interface Ind {
  value: number | null; prev: number | null; surprise: number | null;
  trend: "up"|"down"|"flat"|null; lastUpdated: string | null;
  consensus?: number | null;
}
interface MacroForecasts {
  cpi: number | null; cpiSurprise: number | null;
  cpiCore: number | null; cpiMoM: number | null;
  cpiCoreMoM: number | null; ppiMoM: number | null;
  unemployment: number | null; unemploymentSurprise: number | null;
  pmiMfg: number | null; pmiMfgSurprise: number | null;
  pmiSvc: number | null; pmiSvcSurprise: number | null;
  pmiComposite: number | null; pmiCompositeSurprise: number | null;
  retailSales: number | null; retailSalesSurprise: number | null;
  gdp: number | null; gdpSurprise: number | null;
  employment: number | null; employmentSurprise: number | null;
}
interface MacroData {
  currency: string;
  indicators: Record<string, Ind | null>;
  forecasts?: MacroForecasts | null;
  fetchedAt: string;
}

interface Props {
  currency: Currency;
  expectations: Record<string, unknown> | null;
  yields: { yields: Record<string, number | null>; spreads: Record<string, number | null> } | null;
  sentiment: SentimentEntry | null;
  cot: CotEntry | null;
  ratePath: CBRatePath | null;
  onDivergenceUpdate: (currency: Currency, score: number) => void;
}

type Tab = "overview" | "mispricing" | "focus";
type SignalDir = "bullish" | "bearish" | "neutral" | "warning";

// ─── Helpers de style ─────────────────────────────────────────────────────────

function phaseStyle(p: BiasPhase) {
  if (p === "tightening")    return "bg-red-500/15 text-red-400 border-red-500/30";
  if (p === "easing")        return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  if (p === "hawkish_pause") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (p === "dovish_pause")  return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return "bg-slate-500/15 text-slate-400 border-slate-500/30";
}

function phaseLabel(p: BiasPhase) {
  if (p === "tightening")    return "Resserrement";
  if (p === "easing")        return "Assouplissement";
  if (p === "hawkish_pause") return "Pause Hawkish";
  if (p === "dovish_pause")  return "Pause Dovish";
  return "Transition";
}

function scoreDir(score: number): SignalDir {
  if (score >= 3) return "bullish";
  if (score <= -3) return "bearish";
  return "neutral";
}

function sigColor(d: SignalDir) {
  if (d === "bullish") return "text-emerald-400";
  if (d === "bearish") return "text-red-400";
  if (d === "warning") return "text-amber-400";
  return "text-slate-400";
}

function sigBg(d: SignalDir) {
  if (d === "bullish") return "bg-emerald-500/10 border-emerald-500/20";
  if (d === "bearish") return "bg-red-500/10 border-red-500/20";
  if (d === "warning") return "bg-amber-500/10 border-amber-500/20";
  return "bg-slate-500/10 border-slate-500/20";
}

function sigBar(d: SignalDir) {
  if (d === "bullish") return "bg-emerald-500";
  if (d === "bearish") return "bg-red-500";
  if (d === "warning") return "bg-amber-500";
  return "bg-slate-500";
}

function computeESI(inds: Record<string, Ind | null> | undefined): number | null {
  if (!inds) return null;
  const invertedKeys = new Set(["unemployment"]);
  const checkKeys = ["cpiYoY", "cpiCore", "pmiMfg", "pmiServices", "gdp", "retailSales", "cpiMoM", "ppiMoM", "employment"];
  const signs: number[] = [];
  for (const key of checkKeys) {
    const s = inds[key]?.surprise;
    if (s === null || s === undefined) continue;
    const sign = s > 0 ? 1 : s < 0 ? -1 : 0;
    signs.push(invertedKeys.has(key) ? -sign : sign);
  }
  if (signs.length === 0) return null;
  return Math.round(signs.reduce((a, v) => a + v, 0) / signs.length * 100);
}

function SurpriseIndexBadge({ value }: { value: number }) {
  const color = value > 20 ? "text-emerald-400" : value < -20 ? "text-red-400" : "text-slate-400";
  const bgBar = value > 20 ? "bg-emerald-500" : value < -20 ? "bg-red-500" : "bg-slate-500";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-600">ESI</span>
      <div className="w-12 h-1 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${bgBar} rounded-full`} style={{ width: `${Math.min(100, Math.abs(value))}%` }} />
      </div>
      <span className={`text-[10px] font-bold tabular-nums ${color}`}>{value > 0 ? "+" : ""}{value}</span>
    </div>
  );
}

function FocusRow({ importance, children }: { importance: "critical" | "high" | "medium"; children: React.ReactNode }) {
  const dot = importance === "critical" ? "bg-red-500" : importance === "high" ? "bg-amber-500" : "bg-slate-500";
  return (
    <div className="flex items-start gap-2">
      <span className={`w-1.5 h-1.5 rounded-full mt-[7px] shrink-0 ${dot}`} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function trendDir(t: "up"|"down"|"flat"|null): SignalDir {
  if (t === "up")   return "bullish";
  if (t === "down") return "bearish";
  return "neutral";
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function MacroBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-3 space-y-1.5">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">{title}</div>
      {children}
    </div>
  );
}

function IRow({
  label, ind, unit = "", consensus, surpriseVsCons, tooltip, info, invertSurprise = false,
}: {
  label: string; ind: Ind | null; unit?: string;
  consensus?: number | null; surpriseVsCons?: number | null;
  tooltip?: string | null; info?: string | null; invertSurprise?: boolean;
}) {
  const value = ind?.value ?? null;
  const prev  = ind?.prev  ?? null;
  const fmt   = (v: number | null) => v !== null ? `${v.toFixed(2)}${unit}` : "—";

  const s = ind?.surprise ?? null;
  const effS = invertSurprise && s !== null ? -s : s;
  const valColor = effS === null ? "text-slate-200"
    : effS > 0 ? "text-emerald-400"
    : effS < 0 ? "text-red-400"
    : "text-slate-500";

  const effSurpr = invertSurprise && surpriseVsCons !== null ? -(surpriseVsCons ?? 0) : surpriseVsCons;
  const surpriseCls = effSurpr == null ? "" : effSurpr > 0 ? "text-emerald-500" : effSurpr < 0 ? "text-red-500" : "text-slate-500";
  const surpriseArr = effSurpr == null ? "" : effSurpr > 0 ? "▲" : effSurpr < 0 ? "▼" : "▬";

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[12px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-slate-600 shrink-0">→</span>
          <span className="text-slate-400 truncate">{label}</span>
          {info && (
            <span className="relative group/info inline-flex shrink-0 cursor-help">
              <span className="inline-flex items-center justify-center w-3 h-3 rounded-full border border-slate-700 text-slate-500 text-[7px] font-bold leading-none">i</span>
              <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 w-52 px-2 py-1.5 rounded-md bg-slate-950 text-slate-300 text-[10px] leading-snug opacity-0 group-hover/info:opacity-100 transition-opacity duration-150 z-50 shadow-lg whitespace-normal border border-slate-700">
                {info}
              </span>
            </span>
          )}
        </div>
        {tooltip ? (
          <span className="relative group/val cursor-default shrink-0">
            <span className={`font-semibold tabular-nums ${valColor}`}>{fmt(value)}</span>
            <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-52 px-2 py-1.5 rounded-md bg-slate-950 text-slate-300 text-[10px] leading-snug opacity-0 group-hover/val:opacity-100 transition-opacity duration-150 z-50 shadow-lg whitespace-normal border border-slate-700">
              {tooltip}
            </span>
          </span>
        ) : (
          <span className={`font-semibold tabular-nums shrink-0 ${valColor}`}>{fmt(value)}</span>
        )}
      </div>
      <div className="flex items-center justify-between pl-4 text-[10px] text-slate-600">
        <span>Préc. <span className="text-slate-500">{fmt(prev)}</span></span>
        {surpriseVsCons !== null && surpriseVsCons !== undefined ? (
          <span className={`font-medium ${surpriseCls}`}>
            Surpr. {surpriseArr}{(effSurpr ?? 0) > 0 ? "+" : ""}{(effSurpr ?? 0).toFixed(2)}{unit}
          </span>
        ) : consensus !== null && consensus !== undefined ? (
          <span>Cons. <span className="text-blue-400 font-medium">{fmt(consensus)}</span></span>
        ) : null}
      </div>
    </div>
  );
}

function SignalBar({ strength, direction }: { strength: number; direction: SignalDir }) {
  return (
    <div className="relative w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
      <motion.div
        className={`absolute left-0 top-0 h-full rounded-full ${sigBar(direction)}`}
        initial={{ width: 0 }}
        animate={{ width: `${strength}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function CurrencyCard({
  currency, expectations, yields, sentiment, cot, ratePath, onDivergenceUpdate
}: Props) {
  const meta = CURRENCY_META[currency];

  // ── State ────────────────────────────────────────────────────────────────────
  const [data, setData]           = useState<MacroData | null>(null);
  const [phase, setPhase]         = useState<BiasPhase>("hawkish_pause");
  const [loading, setLoading]     = useState(true);
  const [rateExp, setRateExp]     = useState<RateExpectation | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cacheAge, setCacheAge]   = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [inflFilter, setInflFilter] = useState<"all" | "mom" | "yoy">("mom");
  const [expandedSig, setExpandedSig] = useState<string | null>(null);
  const [divergenceOpen, setDivergenceOpen] = useState(false);

  // ── Data fetch ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const cacheKey = `macro_${currency}`;
    try {
      const res = await fetch(`/api/macro?currency=${currency}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MacroData = await res.json();
      if ("error" in json) throw new Error(String((json as Record<string,unknown>).error));

      const prevCache = loadCache<MacroData>(cacheKey);
      const merged: MacroData = {
        ...json,
        indicators: {
          ...json.indicators,
          pmiMfg:      json.indicators.pmiMfg      ?? prevCache?.data.indicators.pmiMfg      ?? null,
          pmiServices: json.indicators.pmiServices ?? prevCache?.data.indicators.pmiServices ?? null,
        },
      };
      setData(merged);
      setFromCache(false);
      setCacheAge(null);
      saveCache(cacheKey, merged);

      const rateInd = merged.indicators.policyRate;
      if (rateInd?.trend === "up")        setPhase("tightening");
      else if (rateInd?.trend === "down") setPhase("easing");
      else                                setPhase("hawkish_pause");
    } catch {
      const cached = loadCache<MacroData>(cacheKey);
      if (cached) {
        setData(cached.data);
        setFromCache(true);
        setCacheAge(formatCacheDate(cached.savedAt));
        const rateInd = cached.data.indicators.policyRate;
        if (rateInd?.trend === "up")        setPhase("tightening");
        else if (rateInd?.trend === "down") setPhase("easing");
        else                                setPhase("hawkish_pause");
      }
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!expectations) return;
    const all = [
      ...((expectations.rate_hikes ?? []) as RateExpectation[]),
      ...((expectations.rate_cuts  ?? []) as RateExpectation[]),
    ];
    const cbShort = meta.cbShort.toLowerCase();
    setRateExp(all.find((e) =>
      e.cb.toLowerCase().includes(cbShort) || e.cb.toLowerCase().includes(currency.toLowerCase())
    ) ?? null);
  }, [expectations, currency, meta.cbShort]);

  // ── Computed values ──────────────────────────────────────────────────────────
  const inds = data?.indicators;
  const fc   = data?.forecasts ?? null;

  const forScoring = {
    policyRate:   { value: inds?.policyRate?.value   ?? null, prev: inds?.policyRate?.prev   ?? null, consensus: null, surprise: inds?.policyRate?.surprise   ?? null, trend: inds?.policyRate?.trend   ?? null, lastUpdated: "" },
    cpiCore:      { value: inds?.cpiCore?.value      ?? null, prev: inds?.cpiCore?.prev      ?? null, consensus: null, surprise: inds?.cpiCore?.surprise      ?? null, trend: inds?.cpiCore?.trend      ?? null, lastUpdated: "" },
    pmiMfg:       { value: inds?.pmiMfg?.value       ?? null, prev: inds?.pmiMfg?.prev       ?? null, consensus: null, surprise: inds?.pmiMfg?.surprise       ?? null, trend: inds?.pmiMfg?.trend       ?? null, lastUpdated: "" },
    pmiServices:  { value: inds?.pmiServices?.value  ?? null, prev: inds?.pmiServices?.prev  ?? null, consensus: null, surprise: inds?.pmiServices?.surprise  ?? null, trend: inds?.pmiServices?.trend  ?? null, lastUpdated: "" },
    gdp:          { value: inds?.gdp?.value          ?? null, prev: inds?.gdp?.prev          ?? null, consensus: null, surprise: inds?.gdp?.surprise          ?? null, trend: inds?.gdp?.trend          ?? null, lastUpdated: "" },
    retailSales:  { value: inds?.retailSales?.value  ?? null, prev: inds?.retailSales?.prev  ?? null, consensus: null, surprise: inds?.retailSales?.surprise  ?? null, trend: inds?.retailSales?.trend  ?? null, lastUpdated: "" },
    unemployment: { value: inds?.unemployment?.value ?? null, prev: inds?.unemployment?.prev ?? null, consensus: null, surprise: inds?.unemployment?.surprise ?? null, trend: inds?.unemployment?.trend ?? null, lastUpdated: "" },
    employment:   { value: inds?.employment?.value   ?? null, prev: inds?.employment?.prev   ?? null, consensus: null, surprise: inds?.employment?.surprise   ?? null, trend: inds?.employment?.trend   ?? null, lastUpdated: "" },
  };

  const macroScore = calcMacroScore(forScoring, phase);
  const biasText   = biasLabel(macroScore);
  const dir        = scoreDir(macroScore);
  const yield10Y   = yields?.yields[currency]  ?? null;
  const spread10Y  = yields?.spreads[currency] ?? null;

  const esi = computeESI(inds);
  const policyRateValue = inds?.policyRate?.value ?? null;
  const curveSpread = yield10Y !== null && policyRateValue !== null
    ? Math.round((yield10Y - policyRateValue) * 100) : null;
  const curveInverted = curveSpread !== null && curveSpread < 0;
  const curveSig: SignalDir = curveSpread === null ? "neutral"
    : curveSpread < -50 ? "warning"
    : curveInverted ? "neutral"
    : "bullish";

  useEffect(() => { onDivergenceUpdate(currency, macroScore); }, [macroScore, currency, onDivergenceUpdate]);

  const rateConsensus = (() => {
    const rate = inds?.policyRate?.value ?? null;
    if (rate === null) return null;
    if (ratePath && ratePath.meetings.length > 0) {
      const next = ratePath.meetings[0];
      if (next.probMovePct > 50)
        return next.probIsCut
          ? parseFloat((rate - 0.25).toFixed(2))
          : parseFloat((rate + 0.25).toFixed(2));
      return parseFloat(rate.toFixed(2));
    }
    if (!rateExp) return null;
    const desc = rateExp.prob_desc.toLowerCase();
    if (desc.includes("no change")) return parseFloat(rate.toFixed(2));
    if (rateExp.direction === "cut"  && rateExp.prob_pct > 50) return parseFloat((rate - 0.25).toFixed(2));
    if (rateExp.direction === "hike" && rateExp.prob_pct > 50) return parseFloat((rate + 0.25).toFixed(2));
    return parseFloat(rate.toFixed(2));
  })();

  // ── Mispricing signals (computed from live data) ──────────────────────────────
  const mispricingSignals: {
    id: string; label: string; value: string; detail: string;
    direction: SignalDir; strength: number; icon: React.ReactNode;
  }[] = [];

  // COT CFTC — Leveraged Money (hedge funds), source : CFTC FinFutWk.txt
  // Logique : "follow smart money" — majorité long HF = bullish, majorité short = bearish
  // ≠ Retail Myfxbook (contrarian) qui est géré séparément dans le signal "sentiment"
  if (cot) {
    const cotDir: SignalDir = cot.longPct > 60 ? "bullish"  // HF majoritairement long = bullish
      : cot.shortPct > 60 ? "bearish"                        // HF majoritairement short = bearish
      : cot.net > 0 ? "bullish" : cot.net < 0 ? "bearish" : "neutral";
    const imbalance = Math.abs(cot.longPct - cot.shortPct);
    mispricingSignals.push({
      id: "cot", label: "COT Hedge Funds (CFTC)",
      direction: cotDir,
      value: `${cot.longPct.toFixed(0)}% L / ${cot.shortPct.toFixed(0)}% S`,
      detail: `Leveraged Money CFTC : ${cot.longPct.toFixed(0)}% long vs ${cot.shortPct.toFixed(0)}% short (imbalance ${imbalance.toFixed(0)}%, net ${cot.net > 0 ? "+" : ""}${(cot.net / 1000).toFixed(0)}k). ${cotDir === "bullish" ? "Hedge funds majoritairement longs → signal institutionnel haussier." : cotDir === "bearish" ? "Hedge funds majoritairement shorts → signal institutionnel baissier." : "Positioning institutionnel équilibré."}`,
      strength: Math.min(100, imbalance * 2),
      icon: <BarChart2 size={13} />,
    });
  }

  // OIS / rate probability — avec drift bps fin d'an
  if (ratePath && ratePath.meetings.length > 0) {
    const peak = ratePath.peakMeeting;
    const yearEndBps = ratePath.yearEndImplied !== null
      ? Math.round((ratePath.yearEndImplied - ratePath.currentRate) * 100) : null;
    if (peak) {
      const oisDir: SignalDir = peak.probIsCut ? "bearish" : "bullish";
      const bpsLabel = yearEndBps !== null ? `${yearEndBps > 0 ? "+" : ""}${yearEndBps}bps fin an` : "";
      mispricingSignals.push({
        id: "ois", label: "OIS — Drift taux fin d'an",
        direction: oisDir,
        value: bpsLabel
          ? `${peak.probMovePct.toFixed(0)}% ${peak.probIsCut ? "Cut" : "Hike"} · ${bpsLabel}`
          : `${peak.probMovePct.toFixed(0)}% ${peak.probIsCut ? "Cut" : "Hike"}`,
        detail: `Pic OIS : ${peak.probMovePct.toFixed(0)}% de ${peak.probIsCut ? "baisse" : "hausse"} à la réunion ${peak.label}. Taux implicite fin d'an : ${ratePath.yearEndImplied?.toFixed(2) ?? "—"}% (${yearEndBps !== null ? (yearEndBps > 0 ? "+" : "") + yearEndBps + "bps vs taux actuel" : "—"}).`,
        strength: peak.probMovePct,
        icon: <Target size={13} />,
      });
    }
  }

  // Yield curve / spread
  if (spread10Y !== null && currency !== "USD") {
    const curveDir: SignalDir = spread10Y > 0 ? "bullish" : spread10Y < -150 ? "bearish" : "neutral";
    mispricingSignals.push({
      id: "yield", label: "Spread 10Y vs USD", direction: curveDir,
      value: `${spread10Y > 0 ? "+" : ""}${spread10Y}bps`,
      detail: `Différentiel de taux 10 ans vs US : ${spread10Y > 0 ? "+" : ""}${spread10Y}bps. ${Math.abs(spread10Y) > 100 ? "Écart important — potentiel de compression/expansion non pricé." : "Différentiel modéré."}`,
      strength: Math.min(100, Math.abs(spread10Y) / 2),
      icon: <Activity size={13} />,
    });
  }

  // Inflation pressure
  const cpiYoY = inds?.cpiYoY?.value ?? inds?.cpiCore?.value ?? null;
  const policyRate = inds?.policyRate?.value ?? null;
  if (cpiYoY !== null && policyRate !== null) {
    const realRate = policyRate - cpiYoY;
    const inflDir: SignalDir = realRate < 0 ? "bearish" : realRate > 1.5 ? "bullish" : "neutral";
    mispricingSignals.push({
      id: "inflation", label: "Taux Réel (Taux − Inflation)", direction: inflDir,
      value: `${realRate > 0 ? "+" : ""}${realRate.toFixed(2)}%`,
      detail: `Taux directeur ${policyRate.toFixed(2)}% − Inflation YoY ${cpiYoY.toFixed(2)}% = Taux réel ${realRate.toFixed(2)}%. ${realRate < 0 ? "Taux réel négatif → politique encore accommodante → bearish devise." : "Taux réel positif → politique restrictive → bullish devise."}`,
      strength: Math.min(100, Math.abs(realRate) * 25),
      icon: <Zap size={13} />,
    });
  }

  // Sentiment retail — contrarian (majorité short = bullish, majorité long = bearish)
  if (sentiment) {
    const sentDir: SignalDir = sentiment.longPct < 30 ? "bullish"
      : sentiment.longPct > 70 ? "bearish" : "neutral";
    mispricingSignals.push({
      id: "sentiment", label: "Sentiment Retail (Contrarian)", direction: sentDir,
      value: `${sentiment.longPct.toFixed(0)}% Long`,
      detail: `Retail ${sentiment.longPct.toFixed(0)}% long / ${sentiment.shortPct.toFixed(0)}% short. Signal contrarian : ${sentDir === "bullish" ? "majorité short → opportunité haussière" : sentDir === "bearish" ? "majorité long → opportunité baissière" : "sentiment équilibré — pas de signal contrarian fort"}.`,
      strength: Math.abs(sentiment.longPct - 50) * 2,
      icon: <Eye size={13} />,
    });
  }

  const bullCount  = mispricingSignals.filter(s => s.direction === "bullish").length;
  const bearCount  = mispricingSignals.filter(s => s.direction === "bearish").length;
  const avgStr     = mispricingSignals.length > 0
    ? Math.round(mispricingSignals.reduce((a, s) => a + s.strength, 0) / mispricingSignals.length) : 0;
  const mispricDir: SignalDir = bullCount > bearCount ? "bullish" : bearCount > bullCount ? "bearish" : "neutral";

  const divergenceSignal: SignalDir =
    mispricDir !== "neutral" && dir !== "neutral" && mispricDir === dir ? mispricDir :
    mispricDir !== "neutral" && dir !== "neutral" && mispricDir !== dir ? "warning" :
    mispricDir !== "neutral" ? mispricDir : "neutral";
  const divergenceType =
    divergenceSignal === "bullish" ? "Convergence haussière multi-signal" :
    divergenceSignal === "bearish" ? "Convergence baissière multi-signal" :
    divergenceSignal === "warning" ? `Divergence: macro ${dir === "bullish" ? "↑" : dir === "bearish" ? "↓" : "→"} vs signaux ${mispricDir === "bullish" ? "↑" : mispricDir === "bearish" ? "↓" : "→"}` :
    "Pas de signal convergent";

  // Détail des contributeurs macro (même logique que calcMacroScore)
  const macroContributors: { label: string; value: string; sig: number }[] = [
    { label: "Taux directeur", value: inds?.policyRate?.value != null ? `${inds.policyRate.value.toFixed(2)}%` : "", sig: (() => { const s = inds?.policyRate?.surprise; return s == null ? 0 : s > 0.3 ? 1 : s < -0.3 ? -1 : 0; })() },
    { label: "Core CPI",       value: inds?.cpiCore?.value     != null ? `${inds.cpiCore.value.toFixed(2)}%`     : "", sig: (() => { const s = inds?.cpiCore?.surprise;      return s == null ? 0 : s > 0.3 ? 1 : s < -0.3 ? -1 : 0; })() },
    { label: "PMI Mfg",        value: inds?.pmiMfg?.value      != null ? `${inds.pmiMfg.value.toFixed(1)}`       : "", sig: inds?.pmiMfg?.value      != null ? (inds.pmiMfg.value > 50 ? 1 : -1)      : 0 },
    { label: "PMI Services",   value: inds?.pmiServices?.value  != null ? `${inds.pmiServices.value.toFixed(1)}`  : "", sig: inds?.pmiServices?.value  != null ? (inds.pmiServices.value > 50 ? 1 : -1)  : 0 },
    { label: "PIB QoQ",        value: inds?.gdp?.value         != null ? `${inds.gdp.value > 0 ? "+" : ""}${inds.gdp.value.toFixed(2)}%`         : "", sig: (() => { const s = inds?.gdp?.surprise;         return s == null ? 0 : s > 0.3 ? 1 : s < -0.3 ? -1 : 0; })() },
    { label: "Retail Sales",   value: inds?.retailSales?.value  != null ? `${inds.retailSales.value > 0 ? "+" : ""}${inds.retailSales.value.toFixed(2)}%` : "", sig: (() => { const s = inds?.retailSales?.surprise;  return s == null ? 0 : s > 0.3 ? 1 : s < -0.3 ? -1 : 0; })() },
    { label: "Chômage",        value: inds?.unemployment?.value != null ? `${inds.unemployment.value.toFixed(2)}%` : "", sig: (() => { const s = inds?.unemployment?.surprise; return s == null ? 0 : s < -0.3 ? 1 : s > 0.3 ? -1 : 0; })() },
    { label: "Emploi",         value: inds?.employment?.value  != null ? `${inds.employment.value > 0 ? "+" : ""}${inds.employment.value.toFixed(1)}k` : "", sig: (() => { const s = inds?.employment?.surprise;  return s == null ? 0 : s > 10 ? 1 : s < -10 ? -1 : 0; })() },
  ].filter(c => c.value !== "");

  // ── Tabs config ──────────────────────────────────────────────────────────────
  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview",   label: "Aperçu",   icon: <Layers size={10} /> },
    { id: "mispricing", label: "Signaux",  icon: <Eye size={10} /> },
    { id: "focus",      label: "Focus",    icon: <Target size={10} /> },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-800">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl leading-none">{meta.flag}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-white tracking-tight">{currency}</span>
                {!loading && (
                  <span className={`text-sm font-bold ${sigColor(dir)}`}>{biasText}</span>
                )}
              </div>
              <div className="text-[11px] text-slate-500">{meta.cbShort} · {meta.name}</div>
            </div>
          </div>
          <div className="text-right">
            {loading
              ? <Loader2 size={16} className="animate-spin text-slate-600 mt-1" />
              : <>
                  <div className={`text-2xl font-black tabular-nums ${sigColor(dir)}`}>
                    {macroScore > 0 ? "+" : ""}{macroScore}
                  </div>
                  <div className="text-[10px] text-slate-600">score</div>
                </>
            }
          </div>
        </div>

        {/* Phase pill + mispricing + ESI + cache */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${phaseStyle(phase)}`}>
            {phaseLabel(phase)}
          </span>
          {mispricingSignals.length > 0 && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 ${sigBg(mispricDir)}`}>
              <span className={sigColor(mispricDir)}>
                {mispricDir === "bullish" ? "▲" : mispricDir === "bearish" ? "▼" : "—"} {avgStr}
              </span>
              <span className="text-slate-600">signaux</span>
            </span>
          )}
          {esi !== null && <SurpriseIndexBadge value={esi} />}
          {fromCache && cacheAge && (
            <span className="flex items-center gap-0.5 text-[9px] text-amber-500" title="Données depuis le cache local">
              <Database size={9} /> cache {cacheAge}
            </span>
          )}
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-800 px-1 pt-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-t-lg transition-all ${
              activeTab === t.id
                ? "text-white bg-slate-800"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.icon}
            {t.label}
            {t.id === "mispricing" && mispricingSignals.length > 0 && (
              <span className={`text-[9px] font-bold px-1 rounded ${
                mispricDir === "bullish" ? "bg-emerald-500/20 text-emerald-400"
                : mispricDir === "bearish" ? "bg-red-500/20 text-red-400"
                : "bg-slate-700 text-slate-400"
              }`}>
                {bullCount > bearCount ? `${bullCount}↑` : bearCount > bullCount ? `${bearCount}↓` : "—"}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <NarrativeButton currency={currency} phase={phase} macroScore={macroScore} />
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.12 }}
            className="space-y-2"
          >

            {/* ════ APERÇU ════════════════════════════════════════════════════ */}
            {activeTab === "overview" && (
              <>
                {/* OIS mini-chart */}
                {ratePath && ratePath.meetings.length > 0 && (
                  <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">OIS · Probabilités de move</span>
                      <span className="text-[10px] text-slate-600">au {ratePath.asOf}</span>
                    </div>
                    <ResponsiveContainer width="100%" height={48}>
                      <LineChart
                        data={ratePath.meetings.map(m => ({
                          label: m.label,
                          prob:  m.probMovePct,
                        }))}
                        margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
                      >
                        <Line type="monotone" dataKey="prob" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2, fill: "#f59e0b" }} />
                        <XAxis dataKey="label" tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 10 }}
                          labelStyle={{ color: "#94a3b8" }}
                          itemStyle={{ color: "#f59e0b" }}
                          formatter={(v: number) => [`${v.toFixed(0)}%`, "Probabilité"]}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    {ratePath.peakMeeting && (
                      <div className="flex items-center justify-between mt-1 text-[10px]">
                        <span className="text-slate-600">Pic : <span className="text-slate-400">{ratePath.peakMeeting.label}</span></span>
                        <span className={ratePath.peakMeeting.probIsCut ? "text-sky-400 font-bold" : "text-red-400 font-bold"}>
                          {ratePath.peakMeeting.probMovePct.toFixed(0)}% {ratePath.peakMeeting.probIsCut ? "Cut" : "Hike"}
                        </span>
                        {ratePath.yearEndImplied !== null && (
                          <span className="text-slate-600">fin an: {ratePath.yearEndImplied.toFixed(2)}%</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Divergence / convergence signal — expandable */}
                {divergenceSignal !== "neutral" && (
                  <div className={`rounded-xl border overflow-hidden ${sigBg(divergenceSignal)}`}>
                    <button
                      className="w-full p-3 flex items-center justify-between text-left"
                      onClick={() => setDivergenceOpen(o => !o)}
                    >
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Signal Convergence</div>
                        <div className={`text-[11px] font-semibold ${sigColor(divergenceSignal)}`}>{divergenceType}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {divergenceSignal === "bullish" && <TrendingUp size={16} className="text-emerald-400" />}
                        {divergenceSignal === "bearish" && <TrendingDown size={16} className="text-red-400" />}
                        {divergenceSignal === "warning" && <AlertTriangle size={16} className="text-amber-400" />}
                        <ChevronRight size={12} className={`text-slate-600 transition-transform ${divergenceOpen ? "rotate-90" : ""}`} />
                      </div>
                    </button>
                    <AnimatePresence>
                      {divergenceOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 space-y-3 border-t border-slate-700/30">
                            {/* Macro indicators */}
                            <div className="pt-2">
                              <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                                <span>Fondamentaux macro</span>
                                <span className={`font-bold text-[10px] ${sigColor(dir)}`}>score {macroScore > 0 ? "+" : ""}{macroScore}</span>
                              </div>
                              <div className="space-y-1">
                                {macroContributors.map(c => (
                                  <div key={c.label} className="flex items-center justify-between text-[11px]">
                                    <div className="flex items-center gap-1.5">
                                      <span className={c.sig > 0 ? "text-emerald-400" : c.sig < 0 ? "text-red-400" : "text-slate-600"}>
                                        {c.sig > 0 ? "↑" : c.sig < 0 ? "↓" : "→"}
                                      </span>
                                      <span className="text-slate-400">{c.label}</span>
                                    </div>
                                    <span className={`font-semibold tabular-nums ${c.sig > 0 ? "text-emerald-400" : c.sig < 0 ? "text-red-400" : "text-slate-500"}`}>
                                      {c.value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {/* Market signals */}
                            {mispricingSignals.length > 0 && (
                              <div className="pt-2 border-t border-slate-700/30">
                                <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                                  <span>Signaux marché</span>
                                  <span className={`font-bold text-[10px] ${sigColor(mispricDir)}`}>
                                    {bullCount}↑ {bearCount}↓
                                  </span>
                                </div>
                                <div className="space-y-1">
                                  {mispricingSignals.map(s => (
                                    <div key={s.id} className="flex items-center justify-between text-[11px]">
                                      <div className="flex items-center gap-1.5">
                                        <span className={sigColor(s.direction)}>
                                          {s.direction === "bullish" ? "↑" : s.direction === "bearish" ? "↓" : "→"}
                                        </span>
                                        <span className="text-slate-400 truncate max-w-[120px]">{s.label}</span>
                                      </div>
                                      <span className={`font-semibold tabular-nums shrink-0 ${sigColor(s.direction)}`}>
                                        {s.value}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Politique Monétaire */}
                <MacroBlock title="Politique Monétaire">
                  <IRow
                    label="Taux directeur"
                    ind={inds?.policyRate ?? null}
                    unit="%" consensus={rateConsensus}
                  />
                  <div className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-600">→</span>
                      <span className="text-slate-400">10Y Yield</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200 tabular-nums">
                        {yield10Y !== null ? `${yield10Y.toFixed(2)}%` : "—"}
                      </span>
                      {spread10Y !== null && (
                        <span className={`text-[10px] ${spread10Y > 0 ? "text-emerald-500" : "text-red-500"}`}>
                          ({spread10Y > 0 ? "+" : ""}{spread10Y}bps vs US)
                        </span>
                      )}
                    </div>
                  </div>
                  {curveSpread !== null && (
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-600">→</span>
                        <span className="text-slate-400">Courbe (10Y−CT)</span>
                      </div>
                      <span className={`font-semibold tabular-nums ${sigColor(curveSig)}`}>
                        {curveSpread > 0 ? "+" : ""}{curveSpread}bps{curveInverted ? " ⚠" : ""}
                      </span>
                    </div>
                  )}
                </MacroBlock>

                {/* Inflation avec filtre MoM/YoY */}
                <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Inflation</span>
                    <div className="flex gap-0.5">
                      {(["all", "mom", "yoy"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setInflFilter(v)}
                          className={`text-[8px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide transition-colors ${
                            inflFilter === v
                              ? "bg-slate-600 text-white"
                              : "text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {v === "all" ? "Tout" : v.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(inflFilter === "all" || inflFilter === "mom") && (
                    <>
                      <IRow label="PPI MoM"      ind={inds?.ppiMoM     ?? null} unit="%" consensus={fc?.ppiMoM ?? null} />
                      <IRow label="CPI MoM"       ind={inds?.cpiMoM     ?? null} unit="%" consensus={fc?.cpiMoM ?? null} info="Source : Inflation Rate MoM (TradingEconomics)" />
                      <IRow
                        label={(() => {
                          const isQoQ = (inds?.cpiCoreMoM as (Ind & { isQoQ?: boolean }) | null)?.isQoQ;
                          return isQoQ ? "Core CPI QoQ" : "Core CPI MoM";
                        })()}
                        ind={inds?.cpiCoreMoM ?? null}
                        unit="%" consensus={fc?.cpiCoreMoM ?? null}
                        info="=Core Inflation Rate MoM"
                        tooltip={(() => {
                          const raw = (inds?.cpiCoreMoM as (Ind & { _raw?: { last: number; prev: number; refMonth: string } }) | null)?._raw;
                          return raw ? `Index: last=${raw.last} prev=${raw.prev} ref=${raw.refMonth}` : null;
                        })()}
                      />
                    </>
                  )}

                  {(inflFilter === "all" || inflFilter === "yoy") && (
                    <>
                      <IRow
                        label="Core CPI YoY"
                        ind={inds?.cpiCore ?? null}
                        unit="%" consensus={fc?.cpiCore ?? fc?.cpi ?? null}
                        surpriseVsCons={fc?.cpiSurprise ?? null}
                        info={(() => {
                          const fd = (inds?.cpiCore as (Ind & { _finalForecast?: number; _finalDelta?: number }) | null);
                          const base = "=Core Inflation Rate YoY";
                          if (fd?._finalForecast === undefined) return base;
                          const d = fd._finalDelta ?? 0;
                          return `${base} • Final prévu : ${fd._finalForecast?.toFixed(1)}% (${d > 0 ? "↑" : d < 0 ? "↓" : "="})`;
                        })()}
                      />
                      <IRow
                        label="Inflation Rate YoY"
                        ind={inds?.cpiYoY ?? null}
                        unit="%" consensus={fc?.cpi ?? null}
                        info={(() => {
                          const fd = (inds?.cpiYoY as (Ind & { _finalForecast?: number; _finalDelta?: number }) | null);
                          const base = "=Inflation Rate YoY";
                          if (fd?._finalForecast === undefined) return base;
                          const d = fd._finalDelta ?? 0;
                          return `${base} • Final prévu : ${fd._finalForecast?.toFixed(1)}% (${d > 0 ? "↑" : d < 0 ? "↓" : "="})`;
                        })()}
                      />
                      {inds?.commodityPricesYoY && (
                        <IRow label="Commodity Prices YoY" ind={inds.commodityPricesYoY} unit="%" info="AUD — RBA Commodity Price Index" />
                      )}
                    </>
                  )}
                </div>

                {/* Croissance */}
                <MacroBlock title="Croissance">
                  <IRow label="PIB (QoQ%)"     ind={inds?.gdp          ?? null} unit="%" consensus={fc?.gdp ?? null} surpriseVsCons={fc?.gdpSurprise ?? null} />
                  <IRow label="PMI Composite"  ind={inds?.pmiComposite ?? null} consensus={fc?.pmiComposite ?? null} surpriseVsCons={fc?.pmiCompositeSurprise ?? null} />
                  <IRow label="Retail Sales"   ind={inds?.retailSales  ?? null} unit="%" consensus={fc?.retailSales ?? null} surpriseVsCons={fc?.retailSalesSurprise ?? null} />
                </MacroBlock>

                {/* Emploi */}
                <MacroBlock title="Emploi">
                  <IRow label="Variation emploi" ind={inds?.employment  ?? null} unit="k" consensus={fc?.employment ?? null} surpriseVsCons={fc?.employmentSurprise ?? null} />
                  <IRow label="Taux de chômage"  ind={inds?.unemployment ?? null} unit="%" invertSurprise consensus={fc?.unemployment ?? null} surpriseVsCons={fc?.unemploymentSurprise ?? null} />
                </MacroBlock>

                {/* PMI détail */}
                <MacroBlock title="PMI Détail">
                  <IRow label="PMI Manufacturing" ind={inds?.pmiMfg      ?? null} consensus={fc?.pmiMfg  ?? null} surpriseVsCons={fc?.pmiMfgSurprise ?? null} />
                  <IRow label="PMI Services"       ind={inds?.pmiServices ?? null} consensus={fc?.pmiSvc  ?? null} surpriseVsCons={fc?.pmiSvcSurprise ?? null} />
                </MacroBlock>
              </>
            )}

            {/* ════ SIGNAUX / MISPRICING ════════════════════════════════════ */}
            {activeTab === "mispricing" && (
              <>
                {/* Biais global */}
                <div className={`rounded-xl border p-3 flex items-center justify-between ${sigBg(mispricDir)}`}>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Biais Signaux</div>
                    <div className={`text-sm font-bold ${sigColor(mispricDir)}`}>
                      {mispricDir === "bullish" ? `${currency} Haussier` : mispricDir === "bearish" ? `${currency} Baissier` : "Signal Mixte"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500 mb-0.5">Force moy.</div>
                    <div className={`text-2xl font-black tabular-nums ${sigColor(mispricDir)}`}>{avgStr}</div>
                  </div>
                </div>

                {/* Signal list */}
                <div className="space-y-2">
                  {mispricingSignals.length === 0 && (
                    <div className="text-center text-slate-600 text-[11px] py-4">Données insuffisantes pour calculer les signaux</div>
                  )}
                  {mispricingSignals.map((sig) => (
                    <div key={sig.id}
                      className="rounded-xl border overflow-hidden bg-slate-800/30"
                      style={{
                        borderColor: sig.direction === "bullish" ? "rgba(16,185,129,0.15)"
                          : sig.direction === "bearish" ? "rgba(239,68,68,0.15)"
                          : "rgba(100,116,139,0.2)"
                      }}
                    >
                      <button
                        className="w-full px-3 py-2.5 flex items-center gap-3 text-left"
                        onClick={() => setExpandedSig(expandedSig === sig.id ? null : sig.id)}
                      >
                        <span className={`p-1.5 rounded-lg shrink-0 ${
                          sig.direction === "bullish" ? "bg-emerald-500/15 text-emerald-400"
                          : sig.direction === "bearish" ? "bg-red-500/15 text-red-400"
                          : "bg-amber-500/15 text-amber-400"
                        }`}>
                          {sig.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-slate-300 font-medium">{sig.label}</span>
                            <span className={`text-[11px] font-bold tabular-nums ${sigColor(sig.direction)}`}>{sig.value}</span>
                          </div>
                          <SignalBar strength={sig.strength} direction={sig.direction} />
                        </div>
                        <ChevronRight size={12} className={`text-slate-600 shrink-0 transition-transform ${expandedSig === sig.id ? "rotate-90" : ""}`} />
                      </button>
                      <AnimatePresence>
                        {expandedSig === sig.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-3 pb-3 pt-1 border-t border-slate-700/40">
                              <p className="text-[11px] text-slate-400 leading-relaxed">{sig.detail}</p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ════ FOCUS DONNÉES ══════════════════════════════════════════════ */}
            {activeTab === "focus" && (
              <>
                {/* Context phase */}
                <div className={`rounded-xl border p-3 text-[11px] ${sigBg(trendDir(phase === "tightening" ? "up" : phase === "easing" ? "down" : null))}`}>
                  <div className={`font-semibold mb-1 ${sigColor(trendDir(phase === "tightening" ? "up" : phase === "easing" ? "down" : null))}`}>
                    Phase {phaseLabel(phase)}
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    {phase === "tightening"    && "Surveiller les données soutenant une poursuite du resserrement : inflation, emploi solide, PMI expansionniste."}
                    {phase === "easing"        && "Surveiller les données justifiant des baisses : désinflation, ralentissement du marché de l'emploi, PMI en contraction."}
                    {phase === "hawkish_pause" && "Surveiller les données qui pourraient forcer la main : regain d'inflation ou au contraire fort ralentissement."}
                    {phase === "dovish_pause"  && "Surveiller les signes de reprise permettant une normalisation de la politique monétaire."}
                    {phase === "transition"    && "Phase de transition — tous les indicateurs sont importants pour déterminer la direction future."}
                  </p>
                </div>

                {/* Données clés selon phase */}
                <MacroBlock title={phase === "easing" || phase === "dovish_pause" ? "Données Assouplissement" : "Données Resserrement"}>
                  {(phase === "easing" || phase === "dovish_pause")
                    ? <>
                        <FocusRow importance="critical"><IRow label="Taux de chômage" ind={inds?.unemployment ?? null} unit="%" invertSurprise consensus={fc?.unemployment ?? null} /></FocusRow>
                        <FocusRow importance="critical"><IRow label="Variation emploi" ind={inds?.employment ?? null} unit="k" consensus={fc?.employment ?? null} /></FocusRow>
                        <FocusRow importance="high"><IRow label="PIB (QoQ%)" ind={inds?.gdp ?? null} unit="%" consensus={fc?.gdp ?? null} /></FocusRow>
                        <FocusRow importance="high"><IRow label="PMI Composite" ind={inds?.pmiComposite ?? null} consensus={fc?.pmiComposite ?? null} /></FocusRow>
                        <FocusRow importance="medium"><IRow label="Retail Sales" ind={inds?.retailSales ?? null} unit="%" consensus={fc?.retailSales ?? null} /></FocusRow>
                      </>
                    : <>
                        <FocusRow importance="critical"><IRow label="CPI MoM" ind={inds?.cpiMoM ?? null} unit="%" consensus={fc?.cpiMoM ?? null} /></FocusRow>
                        <FocusRow importance="critical"><IRow label="Core CPI YoY" ind={inds?.cpiCore ?? null} unit="%" consensus={fc?.cpiCore ?? null} /></FocusRow>
                        <FocusRow importance="critical"><IRow label="Inflation Rate YoY" ind={inds?.cpiYoY ?? null} unit="%" consensus={fc?.cpi ?? null} /></FocusRow>
                        <FocusRow importance="high"><IRow label="PMI Services" ind={inds?.pmiServices ?? null} consensus={fc?.pmiSvc ?? null} /></FocusRow>
                        <FocusRow importance="high"><IRow label="Variation emploi" ind={inds?.employment ?? null} unit="k" consensus={fc?.employment ?? null} /></FocusRow>
                      </>
                  }
                </MacroBlock>

                {/* Autres indicateurs (référence) */}
                <MacroBlock title="Référence (autres données)">
                  {(phase === "easing" || phase === "dovish_pause")
                    ? <>
                        <FocusRow importance="medium"><IRow label="CPI MoM" ind={inds?.cpiMoM ?? null} unit="%" /></FocusRow>
                        <FocusRow importance="medium"><IRow label="Core CPI YoY" ind={inds?.cpiCore ?? null} unit="%" /></FocusRow>
                        <FocusRow importance="medium"><IRow label="PPI MoM" ind={inds?.ppiMoM ?? null} unit="%" /></FocusRow>
                      </>
                    : <>
                        <FocusRow importance="medium"><IRow label="Taux de chômage" ind={inds?.unemployment ?? null} unit="%" invertSurprise /></FocusRow>
                        <FocusRow importance="medium"><IRow label="PIB (QoQ%)" ind={inds?.gdp ?? null} unit="%" /></FocusRow>
                        <FocusRow importance="medium"><IRow label="Retail Sales" ind={inds?.retailSales ?? null} unit="%" /></FocusRow>
                      </>
                  }
                </MacroBlock>

                {/* Taux directeur */}
                <MacroBlock title="Politique Monétaire">
                  <IRow label="Taux directeur" ind={inds?.policyRate ?? null} unit="%" consensus={rateConsensus} />
                  {yield10Y !== null && (
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-600">→</span>
                        <span className="text-slate-400">10Y Yield</span>
                      </div>
                      <span className="font-semibold text-slate-200 tabular-nums">{yield10Y.toFixed(2)}%</span>
                    </div>
                  )}
                </MacroBlock>
              </>
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
