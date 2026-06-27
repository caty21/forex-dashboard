"use client";

import { useEffect, useRef, useId } from "react";

// Déclaration globale TradingView (chargé via script)
declare global {
  interface Window {
    TradingView?: {
      MiniSymbolOverview: new (config: Record<string, unknown>) => void;
      widget: new (config: Record<string, unknown>) => void;
    };
  }
}

interface TvMiniChartProps {
  symbol:     string;   // ex: "FX:EURUSD", "TVC:DXY", "SP:SPX"
  label?:     string;   // titre affiché au-dessus
  interval?:  "W" | "D" | "M";
  dateRange?: string;   // "1D","5D","1M","3M","6M","12M","60M","ALL","YTD"
  height?:    number;
  showInfo?:  boolean;  // afficher nom + prix sous le graphique
}

// Script TradingView chargé une seule fois
let scriptLoaded = false;
let scriptLoading = false;
const onLoadCallbacks: (() => void)[] = [];

function loadTvScript(cb: () => void) {
  if (scriptLoaded) { cb(); return; }
  onLoadCallbacks.push(cb);
  if (scriptLoading) return;
  scriptLoading = true;
  const s = document.createElement("script");
  s.src   = "https://s3.tradingview.com/tv.js";
  s.async = true;
  s.onload = () => {
    scriptLoaded = true;
    onLoadCallbacks.forEach(f => f());
    onLoadCallbacks.length = 0;
  };
  document.head.appendChild(s);
}

export function TvMiniChart({ symbol, label, dateRange = "1M", height = 180, showInfo = true }: TvMiniChartProps) {
  const uid  = useId().replace(/:/g, "_");
  const id   = `tv_mini_${uid}`;
  const ref  = useRef<HTMLDivElement>(null);
  const init = useRef(false);

  useEffect(() => {
    if (init.current) return;
    init.current = true;

    loadTvScript(() => {
      if (!window.TradingView || !ref.current) return;
      try {
        new window.TradingView.MiniSymbolOverview({
          symbol,
          container_id:         id,
          width:                "100%",
          height,
          locale:               "fr",
          dateRange,
          colorTheme:           "dark",
          trendLineColor:       "#38bdf8",
          underLineColor:       "rgba(56,189,248,0.08)",
          underLineBottomColor: "rgba(56,189,248,0)",
          isTransparent:        true,
          autosize:             false,
          largeChartUrl:        "",
          noTimeScale:          false,
          chartOnly:            !showInfo,
        });
      } catch { /* TradingView indisponible */ }
    });
  }, []); // eslint-disable-line

  return (
    <div className="flex flex-col gap-1">
      {label && <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</p>}
      <div
        ref={ref}
        id={id}
        className="rounded-lg overflow-hidden bg-[#0f1623]"
        style={{ height }}
      />
    </div>
  );
}

// ── Vue avancée plein format (pour la page graphiques) ──────────────────────

interface TvAdvancedChartProps {
  symbol:   string;
  label?:   string;
  interval?: string;
  height?:  number;
}

export function TvAdvancedChart({ symbol, label, interval = "W", height = 250 }: TvAdvancedChartProps) {
  const uid = useId().replace(/:/g, "_");
  const id  = `tv_adv_${uid}`;
  const ref = useRef<HTMLDivElement>(null);
  const init = useRef(false);

  useEffect(() => {
    if (init.current) return;
    init.current = true;

    loadTvScript(() => {
      if (!window.TradingView || !ref.current) return;
      try {
        new window.TradingView.widget({
          autosize:         false,
          width:            "100%",
          height,
          symbol,
          interval,
          timezone:         "Europe/Paris",
          theme:            "dark",
          style:            "1",
          locale:           "fr",
          toolbar_bg:       "#0f1623",
          enable_publishing: false,
          hide_top_toolbar:  true,
          hide_legend:       false,
          save_image:        false,
          container_id:     id,
          backgroundColor:  "rgba(8,12,20,0)",
          gridColor:        "rgba(30,45,61,0.5)",
          hide_volume:      false,
          studies:          [],
        });
      } catch { /* TradingView indisponible */ }
    });
  }, []); // eslint-disable-line

  return (
    <div className="flex flex-col gap-1">
      {label && <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</p>}
      <div
        ref={ref}
        id={id}
        className="rounded-lg overflow-hidden bg-[#0f1623] border border-white/[0.05]"
        style={{ height }}
      />
    </div>
  );
}
