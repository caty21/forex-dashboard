"use client";

// components/ScenarioTab.tsx
// Simulateur "scénario → prix implicite", façon CME SOFRWatch / €STRWatch —
// logique INVERSÉE par rapport aux autres onglets Taux (qui déduisent une
// probabilité depuis les prix de marché) : ici, l'utilisateur choisit
// lui-même un scénario de hikes/cuts à chaque réunion de banque centrale, et
// l'outil en déduit où devrait se situer le taux de référence overnight
// implicite si ce scénario se réalisait.
//
// Lien taux directeur → taux de référence overnight (voir /api/scenario-spreads) :
//   USD : SOFR  ≈ borne basse Fed + (EFFR − borne basse) + (SOFR − EFFR)
//   EUR : €STR  ≈ DFR + (€STR − DFR)
//   GBP : SONIA ≈ Bank Rate + (SONIA − Bank Rate)
// CME calcule ces spreads (USD) à partir des prix forward des futures SOFR
// 1 mois vs Fed Funds (SR1−ZQ) — données de marché propriétaires, pas
// d'équivalent public pour €STR/SONIA. On les approxime partout avec la
// moyenne réalisée historique (FRED, gratuit, fenêtre ~2 semaines).

import { useEffect, useState, useMemo } from "react";
import { RefreshCw, RotateCcw, Info } from "lucide-react";
import {
  LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";

type ScenarioCcy = "USD" | "EUR" | "GBP";

interface ScenarioSpread {
  label: string;
  bps:   number | null;
}

interface ScenarioSpreads {
  currency:     ScenarioCcy;
  asOf:         string;
  targetRate:   number | null;
  targetLabel:  string;
  refRateLabel: string;
  marketConversionOffset: number;
  spreads:      ScenarioSpread[];
  windowDays:   number;
  note:         string;
}

interface Meeting {
  dateIso:     string;
  label:       string;
  impliedRate: number;
}

const STEPS = [-50, -25, 0, 25, 50] as const;

const CCY_META: Record<ScenarioCcy, { flag: string; bank: string; meetingLabel: string }> = {
  USD: { flag: "🇺🇸", bank: "Fed (FOMC)", meetingLabel: "réunion FOMC" },
  EUR: { flag: "🇪🇺", bank: "BCE",        meetingLabel: "Conseil des gouverneurs" },
  GBP: { flag: "🇬🇧", bank: "BoE (MPC)",  meetingLabel: "réunion MPC" },
};

function fmtDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("fr-FR", { month: "short", day: "numeric" });
}

export default function ScenarioTab() {
  const [currency, setCurrency] = useState<ScenarioCcy>("USD");
  const [spreads, setSpreads]   = useState<ScenarioSpreads | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [deltas, setDeltas]     = useState<Record<string, number>>({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = async (ccy: ScenarioCcy) => {
    setLoading(true);
    setError(null);
    try {
      const [spreadsRes, rpRes] = await Promise.all([
        fetch(`/api/scenario-spreads?currency=${ccy}`, { cache: "no-store" }).then(r => r.json()),
        fetch("/api/rate-probabilities", { cache: "no-store" }).then(r => r.json()),
      ]);
      if (spreadsRes?.error) throw new Error(spreadsRes.error);
      setSpreads(spreadsRes as ScenarioSpreads);

      const entry = rpRes?.data?.[ccy];
      const ms: Meeting[] = (entry?.meetings ?? []).map((m: { dateIso: string; label: string; impliedRate: number }) => ({
        dateIso: m.dateIso, label: m.label, impliedRate: m.impliedRate,
      }));
      setMeetings(ms);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setDeltas({}); load(currency); }, [currency]);

  const setDelta = (dateIso: string, bps: number) => setDeltas(prev => ({ ...prev, [dateIso]: bps }));
  const resetAll = () => setDeltas({});

  const totalSpreadBps = useMemo(
    () => spreads ? spreads.spreads.reduce((s, x) => s + (x.bps ?? 0), 0) : null,
    [spreads]
  );

  const chartData = useMemo(() => {
    if (!spreads || spreads.targetRate === null || totalSpreadBps === null || !meetings.length) return [];
    const spreadTotal = totalSpreadBps / 100;

    let cumulTarget = spreads.targetRate;
    return meetings.map(m => {
      const delta = deltas[m.dateIso] ?? 0;
      cumulTarget = parseFloat((cumulTarget + delta / 100).toFixed(4));
      const scenarioRef = parseFloat((cumulTarget + spreadTotal).toFixed(4));

      // Marché (OIS) : impliedRate suit la convention propre à /api/rate-probabilities
      // (borne haute pour USD, MRO pour EUR, Bank Rate direct pour GBP) → on la
      // convertit vers la même échelle que targetRate avant d'ajouter le spread.
      const marketTarget = parseFloat((m.impliedRate + spreads.marketConversionOffset).toFixed(4));
      const marketRef     = parseFloat((marketTarget + spreadTotal).toFixed(4));

      return {
        label: m.label,
        dateIso: m.dateIso,
        scenario: scenarioRef,
        marche: marketRef,
        cumulBps: Math.round((cumulTarget - spreads.targetRate!) * 100),
      };
    });
  }, [spreads, meetings, deltas, totalSpreadBps]);

  const currentImpliedRef = spreads?.targetRate !== null && totalSpreadBps !== null && spreads
    ? parseFloat((spreads.targetRate + totalSpreadBps / 100).toFixed(2))
    : null;

  const meta = CCY_META[currency];

  return (
    <div className="space-y-3">
      <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Scénario — simulateur taux → {spreads?.refRateLabel ?? "taux"} implicite</h2>
          <div className="flex items-center gap-2">
            <button onClick={resetAll} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-600 rounded-md px-2 py-1 transition-colors">
              <RotateCcw size={11} /> Réinitialiser
            </button>
            <button onClick={() => load(currency)} disabled={loading} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-600 rounded-md px-2 py-1 transition-colors disabled:opacity-50">
              <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Rafraîchir
            </button>
          </div>
        </div>

        {/* Sélecteur de devise */}
        <div className="flex gap-1.5 mb-2">
          {(Object.keys(CCY_META) as ScenarioCcy[]).map(ccy => (
            <button
              key={ccy}
              onClick={() => setCurrency(ccy)}
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full border transition-colors ${
                currency === ccy
                  ? "bg-slate-700 border-slate-500 text-white"
                  : "border-slate-700/60 text-slate-400 hover:text-white"
              }`}
            >
              <span>{CCY_META[ccy].flag}</span> {ccy} <span className="text-slate-500 font-normal">· {CCY_META[ccy].bank}</span>
            </button>
          ))}
        </div>

        <p className="text-[10px] text-slate-600 leading-relaxed">
          Logique inversée par rapport aux autres onglets Taux (qui déduisent une probabilité depuis les prix de marché) :
          choisissez vous-même un scénario de hikes/cuts à chaque {meta.meetingLabel}, l&apos;outil déduit où devrait se situer
          le {spreads?.refRateLabel ?? "taux de référence"} implicite si ce scénario se réalisait — façon CME SOFRWatch / €STRWatch.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-[12px] text-red-400">
          {error}
        </div>
      )}

      {loading && !spreads ? (
        <div className="flex items-center justify-center py-16 text-slate-600 text-sm">Chargement…</div>
      ) : spreads && meetings.length > 0 ? (
        <>
          {/* Spreads utilisés */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Info size={11} className="text-slate-600" />
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{spreads.targetLabel} → {spreads.refRateLabel}</span>
            </div>
            <div className="flex items-center gap-4 flex-wrap text-[11px]">
              <span className="text-slate-400">{spreads.targetLabel} : <span className="text-slate-200 font-semibold font-mono">{spreads.targetRate?.toFixed(2)}%</span></span>
              {spreads.spreads.map(s => (
                <span key={s.label} className="text-slate-400">
                  Spread {s.label} : <span className="text-amber-400 font-semibold font-mono">{s.bps !== null ? `${s.bps >= 0 ? "+" : ""}${s.bps}bps` : "—"}</span>
                </span>
              ))}
              <span className="text-slate-400">{spreads.refRateLabel} implicite actuel : <span className="text-slate-100 font-bold font-mono">{currentImpliedRef?.toFixed(2)}%</span></span>
            </div>
            <p className="text-[9px] text-slate-700 mt-2 leading-snug">{spreads.note}</p>
          </div>

          {/* Constructeur de scénario */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Votre scénario — par {meta.meetingLabel}</span>
            <div className="mt-2 space-y-1.5">
              {meetings.map(m => {
                const delta = deltas[m.dateIso] ?? 0;
                return (
                  <div key={m.dateIso} className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 w-[52px] shrink-0 font-mono">{fmtDate(m.dateIso)}</span>
                    <div className="flex gap-1">
                      {STEPS.map(s => (
                        <button
                          key={s}
                          onClick={() => setDelta(m.dateIso, s)}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                            delta === s
                              ? s < 0 ? "bg-sky-500/20 border-sky-500/50 text-sky-400"
                                : s > 0 ? "bg-red-500/20 border-red-500/50 text-red-400"
                                : "bg-slate-700 border-slate-500 text-white"
                              : "border-slate-700/60 text-slate-500 hover:text-white"
                          }`}
                        >
                          {s === 0 ? "Hold" : `${s > 0 ? "+" : ""}${s}`}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chart comparatif */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{spreads.refRateLabel} implicite — votre scénario vs marché (OIS)</span>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} width={44}
                  tickFormatter={(v: number) => `${v.toFixed(2)}%`} domain={["dataMin - 0.1", "dataMax + 0.1"]} />
                <Tooltip
                  content={({ label, payload }) => {
                    if (!payload?.length) return null;
                    const items = payload as { dataKey: string; value: number; color: string }[];
                    return (
                      <div style={{ background: "rgba(8,14,28,0.97)", border: "1px solid #1e293b", borderRadius: 10, padding: "8px 12px" }}>
                        <p style={{ color: "#475569", fontSize: 9, margin: "0 0 6px", fontWeight: 700, textTransform: "uppercase" }}>{label}</p>
                        {items.map(it => (
                          <p key={it.dataKey} style={{ color: it.color, fontSize: 11, margin: "2px 0", fontWeight: 700 }}>
                            {it.dataKey === "scenario" ? "Votre scénario" : "Marché (OIS)"} : {it.value.toFixed(3)}%
                          </p>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend
                  formatter={(value: string) => (
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{value === "scenario" ? "Votre scénario" : "Marché (OIS)"}</span>
                  )}
                />
                <Line type="stepAfter" dataKey="marche"   stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 3" dot={{ r: 2.5, fill: "#1e293b", stroke: "#64748b" }} />
                <Line type="stepAfter" dataKey="scenario" stroke="#f59e0b" strokeWidth={2}   dot={{ r: 3,   fill: "#1e293b", stroke: "#f59e0b" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-slate-600 text-sm">Données indisponibles pour le moment.</div>
      )}
    </div>
  );
}
