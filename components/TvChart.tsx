"use client";

import { useEffect, useRef } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────────
// Chaque instance obtient un identifiant unique injecté dans l'URL du script
// pour forcer le navigateur à ré-exécuter le script même si l'URL est en cache.
// Sans ça, les 4 charts simultanés du tab Marchés ne s'initialisent pas tous.

function mkInstanceId() {
  return Math.random().toString(36).slice(2);
}

// ── Structure DOM commune attendue par les widgets embed TradingView ──────────
//   <div class="tradingview-widget-container">          ← wrapperRef
//     <div class="tradingview-widget-container__widget"></div>
//     <script src="embed-widget-*.js?t=INSTANCE_ID">{config JSON}</script>
//   </div>

function mountEmbedWidget(
  wrapper: HTMLDivElement,
  scriptSrc: string,
  config: Record<string, unknown>,
  height: number
) {
  wrapper.innerHTML = "";

  const widgetDiv = document.createElement("div");
  widgetDiv.className = "tradingview-widget-container__widget";
  widgetDiv.style.width  = "100%";
  widgetDiv.style.height = `${height}px`;
  wrapper.appendChild(widgetDiv);

  const script = document.createElement("script");
  script.type  = "text/javascript";
  script.async = false; // false = exécution ordonnée → document.currentScript correctement défini
  script.src   = scriptSrc;
  script.text  = JSON.stringify(config);
  wrapper.appendChild(script);
}

// ── TvAdvancedChart ───────────────────────────────────────────────────────────
// Graphique avancé (bougies) via embed-widget-advanced-chart.js.
// Utilise une iframe TradingView → accès aux mêmes symboles que le site web
// (SP:SPX, TVC:VIX, TVC:DXY, TVC:GOLD, etc.) sans restriction "abonnement".

interface TvAdvancedChartProps {
  symbol:    string;   // ex: "SP:SPX", "TVC:DXY", "FX:EURUSD"
  label?:    string;
  interval?: string;   // "D", "W", "M", "60", etc.
  height?:   number;
}

export function TvAdvancedChart({
  symbol,
  label,
  interval = "D",
  height   = 250,
}: TvAdvancedChartProps) {
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const instanceId  = useRef(mkInstanceId());

  useEffect(() => {
    if (initialized.current || !wrapperRef.current) return;
    initialized.current = true;

    mountEmbedWidget(
      wrapperRef.current,
      `https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js?t=${instanceId.current}`,
      {
        autosize:             false,
        width:                "100%",
        height,
        symbol,
        interval,
        timezone:             "Europe/Paris",
        theme:                "dark",
        style:                "1",       // bougies japonaises
        locale:               "fr",
        backgroundColor:      "rgba(8,12,20,0)",
        gridColor:            "rgba(30,45,61,0.5)",
        hide_top_toolbar:     false,
        hide_legend:          false,
        allow_symbol_change:  false,
        calendar:             false,
        hide_volume:          true,
        isTransparent:        true,
        save_image:           true,
        drawings_access:      { type: "all", tools: [{ name: "Regression Trend" }] },
      },
      height
    );

    return () => {
      if (wrapperRef.current) wrapperRef.current.innerHTML = "";
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

// ── TvMiniChart ───────────────────────────────────────────────────────────────
// Graphique léger (ligne/area) via embed-widget-mini-symbol-overview.js.
// Idéal pour les aperçus compacts (CurrencyCard, sidebar, etc.).

interface TvMiniChartProps {
  symbol:     string;
  label?:     string;
  dateRange?: string;   // "1D","5D","1M","3M","6M","12M","60M","ALL","YTD"
  height?:    number;
  showInfo?:  boolean;
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
  const instanceId  = useRef(mkInstanceId());

  useEffect(() => {
    if (initialized.current || !wrapperRef.current) return;
    initialized.current = true;

    mountEmbedWidget(
      wrapperRef.current,
      `https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js?t=${instanceId.current}`,
      {
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
      },
      height
    );

    return () => {
      if (wrapperRef.current) wrapperRef.current.innerHTML = "";
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
