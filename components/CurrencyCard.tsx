"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Loader2, Database } from "lucide-react";
import { CURRENCY_META } from "@/lib/constants";
import { biasLabel, biasColor, calcMacroScore } from "@/lib/scoring";
import { saveCache, loadCache, formatCacheDate } from "@/lib/localCache";
import type { Currency, BiasPhase, RateExpectation } from "@/lib/types";
import NarrativeButton from "./NarrativeButton";

interface Ind { value: number | null; prev: number | null; surprise: number | null; trend: "up"|"down"|"flat"|null; lastUpdated: string | null }
interface MacroData { currency: string; indicators: Record<string, Ind | null>; fetchedAt: string }

interface Props {
  currency: Currency;
  expectations: Record<string, unknown> | null;
  yields: { yields: Record<string, number | null>; spreads: Record<string, number | null> } | null;
  onDivergenceUpdate: (currency: Currency, score: number) => void;
}

const PHASES: Record<BiasPhase, { label: string; color: string }> = {
  tightening:    { label: "🔴 Resserrement",  color: "text-red-600"    },
  hawkish_pause: { label: "🟡 Pause Hawkish", color: "text-amber-600"  },
  easing:        { label: "🟢 Assouplissement", color: "text-green-600" },
  dovish_pause:  { label: "🔵 Pause Dovish",  color: "text-blue-600"   },
  transition:    { label: "🟠 Transition",     color: "text-orange-500" },
};

function TrendIcon({ trend }: { trend: "up"|"down"|"flat"|null }) {
  if (trend === "up")   return <TrendingUp  size={11} className="text-green-500 flex-shrink-0" />;
  if (trend === "down") return <TrendingDown size={11} className="text-red-500   flex-shrink-0" />;
  return <Minus size={11} className="text-gray-300 flex-shrink-0" />;
}

function Row({ label, ind, unit = "", invertSurprise = false, warn = false, consensus = null }: {
  label: string; ind: Ind | null; unit?: string; invertSurprise?: boolean; warn?: boolean; consensus?: number | null;
}) {
  const value = ind?.value ?? null;
  const prev  = ind?.prev  ?? null;

  // Colorer la valeur actuelle selon la direction du mouvement
  const s = ind?.surprise ?? null;
  const effectiveS = invertSurprise && s !== null ? -s : s;
  const valCls =
    effectiveS === null ? "text-gray-800"
    : effectiveS > 0   ? "text-green-700"
    : effectiveS < 0   ? "text-red-700"
    :                    "text-gray-500";

  const fmt = (v: number | null) =>
    v !== null ? `${v.toFixed(2)}${unit}` : "—";

  return (
    <div className="py-1.5 border-b border-gray-50 last:border-0">
      {/* Ligne 1 : label + valeur actuelle publiée */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <TrendIcon trend={ind?.trend ?? null} />
          <span className="text-xs text-gray-500 truncate">
            {label}{warn && <span className="text-amber-400 ml-0.5">⚠</span>}
          </span>
        </div>
        <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ${valCls}`}>
          {fmt(value)}
        </span>
      </div>
      {/* Ligne 2 : précédent + consensus marché */}
      <div className="flex items-center justify-between pl-5 mt-0.5">
        <span className="text-[10px] text-gray-400 tabular-nums">
          Préc.&nbsp;<span className="text-gray-500 font-medium">{fmt(prev)}</span>
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums">
          Cons.&nbsp;
          {consensus !== null
            ? <span className="text-blue-500 font-medium">{fmt(consensus)}</span>
            : <span className="text-gray-300">—</span>}
        </span>
      </div>
    </div>
  );
}

export default function CurrencyCard({ currency, expectations, yields, onDivergenceUpdate }: Props) {
  const meta   = CURRENCY_META[currency];
  const [data, setData]         = useState<MacroData | null>(null);
  const [phase, setPhase]       = useState<BiasPhase>("hawkish_pause");
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [rateExp, setRateExp]   = useState<RateExpectation | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cacheAge, setCacheAge]   = useState<string | null>(null);

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

  const inds = data?.indicators;

  // Build a minimal indicator object for scoring
  const forScoring = {
    policyRate:   { value: inds?.policyRate?.value ?? null,   prev: inds?.policyRate?.prev ?? null,   consensus: null, surprise: inds?.policyRate?.surprise ?? null,   trend: inds?.policyRate?.trend ?? null,   lastUpdated: "" },
    cpiCore:      { value: inds?.cpiCore?.value ?? null,      prev: inds?.cpiCore?.prev ?? null,      consensus: null, surprise: inds?.cpiCore?.surprise ?? null,      trend: inds?.cpiCore?.trend ?? null,      lastUpdated: "" },
    pmiMfg:       { value: null, prev: null, consensus: null, surprise: null, trend: null, lastUpdated: "" },
    pmiServices:  { value: null, prev: null, consensus: null, surprise: null, trend: null, lastUpdated: "" },
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

  return (
    <div className={`bg-white border rounded-xl overflow-hidden ${borderCls}`}>
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

      {/* Rate expectation pill */}
      {rateExp && (
        <div className="mx-4 mb-2 px-3 py-1.5 bg-gray-50 rounded-lg text-xs leading-snug">
          <span className="font-semibold">{rateExp.direction === "hike" ? "▲" : "▼"} {rateExp.bps} bps</span>
          <span className="relative group inline-flex items-center ml-0.5 cursor-help align-middle">
            <span className="text-[9px] text-gray-400 border border-gray-300 rounded-full w-3 h-3 flex items-center justify-center leading-none select-none">i</span>
            <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 hidden group-hover:block bg-gray-800 text-white text-[10px] rounded px-2 py-1.5 w-56 z-50 leading-snug shadow-lg whitespace-normal">
              Variation cumulée attendue sur les ~12 prochains mois selon les marchés (OIS / futures de taux). Distinct de la probabilité à la prochaine réunion ci-dessous.
            </span>
          </span>
          <span className="text-gray-500"> · {rateExp.prob_pct}% prob. </span>
          <span className={`font-medium ${rateExp.prob_desc.includes("no change") || rateExp.prob_desc.includes("sans") ? "text-gray-600" : rateExp.direction === "hike" ? "text-red-600" : "text-green-600"}`}>
            {rateExp.prob_desc}
          </span>
        </div>
      )}

      {/* Core indicators (always visible) */}
      <div className="px-4 pb-2">
        <Row label="Taux directeur" ind={inds?.policyRate   ?? null} unit="%" />
        <Row label="CPI (MoM%)"      ind={inds?.cpiCore     ?? null} unit="%" />
        <Row label="PIB (QoQ %)"    ind={inds?.gdp         ?? null} unit="%" />
        <Row label="Chômage"        ind={inds?.unemployment ?? null} unit="%" invertSurprise />

        {/* Expanded indicators */}
        {expanded && (
          <>
            <Row label="PMI Mfg"      ind={null}                          warn />
            <Row label="PMI Services" ind={null}                          warn />
            <Row label="Retail Sales" ind={inds?.retailSales  ?? null}   unit="%" warn={!inds?.retailSales} />
            <Row label="Emploi (MoM%)" ind={inds?.employment   ?? null} unit="%" warn={!inds?.employment} />
            {/* 10Y yield */}
            <div className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-gray-500">10Y Yield</span>
              <span className="font-semibold text-gray-800 tabular-nums">
                {yield10Y !== null ? `${yield10Y.toFixed(2)}%` : "—"}
                {spread10Y !== null && (
                  <span className={`ml-1 text-[10px] ${spread10Y > 0 ? "text-green-600" : "text-red-600"}`}>
                    ({spread10Y > 0 ? "+" : ""}{spread10Y}bps)
                  </span>
                )}
              </span>
            </div>
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
