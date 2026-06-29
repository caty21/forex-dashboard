"use client";

import { useState, useEffect, useCallback } from "react";
import { Printer, RefreshCw, Save, RotateCcw, Plus, Trash2, Sparkles, Loader2, Check } from "lucide-react";
import type { CalendarEvent } from "@/app/api/calendar/route";
import type { DriverData } from "@/lib/types";
import type { FxWeeklyEntry } from "@/app/api/fx-weekly/route";
import type { CotHistory } from "@/app/api/cot-history/route";
import { CURRENCY_META } from "@/lib/constants";
import { TvAdvancedChart } from "@/components/TvChart";

interface Props {
  calEvents:  CalendarEvent[];
  drivers:    DriverData | null;
  cotHistory: CotHistory | null;
}

interface Theme { title: string; body: string }

interface ReportState {
  weekLabel:  string;
  weekFrom:   string;
  weekTo:     string;
  author:     string;
  subtitle:   string;
  themes:     Theme[];
  currencies: Record<string, { pct: string; analysis: string; level: string }>;
  notes:      string;
}

const STORAGE_KEY = "forex-report-v2";
const G10 = ["USD","EUR","GBP","JPY","CHF","CAD","AUD","NZD"];

function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function fmtShort(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

function defaultState(weekFrom = "", weekTo = ""): ReportState {
  return {
    weekLabel: weekFrom && weekTo ? `${fmtShort(weekFrom)} — ${fmtDate(weekTo)}` : "Semaine du … au …",
    weekFrom, weekTo,
    author:   "Capucine · Forex Dashboard",
    subtitle: "Analyse macro-fondamentale G10 · Marchés globaux",
    themes:   [{ title: "", body: "" }, { title: "", body: "" }, { title: "", body: "" }],
    currencies: Object.fromEntries(G10.map(c => [c, { pct: "—", analysis: "", level: "" }])),
    notes: "",
  };
}

function save(state: ReportState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /**/ }
}
function load(): ReportState | null {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

// ── Composants UI ─────────────────────────────────────────────────────────────

function Field({ value, onChange, placeholder, multiline, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  multiline?: boolean; className?: string;
}) {
  if (multiline) return (
    <textarea value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} rows={5}
      className={`w-full bg-transparent resize-none outline-none placeholder-slate-700 ${className}`} />
  );
  return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`bg-transparent outline-none placeholder-slate-700 w-full ${className}`} />
  );
}

function Pct({ val }: { val: string }) {
  const n = parseFloat(val);
  if (isNaN(n) || val === "—") return <span className="text-slate-500 font-mono text-sm">—</span>;
  const c = n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-slate-400";
  return <span className={`font-mono font-bold text-sm ${c}`}>{n > 0 ? "+" : ""}{n.toFixed(1)}%</span>;
}

// ── Bouton Groq "Faits marquants" ─────────────────────────────────────────────
function AiHighlightsButton({ calEvents, drivers, weekFrom, weekTo, onResult }: {
  calEvents:  CalendarEvent[];
  drivers:    DriverData | null;
  weekFrom:   string;
  weekTo:     string;
  onResult:   (themes: Theme[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [err,     setErr]     = useState("");

  const run = async () => {
    setLoading(true); setErr(""); setDone(false);
    try {
      const prevEvents = calEvents.filter(e => e.week === "prev" || (e.isPublished && e.week === "current"));
      const res = await fetch("/api/narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "report_highlights",
          data: {
            events:  prevEvents.map(e => ({ title: e.title, currency: e.currency, actual: e.actual, forecast: e.forecast, previous: e.previous, impact: e.impact })),
            drivers: { vix: (drivers as { vix?: number | null } | null)?.vix, brent: (drivers as { brent?: number | null } | null)?.brent, us10y: (drivers as { us10y?: number | null } | null)?.us10y },
            weekFrom, weekTo,
          },
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const text: string = json.analysis ?? "";
      // Parse les 3 blocs séparés par "--"
      const blocks = text.split(/\n--\n|^--$/m).map(b => b.trim()).filter(Boolean).slice(0, 3);
      const themes: Theme[] = blocks.map(block => {
        const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
        return { title: lines[0] ?? "", body: lines.slice(1).join(" ") };
      });
      onResult(themes);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/i, "").slice(0, 60));
    } finally { setLoading(false); }
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={run} disabled={loading}
        className={`no-print flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
          done    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
          loading ? "bg-sky-500/10 text-sky-400 border border-sky-500/20 cursor-wait" :
          "bg-sky-500/15 text-sky-400 border border-sky-500/25 hover:bg-sky-500/25"
        }`}>
        {loading ? <Loader2 size={10} className="animate-spin" />
         : done   ? <Check size={10} />
         : <Sparkles size={10} />}
        {loading ? "Génération…" : done ? "Injectés !" : "Générer avec IA"}
      </button>
      {err && <span className="text-[9px] text-red-400 truncate max-w-[140px]" title={err}>⚠ {err}</span>}
    </div>
  );
}

// ── Bouton Groq par devise ────────────────────────────────────────────────────
function AiButton({ ccy, weekFrom, weekTo, pct, cotHistory, onResult }: {
  ccy: string; weekFrom: string; weekTo: string; pct: string;
  cotHistory: CotHistory | null; onResult: (text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [err,     setErr]     = useState("");

  const run = async () => {
    setLoading(true); setErr(""); setDone(false);
    try {
      const tffWeeks    = cotHistory?.tff?.[ccy as keyof typeof cotHistory.tff]     ?? [];
      const legacyWeeks = cotHistory?.legacy?.[ccy as keyof typeof cotHistory.legacy] ?? [];
      const tff0    = tffWeeks[0];
      const legacy0 = legacyWeeks[0];

      const res = await fetch("/api/narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "report_ccy",
          currency: ccy,
          data: {
            weeklyPct:      pct,
            weekFrom, weekTo,
            cotNetTff:      tff0?.net,
            cotDeltaTff:    tff0?.deltaNet,
            cotLongPctTff:  tff0?.longPct,
            cotNetLegacy:   legacy0?.net,
            cotDeltaLegacy: legacy0?.deltaNet,
          },
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      onResult(json.analysis ?? "");
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/i, "").slice(0, 60));
    } finally { setLoading(false); }
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={run} disabled={loading}
        className={`no-print flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
          done    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
          loading ? "bg-sky-500/10 text-sky-400 border border-sky-500/20 cursor-wait" :
          "bg-sky-500/15 text-sky-400 border border-sky-500/25 hover:bg-sky-500/25"
        }`}>
        {loading ? <Loader2 size={10} className="animate-spin" />
         : done   ? <Check size={10} />
         : <Sparkles size={10} />}
        {loading ? "Génération…" : done ? "Injecté !" : "Générer avec IA"}
      </button>
      {err && <span className="text-[9px] text-red-400 truncate max-w-[140px]" title={err}>⚠ {err}</span>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ReportTab({ calEvents, drivers, cotHistory }: Props) {
  const [state,     setState]   = useState<ReportState>(() => load() ?? defaultState());
  const [fxData,    setFxData]  = useState<FxWeeklyEntry[] | null>(null);
  const [fxLoading, setFxLoad]  = useState(false);
  const [weekTo,    setWeekTo]  = useState("");
  const [saved,       setSaved]     = useState(false);
  const [showCharts,  setShowCharts] = useState(false);

  const loadFx = useCallback(async (override?: string) => {
    setFxLoad(true);
    try {
      const url = override ? `/api/fx-weekly?weekTo=${override}` : "/api/fx-weekly";
      const r   = await fetch(url);
      if (!r.ok) return;
      const d = await r.json();
      setFxData(d.currencies);
      const newCcys = { ...state.currencies };
      for (const e of d.currencies as FxWeeklyEntry[]) {
        newCcys[e.ccy] = { ...newCcys[e.ccy], pct: e.pct > 0 ? `+${e.pct.toFixed(1)}%` : `${e.pct.toFixed(1)}%` };
      }
      setState(s => ({
        ...s,
        weekFrom:  d.weekFrom,
        weekTo:    d.weekTo,
        weekLabel: `${fmtShort(d.weekFrom)} — ${fmtDate(d.weekTo)}`,
        currencies: newCcys,
      }));
    } finally { setFxLoad(false); }
  }, [state.currencies]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadFx(); }, []); // eslint-disable-line

  const upd = (patch: Partial<ReportState>) =>
    setState(s => { const n = { ...s, ...patch }; save(n); return n; });

  const updCcy = (ccy: string, f: "pct" | "analysis" | "level", v: string) => {
    const c = { ...state.currencies, [ccy]: { ...state.currencies[ccy], [f]: v } };
    upd({ currencies: c });
  };

  const updTheme = (i: number, f: "title" | "body", v: string) =>
    upd({ themes: state.themes.map((t, j) => j === i ? { ...t, [f]: v } : t) });

  const handleSave = () => { save(state); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  // Devises triées par perf hebdo
  const sorted = [...G10].sort((a, b) => {
    const pa = parseFloat(state.currencies[a]?.pct ?? "0");
    const pb = parseFloat(state.currencies[b]?.pct ?? "0");
    return (isNaN(pb) ? 0 : pb) - (isNaN(pa) ? 0 : pa);
  });

  // Calendrier semaine suivante
  const nextEvents = calEvents
    .filter(e => e.week === "next" && e.impact !== "low" && !e.isGroupChild)
    .sort((a, b) => a.date.localeCompare(b.date));
  const calByDay: Record<string, CalendarEvent[]> = {};
  for (const e of nextEvents) {
    const d = e.date.slice(0, 10);
    (calByDay[d] ??= []).push(e);
  }
  const calDays = Object.keys(calByDay).sort();

  const pubDate = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-4">

      {/* ── Contrôles ─────────────────────────────────────────────────────── */}
      <div className="no-print flex items-center justify-between flex-wrap gap-3 bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">📋 Rapport hebdomadaire</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Vendredi clôture :</span>
            <input type="date" value={weekTo} onChange={e => setWeekTo(e.target.value)}
              className="text-[11px] bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:border-sky-500/50" />
            <button onClick={() => loadFx(weekTo || undefined)} disabled={fxLoading}
              className="flex items-center gap-1 text-[11px] bg-sky-500/15 text-sky-400 border border-sky-500/25 px-2 py-1 rounded hover:bg-sky-500/25 disabled:opacity-50">
              <RefreshCw size={10} className={fxLoading ? "animate-spin" : ""} /> Charger
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setState(defaultState()); localStorage.removeItem(STORAGE_KEY); }}
            className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded border border-slate-800 hover:border-slate-700">
            <RotateCcw size={11} /> Reset
          </button>
          <button onClick={handleSave}
            className={`flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border transition-all ${saved ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "text-slate-400 border-slate-800 hover:border-slate-600"}`}>
            <Save size={11} /> {saved ? "Sauvegardé !" : "Sauvegarder"}
          </button>
          <button
            onClick={() => setShowCharts(v => !v)}
            className={`flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border transition-all ${showCharts ? "bg-sky-500/20 text-sky-400 border-sky-500/30" : "text-slate-500 border-slate-800 hover:border-slate-600"}`}>
            {showCharts ? "Masquer graphiques" : "Afficher graphiques TradingView"}
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 text-[11px] bg-sky-600/80 hover:bg-sky-600 text-white px-3 py-1.5 rounded font-medium">
            <Printer size={11} /> Exporter PDF
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          RAPPORT IMPRIMABLE
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="report-root font-sans">

        {/* ── PAGE 1 : COUVERTURE ─────────────────────────────────────────── */}
        <div className="report-page rp-cover bg-[#080c14] min-h-[297mm] flex flex-col p-10">

          {/* Bande top */}
          <div className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center">
                <span className="text-white font-black text-xs">FX</span>
              </div>
              <Field value={state.author} onChange={v => upd({ author: v })}
                className="text-sky-400 text-xs font-semibold tracking-wide" placeholder="Auteur…" />
            </div>
            <span className="text-slate-600 text-[10px]">Publiée le {pubDate}</span>
          </div>

          {/* Titre central */}
          <div className="flex-1 flex flex-col justify-center space-y-6">
            <div className="space-y-1">
              <p className="text-sky-500 text-xs uppercase tracking-[0.25em] font-semibold">Rapport Macro Weekly</p>
              <Field value={state.weekLabel} onChange={v => upd({ weekLabel: v })}
                className="text-white text-4xl font-black leading-tight tracking-tight block"
                placeholder="Semaine du … au …" />
              <Field value={state.subtitle} onChange={v => upd({ subtitle: v })}
                className="text-slate-500 text-sm block mt-2" placeholder="Sous-titre…" />
            </div>

            {/* Barre de séparation animée */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-sky-500 to-transparent" />
              <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />
            </div>

            {/* Classement G10 */}
            {fxData && (
              <div className="grid grid-cols-8 gap-2">
                {sorted.map(ccy => {
                  const meta = CURRENCY_META[ccy as keyof typeof CURRENCY_META];
                  const n    = parseFloat(state.currencies[ccy]?.pct ?? "0");
                  const c    = n > 0 ? "#34d399" : n < 0 ? "#f87171" : "#94a3b8";
                  return (
                    <div key={ccy} className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <span className="text-xl leading-none">{meta?.flag}</span>
                      <span className="text-white text-xs font-bold">{ccy}</span>
                      <span className="font-mono font-bold text-xs" style={{ color: c }}>
                        {isNaN(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Thèmes clés */}
            <div className="space-y-2 mt-4">
              <div className="flex items-center justify-between no-print">
                <p className="text-slate-600 text-[9px] uppercase tracking-widest font-semibold">Faits marquants de la semaine</p>
                <AiHighlightsButton
                  calEvents={calEvents}
                  drivers={drivers}
                  weekFrom={state.weekFrom}
                  weekTo={state.weekTo}
                  onResult={themes => upd({ themes })}
                />
              </div>
              {state.themes.map((theme, i) => (
                <div key={i} className="group relative flex gap-3 p-3 rounded-lg bg-white/[0.03] border-l-2 border-sky-500/60">
                  <div className="flex-1 space-y-0.5">
                    <Field value={theme.title} onChange={v => updTheme(i, "title", v)}
                      className="text-sky-400 text-[10px] font-bold uppercase tracking-wider"
                      placeholder="TITRE DU FAIT MARQUANT…" />
                    <Field value={theme.body} onChange={v => updTheme(i, "body", v)}
                      className="text-slate-400 text-xs" placeholder="Description courte et impact marché…" />
                  </div>
                  <button onClick={() => upd({ themes: state.themes.filter((_, j) => j !== i) })}
                    className="no-print opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-400 shrink-0 self-start mt-0.5">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              <button onClick={() => upd({ themes: [...state.themes, { title: "", body: "" }] })}
                className="no-print flex items-center gap-1 text-[10px] text-slate-700 hover:text-sky-400 mt-1">
                <Plus size={10} /> Ajouter un fait marquant
              </button>
            </div>
          </div>

          {/* Données drivers en bas */}
          {drivers && (
            <div className="mt-8 pt-4 border-t border-white/[0.05] grid grid-cols-4 gap-3">
              {[
                { l: "VIX",    v: drivers.vix?.toFixed(1),       s: drivers.vix != null && drivers.vix > 25 ? "⚠" : "" },
                { l: "DXY",    v: (drivers as {dxy?:number|null}).dxy?.toFixed(2) },
                { l: "Brent",  v: drivers.brent ? `$${drivers.brent.toFixed(1)}` : null },
                { l: "US 10Y", v: drivers.us10y ? `${drivers.us10y.toFixed(2)}%` : null },
              ].map(({ l, v, s }) => (
                <div key={l} className="flex items-center justify-between p-2 rounded-md bg-white/[0.03]">
                  <span className="text-slate-600 text-[10px]">{l}</span>
                  <span className="text-slate-300 text-[11px] font-semibold tabular-nums">{v ?? "—"} {s}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── PAGE 2–3 : ANALYSES DEVISES ─────────────────────────────────── */}
        <div className="report-page bg-[#080c14] min-h-[297mm] p-10 space-y-6">

          {/* En-tête section */}
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-sky-500/30" />
            <h2 className="text-sky-400 text-xs font-bold uppercase tracking-[0.3em]">Actualité G10 · Analyses Devises</h2>
            <div className="h-px flex-1 bg-sky-500/30" />
          </div>

          {/* Grille 2 colonnes */}
          <div className="grid grid-cols-2 gap-4">
            {sorted.map(ccy => {
              const meta  = CURRENCY_META[ccy as keyof typeof CURRENCY_META];
              const entry = state.currencies[ccy];
              const n     = parseFloat(entry?.pct ?? "0");
              const col   = n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-slate-500";
              const borderCol = n > 0 ? "border-emerald-500/30" : n < 0 ? "border-red-500/30" : "border-slate-700";

              return (
                <div key={ccy} className={`flex flex-col gap-3 p-4 rounded-xl bg-[#0f1623] border ${borderCol}`}>
                  {/* Header devise */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl leading-none">{meta?.flag}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-black text-sm">{ccy}</span>
                          <div className="no-print">
                            <Field value={entry?.pct ?? ""} onChange={v => updCcy(ccy, "pct", v)}
                              className={`font-mono font-bold text-sm w-16 ${col}`} placeholder="±0.0%" />
                          </div>
                          <span className={`print-only font-mono font-bold text-sm ${col}`}>
                            {isNaN(n) ? entry?.pct : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`}
                          </span>
                        </div>
                        <span className="text-slate-600 text-[10px]">
                          {meta?.flag && ccy}
                          {cotHistory?.tff?.[ccy as keyof typeof cotHistory.tff]?.[0]?.net != null && (
                            <span className="ml-2">
                              COT {(cotHistory.tff[ccy as keyof typeof cotHistory.tff]?.[0]?.net ?? 0) > 0 ? "▲" : "▼"}
                              {" "}{((cotHistory.tff[ccy as keyof typeof cotHistory.tff]?.[0]?.net ?? 0) / 1000).toFixed(1)}k
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <AiButton
                      ccy={ccy}
                      weekFrom={state.weekFrom}
                      weekTo={state.weekTo}
                      pct={entry?.pct ?? "—"}
                      cotHistory={cotHistory}
                      onResult={v => updCcy(ccy, "analysis", v)}
                    />
                  </div>

                  {/* Analyse */}
                  <Field value={entry?.analysis ?? ""} onChange={v => updCcy(ccy, "analysis", v)}
                    multiline
                    className="text-slate-300 text-xs leading-relaxed"
                    placeholder={`Analyse ${ccy} — cliquer ✨ pour générer avec l'IA, ou rédiger manuellement…`} />

                  {/* Niveau clé */}
                  <div className="flex items-center gap-2 pt-1 border-t border-white/[0.05]">
                    <span className="text-slate-600 text-[10px] shrink-0">Niveau clé :</span>
                    <Field value={entry?.level ?? ""} onChange={v => updCcy(ccy, "level", v)}
                      className="text-sky-400 text-[11px] font-mono" placeholder="ex: 1.1700 résistance…" />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-slate-700 text-[9px] text-center pt-4">{state.weekLabel} · {state.author}</p>
        </div>

        {/* ── PAGE 3 : GRAPHIQUES TRADINGVIEW ─────────────────────────────── */}
        {showCharts && (
          <div className="report-page bg-[#080c14] min-h-[297mm] p-10 space-y-6">

            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-sky-500/30" />
              <h2 className="text-sky-400 text-xs font-bold uppercase tracking-[0.3em]">Vue d&apos;ensemble · Marchés Globaux</h2>
              <div className="h-px flex-1 bg-sky-500/30" />
            </div>

            {/* Macro overview : S&P, VIX, DXY, Or — bougies interactives avec outils de dessin */}
            <div className="grid grid-cols-2 gap-4">
              <TvAdvancedChart symbol="SP:SPX"   label="S&P 500"          interval="D" height={750} />
              <TvAdvancedChart symbol="TVC:VIX"  label="VIX"              interval="D" height={750} />
              <TvAdvancedChart symbol="TVC:DXY"  label="DXY Dollar Index" interval="W" height={750} />
              <TvAdvancedChart symbol="TVC:GOLD" label="Or (XAU/USD)"     interval="W" height={750} />
            </div>

            <div className="flex items-center gap-4 pt-2">
              <div className="h-px flex-1 bg-sky-500/30" />
              <h2 className="text-sky-400 text-xs font-bold uppercase tracking-[0.3em]">Currency Charts · G10 Weekly</h2>
              <div className="h-px flex-1 bg-sky-500/30" />
            </div>

            {/* 8 currency charts — bougie hebdomadaire */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { sym: "TVC:DXY",      label: "🇺🇸 USD · DXY" },
                { sym: "FX:EURUSD",    label: "🇪🇺 EUR/USD" },
                { sym: "FX:GBPUSD",    label: "🇬🇧 GBP/USD" },
                { sym: "FX:USDJPY",    label: "🇯🇵 USD/JPY" },
                { sym: "FX:USDCHF",    label: "🇨🇭 USD/CHF" },
                { sym: "FX:USDCAD",    label: "🇨🇦 USD/CAD" },
                { sym: "FX:AUDUSD",    label: "🇦🇺 AUD/USD" },
                { sym: "FX:NZDUSD",    label: "🇳🇿 NZD/USD" },
              ].map(({ sym, label }) => (
                <TvAdvancedChart key={sym} symbol={sym} label={label} interval="W" height={160} />
              ))}
            </div>

            <p className="text-slate-700 text-[9px] text-center pt-2">
              {state.weekLabel} · {state.author} · Sources TradingView
            </p>
          </div>
        )}

        {/* ── PAGE 4 : CALENDRIER + NOTES ─────────────────────────────────── */}
        {calDays.length > 0 && (
          <div className="report-page bg-[#080c14] min-h-[297mm] p-10 space-y-5">

            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-sky-500/30" />
              <h2 className="text-sky-400 text-xs font-bold uppercase tracking-[0.3em]">Calendrier Économique · Semaine à Venir</h2>
              <div className="h-px flex-1 bg-sky-500/30" />
            </div>

            {calDays.map(day => (
              <div key={day} className="space-y-1">
                <div className="flex items-center gap-2 py-1">
                  <div className="w-1 h-4 rounded-full bg-sky-500" />
                  <span className="text-sky-300 text-[11px] font-bold uppercase tracking-wider">
                    {new Date(day + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                  </span>
                </div>
                <div className="ml-3 rounded-lg overflow-hidden border border-white/[0.05]">
                  <table className="w-full">
                    <tbody>
                      {calByDay[day].map(ev => {
                        const time  = new Date(ev.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                        const dot   = ev.impact === "high" ? "bg-red-500" : ev.impact === "medium" ? "bg-amber-400" : "bg-slate-600";
                        const meta  = CURRENCY_META[ev.currency as keyof typeof CURRENCY_META];
                        return (
                          <tr key={ev.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                            <td className="py-1.5 px-3 text-[11px] text-slate-500 tabular-nums w-14">{time}</td>
                            <td className="py-1.5 px-2 w-12">
                              <span className="text-xs font-bold text-slate-300">{meta?.flag} {ev.currency}</span>
                            </td>
                            <td className="py-1.5 px-2 w-5 text-center">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
                            </td>
                            <td className="py-1.5 px-2 text-[11px] text-slate-300">{ev.title}</td>
                            <td className="py-1.5 px-3 text-[10px] text-slate-500 text-right tabular-nums">{ev.previous ?? "—"}</td>
                            <td className="py-1.5 px-3 text-[10px] text-sky-400 text-right font-medium tabular-nums">{ev.forecast ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* Notes éditables */}
            <div className="mt-4 p-4 rounded-xl bg-[#0f1623] border border-white/[0.05] space-y-2">
              <p className="text-sky-400 text-[10px] font-bold uppercase tracking-wider">Points d&apos;attention pour la semaine à venir</p>
              <Field value={state.notes} onChange={v => upd({ notes: v })} multiline
                className="text-slate-300 text-xs leading-relaxed"
                placeholder="Thèmes clés, banques centrales à surveiller, niveaux importants, risques géopolitiques…" />
            </div>

            <p className="text-slate-700 text-[9px] text-center pt-4">{state.weekLabel} · {state.author}</p>
          </div>
        )}
      </div>

      {/* ── CSS print ─────────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          body > * { visibility: hidden !important; }
          .report-root, .report-root * { visibility: visible !important; }
          .report-root { position: fixed; inset: 0; overflow: visible; }
          .no-print { display: none !important; }
          .report-page { page-break-after: always; min-height: 100vh; }
          @page { size: A4; margin: 0; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          input, textarea { border: none !important; padding: 0 !important; }
        }
        .print-only { display: none; }
        @media print { .print-only { display: inline !important; } }
      `}</style>
    </div>
  );
}
