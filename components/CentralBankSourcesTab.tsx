"use client";

import React, { useEffect, useState } from "react";
import { Loader2, ExternalLink, FileText, RefreshCw } from "lucide-react";
import {
  ScatterChart, Scatter, ZAxis, LineChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import type { CBGovernance } from "@/app/api/central-bank-sources/route";

const CCY_ISO: Record<string, string> = {
  USD: "us", EUR: "eu", GBP: "gb", JPY: "jp",
  CHF: "ch", CAD: "ca", AUD: "au", NZD: "nz",
};

const ORDER = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];

function Flag({ ccy }: { ccy: string }) {
  return (
    <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 bg-slate-700">
      <img
        src={`https://flagcdn.com/w40/${CCY_ISO[ccy] ?? ccy.slice(0, 2).toLowerCase()}.png`}
        width={24} height={24} alt={ccy} className="w-full h-full object-cover"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    </div>
  );
}

// ── Dot plot Fed : scatter (année × taux, taille = nb de participants) ────────

function FedDotPlotChart({ dotPlot }: { dotPlot: NonNullable<CBGovernance["dotPlot"]> }) {
  const yearIndex = new Map(dotPlot.years.map((y, i) => [y, i]));
  const scatterData = dotPlot.dots.map(d => ({ x: yearIndex.get(d.year) ?? 0, y: d.rate, z: d.count, year: d.year }));
  const medianData = dotPlot.years.map((y, i) => ({ x: i, y: dotPlot.medianByYear[y] }));

  const allRates = dotPlot.dots.map(d => d.rate);
  const minY = Math.min(...allRates, ...Object.values(dotPlot.medianByYear)) - 0.2;
  const maxY = Math.max(...allRates, ...Object.values(dotPlot.medianByYear)) + 0.2;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ScatterChart margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
        <XAxis
          type="number" dataKey="x" domain={[-0.5, dotPlot.years.length - 0.5]}
          ticks={dotPlot.years.map((_, i) => i)}
          tickFormatter={(i: number) => dotPlot.years[i] ?? ""}
          tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false}
        />
        <YAxis
          type="number" dataKey="y" domain={[minY, maxY]}
          tickFormatter={(v: number) => `${v.toFixed(1)}%`}
          tick={{ fontSize: 8, fill: "#64748b" }} axisLine={false} tickLine={false} width={34}
        />
        <ZAxis type="number" dataKey="z" range={[20, 260]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as { year: string; y: number; z: number } | undefined;
            if (!p) return null;
            return (
              <div style={{ background: "rgba(8,14,28,0.97)", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 10px" }}>
                <p style={{ color: "#94a3b8", fontSize: 9, margin: 0 }}>{p.year} · {p.y.toFixed(3)}%</p>
                <p style={{ color: "#f59e0b", fontSize: 9, margin: 0, fontWeight: 700 }}>{p.z} participant{p.z > 1 ? "s" : ""}</p>
              </div>
            );
          }}
        />
        <Scatter data={scatterData} fill="#f59e0b" fillOpacity={0.65} />
        <Scatter data={medianData} fill="#38bdf8" shape="diamond" legendType="none" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── Évolution : médiane "année courante" + "long terme" au fil des SEP ────────

function FedEvolutionChart({ dotPlot }: { dotPlot: NonNullable<CBGovernance["dotPlot"]> }) {
  const data = dotPlot.history.map(h => {
    const entries = Object.entries(h.medianByYear);
    const nearTerm = entries.find(([y]) => y !== "Longer run")?.[1] ?? null;
    const longRun = h.medianByYear["Longer run"] ?? null;
    return { date: h.date.slice(2, 7), nearTerm, longRun };
  });

  return (
    <ResponsiveContainer width="100%" height={110}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 7, fill: "#475569" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 7, fill: "#475569" }} axisLine={false} tickLine={false} width={30} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
        <Tooltip
          content={({ label, payload }) => {
            if (!payload?.length) return null;
            const items = payload as { dataKey: string; value: number }[];
            return (
              <div style={{ background: "rgba(8,14,28,0.97)", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 10px" }}>
                <p style={{ color: "#475569", fontSize: 8, margin: "0 0 4px" }}>{label}</p>
                {items.map(it => (
                  <p key={it.dataKey} style={{ color: it.dataKey === "longRun" ? "#38bdf8" : "#f59e0b", fontSize: 9, margin: 0, fontWeight: 700 }}>
                    {it.dataKey === "longRun" ? "Long terme" : "Année courante"} : {it.value.toFixed(2)}%
                  </p>
                ))}
              </div>
            );
          }}
        />
        <Line type="monotone" dataKey="nearTerm" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2.5, fill: "#1e293b", stroke: "#f59e0b" }} />
        <Line type="monotone" dataKey="longRun" stroke="#38bdf8" strokeWidth={1.5} dot={{ r: 2.5, fill: "#1e293b", stroke: "#38bdf8" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Prévisions macro (comment la BC voit sa propre économie) ──────────────────
// PIB + inflation par échéance, publiées par la BC elle-même (SEP Fed,
// Eurosystem staff projections, BoJ Outlook Report, MPR BoC, SMP RBA…).

function fmtForecastYear(y: string): string {
  const m = y.match(/^(\d{4})-(\d{2})$/);
  if (!m) return y;
  const MONTH: Record<string, string> = { "06": "Jun", "12": "Dec" };
  return `${MONTH[m[2]] ?? m[2]}’${m[1].slice(2)}`;
}

function ForecastBlock({ forecast }: { forecast: NonNullable<CBGovernance["forecast"]> }) {
  const years = forecast.years;
  const hasGdp = Object.values(forecast.gdp).some(v => v != null);
  const hasInfl = Object.values(forecast.inflation).some(v => v != null);
  if (!years.length || (!hasGdp && !hasInfl)) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[9px] text-slate-600 uppercase tracking-wide">Prévisions — comment la BC voit son économie</p>
      <div className="bg-slate-900/60 rounded-lg px-3 py-2.5 overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr>
              <th className="text-left text-slate-600 font-normal pb-1"> </th>
              {years.map(y => (
                <th key={y} className="text-right text-slate-500 font-medium pb-1 pl-2.5 tabular-nums whitespace-nowrap">{fmtForecastYear(y)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasGdp && (
              <tr>
                <td className="text-slate-400 pr-2 py-0.5 whitespace-nowrap">PIB</td>
                {years.map(y => {
                  const v = forecast.gdp[y];
                  return (
                    <td key={y} className="text-right text-slate-200 font-semibold tabular-nums pl-2.5 whitespace-nowrap">
                      {v != null ? `${v > 0 ? "+" : ""}${v}%` : "—"}
                    </td>
                  );
                })}
              </tr>
            )}
            {hasInfl && (
              <tr>
                <td className="text-slate-400 pr-2 py-0.5 whitespace-nowrap">Inflation</td>
                {years.map(y => {
                  const v = forecast.inflation[y];
                  return (
                    <td key={y} className="text-right text-amber-400 font-semibold tabular-nums pl-2.5 whitespace-nowrap">
                      {v != null ? `${v > 0 ? "+" : ""}${v}%` : "—"}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[8px] text-slate-700 leading-snug">
        {forecast.label} · publié {forecast.asOf}
        {forecast.isProxy && forecast.proxyLabel ? ` · ${forecast.proxyLabel}` : ""}
      </p>
    </div>
  );
}

// ── Carte banque centrale ──────────────────────────────────────────────────────

function CBCard({ g }: { g: CBGovernance }) {
  const hasVote = g.voteSummary !== null;
  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
        <Flag ccy={g.currency} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-200 truncate">{g.bankName}</h3>
          <p className="text-[10px] text-slate-600">{g.countryLabel} · {g.currency}</p>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {hasVote ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] text-slate-600 uppercase tracking-wide">Dernière réunion</p>
                <p className="text-xs text-slate-300 font-medium">{g.meetingDate ?? "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-slate-600 uppercase tracking-wide">Taux</p>
                <p className="text-sm text-amber-400 font-bold tabular-nums">{g.rateLevel ?? "—"}</p>
              </div>
            </div>

            <div className="bg-slate-900/60 rounded-lg px-3 py-2.5">
              <p className="text-[9px] text-slate-600 uppercase tracking-wide mb-1">Vote</p>
              <p className="text-lg font-black text-slate-100 tabular-nums">{g.voteSummary}</p>
              {g.voteDetail && (
                <p className="text-[10px] text-slate-500 mt-1 leading-snug">{g.voteDetail}</p>
              )}
            </div>

            {g.dotPlot && (
              <div className="space-y-2">
                <p className="text-[9px] text-slate-600 uppercase tracking-wide">Dot plot — projections des membres</p>
                <FedDotPlotChart dotPlot={g.dotPlot} />
                <p className="text-[9px] text-slate-600 uppercase tracking-wide">Évolution (dernières publications SEP)</p>
                <FedEvolutionChart dotPlot={g.dotPlot} />
                <div className="flex items-center gap-3 text-[8px] text-slate-600">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Année courante</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-400 inline-block" /> Long terme</span>
                </div>
              </div>
            )}

            {g.forecast && <ForecastBlock forecast={g.forecast} />}
          </>
        ) : (
          <div className="bg-slate-900/60 rounded-lg px-3 py-3 text-center">
            <p className="text-[11px] text-slate-500">
              {g.fetchError === "Scraping non encore implémenté pour cette banque"
                ? "Vote / rapport non encore automatisés pour cette banque"
                : `Données indisponibles (${g.fetchError ?? "erreur"})`}
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {g.reportPdfUrl && (
            <a
              href={g.reportPdfUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md px-2 py-1.5 transition-colors"
            >
              <FileText size={11} /> Rapport PDF
            </a>
          )}
          <a
            href={g.policyPageUrl} target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md px-2 py-1.5 transition-colors"
          >
            <ExternalLink size={11} /> Site officiel
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Onglet principal ────────────────────────────────────────────────────────────

export default function CentralBankSourcesTab() {
  const [data, setData]       = useState<Record<string, CBGovernance> | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/central-bank-sources", { cache: "no-store" });
      const json = await res.json();
      setData(json.data);
      setFetchedAt(json.fetchedAt);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Sources banques centrales</h2>
          <p className="text-[10px] text-slate-600 mt-0.5">
            Vote de la dernière réunion · dot plot (Fed) · rapport de politique monétaire · site officiel
          </p>
        </div>
        <div className="flex items-center gap-2">
          {fetchedAt && <span className="text-[9px] text-slate-600">MAJ {new Date(fetchedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-600 rounded-md px-2 py-1 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Rafraîchir
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-slate-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
          {ORDER.map(ccy => {
            const g = data?.[ccy];
            return g ? <CBCard key={ccy} g={g} /> : null;
          })}
        </div>
      )}
    </div>
  );
}
