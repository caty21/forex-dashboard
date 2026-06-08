"use client";

import { useState } from "react";
import {
  ComposedChart, Bar, Cell, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import type { Currency } from "@/lib/types";
import type { CotWeek, CotHistory } from "@/app/api/cot-history/route";
import { CURRENCY_META } from "@/lib/constants";

interface Props {
  history: CotHistory | null;
  loading: boolean;
}

const CURRENCIES: Currency[] = ["EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "USD"];

function formatNet(n: number): string {
  const abs  = Math.abs(n);
  const sign = n >= 0 ? "+" : "-";
  return abs >= 1000 ? `${sign}${(abs / 1000).toFixed(1)}k` : `${sign}${abs}`;
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────
function Sparkline({ weeks }: { weeks: CotWeek[] }) {
  const pts = [...weeks].reverse().slice(-8);
  if (pts.length < 2) return <div className="w-16 h-6 text-slate-700 text-[10px] flex items-center">—</div>;

  const vals  = pts.map(w => w.net);
  const min   = Math.min(...vals);
  const max   = Math.max(...vals);
  const range = max - min || 1;
  const W = 64, H = 24, PAD = 2;

  const points = vals.map((v, i) => {
    const x = PAD + (i / (vals.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(" ");

  const latest = vals[vals.length - 1];
  const color  = latest >= 0 ? "#10b981" : "#ef4444";
  const lastX  = PAD + (W - PAD * 2);
  const lastY  = H - PAD - ((latest - min) / range) * (H - PAD * 2);

  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
      {min < 0 && max > 0 && (
        <line
          x1={PAD} x2={W - PAD}
          y1={H - PAD - ((0 - min) / range) * (H - PAD * 2)}
          y2={H - PAD - ((0 - min) / range) * (H - PAD * 2)}
          stroke="#475569" strokeWidth={0.5} strokeDasharray="2 2"
        />
      )}
    </svg>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const net      = payload.find(p => p.name === "net")?.value ?? 0;
  const longPct  = payload.find(p => p.name === "longPct")?.value ?? 0;
  const deltaNet = payload.find(p => p.name === "deltaNet")?.value;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs shadow-xl space-y-0.5">
      <p className="text-slate-400 font-medium">{label}</p>
      <p className={`font-bold ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>Net : {formatNet(net)}</p>
      <p className="text-slate-300">{longPct}% L / {100 - longPct}% S</p>
      {deltaNet !== undefined && deltaNet !== null && (
        <p className={`text-[11px] ${deltaNet > 0 ? "text-emerald-400" : deltaNet < 0 ? "text-red-400" : "text-slate-500"}`}>
          Δ semaine : {formatNet(deltaNet)}
        </p>
      )}
    </div>
  );
}

// ── Carte devise ──────────────────────────────────────────────────────────────
function CurrencyCard({ ccy, weeks, selected, onClick }: {
  ccy: Currency; weeks: CotWeek[]; selected: boolean; onClick: () => void;
}) {
  const latest = weeks[0];
  const d      = latest?.deltaNet ?? null;
  const meta   = CURRENCY_META[ccy];
  const bias   = latest ? (latest.longPct > 60 ? "bull" : latest.shortPct > 60 ? "bear" : "neu") : "neu";

  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-1.5 p-3 rounded-xl border transition-all text-left w-full ${
        selected
          ? "bg-slate-800/80 border-amber-500/50"
          : "bg-slate-900/50 border-slate-800 hover:border-slate-600"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-white">{meta?.flag} {ccy}</span>
        {d !== null ? (
          <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${
            d > 0 ? "text-emerald-400" : d < 0 ? "text-red-400" : "text-slate-500"
          }`}>
            {d > 0 ? <TrendingUp size={10} /> : d < 0 ? <TrendingDown size={10} /> : <Minus size={10} />}
            {formatNet(d)}
          </span>
        ) : <span className="text-[10px] text-slate-600">—</span>}
      </div>

      <Sparkline weeks={weeks} />

      {latest && (
        <div className="flex items-center justify-between">
          <span className={`text-[11px] font-semibold ${
            bias === "bull" ? "text-emerald-400" : bias === "bear" ? "text-red-400" : "text-slate-400"
          }`}>
            {formatNet(latest.net)}
          </span>
          <span className="text-[10px] text-slate-500">{latest.longPct}%L</span>
        </div>
      )}

      <div className="flex justify-center">
        {selected
          ? <ChevronUp size={12} className="text-amber-400" />
          : <ChevronDown size={12} className="text-slate-700" />}
      </div>
    </button>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function CotTab({ history, loading }: Props) {
  const [selected, setSelected] = useState<Currency | null>(null);
  const [mode,     setMode]     = useState<"tff" | "legacy">("tff");

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Chargement historique COT…</div>;
  }
  if (!history || (!Object.keys(history.tff ?? {}).length && !Object.keys(history.legacy ?? {}).length)) {
    return <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Données COT indisponibles</div>;
  }

  const dataset    = history[mode] ?? {};
  const latestDate = (dataset.EUR ?? dataset.GBP ?? [])[0]?.weekDate ?? "";

  const handleSelect = (ccy: Currency) => setSelected(prev => prev === ccy ? null : ccy);

  const selWeeks  = selected ? (dataset[selected] ?? []) : [];
  const chartData = [...selWeeks].reverse().map(w => ({
    label:    w.weekDate.slice(5),
    net:      w.net,
    longPct:  w.longPct,
    deltaNet: w.deltaNet,
    fill:     w.net >= 0 ? "#10b981" : "#ef4444",
  }));

  const w0 = selWeeks[0];
  const d  = w0?.deltaNet ?? null;

  const MODE_LABELS = {
    tff:    { label: "Hedge Funds (TFF)",       desc: "Leveraged Money — gestionnaires spéculatifs, fonds macro" },
    legacy: { label: "Non-Commercial (Legacy)",  desc: "Tous spéculateurs — traders non-commerciaux (méthode classique depuis 1986)" },
  };

  return (
    <div className="space-y-3">
      {/* En-tête + toggle */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">COT · CFTC</h2>
          {latestDate && <span className="text-[11px] text-amber-400/80">Semaine du {latestDate}</span>}
        </div>

        {/* Toggle TFF / Legacy */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
          {(["tff", "legacy"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${
                mode === m
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {MODE_LABELS[m].label}
            </button>
          ))}
        </div>
      </div>

      {/* Description du mode */}
      <p className="text-[11px] text-slate-600">{MODE_LABELS[mode].desc}</p>

      {/* Grille 8 cartes */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {CURRENCIES.map(ccy => (
          <CurrencyCard
            key={ccy}
            ccy={ccy}
            weeks={dataset[ccy] ?? []}
            selected={selected === ccy}
            onClick={() => handleSelect(ccy)}
          />
        ))}
      </div>

      {/* Panneau détail */}
      {selected && chartData.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
          {/* Résumé */}
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-sm font-bold text-white">
              {CURRENCY_META[selected]?.flag} {selected}
            </span>
            {w0 && (
              <span className={`text-xs font-semibold ${w0.net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {formatNet(w0.net)} net · {w0.longPct}%L / {w0.shortPct}%S
              </span>
            )}
            {d !== null && (
              <span className={`text-xs ${d > 0 ? "text-emerald-400" : d < 0 ? "text-red-400" : "text-slate-500"}`}>
                {d > 0 ? "▲" : "▼"} {formatNet(Math.abs(d))} Δ sem.
              </span>
            )}
            {w0?.deltaLong !== null && w0?.deltaLong !== undefined && (
              <span className="text-[11px] text-slate-500">
                +L {formatNet(w0.deltaLong)} / +S {formatNet(w0.deltaShort ?? 0)}
              </span>
            )}
            <span className="text-xs text-slate-600">{selWeeks.length} semaines</span>
          </div>

          {/* Chart */}
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#334155" }} interval="preserveStartEnd" />
              <YAxis yAxisId="net" orientation="left" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} width={36} />
              <YAxis yAxisId="pct" orientation="right" domain={[0,100]} tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} tickFormatter={v=>`${v}%`} width={30} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine yAxisId="net" y={0} stroke="#475569" strokeWidth={1} />
              <Bar yAxisId="net" dataKey="net" name="net" radius={[2,2,0,0]} maxBarSize={24} isAnimationActive={false}>
                {chartData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
              <Line yAxisId="pct" type="monotone" dataKey="longPct" name="longPct" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Tableau 6 dernières semaines avec deltas */}
          <table className="w-full text-[11px] text-slate-400">
            <thead>
              <tr className="border-b border-slate-800 text-slate-600">
                <th className="text-left pb-1">Semaine</th>
                <th className="text-right pb-1">Net</th>
                <th className="text-right pb-1">Δ Net</th>
                <th className="text-right pb-1">Δ Longs</th>
                <th className="text-right pb-1">Δ Shorts</th>
                <th className="text-right pb-1">%L</th>
              </tr>
            </thead>
            <tbody>
              {selWeeks.slice(0, 6).map((w, i) => (
                <tr key={w.weekDate} className={`border-b border-slate-800/40 ${i === 0 ? "text-white" : ""}`}>
                  <td className="py-1">{w.weekDate}</td>
                  <td className={`text-right font-medium ${w.net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {formatNet(w.net)}
                  </td>
                  <td className={`text-right text-[10px] ${
                    w.deltaNet === null ? "text-slate-600"
                    : w.deltaNet > 0 ? "text-emerald-400"
                    : w.deltaNet < 0 ? "text-red-400"
                    : "text-slate-500"
                  }`}>
                    {w.deltaNet !== null ? formatNet(w.deltaNet) : "—"}
                  </td>
                  <td className={`text-right text-[10px] ${
                    !w.deltaLong ? "text-slate-600" : w.deltaLong > 0 ? "text-emerald-400" : "text-red-400"
                  }`}>
                    {w.deltaLong !== null && w.deltaLong !== undefined ? formatNet(w.deltaLong) : "—"}
                  </td>
                  <td className={`text-right text-[10px] ${
                    !w.deltaShort ? "text-slate-600" : w.deltaShort > 0 ? "text-red-400" : "text-emerald-400"
                  }`}>
                    {w.deltaShort !== null && w.deltaShort !== undefined ? formatNet(w.deltaShort) : "—"}
                  </td>
                  <td className="text-right text-emerald-400">{w.longPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
