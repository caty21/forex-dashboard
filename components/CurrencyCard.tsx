"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, Minus, Loader2, Database,
  BarChart2, Activity, Target, Zap, Eye, Layers,
  ChevronRight, ArrowUpRight, ArrowDownRight, AlertTriangle, Info,
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
} from "recharts";
import { CURRENCY_META, COUNTRY_PROFILES } from "@/lib/constants";
import { biasLabel, calcMacroScore } from "@/lib/scoring";
import { saveCache, loadCache, formatCacheDate } from "@/lib/localCache";
import type { Currency, BiasPhase, RateExpectation, MacroSection } from "@/lib/types";
import type { CBRatePath, ILWeeklyDelta } from "@/lib/rateprobability";
import type { SentimentEntry, CotEntry } from "@/lib/types";
import type { CalendarEvent } from "@/app/api/calendar/route";
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
  calEvents?: CalendarEvent[];
  macroSection?: MacroSection;
  syncMacroSlide?: "mon" | "infl" | "cro" | "empl";
  onMacroSlideChange?: (id: "mon" | "infl" | "cro" | "empl") => void;
  syncCardTab?: "overview" | "mispricing" | "focus";
  onCardTabChange?: (id: "overview" | "mispricing" | "focus") => void;
  syncSignauxSlide?: "ois" | "cot" | "sent";
  onSignauxSlideChange?: (id: "ois" | "cot" | "sent") => void;
}

type Tab = "overview" | "mispricing" | "focus";
type SignalDir = "bullish" | "bearish" | "neutral" | "warning";
type SliderBlock = "news" | "ois" | "cot" | "signal";

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

// ─── Phase depuis OIS (source primaire) ──────────────────────────────────────
// Ordre de priorité :
//  1. Resserrement actif   : proba de hausse >60% ET bps annuels >+15
//  2. Assouplissement actif: proba de coupe  >60% OU bps annuels <−40
//  3. Pause dovish         : bps annuels ≤ −15 (coupes attendues, pas imminentes)
//  4. Pause hawkish        : bps annuels ≥ +20 OU biais sans coupe modérément pricé
//  5. Transition           : anticipations neutres (fin de cycle, CB en attente)
function computePhaseFromOIS(ratePath: CBRatePath | null): BiasPhase | null {
  if (!ratePath?.peakMeeting) return null;
  const yearEndBps = ratePath.yearEndImplied !== null
    ? Math.round((ratePath.yearEndImplied - ratePath.currentRate) * 100)
    : 0;
  const { probMovePct, probIsCut } = ratePath.peakMeeting;
  if (!probIsCut && probMovePct > 60 && yearEndBps >= 15) return "tightening";
  if (probIsCut && (probMovePct > 60 || yearEndBps <= -40))  return "easing";
  if (yearEndBps <= -15)                                      return "dovish_pause";
  if (yearEndBps >= 20 || (!probIsCut && probMovePct > 40 && yearEndBps > 5)) return "hawkish_pause";
  return "transition";
}

// ─── Description contextuelle de la phase (avec vrais chiffres OIS) ──────────
function phaseDescription(phase: BiasPhase, ratePath: CBRatePath | null): string {
  const yearEndBps = (ratePath?.yearEndImplied != null && ratePath?.currentRate != null)
    ? Math.round((ratePath.yearEndImplied - ratePath.currentRate) * 100)
    : null;
  const peak   = ratePath?.peakMeeting;
  const bpsStr = yearEndBps !== null ? `${yearEndBps > 0 ? "+" : ""}${yearEndBps}bps fin d'an` : "";
  const probStr = peak ? `${peak.probMovePct.toFixed(0)}% de ${peak.probIsCut ? "coupe" : "hausse"} (${peak.label})` : "";
  switch (phase) {
    case "tightening":
      return `Cycle de resserrement actif — ${probStr}${bpsStr ? ` · ${bpsStr}` : ""}. Surveiller : inflation, emploi solide, PMI > 50.`;
    case "easing":
      return `Cycle d'assouplissement — ${probStr}${bpsStr ? ` · ${bpsStr}` : ""}. Surveiller : désinflation, ralentissement emploi, PMI < 50.`;
    case "dovish_pause":
      return `Pause dovish${bpsStr ? ` — ${bpsStr} anticipés` : ""}. Prochaine réunion stable mais coupes attendues plus tard. Surveiller : timing désinflation.`;
    case "hawkish_pause":
      return `Pause hawkish${bpsStr ? ` — ${bpsStr} anticipés` : ""}. CB en attente. Surveiller : regain d'inflation ou fort ralentissement.`;
    case "transition":
      return `Anticipations neutres${bpsStr ? ` (${bpsStr})` : ""}. CB données-dépendantes — tous les indicateurs comptent.`;
  }
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
  const cls = value > 20
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : value < -20
    ? "bg-red-500/15 text-red-400 border-red-500/30"
    : "bg-slate-700/40 text-slate-400 border-slate-600/30";
  return (
    <span
      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border tabular-nums ${cls}`}
      title={"ESI — Economic Surprise Index\n\nBeat/miss de 9 indicateurs (CPI, PMI, PIB, emploi…).\nPlage −100 → +100. Vert > +20 (majorité de beats), Rouge < −20 (majorité de misses)."}
    >
      ESI {value > 0 ? "+" : ""}{value}
    </span>
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

// ─── Profils géopolitiques statiques ─────────────────────────────────────────

const ENERGY_PROFILE: Record<string, {
  type: "export" | "import" | "neutre";
  desc: string;
  products: string[];
}> = {
  USD: { type: "export",  desc: "1er producteur mondial pétrole + gaz (EIA). Exportateur net depuis 2019.",            products: ["Pétrole", "GNL", "Blé", "Soja", "Maïs"] },
  EUR: { type: "import",  desc: "Import ~75% énergie (MENA, Russie réduit). Très sensible aux chocs pétrole.",         products: ["Blé (FR, DE)", "Machines industrielles"] },
  GBP: { type: "neutre",  desc: "Mer du Nord en déclin. Production ≈ consommation (~neutre).",                          products: ["Services financiers"] },
  JPY: { type: "import",  desc: "Import ~90% énergie. 3ème importateur GNL mondial. Très sensible au Détroit d'Hormuz.", products: ["Électronique", "Voitures"] },
  CHF: { type: "import",  desc: "Import ~75% énergie (gaz naturel Europe, pétrole OPEP).",                              products: [] },
  CAD: { type: "export",  desc: "Pétrole sables bitumineux (Alberta). Export ~4 Mb/j.",                                 products: ["Pétrole", "Gaz naturel", "Blé", "Potasse", "Bois d'œuvre"] },
  AUD: { type: "export",  desc: "2ème exportateur GNL mondial. Export charbon thermique + métallurgique.",              products: ["Minerai de fer", "GNL", "Charbon", "Or", "Blé", "Cuivre"] },
  NZD: { type: "import",  desc: "Import pétrole. Renouvelables ~85% élec (hydro). Indépendant localement.",            products: ["Lait / Produits laitiers", "Viande bovine", "Bois", "Laine"] },
};

function trendDir(t: "up"|"down"|"flat"|null): SignalDir {
  if (t === "up")   return "bullish";
  if (t === "down") return "bearish";
  return "neutral";
}

// ─── RpArrow : flèche de tendance pour probabilités de taux (delta IL hebdo) ──
// delta         = valeur_actuelle - valeur_précédent_article
// isBearishIfUp = true si une hausse du delta est baissière pour la devise

function RpArrow({
  delta, isBearishIfPositive, suffix, strongT, modT,
}: {
  delta: number; isBearishIfPositive: boolean; suffix: string; strongT: number; modT: number;
}) {
  const abs = Math.abs(delta);
  if (abs < modT) return null;
  const strong = abs >= strongT;
  const up     = delta > 0;
  const bearish = isBearishIfPositive ? up : !up;
  const color   = bearish ? "text-sky-400" : "text-amber-400";
  const arrow   = strong ? (up ? "↑↑" : "↓↓") : (up ? "↑" : "↓");
  return (
    <span className={`font-bold ${color}`}>
      {arrow}{up ? "+" : ""}{Math.abs(Math.round(abs * 10) / 10)}{suffix}
    </span>
  );
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function MacroBlock({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 p-3 space-y-1.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function IRow({
  label, ind, unit = "", consensus, surpriseVsCons, tooltip, info, invertSurprise = false, isNew = false,
}: {
  label: string; ind: Ind | null; unit?: string;
  consensus?: number | null; surpriseVsCons?: number | null;
  tooltip?: string | null; info?: string | null; invertSurprise?: boolean; isNew?: boolean;
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
          {isNew && (
            <span className="text-[7px] font-bold px-1 py-px rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0 animate-pulse">NEW</span>
          )}
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

// ─── OIS Enhanced Block ───────────────────────────────────────────────────────
// Bloc OIS enrichi : summary (Current Rate → Expected, Next Meeting, Most Likely/Alt)
// + 3 onglets graphiques : Rate Curve / Implied Points / Scénarios

function OISEnhancedBlock({ ratePath }: { ratePath: CBRatePath }) {
  const [chartTab, setChartTab] = useState<"curve" | "implied" | "scenarios">("curve");

  const { currentRate, meetings, yearEndImplied, ilDelta, ilCurrent } = ratePath;
  if (!meetings.length) return null;

  const m0 = meetings[0];
  const bpsYE = yearEndImplied !== null ? Math.round((yearEndImplied - currentRate) * 100) : null;
  const bpsCls = bpsYE === null ? "text-slate-400" : bpsYE < 0 ? "text-sky-400" : bpsYE > 0 ? "text-red-400" : "text-slate-400";

  // Expected move at next meeting
  const isMoveExpected = m0.probMovePct >= 50;
  const moveLabel  = isMoveExpected ? (m0.probIsCut ? "Cut" : "Hike") : "Hold";
  const moveCls    = isMoveExpected ? (m0.probIsCut ? "text-sky-400" : "text-red-400") : "text-slate-400";
  const moveIcon   = isMoveExpected ? (m0.probIsCut ? "↓" : "↑") : "=";

  // Probability-weighted expected bps at next meeting
  const expectedBps = Math.round((m0.probMovePct / 100) * (m0.impliedRate - currentRate) * 10000) / 100;

  // Most Likely / Alternative scenarios at next meeting
  const mlIsMove = m0.probMovePct >= 50;
  const mlRate   = mlIsMove ? m0.impliedRate : currentRate;
  const mlProb   = mlIsMove ? m0.probMovePct : 100 - m0.probMovePct;
  const altRate  = mlIsMove ? currentRate : m0.impliedRate;
  const altProb  = mlIsMove ? 100 - m0.probMovePct : m0.probMovePct;
  const altIsMove = !mlIsMove;

  // Chart data (limit to 10 meetings)
  const chartMeetings = meetings.slice(0, 10);

  const rateCurveData = chartMeetings.map(m => ({
    label: m.label,
    current: +m.impliedRate.toFixed(3),
    ...(ilDelta ? { weekAgo: +(m.impliedRate + ilDelta.bpsDelta / 100).toFixed(3) } : {}),
  }));

  const impliedPtsData = chartMeetings.map(m => ({
    label: m.label,
    bps: +m.changeBps.toFixed(1),
  }));

  const scenariosData = meetings.slice(0, 8).map(m => ({
    label: m.label,
    dateIso: m.dateIso,
    rate: +m.impliedRate.toFixed(3),
    prob: m.probMovePct,
    isCut: m.probIsCut,
  }));

  // Y-axis domain for Rate Curve
  const allRates = rateCurveData.flatMap(d => [d.current, d.weekAgo].filter((v): v is number => v !== undefined));
  allRates.push(currentRate);
  const minR = Math.min(...allRates);
  const maxR = Math.max(...allRates);
  const yMargin = Math.max(0.05, (maxR - minR) * 0.25);

  return (
    <div className="rounded-xl border border-slate-700/30 overflow-hidden">

      {/* ── Summary header ────────────────────────────────────────────────── */}
      <div className="bg-slate-800/40 px-3 pt-2.5 pb-2">
        {/* Title */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">OIS · Futures</span>
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">LIVE</span>
          </div>
          <span className="text-[9px] text-slate-600">au {ratePath.asOf}</span>
        </div>

        {/* 3-column rates */}
        <div className="grid grid-cols-3 gap-1 mb-2">
          <div>
            <div className="text-[8px] text-slate-600">Current Rate</div>
            <div className="text-[15px] font-bold text-slate-200 tabular-nums">{currentRate.toFixed(2)}%</div>
          </div>
          <div>
            <div className="text-[8px] text-slate-600">Expected</div>
            <div className={`text-[15px] font-bold tabular-nums ${bpsCls}`}>{yearEndImplied?.toFixed(2) ?? "—"}%</div>
          </div>
          <div className="text-right">
            <div className="text-[8px] text-slate-600">Next Meeting</div>
            <div className="text-[11px] font-semibold text-slate-300">{m0.label}</div>
          </div>
        </div>

        {/* Expected Move + Change bps + Δ fin an */}
        <div className="flex items-center gap-3 mb-2">
          <div>
            <div className="text-[8px] text-slate-600">Expected Move</div>
            <div className={`flex items-center gap-0.5 text-[12px] font-bold ${moveCls}`}>
              <span>{moveIcon}</span><span>{moveLabel}</span>
            </div>
          </div>
          <div>
            <div className="text-[8px] text-slate-600">Change (bps)</div>
            <div className={`text-[12px] font-bold tabular-nums ${bpsCls}`}>
              {expectedBps > 0 ? "+" : ""}{expectedBps.toFixed(2)}
            </div>
          </div>
          {bpsYE !== null && (
            <div className="ml-auto text-right">
              <div className="text-[8px] text-slate-600">Δ fin an</div>
              <div className={`text-[18px] font-black tabular-nums ${bpsCls}`}>
                {bpsYE > 0 ? "+" : ""}{bpsYE}<span className="text-[9px] ml-0.5">bps</span>
              </div>
            </div>
          )}
        </div>

        {/* Most Likely / Alternative probability bars */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] text-slate-600 w-14 shrink-0">Most Likely</span>
            <span className={`text-[9px] font-bold w-3 text-center shrink-0 ${mlIsMove ? moveCls : "text-slate-400"}`}>{mlIsMove ? moveIcon : "="}</span>
            <span className="text-[9px] font-bold text-slate-200 tabular-nums w-10 shrink-0">{mlRate.toFixed(2)}%</span>
            <div className="flex-1 bg-slate-700/40 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full ${mlIsMove ? (m0.probIsCut ? "bg-sky-500" : "bg-red-500") : "bg-amber-500/70"}`}
                style={{ width: `${mlProb}%` }}
              />
            </div>
            <span className="text-[8px] font-semibold text-slate-400 w-7 text-right shrink-0">{Math.round(mlProb)}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] text-slate-600 w-14 shrink-0">Alternative</span>
            <span className={`text-[9px] font-bold w-3 text-center shrink-0 ${altIsMove ? moveCls : "text-slate-500"}`}>{altIsMove ? moveIcon : "="}</span>
            <span className="text-[9px] font-bold text-slate-500 tabular-nums w-10 shrink-0">{altRate.toFixed(2)}%</span>
            <div className="flex-1 bg-slate-700/40 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full ${altIsMove ? (m0.probIsCut ? "bg-sky-400/40" : "bg-red-400/40") : "bg-slate-500/40"}`}
                style={{ width: `${altProb}%` }}
              />
            </div>
            <span className="text-[8px] font-semibold text-slate-600 w-7 text-right shrink-0">{Math.round(altProb)}%</span>
          </div>
        </div>
      </div>

      {/* ── Chart section ─────────────────────────────────────────────────── */}
      <div className="border-t border-slate-700/40 px-3 pt-2 pb-2">
        {/* Tab buttons */}
        <div className="flex gap-1 mb-2">
          {([ { id: "curve" as const, label: "Rate Curve" }, { id: "implied" as const, label: "Implied Pts" }, { id: "scenarios" as const, label: "Scénarios" } ]).map(t => (
            <button
              key={t.id}
              onClick={() => setChartTab(t.id)}
              className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border transition-all ${
                chartTab === t.id
                  ? "bg-slate-700 border-slate-500 text-white"
                  : "border-slate-700/60 text-slate-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Chart 1 — Implied Interest Rate Curve */}
        {chartTab === "curve" && (
          <div>
            {/* Légende visuelle */}
            <div className="flex items-center gap-3 mb-1.5">
              <span className="text-[8px] text-slate-500">Courbe de taux implicite</span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="flex items-center gap-1 text-[8px] text-slate-200">
                  <span className="inline-block w-5 h-px bg-slate-200 rounded" />
                  Actuel
                </span>
                <span className={`flex items-center gap-1 text-[8px] ${ilDelta ? "text-sky-400" : "text-slate-600"}`}>
                  <span className={`inline-block w-5 border-t border-dashed ${ilDelta ? "border-sky-400" : "border-slate-700"}`} />
                  {ilDelta ? `Sem. préc. (${ilDelta.prevDate})` : "Sem. préc. (indispo)"}
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={rateCurveData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} width={32}
                  domain={[minR - yMargin, maxR + yMargin]}
                  tickFormatter={(v: number) => v.toFixed(2)} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 9 }}
                  labelStyle={{ color: "#94a3b8", fontSize: 9 }}
                  itemStyle={{ color: "#e2e8f0", fontSize: 9 }}
                  formatter={(v: number, name: string) => [`${v.toFixed(3)}%`, name === "current" ? "Actuel" : "Sem. préc."]}
                />
                <Line type="monotone" dataKey="current" stroke="#e2e8f0" strokeWidth={1.5} dot={{ r: 2, fill: "#e2e8f0" }} name="current" />
                {ilDelta && (
                  <Line type="monotone" dataKey="weekAgo" stroke="#38bdf8" strokeWidth={1.5} dot={{ r: 2, fill: "#38bdf8" }} strokeDasharray="4 2" name="weekAgo" />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Chart 2 — Implied Points (bps cumulatifs par réunion) */}
        {chartTab === "implied" && (
          <div>
            {/* Légende couleurs barres */}
            <div className="flex items-center gap-3 mb-1.5">
              <span className="text-[8px] text-slate-500">Implied Points (bps par réunion)</span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="flex items-center gap-1 text-[8px] text-emerald-400">
                  <span className="inline-block w-2 h-2 rounded-sm bg-emerald-400/80" /> Hausse
                </span>
                <span className="flex items-center gap-1 text-[8px] text-pink-400">
                  <span className="inline-block w-2 h-2 rounded-sm bg-pink-400/80" /> Baisse
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={impliedPtsData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 7, fill: "#64748b" }} axisLine={false} tickLine={false} width={36}
                  tickFormatter={(v: number) => `${v}bps`} />
                <ReferenceLine y={0} stroke="#334155" strokeWidth={0.5} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 9 }}
                  labelStyle={{ color: "#94a3b8", fontSize: 9 }}
                  itemStyle={{ color: "#e2e8f0", fontSize: 9 }}
                  formatter={(v: number) => [`${v > 0 ? "+" : ""}${v.toFixed(1)}bps`, "Implied"]}
                />
                <Bar dataKey="bps" radius={[2, 2, 0, 0]}>
                  {impliedPtsData.map((entry, i) => (
                    <Cell key={i} fill={entry.bps < 0 ? "#f472b6" : entry.bps > 0 ? "#4ade80" : "#475569"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Chart 3 — Scénarios : taux implicite par réunion (barres horizontales) */}
        {chartTab === "scenarios" && (
          <div>
            <div className="text-[8px] text-slate-600 mb-1.5">Taux implicite par réunion</div>
            <div className="space-y-1">
              {(() => {
                const maxR2 = Math.max(...scenariosData.map(d => d.rate), currentRate);
                const minR2 = Math.min(...scenariosData.map(d => d.rate), currentRate) - 0.05;
                const range = maxR2 - minR2 || 0.25;
                return scenariosData.map(d => {
                  const barW   = Math.max(5, Math.min(100, ((d.rate - minR2) / range) * 100));
                  const isDown = d.rate < currentRate - 0.001;
                  const isUp   = d.rate > currentRate + 0.001;
                  const barCl  = isDown ? "bg-sky-500/70" : isUp ? "bg-red-500/70" : "bg-amber-500/60";
                  const isPeak = ratePath.peakMeeting?.dateIso === d.dateIso;
                  return (
                    <div key={d.label} className="flex items-center gap-1.5">
                      <span className={`text-[8px] w-9 shrink-0 ${isPeak ? "text-amber-300 font-bold" : "text-slate-600"}`}>
                        {d.label}{isPeak ? "●" : ""}
                      </span>
                      <div className="flex-1 bg-slate-700/30 rounded-full h-2.5 overflow-hidden">
                        <div className={`h-full ${barCl} rounded-full`} style={{ width: `${barW}%` }} />
                      </div>
                      <span className="text-[8px] font-mono text-slate-300 w-10 text-right shrink-0">{d.rate.toFixed(2)}%</span>
                      <span className="text-[7px] text-slate-600 w-6 text-right shrink-0">{d.prob.toFixed(0)}%</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>

      {/* ── IL footer (analyste InvestingLive) ────────────────────────────── */}
      {ilCurrent && (
        <div className="border-t border-slate-700/40 bg-slate-900/30 px-3 py-1.5 flex items-center justify-between gap-2">
          <span className="text-[9px] text-slate-600 italic shrink-0">
            Analyste · {ilCurrent.articleDate} ·{" "}
            <span className={ilCurrent.isCut ? "text-sky-400" : ilCurrent.isNoChange ? "text-slate-400" : "text-red-400"}>
              {ilCurrent.isNoChange ? "Hold" : `${ilCurrent.isCut ? "" : "+"}${ilCurrent.bpsYearEnd}bps`}
            </span>
          </span>
          {ratePath.ilDelta && (Math.abs(ratePath.ilDelta.probDelta) >= 3 || Math.abs(ratePath.ilDelta.bpsDelta) >= 5) && (
            <span className="text-[9px] text-slate-500 flex items-center gap-1 shrink-0">
              Δsem:
              <RpArrow delta={ratePath.ilDelta.probDelta} isBearishIfPositive={ratePath.ilDelta.isCut} suffix="%" strongT={10} modT={3} />
              <RpArrow delta={ratePath.ilDelta.bpsDelta}  isBearishIfPositive={true} suffix="bps" strongT={25} modT={5} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function CurrencyCard({
  currency, expectations, yields, sentiment, cot, ratePath, onDivergenceUpdate,
  calEvents, macroSection, syncMacroSlide, onMacroSlideChange,
  syncCardTab, onCardTabChange, syncSignauxSlide, onSignauxSlideChange,
}: Props) {
  const meta = CURRENCY_META[currency];

  // ── State ────────────────────────────────────────────────────────────────────
  const [data, setData]           = useState<MacroData | null>(null);
  // Phase dérivée des probabilités OIS (source primaire) ou du trend FRED (fallback)
  const phase = useMemo<BiasPhase>(() => {
    const oisPhase = computePhaseFromOIS(ratePath);
    if (oisPhase) return oisPhase;
    const rateInd = data?.indicators?.policyRate;
    if (rateInd?.trend === "up")   return "tightening";
    if (rateInd?.trend === "down") return "easing";
    return "hawkish_pause";
  }, [ratePath, data]);
  const [loading, setLoading]     = useState(true);
  const [rateExp, setRateExp]     = useState<RateExpectation | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cacheAge, setCacheAge]   = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [inflFilter, setInflFilter] = useState<"all" | "mom" | "yoy">("mom");
  const [expandedSig, setExpandedSig] = useState<string | null>(null);
  const [divergenceOpen, setDivergenceOpen] = useState(false);
  const [showCotInfo, setShowCotInfo]       = useState(false);
  const [showAllMeetings, setShowAllMeetings] = useState(false);
  const [showYield10Y, setShowYield10Y]       = useState(false);
  const [showRecentNews, setShowRecentNews]   = useState(false);
  const [showUpcoming, setShowUpcoming]       = useState(false);
  const [sliderBlock, setSliderBlock] = useState<SliderBlock>("ois");
  const [sliderDir, setSliderDir]     = useState<1|-1>(1);
  type MacroSlide   = "mon" | "infl" | "cro" | "empl";
  type SignauxSlide = "ois" | "cot" | "sent";
  const [macroSlide,    setMacroSlide]    = useState<MacroSlide>("mon");
  const [macroSlideDir, setMacroSlideDir] = useState<1|-1>(1);
  const prevSyncMacroRef = useRef<MacroSlide>(syncMacroSlide ?? "mon");
  const [signauxSlide,    setSignauxSlide]    = useState<SignauxSlide>("ois");
  const [signauxSlideDir, setSignauxSlideDir] = useState<1|-1>(1);
  const prevSyncCardTabRef     = useRef<Tab>(syncCardTab ?? "overview");
  const prevSyncSignauxSlideRef = useRef<SignauxSlide>(syncSignauxSlide ?? "ois");

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
    } catch {
      const cached = loadCache<MacroData>(cacheKey);
      if (cached) {
        setData(cached.data);
        setFromCache(true);
        setCacheAge(formatCacheDate(cached.savedAt));
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

  // COT CFTC — Analyse flux AM (hedging) vs HF (spéculation) + momentum hebdomadaire
  // Logique : qui domine le flux ET dans quelle direction évolue chaque groupe
  if (cot) {
    const hfIsShort      = cot.net < 0;
    const amDominates    = Math.abs(cot.amNet) > Math.abs(cot.net);
    const hfLongsGrowing  = cot.longsDelta  !== null && cot.longsDelta  > 0;
    const hfShortsReducing= cot.shortsDelta !== null && cot.shortsDelta < 0;
    const hfShortsGrowing = cot.shortsDelta !== null && cot.shortsDelta > 0;
    const hfLongsReducing = cot.longsDelta  !== null && cot.longsDelta  < 0;
    // Direction du signal = momentum, pas position absolue
    let cotDir: SignalDir;
    if (amDominates) {
      cotDir = cot.amNet > 0 ? "bullish" : "bearish";
    } else if (hfIsShort) {
      cotDir = (hfLongsGrowing || hfShortsReducing) ? "neutral" : "bearish";
    } else {
      cotDir = (hfShortsGrowing || hfLongsReducing) ? "neutral" : "bullish";
    }
    // Tendance HF en mots
    let hfTrend = "";
    if (hfIsShort) {
      if (hfLongsGrowing && hfShortsReducing) hfTrend = "retournement en cours (L↑ S↓)";
      else if (hfLongsGrowing)   hfTrend = "accumulation de longs (L↑)";
      else if (hfShortsReducing) hfTrend = "couverture de shorts (S↓)";
      else hfTrend = "shorts stables";
    } else {
      if (hfShortsGrowing && hfLongsReducing) hfTrend = "retournement baissier (S↑ L↓)";
      else if (hfShortsGrowing) hfTrend = "ajout de shorts (S↑)";
      else if (hfLongsReducing) hfTrend = "réduction de longs (L↓)";
      else hfTrend = "longs stables";
    }
    const hfImbalance = Math.abs(cot.longPct - cot.shortPct);
    const momentumBoost = cot.netDelta !== null ? Math.min(30, Math.abs(cot.netDelta) / 500) : 0;
    mispricingSignals.push({
      id: "cot", label: "COT CFTC — Flux & Momentum",
      direction: cotDir,
      value: amDominates
        ? `AM ${cot.amNet > 0 ? "+" : ""}${(cot.amNet/1000).toFixed(0)}k domine`
        : `HF ${cot.net > 0 ? "+" : ""}${(cot.net/1000).toFixed(0)}k domine`,
      detail: `AM (hedging) : net ${cot.amNet > 0 ? "+" : ""}${(cot.amNet/1000).toFixed(0)}k${cot.amNetDelta !== null ? ` Δ${cot.amNetDelta > 0 ? "+" : ""}${(cot.amNetDelta/1000).toFixed(0)}k` : ""}. HF (spécu) : net ${cot.net > 0 ? "+" : ""}${(cot.net/1000).toFixed(0)}k — ${hfTrend}. Flux dominant : ${amDominates ? "AM (institutionnel)" : "HF (spéculatif)"}.`,
      strength: Math.min(100, hfImbalance * 1.5 + momentumBoost),
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

  // Taux réel = Taux directeur − CPI YoY headline (= Inflation Rate YoY TE)
  // Pas de fallback sur Core CPI : Core < Headline → gonflerait artificiellement le taux réel
  const cpiHeadlineForReal = inds?.cpiYoY?.value ?? null;
  const policyRate = inds?.policyRate?.value ?? null;
  if (cpiHeadlineForReal !== null && policyRate !== null) {
    const realRate = policyRate - cpiHeadlineForReal;
    const inflDir: SignalDir = realRate < 0 ? "bearish" : realRate > 1.5 ? "bullish" : "neutral";
    mispricingSignals.push({
      id: "inflation", label: "Taux Réel (CT − CPI YoY)", direction: inflDir,
      value: `${realRate > 0 ? "+" : ""}${realRate.toFixed(2)}%`,
      detail: `Taux directeur ${policyRate.toFixed(2)}% − CPI YoY ${cpiHeadlineForReal.toFixed(2)}% = Taux réel ${realRate.toFixed(2)}%. ${realRate < 0 ? "Taux réel négatif → politique encore accommodante → bearish devise." : realRate > 1.5 ? "Taux réel élevé → politique très restrictive → bullish devise." : "Taux réel faiblement positif → neutre."}`,
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

  // Convergence : les deux s'alignent → fort signal
  // Divergence  : macro et signaux se contredisent → alerte
  // Macro seul  : signaux neutres mais macro directionnelle → signaler quand même
  // Signaux seuls: macro neutre mais signaux directionnels → signaler quand même
  const divergenceSignal: SignalDir =
    mispricDir !== "neutral" && dir !== "neutral" && mispricDir === dir ? mispricDir :
    mispricDir !== "neutral" && dir !== "neutral" && mispricDir !== dir ? "warning" :
    dir !== "neutral" ? dir :            // macro seule directionnelle (signaux neutres)
    mispricDir !== "neutral" ? mispricDir : // signaux seuls (macro neutre)
    "neutral";

  const macroOnly   = dir !== "neutral" && mispricDir === "neutral";
  const signalsOnly = mispricDir !== "neutral" && dir === "neutral";
  const bothAligned = mispricDir !== "neutral" && dir !== "neutral" && mispricDir === dir;
  const bothOpposed = mispricDir !== "neutral" && dir !== "neutral" && mispricDir !== dir;

  const divergenceType =
    bothAligned && divergenceSignal === "bullish" ? "Convergence haussière multi-signal" :
    bothAligned && divergenceSignal === "bearish" ? "Convergence baissière multi-signal" :
    bothOpposed ? `Divergence: macro ${dir === "bullish" ? "↑" : "↓"} vs signaux ${mispricDir === "bullish" ? "↑" : "↓"}` :
    macroOnly && dir === "bullish" ? `Macro haussière (score +${macroScore}), signaux neutres` :
    macroOnly && dir === "bearish" ? `Macro baissière (score ${macroScore}), signaux neutres` :
    signalsOnly && mispricDir === "bullish" ? `Signaux haussiers, macro neutre` :
    signalsOnly && mispricDir === "bearish" ? `Signaux baissiers, macro neutre` :
    "Pas de signal convergent";

  // Détail des contributeurs macro (même logique que calcMacroScore)
  const macroContributors: { label: string; value: string; sig: number }[] = [
    { label: "Taux directeur", value: inds?.policyRate?.value != null ? `${inds.policyRate.value.toFixed(2)}%` : "", sig: (() => { const s = inds?.policyRate?.surprise; return s == null ? 0 : s > 0.3 ? 1 : s < -0.3 ? -1 : 0; })() },
    { label: "Core CPI",       value: inds?.cpiCore?.value     != null ? `${inds.cpiCore.value.toFixed(2)}%`     : "", sig: (() => { const s = inds?.cpiCore?.surprise;      return s == null ? 0 : s > 0.3 ? 1 : s < -0.3 ? -1 : 0; })() },
    { label: "PMI Mfg",        value: inds?.pmiMfg?.value      != null ? `${inds.pmiMfg.value.toFixed(1)}`       : "", sig: inds?.pmiMfg?.value      != null ? (inds.pmiMfg.value > 50 ? 1 : -1)      : 0 },
    { label: "PMI Services",   value: inds?.pmiServices?.value  != null ? `${inds.pmiServices.value.toFixed(1)}`  : "", sig: inds?.pmiServices?.value  != null ? (inds.pmiServices.value > 50 ? 1 : -1)  : 0 },
    { label: "PIB QoQ",        value: inds?.gdp?.value         != null ? `${inds.gdp.value > 0 ? "+" : ""}${inds.gdp.value.toFixed(2)}%`         : "", sig: (() => { const s = inds?.gdp?.surprise;         return s == null ? 0 : s > 0.3 ? 1 : s < -0.3 ? -1 : 0; })() },
    { label: "Retail Sales MoM", value: inds?.retailSales?.value  != null ? `${inds.retailSales.value > 0 ? "+" : ""}${inds.retailSales.value.toFixed(2)}%` : "", sig: (() => { const s = inds?.retailSales?.surprise;  return s == null ? 0 : s > 0.3 ? 1 : s < -0.3 ? -1 : 0; })() },
    { label: "Chômage",        value: inds?.unemployment?.value != null ? `${inds.unemployment.value.toFixed(2)}%` : "", sig: (() => { const s = inds?.unemployment?.surprise; return s == null ? 0 : s < -0.3 ? 1 : s > 0.3 ? -1 : 0; })() },
    { label: "Emploi",         value: inds?.employment?.value  != null ? `${inds.employment.value > 0 ? "+" : ""}${inds.employment.value.toFixed(1)}k` : "", sig: (() => { const s = inds?.employment?.surprise;  return s == null ? 0 : s > 10 ? 1 : s < -10 ? -1 : 0; })() },
  ].filter(c => c.value !== "");

  const goToSlide = useCallback((id: SliderBlock) => {
    const order: SliderBlock[] = ["news", "ois", "cot", "signal"];
    setSliderBlock(prev => {
      setSliderDir(order.indexOf(id) >= order.indexOf(prev) ? 1 : -1);
      return id;
    });
  }, []);

  const goToMacroSlide = useCallback((id: "mon"|"infl"|"cro"|"empl") => {
    const order = ["mon", "infl", "cro", "empl"] as const;
    setMacroSlide(prev => {
      setMacroSlideDir(order.indexOf(id) >= order.indexOf(prev) ? 1 : -1);
      return id;
    });
    onMacroSlideChange?.(id);
    onCardTabChange?.("overview");
  }, [onMacroSlideChange, onCardTabChange]);

  // Sync depuis une autre carte : calculer la direction par rapport à la valeur précédente
  useEffect(() => {
    if (syncMacroSlide === undefined) return;
    const order = ["mon", "infl", "cro", "empl"] as const;
    const prev = prevSyncMacroRef.current;
    if (syncMacroSlide !== prev) {
      setMacroSlideDir(order.indexOf(syncMacroSlide) >= order.indexOf(prev) ? 1 : -1);
      setMacroSlide(syncMacroSlide);
      prevSyncMacroRef.current = syncMacroSlide;
    }
  }, [syncMacroSlide]);

  // Sync tab principal depuis une autre carte
  useEffect(() => {
    if (syncCardTab === undefined) return;
    const prev = prevSyncCardTabRef.current;
    if (syncCardTab !== prev) {
      setActiveTab(syncCardTab);
      prevSyncCardTabRef.current = syncCardTab;
    }
  }, [syncCardTab]);

  // Sync sous-slide Signaux depuis une autre carte
  useEffect(() => {
    if (syncSignauxSlide === undefined) return;
    const order: SignauxSlide[] = ["ois", "cot", "sent"];
    const prev = prevSyncSignauxSlideRef.current;
    if (syncSignauxSlide !== prev) {
      setSignauxSlideDir(order.indexOf(syncSignauxSlide) >= order.indexOf(prev) ? 1 : -1);
      setSignauxSlide(syncSignauxSlide);
      prevSyncSignauxSlideRef.current = syncSignauxSlide;
    }
  }, [syncSignauxSlide]);

  const goToSignauxSlide = useCallback((id: SignauxSlide) => {
    const order: SignauxSlide[] = ["ois", "cot", "sent"];
    setSignauxSlide(prev => {
      setSignauxSlideDir(order.indexOf(id) >= order.indexOf(prev) ? 1 : -1);
      return id;
    });
    onSignauxSlideChange?.(id);
    onCardTabChange?.("mispricing");
  }, [onSignauxSlideChange, onCardTabChange]);

  // ── Recent published events for this currency (last 72h, non-low impact) ─────
  const recentEvents = useMemo(() => {
    if (!calEvents?.length) return [];
    const cutoff = Date.now() - 72 * 3600 * 1000;
    return calEvents
      .filter(e =>
        e.currency === currency &&
        e.isPublished &&
        e.actual !== null &&
        e.impact !== "low" &&
        new Date(e.date).getTime() >= cutoff
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3);
  }, [calEvents, currency]);

  // ── Upcoming events for this currency (next 3 days, not yet published) ────────
  const upcomingEvents = useMemo(() => {
    if (!calEvents?.length) return [];
    const now = Date.now();
    const horizon = now + 3 * 24 * 3600 * 1000;
    return calEvents
      .filter(e =>
        e.currency === currency &&
        !e.isPublished &&
        e.impact !== "low" &&
        new Date(e.date).getTime() >= now &&
        new Date(e.date).getTime() <= horizon
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [calEvents, currency]);

  // ── Categories with a real publication in the last 7 days for this currency
  // Uses the calendar event date (not lastUpdated scraping timestamp).
  const recentCalCategories = useMemo(() => {
    if (!calEvents?.length) return new Set<string>();
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const cats = new Set<string>();
    for (const e of calEvents) {
      if (
        e.currency === currency &&
        e.isPublished &&
        e.actual !== null && e.actual !== "" &&
        new Date(e.date).getTime() >= cutoff
      ) {
        cats.add(e.category);
      }
    }
    return cats;
  }, [calEvents, currency]);

  // Maps indicator key → EventCategory (matches calendar route types)
  const IND_CAT: Record<string, string> = {
    cpiYoY: "inflation", cpiCore: "inflation", cpiMoM: "inflation",
    cpiCoreMoM: "inflation", ppiMoM: "inflation",
    pmiMfg: "pmi", pmiServices: "pmi", pmiComposite: "pmi",
    unemployment: "employment", employment: "employment",
    gdp: "gdp",
    retailSales: "retail_sales",
    policyRate: "policy_rate",
  };
  const indIsNew = (key: string) => recentCalCategories.has(IND_CAT[key] ?? "__none__");

  // ── 5-dimension signal summary (header dots) ──────────────────────────────────
  const oisSignalDir: SignalDir = (() => {
    if (!ratePath?.peakMeeting) return "neutral";
    return ratePath.peakMeeting.probIsCut ? "bearish" : "bullish";
  })();
  const cotSignalDir  = (mispricingSignals.find(s => s.id === "cot")?.direction      ?? "neutral") as SignalDir;
  const sentSignalDir = (mispricingSignals.find(s => s.id === "sentiment")?.direction ?? "neutral") as SignalDir;
  const realRateDir: SignalDir = (() => {
    const cpiH = inds?.cpiYoY?.value ?? null;
    if (policyRateValue === null || cpiH === null) return "neutral";
    const rr = policyRateValue - cpiH;
    return rr < 0 ? "bearish" : rr > 1.5 ? "bullish" : "neutral";
  })();
  const signalSummary: { key: string; abbr: string; dir: SignalDir }[] = [
    { key: "ois",  abbr: "OIS",  dir: oisSignalDir },
    { key: "mac",  abbr: "Fonda.", dir },
    { key: "cot",  abbr: "COT",  dir: cotSignalDir },
    { key: "sent", abbr: "Sent", dir: sentSignalDir },
    { key: "real", abbr: "Tx.R", dir: realRateDir },
  ];

  // Auto-select first available slider block when data changes
  useEffect(() => {
    const available: SliderBlock[] = [];
    if (recentEvents.length > 0)                        available.push("news");
    if (ratePath && ratePath.meetings.length > 0)       available.push("ois");
    if (cot)                                            available.push("cot");
    if (divergenceSignal !== "neutral")                 available.push("signal");
    if (!available.length) return;
    setSliderBlock(prev => available.includes(prev) ? prev : available[0]);
  }, [recentEvents.length, ratePath, cot, divergenceSignal]);

  // ── macroSection filtering helpers ───────────────────────────────────────────
  const ms = macroSection ?? "all";
  const showInflation  = ms === "all" || ms === "inflation";
  const showPmi        = ms === "all" || ms === "pmi";
  const showEmployment = ms === "all" || ms === "employment";
  const showGdp        = ms === "all" || ms === "gdp" || ms === "pmi";

  // ── Tabs config ──────────────────────────────────────────────────────────────
  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview",   label: "Aperçu",   icon: <Layers size={10} /> },
    { id: "mispricing", label: "Signaux",  icon: <Eye size={10} /> },
    { id: "focus",      label: "Focus",    icon: <Target size={10} /> },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">

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
          {loading && <Loader2 size={16} className="animate-spin text-slate-600 mt-1" />}
        </div>

        {/* Phase pill + mispricing + ESI + cache */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${phaseStyle(phase)}`}>
            {phaseLabel(phase)}
          </span>
          {esi !== null && <SurpriseIndexBadge value={esi} />}
          {fromCache && cacheAge && (
            <span className="text-amber-500/60 cursor-help" title={`Données depuis le cache local (${cacheAge})`}>
              <Database size={9} />
            </span>
          )}
        </div>
        {/* 5-dimension signal summary */}
        {!loading && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-800">
            {signalSummary.map(s => (
              <div key={s.key} className="flex flex-col items-center gap-0.5" title={s.key === "real" ? `Taux Réel = Taux directeur − CPI YoY.\n> +1.5% → restrictif (bullish)\n< 0% → accommodant (bearish)` : `${s.abbr} : ${s.dir}`}>
                <div className={`w-2 h-2 rounded-full ${
                  s.dir === "bullish" ? "bg-emerald-500"
                  : s.dir === "bearish" ? "bg-red-500"
                  : s.dir === "warning" ? "bg-amber-500"
                  : "bg-slate-700"
                }`} />
                <span className="text-[7px] text-slate-600 leading-none">{s.abbr}</span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-1">
              {recentEvents.length > 0 && (
                <button
                  onClick={() => { setShowRecentNews(v => !v); setShowUpcoming(false); }}
                  className={`text-[8px] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border transition-all ${
                    showRecentNews
                      ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                      : "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20 animate-pulse"
                  }`}
                >
                  <span className="w-1 h-1 rounded-full bg-current" />
                  {recentEvents.length} publiée{recentEvents.length > 1 ? "s" : ""}
                </button>
              )}
              {upcomingEvents.length > 0 && (
                <button
                  onClick={() => { setShowUpcoming(v => !v); setShowRecentNews(false); }}
                  className={`text-[8px] font-semibold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border transition-all ${
                    showUpcoming
                      ? "bg-sky-500/20 border-sky-500/40 text-sky-300"
                      : "bg-sky-500/10 border-sky-500/20 text-sky-400 hover:bg-sky-500/20"
                  }`}
                >
                  <span className="w-1 h-1 rounded-full bg-current" />
                  {upcomingEvents.length} à venir
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── News flash panel ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showRecentNews && recentEvents.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="overflow-hidden"
          >
            <div className="bg-gradient-to-b from-amber-500/10 to-amber-500/5 border-b border-amber-500/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span className="text-[9px] font-bold text-amber-400/80 uppercase tracking-widest">Données publiées récemment</span>
                <button onClick={() => setShowRecentNews(false)} className="ml-auto text-amber-500/40 hover:text-amber-400 transition-colors text-[11px] leading-none">✕</button>
              </div>
              <div className="space-y-1">
                {recentEvents.map(e => {
                  const aNum = e.actual   ? parseFloat(e.actual)   : null;
                  const fNum = e.forecast ? parseFloat(e.forecast) : null;
                  const surp = aNum !== null && fNum !== null && !isNaN(aNum) && !isNaN(fNum) ? aNum - fNum : null;
                  const isBeat = surp !== null && surp > 0;
                  const isMiss = surp !== null && surp < 0;
                  return (
                    <div key={e.id} className="flex items-center gap-2">
                      <span className={`w-1 h-1 rounded-full shrink-0 ${e.impact === "high" ? "bg-red-500" : "bg-amber-500"}`} />
                      <span className="text-[10px] text-slate-300 flex-1 truncate">{e.title}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        {e.actual   && <span className={`text-[10px] font-bold tabular-nums ${isBeat ? "text-emerald-400" : isMiss ? "text-red-400" : "text-slate-300"}`}>A: {e.actual}</span>}
                        {e.forecast && <span className="text-[9px] text-slate-600">F: {e.forecast}</span>}
                        {isBeat && <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/15 px-1 rounded">↑</span>}
                        {isMiss && <span className="text-[8px] font-black text-red-400 bg-red-500/15 px-1 rounded">↓</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Upcoming events panel ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showUpcoming && upcomingEvents.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="overflow-hidden"
          >
            <div className="bg-gradient-to-b from-sky-500/10 to-sky-500/5 border-b border-sky-500/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                <span className="text-[9px] font-bold text-sky-400/80 uppercase tracking-widest">À venir — 3 prochains jours</span>
                <button onClick={() => setShowUpcoming(false)} className="ml-auto text-sky-500/40 hover:text-sky-400 transition-colors text-[11px] leading-none">✕</button>
              </div>
              <div className="space-y-1.5">
                {upcomingEvents.map(e => {
                  const fNum = e.forecast ? parseFloat(e.forecast) : null;
                  const pNum = e.previous ? parseFloat(e.previous) : null;
                  const diff = fNum !== null && pNum !== null && !isNaN(fNum) && !isNaN(pNum) ? fNum - pNum : null;
                  const isUp   = diff !== null && diff > 0;
                  const isDown = diff !== null && diff < 0;
                  const eventDate = new Date(e.date);
                  const dayLabel = eventDate.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
                  const timeLabel = eventDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={e.id} className="flex items-start gap-2">
                      <span className={`w-1 h-1 rounded-full shrink-0 mt-[5px] ${e.impact === "high" ? "bg-red-500" : "bg-amber-500"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[10px] text-slate-300 truncate">{e.title}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[9px] text-slate-500">{dayLabel} {timeLabel}</span>
                          {e.forecast && (
                            <span className="text-[9px] text-sky-400 font-semibold">
                              F: {e.forecast}
                            </span>
                          )}
                          {e.previous && (
                            <span className="text-[9px] text-slate-500">
                              Préc: {e.previous}
                            </span>
                          )}
                          {diff !== null && (
                            <span className={`text-[8px] font-black px-1 rounded ${
                              isUp   ? "text-emerald-400 bg-emerald-500/15"
                              : isDown ? "text-red-400 bg-red-500/15"
                              : "text-slate-400 bg-slate-700"
                            }`}>
                              {isUp ? "↑" : isDown ? "↓" : "="}{" "}
                              {diff > 0 ? "+" : ""}{diff.toFixed(2).replace(/\.?0+$/, "")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-slate-800 px-1 pt-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setActiveTab(t.id); onCardTabChange?.(t.id); }}
            className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-t-lg transition-all ${
              activeTab === t.id
                ? "text-white bg-slate-800"
                : "text-slate-400 hover:text-white"
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
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

                {/* ── Convergence / Divergence macro ↔ marché ─────────────── */}
                <div className={`rounded-lg border px-2.5 py-1.5 flex items-center gap-1.5 text-[10px] ${
                  bothOpposed ? "bg-amber-500/8 border-amber-500/25"
                  : bothAligned ? sigBg(divergenceSignal)
                  : "bg-slate-800/40 border-slate-700/30"
                }`}>
                  <span className="text-slate-500 shrink-0 text-[9px] uppercase tracking-wider">Fond.</span>
                  <span className={`font-black text-[13px] leading-none ${sigColor(dir)}`}>{dir === "bullish" ? "↑" : dir === "bearish" ? "↓" : "—"}</span>
                  <span className={`font-bold flex-1 text-center ${bothOpposed ? "text-amber-400" : sigColor(divergenceSignal)}`}>
                    {bothOpposed ? "⚠ Divergence" : bothAligned ? (divergenceSignal === "bullish" ? "✓ Convergence ↑" : "✓ Convergence ↓") : dir !== "neutral" ? "Macro seule" : mispricDir !== "neutral" ? "Signaux seuls" : "Neutre"}
                  </span>
                  <span className={`font-black text-[13px] leading-none ${sigColor(mispricDir)}`}>{mispricDir === "bullish" ? "↑" : mispricDir === "bearish" ? "↓" : "—"}</span>
                  <span className="text-slate-500 shrink-0 text-[9px] uppercase tracking-wider">Marché</span>
                </div>

                {/* ── Slider macro : Mon. / Infl. / Cro. / Empl. ───────────── */}
                {(() => {
                  const macroTabs: { id: "mon"|"infl"|"cro"|"empl"; label: string }[] = [
                    { id: "mon",   label: "Mon." },
                    { id: "infl",  label: "Infl." },
                    { id: "cro",   label: "Cro." },
                    { id: "empl",  label: "Empl." },
                  ];
                  return (
                    <div className="space-y-1.5">
                      {/* Micro-buttons */}
                      <div className="flex gap-1">
                        {macroTabs.map(t => (
                          <button
                            key={t.id}
                            onClick={() => goToMacroSlide(t.id)}
                            className={`text-[9px] font-semibold px-2.5 py-0.5 rounded-full border transition-all ${
                              macroSlide === t.id
                                ? "bg-slate-700 border-slate-500 text-white"
                                : "bg-transparent border-slate-700/60 text-slate-400 hover:text-white hover:border-slate-500"
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      {/* Fixed-height sliding container */}
                      <div className="relative h-[260px] overflow-hidden rounded-xl">
                        <AnimatePresence mode="wait" custom={macroSlideDir}>
                          <motion.div
                            key={macroSlide}
                            custom={macroSlideDir}
                            variants={{
                              enter:  (d: number) => ({ x: d > 0 ? "100%" : "-100%", opacity: 0 }),
                              center: { x: "0%", opacity: 1 },
                              exit:   (d: number) => ({ x: d > 0 ? "-100%" : "100%", opacity: 0 }),
                            }}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ type: "tween", duration: 0.22, ease: "easeInOut" }}
                            className="absolute inset-0 overflow-hidden"
                          >

                            {/* MON. — Politique Monétaire */}
                            {macroSlide === "mon" && (
                              <MacroBlock title="Politique Monétaire">
                                <IRow label="Taux directeur" ind={inds?.policyRate ?? null} unit="%" consensus={rateConsensus} isNew={indIsNew("policyRate")} />
                                {(() => {
                                  const cpiH = inds?.cpiYoY?.value ?? null;
                                  if (policyRateValue === null || cpiH === null) return null;
                                  const rr = parseFloat((policyRateValue - cpiH).toFixed(2));
                                  const rDir: SignalDir = rr < 0 ? "bearish" : rr > 1.5 ? "bullish" : "neutral";
                                  return (
                                    <div className="flex items-center justify-between text-[12px]">
                                      <div className="flex items-center gap-1.5"><span className="text-slate-600">→</span><span className="text-slate-400">Taux réel (CT−CPI)</span></div>
                                      <span className={`font-semibold tabular-nums ${sigColor(rDir)}`} title={`${policyRateValue.toFixed(2)}% − CPI YoY ${cpiH.toFixed(2)}%`}>{rr > 0 ? "+" : ""}{rr}%</span>
                                    </div>
                                  );
                                })()}
                                {curveSpread !== null && (
                                  <div className="flex items-center justify-between text-[12px]">
                                    <div className="flex items-center gap-1.5"><span className="text-slate-600">→</span><span className="text-slate-400">Courbe (10Y−CT)</span></div>
                                    <span className={`font-semibold tabular-nums ${sigColor(curveSig)}`}>{curveSpread > 0 ? "+" : ""}{curveSpread}bps{curveInverted ? " ⚠" : ""}</span>
                                  </div>
                                )}
                                {yield10Y !== null && (
                                  <div className="flex items-center justify-between text-[12px]">
                                    <div className="flex items-center gap-1.5"><span className="text-slate-600">→</span><span className="text-slate-400">10Y Yield</span></div>
                                    <span className="font-semibold text-slate-200 tabular-nums">{yield10Y.toFixed(2)}%</span>
                                  </div>
                                )}
                              </MacroBlock>
                            )}

                            {/* INFL. — Inflation */}
                            {macroSlide === "infl" && (
                              <MacroBlock title="Inflation">
                                <IRow label="CPI MoM"  ind={inds?.cpiMoM  ?? null} unit="%" consensus={fc?.cpiMoM ?? null} isNew={indIsNew("cpiMoM")} />
                                <IRow label="PPI MoM"  ind={inds?.ppiMoM  ?? null} unit="%" consensus={fc?.ppiMoM ?? null} isNew={indIsNew("ppiMoM")} />
                                <IRow label="Core CPI YoY" ind={inds?.cpiCore ?? null} unit="%" consensus={fc?.cpiCore ?? fc?.cpi ?? null} surpriseVsCons={fc?.cpiSurprise ?? null} isNew={indIsNew("cpiCore")} />
                                <IRow label="Inflation Rate YoY" ind={inds?.cpiYoY ?? null} unit="%" consensus={fc?.cpi ?? null} isNew={indIsNew("cpiYoY")} />
                              </MacroBlock>
                            )}

                            {/* CRO. — Croissance */}
                            {macroSlide === "cro" && (
                              <MacroBlock title="Croissance">
                                <IRow label="PIB (QoQ%)"       ind={inds?.gdp          ?? null} unit="%" consensus={fc?.gdp ?? null} surpriseVsCons={fc?.gdpSurprise ?? null} isNew={indIsNew("gdp")} />
                                <IRow label="PMI Composite"    ind={inds?.pmiComposite ?? null} consensus={fc?.pmiComposite ?? null} surpriseVsCons={fc?.pmiCompositeSurprise ?? null} isNew={indIsNew("pmiComposite")} />
                                <IRow label="Retail Sales MoM" ind={inds?.retailSales  ?? null} unit="%" consensus={fc?.retailSales ?? null} surpriseVsCons={fc?.retailSalesSurprise ?? null} isNew={indIsNew("retailSales")} />
                                <IRow label="PMI Manufacturing" ind={inds?.pmiMfg      ?? null} consensus={fc?.pmiMfg ?? null} surpriseVsCons={fc?.pmiMfgSurprise ?? null} isNew={indIsNew("pmiMfg")} />
                                <IRow label="PMI Services"      ind={inds?.pmiServices ?? null} consensus={fc?.pmiSvc ?? null} surpriseVsCons={fc?.pmiSvcSurprise ?? null} isNew={indIsNew("pmiServices")} />
                              </MacroBlock>
                            )}

                            {/* EMPL. — Emploi */}
                            {macroSlide === "empl" && (
                              <MacroBlock title="Emploi">
                                <IRow label="Variation emploi" ind={inds?.employment  ?? null} unit="k" consensus={fc?.employment ?? null} surpriseVsCons={fc?.employmentSurprise ?? null} isNew={indIsNew("employment")} />
                                <IRow label="Taux de chômage"  ind={inds?.unemployment ?? null} unit="%" invertSurprise consensus={fc?.unemployment ?? null} surpriseVsCons={fc?.unemploymentSurprise ?? null} isNew={indIsNew("unemployment")} />
                              </MacroBlock>
                            )}

                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* ════ SIGNAUX / MISPRICING ════════════════════════════════════ */}
            {activeTab === "mispricing" && (
              <>
                {/* ── Slider : OIS / COT / Sentiment ──────────────────────── */}
                {(() => {
                  const sigTabs: { id: SignauxSlide; label: string }[] = [];
                  if (ratePath && ratePath.meetings.length > 0) sigTabs.push({ id: "ois",  label: "OIS" });
                  if (cot)       sigTabs.push({ id: "cot",  label: "COT" });
                  if (sentiment) sigTabs.push({ id: "sent", label: "Sentiment" });
                  if (!sigTabs.length) return <div className="text-center text-slate-600 text-[11px] py-4">Données insuffisantes</div>;
                  return (
                    <div className="space-y-1.5">
                      {sigTabs.length > 1 && (
                        <div className="flex gap-1">
                          {sigTabs.map(t => (
                            <button key={t.id} onClick={() => goToSignauxSlide(t.id)} className={`text-[9px] font-semibold px-2.5 py-0.5 rounded-full border transition-all ${signauxSlide === t.id ? "bg-slate-700 border-slate-500 text-white" : "bg-transparent border-slate-700/60 text-slate-400 hover:text-white hover:border-slate-500"}`}>{t.label}</button>
                          ))}
                        </div>
                      )}
                      <div className={`relative ${signauxSlide === "ois" && ratePath && ratePath.meetings.length > 0 ? "h-[460px]" : "h-[310px]"} overflow-hidden rounded-xl transition-all duration-300`}>
                        <AnimatePresence mode="wait" custom={signauxSlideDir}>
                          <motion.div
                            key={signauxSlide}
                            custom={signauxSlideDir}
                            variants={{
                              enter:  (d: number) => ({ x: d > 0 ? "100%" : "-100%", opacity: 0 }),
                              center: { x: "0%", opacity: 1 },
                              exit:   (d: number) => ({ x: d > 0 ? "-100%" : "100%", opacity: 0 }),
                            }}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ type: "tween", duration: 0.22, ease: "easeInOut" }}
                            className="absolute inset-0 overflow-hidden"
                          >

                            {/* OIS — nouveau bloc enrichi */}
                            {signauxSlide === "ois" && ratePath && ratePath.meetings.length > 0 && (
                              <OISEnhancedBlock ratePath={ratePath} />
                            )}

                            {/* COT */}
                            {signauxSlide === "cot" && cot && (() => {
                  const hfIsShort       = cot.net < 0;
                  const amDominates     = Math.abs(cot.amNet) > Math.abs(cot.net);
                  const hfLongsGrowing  = cot.longsDelta  !== null && cot.longsDelta  > 0;
                  const hfShortsReducing= cot.shortsDelta !== null && cot.shortsDelta < 0;
                  const hfShortsGrowing = cot.shortsDelta !== null && cot.shortsDelta > 0;
                  const hfLongsReducing = cot.longsDelta  !== null && cot.longsDelta  < 0;

                  let hfTrend = "";
                  if (hfIsShort) {
                    if (hfLongsGrowing && hfShortsReducing) hfTrend = "retournement en cours (L↑ S↓)";
                    else if (hfLongsGrowing)    hfTrend = "accumulation de longs (L↑)";
                    else if (hfShortsReducing)  hfTrend = "couverture de shorts (S↓)";
                    else hfTrend = "exposition baissière stable";
                  } else {
                    if (hfShortsGrowing && hfLongsReducing) hfTrend = "retournement baissier (S↑ L↓)";
                    else if (hfShortsGrowing) hfTrend = "ajout de shorts (S↑)";
                    else if (hfLongsReducing) hfTrend = "réduction de longs (L↓)";
                    else hfTrend = "exposition haussière stable";
                  }

                  // Poids relatif AM vs HF (barre de dominance)
                  const totalAbs = Math.abs(cot.amNet) + Math.abs(cot.net);
                  const amPct    = totalAbs > 0 ? Math.round(Math.abs(cot.amNet) / totalAbs * 100) : 50;
                  const hfPct    = 100 - amPct;
                  const dFmt     = (v: number) => `${v > 0 ? "+" : ""}${(v / 1000).toFixed(1)}k`;

                  return (
                    <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-3 space-y-2">
                      {/* ① Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[9px] text-slate-300 uppercase tracking-widest">
                          <BarChart2 size={9} />
                          COT CFTC · {cot.weekDate}
                          <button
                            onClick={() => setShowCotInfo(v => !v)}
                            className="ml-0.5 text-slate-500 hover:text-slate-300 transition-colors"
                            title="Comprendre ces données"
                          >
                            <Info size={10} />
                          </button>
                        </div>
                        <span className="text-[9px] text-slate-400">{cot.prevWeekDate ? `vs ${cot.prevWeekDate}` : ""}</span>
                      </div>

                      {/* ⓘ Tooltip explicatif */}
                      {showCotInfo && (
                        <div className="bg-slate-900 border border-slate-700/60 rounded-lg px-2.5 py-2 text-[9px] text-slate-400 space-y-1 leading-relaxed">
                          <p><span className="text-indigo-400 font-bold">AM (Asset Managers)</span> — fonds pension, souverains, assurances. Prennent des positions pour <em>couvrir</em> des expositions réelles (hedging). Leur flux pilote la devise à moyen terme.</p>
                          <p><span className="text-amber-400 font-bold">HF (Hedge Funds / CTAs)</span> — spéculation directionnelle à court terme. Réactifs aux catalyseurs macro. Retournements rapides possibles.</p>
                          <p className="pt-0.5 border-t border-slate-700/40"><span className="text-slate-300 font-semibold">Lire :</span> Net = longs − shorts · <span className="text-emerald-400">Δ sem</span> = variation vs semaine précédente · <span className="text-slate-300">L%</span> = part de longs dans le total. Un HF net short avec des longs qui augmentent (Δ L↑) signale un potentiel retournement haussier.</p>
                        </div>
                      )}

                      {/* ② Signal de synthèse — lecture immédiate en premier */}
                      {(() => {
                        const hfSignalColor =
                          (hfLongsGrowing && hfIsShort) || (hfShortsReducing && hfIsShort)
                            ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
                            : (hfShortsGrowing && !hfIsShort) || (hfLongsReducing && !hfIsShort)
                            ? "text-red-400 border-red-500/20 bg-red-500/5"
                            : "text-slate-300 border-slate-600/30 bg-slate-800/30";
                        return (
                          <div className={`rounded-lg border px-3 py-2 ${hfSignalColor}`}>
                            <div className="text-[11px] font-bold leading-snug">
                              → HF {hfIsShort ? "net short" : "net long"} — {hfTrend}
                            </div>
                            <div className="text-[9px] mt-0.5 opacity-70">
                              {amDominates
                                ? `AM domine le flux · ${cot.amNet > 0 ? "hedge haussier" : "hedge baissier"} (${dFmt(cot.amNet)})`
                                : `HF domine le flux · net ${dFmt(cot.net)}`
                              }
                            </div>
                          </div>
                        );
                      })()}

                      {/* ③ Flux hebdomadaire HF — ΔL/ΔS en priorité */}
                      <div className="bg-slate-900/40 rounded-lg px-3 py-2 space-y-1.5">
                        <div className="text-[8px] text-slate-300 uppercase tracking-wider text-center">Mouvement HF · semaine</div>
                        <div className="flex justify-center items-stretch gap-8">
                          <div className="space-y-0.5 text-center">
                            <div className="text-[8px] text-slate-400">Δ Longs</div>
                            <div className={`text-[13px] font-black tabular-nums leading-none ${
                              cot.longsDelta === null ? "text-slate-600"
                              : cot.longsDelta > 0 ? "text-emerald-400" : "text-red-400"
                            }`}>
                              {cot.longsDelta !== null
                                ? `${cot.longsDelta > 0 ? "+" : ""}${(cot.longsDelta/1000).toFixed(1)}k${cot.longsDelta > 0 ? "↑" : "↓"}`
                                : "—"
                              }
                            </div>
                            <div className="text-[9px] text-slate-400">{(cot.hfLongs/1000).toFixed(1)}k acc.</div>
                          </div>
                          <div className="w-px bg-slate-700/50" />
                          <div className="space-y-0.5 text-center">
                            <div className="text-[8px] text-slate-400">Δ Shorts</div>
                            <div className={`text-[13px] font-black tabular-nums leading-none ${
                              cot.shortsDelta === null ? "text-slate-600"
                              : cot.shortsDelta > 0 ? "text-red-400" : "text-emerald-400"
                            }`}>
                              {cot.shortsDelta !== null
                                ? `${cot.shortsDelta > 0 ? "+" : ""}${(cot.shortsDelta/1000).toFixed(1)}k${cot.shortsDelta > 0 ? "↑" : "↓"}`
                                : "—"
                              }
                            </div>
                            <div className="text-[9px] text-slate-400">{(cot.hfShorts/1000).toFixed(1)}k acc.</div>
                          </div>
                        </div>
                      </div>

                      {/* ④ Dominance AM vs HF — poids + direction explicite */}
                      <div className="space-y-1.5">
                        {/* Barre de poids */}
                        <div className="flex rounded-full overflow-hidden h-1.5">
                          <div className="bg-indigo-500/70 transition-all" style={{ width: `${amPct}%` }} />
                          <div className="bg-amber-500/60 transition-all" style={{ width: `${hfPct}%` }} />
                        </div>
                        {/* AM */}
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-indigo-400 font-semibold">AM · {amPct}% du flux</span>
                          <span className="flex items-center gap-1.5">
                            <span className={`font-bold px-1 rounded text-[8px] ${cot.amNet > 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                              {cot.amNet > 0 ? "LONG" : "SHORT"}
                            </span>
                            <span className={`tabular-nums ${cot.amNet > 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {dFmt(cot.amNet)}
                            </span>
                            {cot.amNetDelta !== null && (
                              <span className="text-slate-400">Δ{dFmt(cot.amNetDelta)}{cot.amNetDelta > 0 ? "↑" : "↓"}</span>
                            )}
                          </span>
                        </div>
                        {/* HF */}
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-amber-400 font-semibold">HF · {hfPct}% du flux</span>
                          <span className="flex items-center gap-1.5">
                            <span className={`font-bold px-1 rounded text-[8px] ${cot.net > 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                              {cot.net > 0 ? "LONG" : "SHORT"}
                            </span>
                            <span className={`tabular-nums ${cot.net > 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {dFmt(cot.net)}
                            </span>
                            {cot.netDelta !== null && (
                              <span className="text-slate-400">Δ{dFmt(cot.netDelta)}{cot.netDelta > 0 ? "↑" : "↓"}</span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                            {/* Sentiment */}
                            {signauxSlide === "sent" && sentiment && (() => {
                              const sentDir = sentiment.longPct < 30 ? "bullish" : sentiment.longPct > 70 ? "bearish" : "neutral";
                              const sentCls = sentDir === "bullish" ? "text-emerald-400" : sentDir === "bearish" ? "text-red-400" : "text-slate-400";
                              const sentBg  = sentDir === "bullish" ? "border-emerald-500/20 bg-emerald-500/5" : sentDir === "bearish" ? "border-red-500/20 bg-red-500/5" : "border-slate-700/40 bg-slate-800/20";
                              return (
                                <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-3 h-full space-y-3">
                                  <div className="flex items-center gap-1.5 text-[9px] text-slate-300 uppercase tracking-widest">
                                    <Activity size={9} />
                                    Sentiment Retail (DXM)
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <div className="text-center shrink-0">
                                      <div className="text-[9px] text-slate-400 mb-0.5">Long</div>
                                      <div className="text-[26px] font-black tabular-nums text-emerald-400 leading-none">{sentiment.longPct.toFixed(0)}%</div>
                                    </div>
                                    <div className="flex-1 space-y-1">
                                      <div className="flex rounded-full overflow-hidden h-2.5">
                                        <div className="bg-emerald-500/70 transition-all" style={{ width: `${sentiment.longPct}%` }} />
                                        <div className="bg-red-500/60 transition-all" style={{ width: `${sentiment.shortPct}%` }} />
                                      </div>
                                      <div className="flex justify-between text-[8px] text-slate-400"><span>Long</span><span>Short</span></div>
                                    </div>
                                    <div className="text-center shrink-0">
                                      <div className="text-[9px] text-slate-400 mb-0.5">Short</div>
                                      <div className="text-[26px] font-black tabular-nums text-red-400 leading-none">{sentiment.shortPct.toFixed(0)}%</div>
                                    </div>
                                  </div>
                                  <div className={`rounded-lg border px-3 py-2 ${sentBg}`}>
                                    <div className={`text-[11px] font-bold ${sentCls}`}>
                                      {sentDir === "bullish"
                                        ? `Signal contrarian HAUSSIER — majorité short (${sentiment.shortPct.toFixed(0)}%)`
                                        : sentDir === "bearish"
                                        ? `Signal contrarian BAISSIER — majorité long (${sentiment.longPct.toFixed(0)}%)`
                                        : "Sentiment équilibré — pas de signal contrarian"}
                                    </div>
                                    <div className="text-[9px] text-slate-500 mt-0.5">
                                      {sentDir === "bullish" ? "Retail survendu → opportunité d'achat"
                                        : sentDir === "bearish" ? "Retail suracheté → opportunité de vente"
                                        : "Attendre un déséquilibre >70/30"}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* ════ FOCUS DONNÉES ══════════════════════════════════════════════ */}
            {activeTab === "focus" && (
              <>
                {/* Context phase — source : OIS / probabilités de taux (fallback : trend FRED) */}
                <div className={`rounded-xl border p-3 text-[11px] ${sigBg(trendDir(phase === "tightening" ? "up" : phase === "easing" ? "down" : null))}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold ${sigColor(trendDir(phase === "tightening" ? "up" : phase === "easing" ? "down" : null))}`}>
                      Phase {phaseLabel(phase)}
                    </span>
                    <span className="text-[9px] text-slate-600 italic">
                      {ratePath ? "Source : OIS / probabilités" : "Source : trend taux FRED"}
                    </span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    {phaseDescription(phase, ratePath)}
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
                        <FocusRow importance="medium"><IRow label="Retail Sales MoM" ind={inds?.retailSales ?? null} unit="%" consensus={fc?.retailSales ?? null} /></FocusRow>
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
