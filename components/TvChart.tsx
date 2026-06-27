"use client";

import { useEffect, useRef } from "react";

// ── TvMiniChart ───────────────────────────────────────────────────────────────
// Utilise le script embed TradingView dédié (embed-widget-mini-symbol-overview.js)
// et NON pas tv.js (qui n'expose pas MiniSymbolOverview).
// La structure DOM attendue par TradingView :
//   <div class="tradingview-widget-container">        ← wrapper
//     <div class="tradingview-widget-container__widget"></div>
//     <script src="embed-widget-mini-symbol-overview.js">{config}</script>
//   </div>

interface TvMiniChartProps {
  symbol:     string;   // ex: "SP:SPX", "TVC:DXY", "FX:EURUSD"
  label?:     string;   // titre affiché au-dessus
  interval?:  "W" | "D" | "M";
  dateRange?: string;   // "1D","5D","1M","3M","6M","12M","60M","ALL","YTD"
  height?:    number;
  showInfo?:  boolean;  // afficher nom + prix sous le graphique
}

export function TvMiniChart({
  symbol,
  label,
  dateRange = "1M",
  height    = 180,
  showInfo  = true,
}: TvMiniChartProps) {
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !wrapperRef.current) return;
    initialized.current = true;

    const wrapper = wrapperRef.current;
    wrapper.innerHTML = "";

    // Div cible du widget
    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    wrapper.appendChild(widgetDiv);

    // Script embed avec config inline (textContent lu par le script au chargement)
    const script = document.createElement("script");
    script.type  = "text/javascript";
    script.async = true;
    script.src   = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
    script.text  = JSON.stringify({
      symbol,
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
    wrapper.appendChild(script);

    return () => {
      wrapper.innerHTML   = "";
      initialized.current = false;
    };
  }, []); // eslint-disable-line

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
          {label}
        </p>
      )}
      <div
        ref={wrapperRef}
        className="tradingview-widget-container rounded-lg overflow-hidden bg-[#0f1623]"
        style={{ height }}
      />
    </div>
  );
}

// ── TvAdvancedChart ───────────────────────────────────────────────────────────
// Graphique avancé plein format via tv.js (TradingView.widget).
// Note : certains symboles affichent une popup "disponible uniquement sur TradingView".

declare global {
  interface Window {
    TradingView?: {
      widget: new (config: Record<string, unknown>) => void;
    };
  }
}

let tvScriptLoaded  = false;
let tvScriptLoading = false;
const tvCallbacks: (() => void)[] = [];

function loadTvScript(cb: () => void) {
  if (tvScriptLoaded) { cb(); return; }
  tvCallbacks.push(cb);
  if (tvScriptLoading) return;
  tvScriptLoading = true;
  const s = document.createElement("script");
  s.src   = "https://s3.tradingview.com/tv.js";
  s.async = true;
  s.onload = () => {
    tvScriptLoaded = true;
    tvCallbacks.forEach(f => f());
    tvCallbacks.length = 0;
  };
  document.head.appendChild(s);
}

interface TvAdvancedChartProps {
  symbol:    string;
  label?:    string;
  interval?: string;
  height?:   number;
}

export function TvAdvancedChart({
  symbol,
  label,
  interval = "W",
  height   = 250,
}: TvAdvancedChartProps) {
  const uid  = useRef(`tv_adv_${Math.random().toString(36).slice(2)}`);
  const ref  = useRef<HTMLDivElement>(null);
  const init = useRef(false);

  useEffect(() => {
    if (init.current) return;
    init.current = true;

    loadTvScript(() => {
      if (!window.TradingView || !ref.current) return;
      try {
        new window.TradingView.widget({
          autosize:          false,
          width:             "100%",
          height,
          symbol,
          interval,
          timezone:          "Europe/Paris",
          theme:             "dark",
          style:             "1",
          locale:            "fr",
          toolbar_bg:        "#0f1623",
          enable_publishing: false,
          hide_top_toolbar:  true,
          hide_legend:       false,
          save_image:        false,
          container_id:      uid.current,
          backgroundColor:   "rgba(8,12,20,0)",
          gridColor:         "rgba(30,45,61,0.5)",
          hide_volume:       false,
          studies:           [],
        });
      } catch { /* TradingView indisponible */ }
    });
  }, []); // eslint-disable-line

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
          {label}
        </p>
      )}
      <div
        ref={ref}
        id={uid.current}
        className="rounded-lg overflow-hidden bg-[#0f1623] border border-white/[0.05]"
        style={{ height }}
      />
    </div>
  );
}
