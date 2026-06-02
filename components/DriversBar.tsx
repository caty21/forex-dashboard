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

function D({ label, value, dec = 2, unit = "", delta, deltaPct, deltaDec, tooltip }: {
  label:     string;
  value:     number | null;
  dec?:      number;
  unit?:     string;
  delta?:    number | null;
  deltaPct?: boolean;
  deltaDec?: number;
  tooltip?:  string;
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

  return (
    <>
      <div
        ref={ref}
        onMouseEnter={tooltip ? show : undefined}
        onMouseLeave={tooltip ? hide : undefined}
        className={`flex items-center gap-1.5 shrink-0 ${tooltip ? "cursor-help" : ""}`}
      >
        <span className="text-slate-500 text-[11px]">{label}</span>
        <span className="text-slate-100 font-semibold tabular-nums text-[11px]">
          {fmt(value, dec, unit)}
        </span>
        {dFmt && (
          <span className={`text-[10px] font-medium tabular-nums ${dColor}`}>
            {dArrow}{dFmt}
          </span>
        )}
        {tooltip && (
          <span className="w-3 h-3 rounded-full border border-slate-700 text-slate-600 text-[7px] flex items-center justify-center leading-none select-none shrink-0">
            i
          </span>
        )}
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

function VSep() {
  return <div className="w-px h-3.5 bg-slate-700/60 shrink-0 mx-0.5" />;
}

export default function DriversBar({ drivers }: Props) {
  const {
    vix, vixDelta,
    sp500, sp500ChangePct,
    btc, btcChange24h,
    hySpread, igSpread,
    us10y, us2y, curveSlope,
    gold, goldDelta,
    silver, silverDelta,
    brent, brentDelta,
    wti, wtiDelta,
  } = drivers;

  const dxy      = (drivers as DriverData & { dxy?: number | null }).dxy       ?? null;
  const dxyDelta = (drivers as DriverData & { dxyDelta?: number | null }).dxyDelta ?? null;
  const riskOff  = (vix ?? 0) > 25 || (hySpread ?? 0) > 500;

  return (
    <div className="mb-4 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 flex items-center gap-4 overflow-x-auto scrollbar-hide">

      <span className="text-slate-500 font-semibold uppercase tracking-widest text-[10px] shrink-0">
        DRIVERS GLOBAUX
      </span>

      {riskOff && (
        <div className="flex items-center gap-1 shrink-0 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5">
          <AlertTriangle size={10} className="text-red-400" />
          <span className="text-[9px] font-semibold text-red-400">Risk-Off</span>
        </div>
      )}

      <VSep />

      {/* Sentiment / Risk-On */}
      <D label="VIX" value={vix} dec={1} delta={vixDelta} deltaDec={1}
        tooltip="Clôture actuelle − clôture précédente (Yahoo Finance)." />
      <D label="S&P 500" value={sp500} dec={0} delta={sp500ChangePct} deltaPct deltaDec={2}
        tooltip="% vs clôture précédente (Yahoo Finance)." />
      <D label="Bitcoin" value={btc} dec={0} unit=" $" delta={btcChange24h} deltaPct deltaDec={2}
        tooltip="Variation 24h (Binance / CoinGecko)." />

      <VSep />

      {/* Crédit */}
      <D label="HY Spread" value={hySpread} dec={0} unit=" bps"
        tooltip="High Yield spread vs Treasuries US. >500 bps = risk-off fort." />
      <D label="IG Spread" value={igSpread} dec={0} unit=" bps"
        tooltip="Investment Grade spread vs Treasuries US." />

      <VSep />

      {/* Taux & FX */}
      <D label="DXY" value={dxy} dec={2} delta={dxyDelta} deltaDec={2}
        tooltip="ICE Dollar Index Futures (DX=F) — Yahoo Finance, cache 5 min." />
      <D
        label="Crb 2-10" value={curveSlope} dec={0} unit=" bps"
        tooltip={`Spread US 10Y − US 2Y. Négatif = courbe inversée.\nUS 10Y: ${us10y != null ? us10y.toFixed(2) + "%" : "N/A"} | US 2Y: ${us2y != null ? us2y.toFixed(2) + "%" : "N/A"}`}
      />

      <VSep />

      {/* Commodités */}
      <D label="Or $/oz" value={gold} dec={0} delta={goldDelta} deltaDec={1}
        tooltip="Delta intraday close−open (Stooq)." />
      <D label="Argent $/oz" value={silver} dec={2} delta={silverDelta}
        tooltip="Delta intraday close−open (Stooq)." />
      <D label="Brent $/b" value={brent} dec={1} delta={brentDelta} deltaDec={1}
        tooltip="Delta intraday close−open (Stooq)." />
      <D label="WTI $/b" value={wti} dec={1} delta={wtiDelta} deltaDec={1}
        tooltip="Delta intraday close−open (Stooq)." />

    </div>
  );
}
