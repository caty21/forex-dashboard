"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Loader2, Database } from "lucide-react";
import { CURRENCY_META, COUNTRY_PROFILES } from "@/lib/constants";
import { biasLabel, biasColor, calcMacroScore } from "@/lib/scoring";
import { saveCache, loadCache, formatCacheDate } from "@/lib/localCache";
import type { Currency, BiasPhase, RateExpectation } from "@/lib/types";
import type { CBRatePath } from "@/lib/rateprobability";
import type { SentimentEntry, CotEntry } from "@/lib/types";
import NarrativeButton from "./NarrativeButton";

interface Ind { value: number | null; prev: number | null; surprise: number | null; trend: "up"|"down"|"flat"|null; lastUpdated: string | null }
interface MacroForecasts {
  cpi: number | null; cpiSurprise: number | null;
  cpiCore:    number | null;
  cpiMoM:     number | null;
  cpiCoreMoM: number | null;
  ppiMoM:     number | null;
  unemployment: number | null; unemploymentSurprise: number | null;
  pmiMfg: number | null; pmiMfgSurprise: number | null;
  pmiSvc: number | null; pmiSvcSurprise: number | null;
  pmiComposite: number | null; pmiCompositeSurprise: number | null;
  retailSales: number | null; retailSalesSurprise: number | null;
  gdp: number | null; gdpSurprise: number | null;
  employment: number | null; employmentSurprise: number | null;
}
interface MacroData { currency: string; indicators: Record<string, Ind | null>; forecasts?: MacroForecasts | null; fetchedAt: string }

interface Props {
  currency: Currency;
  expectations: Record<string, unknown> | null;
  yields: { yields: Record<string, number | null>; spreads: Record<string, number | null> } | null;
  sentiment: SentimentEntry | null;
  cot: CotEntry | null;
  ratePath: CBRatePath | null;
  onDivergenceUpdate: (currency: Currency, score: number) => void;
}

const PHASES: Record<BiasPhase, { label: string; color: string }> = {
  tightening:    { label: "🔴 Resserrement",  color: "text-red-600"    },
  hawkish_pause: { label: "🟡 Pause Hawkish", color: "text-amber-600"  },
  easing:        { label: "🟢 Assouplissement", color: "text-green-600" },
  dovish_pause:  { label: "🔵 Pause Dovish",  color: "text-blue-600"   },
  transition:    { label: "🟠 Transition",     color: "text-orange-500" },
};

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 pt-1.5 pb-0.5">
      <span className="text-[8px] font-bold text-gray-300 uppercase tracking-widest whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  );
}

function TrendIcon({ trend }: { trend: "up"|"down"|"flat"|null }) {
  if (trend === "up")   return <TrendingUp  size={11} className="text-green-500 flex-shrink-0" />;
  if (trend === "down") return <TrendingDown size={11} className="text-red-500   flex-shrink-0" />;
  return <Minus size={11} className="text-gray-300 flex-shrink-0" />;
}

function Row({ label, ind, unit = "", invertSurprise = false, warn = false, consensus = null, surpriseVsCons = null, tooltip = null, info = null }: {
  label: string; ind: Ind | null; unit?: string; invertSurprise?: boolean; warn?: boolean;
  consensus?: number | null;
  surpriseVsCons?: number | null;
  tooltip?: string | null;
  info?: string | null;       // petit "i" avec tooltip sur le label
}) {
  const value = ind?.value ?? null;
  const prev  = ind?.prev  ?? null;

  // Colorer la valeur actuelle selon la direction du mouvement vs période précédente
  const s = ind?.surprise ?? null;
  const effectiveS = invertSurprise && s !== null ? -s : s;
  const valCls =
    effectiveS === null ? "text-gray-800"
    : effectiveS > 0   ? "text-green-700"
    : effectiveS < 0   ? "text-red-700"
    :                    "text-gray-500";

  const fmt = (v: number | null) =>
    v !== null ? `${v.toFixed(2)}${unit}` : "—";

  // Coloration de la surprise vs consensus (inversion pour chômage/unemployment)
  const effSurprise = invertSurprise && surpriseVsCons !== null ? -surpriseVsCons : surpriseVsCons;
  const surpriseCls = effSurprise === null ? ""
    : effSurprise > 0 ? "text-green-600"
    : effSurprise < 0 ? "text-red-600"
    : "text-gray-500";
  const surpriseArrow = effSurprise === null ? "" : effSurprise > 0 ? "▲" : effSurprise < 0 ? "▼" : "▬";

  return (
    <div className="py-1.5 border-b border-gray-50 last:border-0">
      {/* Ligne 1 : label + valeur actuelle publiée */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <TrendIcon trend={ind?.trend ?? null} />
          {/* label dans son propre span truncate — sans enfants positionnés absolument */}
          <span className="text-xs text-gray-500 truncate">
            {label}
            {warn && <span className="text-amber-400 ml-0.5">⚠</span>}
          </span>
          {/* info badge EN DEHORS du truncate pour éviter le clip overflow:hidden */}
          {info && (
            <span className="relative group/info inline-flex shrink-0 cursor-help">
              <span className="inline-flex items-center justify-center w-3 h-3 rounded-full border border-blue-300 text-blue-400 text-[7px] font-bold leading-none">i</span>
              <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 w-52 px-2 py-1.5 rounded-md bg-gray-900 text-white text-[10px] leading-snug opacity-0 group-hover/info:opacity-100 transition-opacity duration-150 z-50 shadow-lg whitespace-normal text-left">
                {info}
              </span>
            </span>
          )}
        </div>
        {tooltip ? (
          <span className="relative group/val cursor-default shrink-0">
            <span className={`text-xs font-semibold tabular-nums ${valCls}`}>{fmt(value)}</span>
            <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-52 px-2 py-1.5 rounded-md bg-gray-900 text-white text-[10px] leading-snug opacity-0 group-hover/val:opacity-100 transition-opacity duration-150 z-50 shadow-lg whitespace-normal text-left">
              {tooltip}
            </span>
          </span>
        ) : (
          <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ${valCls}`}>{fmt(value)}</span>
        )}
      </div>
      {/* Ligne 2 : précédent + consensus à venir OU surprise post-publication */}
      <div className="flex items-center justify-between pl-5 mt-0.5">
        <span className="text-[10px] text-gray-400 tabular-nums">
          Préc.&nbsp;<span className="text-gray-500 font-medium">{fmt(prev)}</span>
        </span>
        {surpriseVsCons !== null ? (
          // Surprise vs consensus (≤5 jours post-release)
          <span className="text-[10px] tabular-nums">
            <span className="text-gray-400">Surpr.&nbsp;</span>
            <span className={`font-medium ${surpriseCls}`}>
              {surpriseArrow}{surpriseVsCons > 0 ? "+" : ""}{surpriseVsCons.toFixed(2)}{unit}
            </span>
          </span>
        ) : (
          // Consensus à venir (upcoming)
          <span className="text-[10px] text-gray-400 tabular-nums">
            Cons.&nbsp;
            {consensus !== null
              ? <span className="text-blue-500 font-medium">{fmt(consensus)}</span>
              : <span className="text-gray-300">—</span>}
          </span>
        )}
      </div>
    </div>
  );
}

export default function CurrencyCard({ currency, expectations, yields, sentiment, cot, ratePath, onDivergenceUpdate }: Props) {
  const meta   = CURRENCY_META[currency];
  const [data, setData]         = useState<MacroData | null>(null);
  const [phase, setPhase]       = useState<BiasPhase>("hawkish_pause");
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [rateExp, setRateExp]   = useState<RateExpectation | null>(null);
  const [fromCache, setFromCache]   = useState(false);
  const [cacheAge, setCacheAge]     = useState<string | null>(null);
  const [inflFilter, setInflFilter] = useState<"all" | "mom" | "yoy">("mom");

  // Single fetch — server batches all FRED calls
  const load = useCallback(async () => {
    setLoading(true);
    const cacheKey = `macro_${currency}`;
    try {
      const res = await fetch(`/api/macro?currency=${currency}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MacroData = await res.json();
      if ("error" in json) throw new Error(String((json as Record<string,unknown>).error));

      // PMI est scraped mensuellement → si le serveur renvoie null cette semaine
      // (PMI pas encore publié), on conserve la valeur précédente du cache local.
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

      // Infer phase from policy rate trend
      const rateInd = merged.indicators.policyRate;
      if (rateInd?.trend === "up")        setPhase("tightening");
      else if (rateInd?.trend === "down") setPhase("easing");
      else                                setPhase("hawkish_pause");
    } catch {
      // API indisponible → on utilise le cache localStorage si disponible
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

  // Match rate expectation for this currency
  useEffect(() => {
    if (!expectations) return;
    const all = [
      ...((expectations.rate_hikes ?? []) as RateExpectation[]),
      ...((expectations.rate_cuts  ?? []) as RateExpectation[]),
    ];
    const cbShort = meta.cbShort.toLowerCase();
    setRateExp(all.find((e) => e.cb.toLowerCase().includes(cbShort) || e.cb.toLowerCase().includes(currency.toLowerCase())) ?? null);
  }, [expectations, currency, meta.cbShort]);

  const inds         = data?.indicators;
  const fc           = data?.forecasts ?? null;  // ForexFactory forecasts

  // Build a minimal indicator object for scoring
  const forScoring = {
    policyRate:   { value: inds?.policyRate?.value ?? null,   prev: inds?.policyRate?.prev ?? null,   consensus: null, surprise: inds?.policyRate?.surprise ?? null,   trend: inds?.policyRate?.trend ?? null,   lastUpdated: "" },
    cpiCore:      { value: inds?.cpiCore?.value ?? null,      prev: inds?.cpiCore?.prev ?? null,      consensus: null, surprise: inds?.cpiCore?.surprise ?? null,      trend: inds?.cpiCore?.trend ?? null,      lastUpdated: "" },
    pmiMfg:       { value: inds?.pmiMfg?.value      ?? null, prev: inds?.pmiMfg?.prev      ?? null, consensus: null, surprise: inds?.pmiMfg?.surprise      ?? null, trend: inds?.pmiMfg?.trend      ?? null, lastUpdated: "" },
    pmiServices:  { value: inds?.pmiServices?.value ?? null, prev: inds?.pmiServices?.prev ?? null, consensus: null, surprise: inds?.pmiServices?.surprise ?? null, trend: inds?.pmiServices?.trend ?? null, lastUpdated: "" },
    gdp:          { value: inds?.gdp?.value ?? null,          prev: inds?.gdp?.prev ?? null,          consensus: null, surprise: inds?.gdp?.surprise ?? null,          trend: inds?.gdp?.trend ?? null,          lastUpdated: "" },
    retailSales:  { value: inds?.retailSales?.value ?? null,  prev: inds?.retailSales?.prev ?? null,  consensus: null, surprise: inds?.retailSales?.surprise ?? null,  trend: inds?.retailSales?.trend ?? null,  lastUpdated: "" },
    unemployment: { value: inds?.unemployment?.value ?? null, prev: inds?.unemployment?.prev ?? null, consensus: null, surprise: inds?.unemployment?.surprise ?? null, trend: inds?.unemployment?.trend ?? null, lastUpdated: "" },
    employment:   { value: inds?.employment?.value ?? null,   prev: inds?.employment?.prev ?? null,   consensus: null, surprise: inds?.employment?.surprise ?? null,   trend: inds?.employment?.trend ?? null,   lastUpdated: "" },
  };

  const macroScore = calcMacroScore(forScoring, phase);
  const biasText   = biasLabel(macroScore);
  const biasCls    = biasColor(macroScore);
  const phaseInfo  = PHASES[phase];
  const yield10Y   = yields?.yields[currency] ?? null;
  const spread10Y  = yields?.spreads[currency] ?? null;
  const borderCls  = macroScore >= 4 ? "border-green-200" : macroScore <= -4 ? "border-red-200" : "border-gray-200";

  // Consensus = taux attendu à la prochaine réunion CB
  // Priorité : ratePath (OIS temps réel) > rateExp (snapshot statique)
  const rateConsensus = (() => {
    const rate = inds?.policyRate?.value ?? null;
    if (rate === null) return null;
    // OIS live
    if (ratePath && ratePath.meetings.length > 0) {
      const next = ratePath.meetings[0];
      if (next.probMovePct > 50) {
        return next.probIsCut
          ? parseFloat((rate - 0.25).toFixed(2))
          : parseFloat((rate + 0.25).toFixed(2));
      }
      return parseFloat(rate.toFixed(2));
    }
    // Fallback snapshot statique (CHF / si rateprobability indispo)
    if (!rateExp) return null;
    const desc = rateExp.prob_desc.toLowerCase();
    if (desc.includes("no change")) return parseFloat(rate.toFixed(2));
    if (rateExp.direction === "cut"  && rateExp.prob_pct > 50) return parseFloat((rate - 0.25).toFixed(2));
    if (rateExp.direction === "hike" && rateExp.prob_pct > 50) return parseFloat((rate + 0.25).toFixed(2));
    return parseFloat(rate.toFixed(2));
  })();

  return (
    <div className={`bg-white border rounded-xl ${borderCls}`}>
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl leading-none">{meta.flag}</span>
            <div>
              <div className="font-semibold text-sm text-gray-900">{currency}</div>
              <div className="text-[10px] text-gray-400">{meta.cbShort} · {meta.name}</div>
            </div>
          </div>
          <div className="text-right">
            {loading
              ? <Loader2 size={15} className="animate-spin text-gray-300" />
              : <>
                  <div className={`text-sm font-bold ${biasCls}`}>{biasText}</div>
                  <div className="text-[10px] text-gray-400">Score : {macroScore > 0 ? "+" : ""}{macroScore}</div>
                </>
            }
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className={`text-[10px] font-medium ${phaseInfo.color}`}>{phaseInfo.label}</div>
          {fromCache && cacheAge && (
            <div className="flex items-center gap-0.5 text-[9px] text-amber-500" title="Données issues du cache local — API indisponible lors du dernier chargement">
              <Database size={9} />
              <span>cache {cacheAge}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Probabilités OIS (rateprobability.com) ─────────────────────────── */}
      {ratePath && ratePath.meetings.length > 0 ? (
        <div className="mx-4 mb-2 px-3 py-2 bg-gray-50 rounded-lg">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">OIS · marchés</span>
            <span className="text-[9px] text-gray-400">au {ratePath.asOf}</span>
          </div>

          {/* Pic + taux fin d'année */}
          {ratePath.peakMeeting && (
            <div className="flex items-center justify-between text-[10px] mb-1.5">
              <span>
                <span className="text-gray-500">Pic </span>
                <span className="font-semibold text-gray-800">{ratePath.peakMeeting.label}</span>
                <span className={`ml-1 font-bold ${ratePath.peakMeeting.probIsCut ? "text-green-600" : "text-red-500"}`}>
                  {ratePath.peakMeeting.probMovePct.toFixed(0)}%
                  {ratePath.peakMeeting.probIsCut ? " ▼" : " ▲"}
                  {ratePath.peakMeeting.changeBps > 0.5 &&
                    <span className="font-normal text-gray-400"> +{ratePath.peakMeeting.changeBps.toFixed(0)}bps</span>
                  }
                </span>
              </span>
              {ratePath.yearEndImplied !== null && (
                <span className="text-gray-400 text-[9px]">
                  fin d&apos;an {ratePath.yearEndImplied.toFixed(2)}%
                </span>
              )}
            </div>
          )}

          {/* Timeline réunion par réunion */}
          <div className="flex flex-col gap-[3px]">
            {ratePath.meetings.slice(0, 6).map(m => (
              <div key={m.dateIso} className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-400 w-11 shrink-0 tabular-nums">{m.label}</span>
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${m.probIsCut ? "bg-green-400" : "bg-red-400"}`}
                    style={{ width: `${m.probMovePct}%` }}
                  />
                </div>
                <span className={`text-[9px] w-7 text-right tabular-nums shrink-0 ${m.probMovePct >= 50 ? "font-bold text-gray-800" : "text-gray-400"}`}>
                  {m.probMovePct.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : rateExp ? (
        /* Fallback snapshot statique (ex: CHF sans données OIS) */
        <div className="mx-4 mb-2 px-3 py-1.5 bg-gray-50 rounded-lg text-xs leading-snug">
          <span className="font-semibold">{rateExp.direction === "hike" ? "▲" : "▼"} {rateExp.bps} bps</span>
          <span className="text-gray-500"> · {rateExp.prob_pct}% prob. </span>
          <span className={`font-medium ${rateExp.prob_desc.includes("no change") ? "text-gray-600" : rateExp.direction === "hike" ? "text-red-600" : "text-green-600"}`}>
            {rateExp.prob_desc}
          </span>
        </div>
      ) : null}

      {/* ── Indicateurs macro — organisation "prisme" ─────────────────────── */}
      <div className="px-4 pb-2">

        {/* ── POLITIQUE MONÉTAIRE ─────────────────────────────────────────── */}
        <SectionHeader label="Politique monétaire" />
        <Row label="Taux directeur" ind={inds?.policyRate ?? null} unit="%" consensus={rateConsensus} />
        <div className="py-1.5 border-b border-gray-50">
          <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-3 h-3 flex-shrink-0" />
            <span className="text-xs text-gray-500">10Y Yield</span>
          </div>
          <span className="font-semibold text-gray-800 tabular-nums text-xs flex-shrink-0">
            {yield10Y !== null ? `${yield10Y.toFixed(2)}%` : "—"}
            {spread10Y !== null && (
              <span className={`ml-1 text-[10px] ${spread10Y > 0 ? "text-green-600" : "text-red-600"}`}>
                ({spread10Y > 0 ? "+" : ""}{spread10Y}bps vs US)
              </span>
            )}
          </span>
          </div>
        </div>

        {/* ── INFLATION ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mt-2 mb-0.5">
          <span className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">Inflation</span>
          <div className="flex gap-0.5">
            {(["all", "mom", "yoy"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setInflFilter(v)}
                className={`text-[8px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide transition-colors ${
                  inflFilter === v
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {v === "all" ? "Tout" : v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {(inflFilter === "all" || inflFilter === "mom") && (
          <>
            <Row label="PPI MoM" ind={inds?.ppiMoM ?? null} unit="%" consensus={fc?.ppiMoM ?? null} />
            <Row label="CPI MoM" ind={inds?.cpiMoM ?? null} unit="%" consensus={fc?.cpiMoM ?? null} info="Source : Inflation Rate MoM (TradingEconomics)" />
            <Row
              label={(() => {
                const isQoQ = (inds?.cpiCoreMoM as (Ind & { isQoQ?: boolean }) | null)?.isQoQ;
                return isQoQ ? "Core CPI QoQ" : "Core CPI MoM";
              })()}
              ind={inds?.cpiCoreMoM ?? null}
              unit="%"
              consensus={fc?.cpiCoreMoM ?? null}
              tooltip={(() => {
                const raw = (inds?.cpiCoreMoM as (Ind & { _raw?: { last: number; prev: number; refMonth: string } }) | null)?._raw;
                const base = "=Core Inflation Rate MoM";
                return raw ? `${base} — Index: last=${raw.last}  prev=${raw.prev}  ref=${raw.refMonth}` : base;
              })()}
            />
          </>
        )}
        {(inflFilter === "all" || inflFilter === "yoy") && (
          <>
            <Row
              label="Core CPI YoY"
              ind={inds?.cpiCore ?? null}
              unit="%"
              consensus={fc?.cpiCore ?? fc?.cpi ?? null}
              surpriseVsCons={fc?.cpiSurprise ?? null}
              tooltip={(() => {
                const fd = (inds?.cpiCore as (Ind & { _finalForecast?: number; _finalDelta?: number }) | null);
                if (fd?._finalForecast === undefined) return null;
                const d = fd._finalDelta ?? 0;
                const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "=";
                return `Prel./Flash — Final prévu : ${fd._finalForecast?.toFixed(1)}% (${arrow}${d > 0 ? "+" : ""}${d.toFixed(2)})`;
              })()}
              info={(() => {
                const fd = (inds?.cpiCore as (Ind & { _finalDelta?: number }) | null);
                if (fd?._finalDelta === undefined) return null;
                return fd._finalDelta > 0 ? "↑F" : fd._finalDelta < 0 ? "↓F" : "=F";
              })()}
            />
            <Row
              label="Inflation Rate YoY"
              ind={inds?.cpiYoY ?? null}
              unit="%"
              consensus={fc?.cpi ?? null}
              tooltip={(() => {
                const fd = (inds?.cpiYoY as (Ind & { _finalForecast?: number; _finalDelta?: number }) | null);
                if (fd?._finalForecast === undefined) return null;
                const d = fd._finalDelta ?? 0;
                const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "=";
                return `Prel./Flash — Final prévu : ${fd._finalForecast?.toFixed(1)}% (${arrow}${d > 0 ? "+" : ""}${d.toFixed(2)})`;
              })()}
              info={(() => {
                const fd = (inds?.cpiYoY as (Ind & { _finalDelta?: number }) | null);
                if (fd?._finalDelta === undefined) return null;
                return fd._finalDelta > 0 ? "↑F" : fd._finalDelta < 0 ? "↓F" : "=F";
              })()}
            />
            {inds?.commodityPricesYoY && (
              <Row label="Commodity Prices YoY" ind={inds.commodityPricesYoY} unit="%" info="AUD — RBA Commodity Price Index (TradingEconomics)" />
            )}
          </>
        )}

        {/* ── CROISSANCE ──────────────────────────────────────────────────── */}
        <SectionHeader label="Croissance" />
        <Row label="PIB (QoQ%)"     ind={inds?.gdp      ?? null} unit="%" consensus={fc?.gdp ?? null} surpriseVsCons={fc?.gdpSurprise ?? null} />
        <Row label="PMI Composite"  ind={inds?.pmiComposite ?? null} warn={!inds?.pmiComposite} consensus={fc?.pmiComposite ?? null} surpriseVsCons={fc?.pmiCompositeSurprise ?? null} />

        {/* ── EMPLOI ──────────────────────────────────────────────────────── */}
        <SectionHeader label="Emploi" />
        {/* Variation emploi = NFP/Employment Change en milliers — ex: +115k = 115 000 emplois créés */}
        <Row label="Variation emploi" ind={inds?.employment  ?? null} unit="k" warn={!inds?.employment} consensus={fc?.employment ?? null} surpriseVsCons={fc?.employmentSurprise ?? null} />
        <Row label="Taux de chômage"  ind={inds?.unemployment ?? null} unit="%" invertSurprise consensus={fc?.unemployment ?? null} surpriseVsCons={fc?.unemploymentSurprise ?? null} />

        {/* ── Données supplémentaires (expanded) ──────────────────────────── */}
        {expanded && (
          <>
            {/* PMI détail */}
            <SectionHeader label="PMI détail" />
            <Row label="PMI Mfg"       ind={inds?.pmiMfg      ?? null} warn={!inds?.pmiMfg}       consensus={fc?.pmiMfg      ?? null} surpriseVsCons={fc?.pmiMfgSurprise      ?? null} />
            <Row label="PMI Services"  ind={inds?.pmiServices ?? null} warn={!inds?.pmiServices}   consensus={fc?.pmiSvc      ?? null} surpriseVsCons={fc?.pmiSvcSurprise      ?? null} />
            <Row label="Ventes détail" ind={inds?.retailSales ?? null} unit="%" warn={!inds?.retailSales} consensus={fc?.retailSales ?? null} surpriseVsCons={fc?.retailSalesSurprise ?? null} />

            {/* Géopolitique */}
            <SectionHeader label="Géopolitique" />
            {inds?.tradeBalance ? (
              <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
                <span className="text-gray-500 text-xs">Balance comm.</span>
                <span className={`text-xs font-semibold tabular-nums ${(inds.tradeBalance.value ?? 0) >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {(inds.tradeBalance.value ?? 0) >= 0 ? "+" : ""}{inds.tradeBalance.value?.toFixed(1)}B
                  <span className="text-[9px] text-gray-400 font-normal ml-0.5">
                    {(inds.tradeBalance.value ?? 0) >= 0 ? " surplus" : " déficit"}
                  </span>
                </span>
              </div>
            ) : null}
            {/* Profil énergie + matières premières */}
            {(() => {
              const profile = COUNTRY_PROFILES[currency];
              if (!profile) return null;
              const energyColor = profile.energy === "exporter" ? "text-green-700 bg-green-50" : profile.energy === "importer" ? "text-red-700 bg-red-50" : "text-gray-600 bg-gray-100";
              const energyLabel = profile.energy === "exporter" ? "🛢 Export. énergie" : profile.energy === "importer" ? "⚡ Import. énergie" : "⚖ Énergie ~neutre";
              return (
                <div className="py-1.5 border-b border-gray-50 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${energyColor}`}>{energyLabel}</span>
                    <span className="text-[9px] text-gray-400 text-right leading-tight max-w-[55%]">{profile.energyNote}</span>
                  </div>
                  {profile.commodities.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {profile.commodities.map(c => (
                        <span key={c} className="text-[8px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Sentiment & Positionnement ──────────────────────────────── */}
            <SectionHeader label="Sentiment & Positionnement" />
            {sentiment ? (
              <div className="py-1.5 border-b border-gray-50">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500 text-[10px]">{sentiment.pair} · Myfxbook</span>
                  <span className="text-[10px] tabular-nums">
                    <span className="text-green-600 font-semibold">{sentiment.longPct}% L</span>
                    <span className="text-gray-300 mx-0.5">/</span>
                    <span className="text-red-500 font-semibold">{sentiment.shortPct}% S</span>
                  </span>
                </div>
                {/* Barre visuelle long/short */}
                <div className="flex h-1.5 rounded-full overflow-hidden">
                  <div className="bg-green-400 transition-all" style={{ width: `${sentiment.longPct}%` }} />
                  <div className="bg-red-400 flex-1" />
                </div>
                {/* Signal contrarien */}
                {(sentiment.longPct >= 70 || sentiment.shortPct >= 70) && (
                  <p className={`text-[9px] mt-0.5 font-medium ${sentiment.longPct >= 70 ? "text-red-500" : "text-green-600"}`}>
                    {sentiment.longPct >= 70 ? "⚠ Retail très long — signal contrarien baissier" : "⚠ Retail très short — signal contrarien haussier"}
                  </p>
                )}
              </div>
            ) : (
              <div className="py-1 text-[10px] text-gray-300 border-b border-gray-50">— (Myfxbook indisponible)</div>
            )}

            {/* ── COT CFTC ────────────────────────────────────────────────── */}
            <div className="pt-1 pb-0.5">
              <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">COT — Hedge Funds</span>
            </div>
            {cot ? (
              <div className="py-1.5">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500 text-[10px]">Lev. Money · {cot.weekDate}</span>
                  <span className="text-[10px] tabular-nums">
                    <span className="text-green-600 font-semibold">{cot.longPct}% L</span>
                    <span className="text-gray-300 mx-0.5">/</span>
                    <span className="text-red-500 font-semibold">{cot.shortPct}% S</span>
                    <span className="text-gray-400 ml-1">({cot.net > 0 ? "+" : ""}{cot.net.toLocaleString("fr-FR")})</span>
                  </span>
                </div>
                <div className="flex h-1.5 rounded-full overflow-hidden">
                  <div className="bg-green-400 transition-all" style={{ width: `${cot.longPct}%` }} />
                  <div className="bg-red-400 flex-1" />
                </div>
                {/* Divergence COT vs Sentiment */}
                {sentiment && Math.abs(cot.longPct - sentiment.longPct) >= 20 && (
                  <p className="text-[9px] mt-0.5 text-amber-600 font-medium">
                    ⚡ Divergence COT/Retail : {Math.abs(cot.longPct - sentiment.longPct)}pts
                  </p>
                )}
              </div>
            ) : (
              <div className="py-1 text-[10px] text-gray-300">— (CFTC indisponible)</div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-4 py-2 flex items-center justify-between">
        <NarrativeButton currency={currency} indicators={forScoring} macroScore={macroScore} />
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600"
        >
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {expanded ? "Moins" : "Détails"}
        </button>
      </div>
    </div>
  );
}
