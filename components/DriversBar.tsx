"use client";

import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import type { DriverData } from "@/lib/types";

interface Props { drivers: DriverData }

function fmt(v: number | null, dec: number, unit = "") {
  if (v === null) return "—";
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}${unit}`;
}

interface TooltipState { x: number; y: number }

function Tile({ label, value, dec = 2, unit = "", delta, deltaPct, deltaDec, tooltip, accent }: {
  label:     string;
  value:     number | null;
  dec?:      number;
  unit?:     string;
  delta?:    number | null;
  deltaPct?: boolean;
  deltaDec?: number;
  tooltip?:  string;
  accent?:   "red" | "green" | "amber";
}) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  const pos    = delta != null && delta > 0;
  const neg    = delta != null && delta < 0;
  const dColor = pos ? "text-emerald-400" : neg ? "text-red-400" : "text-slate-500";
  const dArrow = pos ? "▲" : neg ? "▼" : "";
  const dFmt   = delta != null
    ? `${Math.abs(delta).toFixed(deltaDec ?? dec)}${deltaPct ? "%" : ""}`
    : null;

  const borderCls = accent === "red"   ? "border-red-500/30 bg-red-500/5"
                  : accent === "green" ? "border-emerald-500/30 bg-emerald-500/5"
                  : accent === "amber" ? "border-amber-500/30 bg-amber-500/5"
                  : "border-slate-800/60 bg-slate-900/40";

  return (
    <>
      <div
        ref={ref}
        onMouseEnter={tooltip ? show : undefined}
        onMouseLeave={tooltip ? hide : undefined}
        className={`flex flex-col gap-0.5 px-3 py-2 rounded-lg border ${borderCls} ${tooltip ? "cursor-help" : ""} min-w-[72px]`}
      >
        <span className="text-slate-500 text-[10px] font-medium leading-none">{label}</span>
        <div className="flex items-baseline gap-1">
          <span className="text-slate-100 font-bold tabular-nums text-[13px] leading-none">
            {fmt(value, dec, unit)}
          </span>
          {dFmt && (
            <span className={`text-[10px] font-medium tabular-nums leading-none ${dColor}`}>
              {dArrow}{dFmt}
            </span>
          )}
        </div>
      </div>

      {tip && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[9999] bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded-lg px-3 py-2 w-60 leading-snug shadow-xl pointer-events-none whitespace-pre-line"
          style={{ left: tip.x, top: tip.y - 8, transform: "translate(-50%, -100%)" }}
        >
          {tooltip}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
        </div>,
        document.body,
      )}
    </>
  );
}

function GroupLabel({ label }: { label: string }) {
  return (
    <span className="text-slate-600 text-[9px] font-semibold uppercase tracking-widest self-center shrink-0 hidden sm:block">
      {label}
    </span>
  );
}

export default function DriversBar({ drivers }: Props) {
  const {
    vix, vixDelta,
    sp500, sp500ChangePct,
    btc, btcDeltaPct, btcChange24h,
    hySpread, igSpread,
    us10y, us2y, curveSlope,
    gold, goldDeltaPct,
    silver, silverDeltaPct,
    brent, brentDelta, brentDeltaPct,
    wti, wtiDelta, wtiDeltaPct,
  } = drivers;

  const riskOff = (vix ?? 0) > 25 || (hySpread ?? 0) > 500;

  return (
    <div className="mb-4 bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-2">

      {/* Ligne titre + alerte */}
      <div className="flex items-center justify-between">
        <span className="text-slate-500 font-semibold uppercase tracking-widest text-[10px]">
          Drivers Globaux
        </span>
        {riskOff && (
          <div className="flex items-center gap-1 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">
            <AlertTriangle size={10} className="text-red-400" />
            <span className="text-[9px] font-semibold text-red-400">Risk-Off</span>
          </div>
        )}
      </div>

      {/* Grille responsive — 2 lignes sur desktop, s'adapte sur mobile */}
      <div className="flex flex-wrap gap-2">

        {/* ── Sentiment ─────────────────────────────────────────── */}
        <GroupLabel label="Sentiment" />
        <Tile label="VIX" value={vix} dec={1} delta={vixDelta} deltaDec={1}
          accent={(vix ?? 0) > 25 ? "red" : undefined}
          tooltip="Clôture actuelle − clôture précédente (Yahoo Finance)." />
        <Tile label="S&P 500" value={sp500} dec={0} delta={sp500ChangePct} deltaPct deltaDec={2}
          tooltip="% vs clôture J-1 (Business Insider, cache 1 min). Fallback : Yahoo Finance." />
        <Tile label="BTC/USD" value={btc} dec={0} unit=" $"
          delta={btcDeltaPct ?? btcChange24h} deltaPct deltaDec={2}
          tooltip="% vs clôture J-1 (investing.com, cache 1 min). Fallback : Binance/CoinGecko 24h." />

        {/* ── Crédit ────────────────────────────────────────────── */}
        <div className="w-px bg-slate-800 self-stretch mx-0.5 hidden sm:block" />
        <GroupLabel label="Crédit" />
        <Tile label="HY Spread" value={hySpread} dec={0} unit=" bps"
          accent={(hySpread ?? 0) > 500 ? "red" : (hySpread ?? 0) > 400 ? "amber" : undefined}
          tooltip="High Yield spread vs Treasuries US. >500 bps = risk-off fort." />
        <Tile label="IG Spread" value={igSpread} dec={0} unit=" bps"
          tooltip="Investment Grade spread vs Treasuries US." />

        {/* ── Taux ──────────────────────────────────────────────── */}
        <div className="w-px bg-slate-800 self-stretch mx-0.5 hidden sm:block" />
        <GroupLabel label="Taux" />
        <Tile
          label="Crb 2-10" value={curveSlope} dec={0} unit=" bps"
          accent={(curveSlope ?? 0) < -50 ? "amber" : undefined}
          tooltip={`Spread US 10Y − US 2Y. Négatif = courbe inversée.\nUS 10Y: ${us10y != null ? us10y.toFixed(2) + "%" : "N/A"} | US 2Y: ${us2y != null ? us2y.toFixed(2) + "%" : "N/A"}`}
        />

        {/* ── Commodités ────────────────────────────────────────── */}
        <div className="w-px bg-slate-800 self-stretch mx-0.5 hidden sm:block" />
        <GroupLabel label="Commodités" />
        <Tile label="Or $/oz" value={gold} dec={0}
          delta={goldDeltaPct} deltaPct deltaDec={2}
          tooltip="% vs clôture J-1 (Business Insider, cache 1 min). Fallback : Yahoo GC=F." />
        <Tile label="Argent $/oz" value={silver} dec={2}
          delta={silverDeltaPct} deltaPct deltaDec={2}
          tooltip="% vs clôture J-1 (Business Insider, cache 1 min). Fallback : Yahoo SI=F." />
        <Tile label="Brent $/b" value={brent} dec={1}
          delta={brentDeltaPct ?? brentDelta} deltaPct={brentDeltaPct !== null} deltaDec={2}
          tooltip={`% évolution vs clôture J-1 (abcbourse.com — Six Financial Information, temps réel).${brentDelta != null ? `\nDelta: ${brentDelta > 0 ? "+" : ""}${brentDelta.toFixed(2)} $` : ""}`} />
        <Tile label="WTI $/b" value={wti} dec={1}
          delta={wtiDeltaPct ?? wtiDelta} deltaPct={wtiDeltaPct !== null} deltaDec={2}
          tooltip={`% évolution vs clôture J-1 (Business Insider, cache 1 min). Fallback : Yahoo Finance CL=F.${wtiDelta != null ? `\nDelta: ${wtiDelta > 0 ? "+" : ""}${wtiDelta.toFixed(2)} $` : ""}`} />

      </div>
    </div>
  );
}
