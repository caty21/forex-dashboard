export type Currency = "USD" | "EUR" | "GBP" | "JPY" | "CHF" | "CAD" | "AUD" | "NZD";

export type BiasPhase = "tightening" | "hawkish_pause" | "easing" | "dovish_pause" | "transition";

export interface Indicator {
  value: number | null;
  prev: number | null;
  consensus: number | null;
  surprise: number | null;
  trend: "up" | "down" | "flat" | null;
  lastUpdated: string;
}

export interface RateExpectation {
  cb: string;
  bps: number;
  prob_pct: number;
  prob_desc: string;
  direction: "cut" | "hike";
}

export interface CurrencyIndicators {
  policyRate: Indicator;
  cpiCore: Indicator;
  pmiMfg: Indicator;
  pmiServices: Indicator;
  gdp: Indicator;
  retailSales: Indicator;
  unemployment: Indicator;
  employment: Indicator;
}

export interface COTData {
  netContracts: number;
  deltaWoW: number;
  percentile52w: number;
  signal: "bullish" | "bearish" | "contrarian_bullish" | "contrarian_bearish" | "neutral";
  history: { weekEnding: string; net: number }[];
}

export interface RetailSentimentPair {
  pair: string;
  longPct: number;
  shortPct: number;
  change24h: number;
  source: string;
  signal: "contrarian_bearish" | "contrarian_bullish" | "neutral";
}

export interface STIRData {
  instrument: string;
  impliedRates: { tenor: string; rate: number }[];
  cutsHikes12M: number;
  deltaWoW: number;
  signal: "bullish" | "bearish" | "neutral";
  lastUpdated: string;
}

export interface Bond10YData {
  yield: number;
  deltaWoW_bps: number;
  spreadVsUST_bps: number | null;
  deltaSpreadWoW_bps: number | null;
  inverted: boolean;
  signal: "bullish" | "bearish" | "neutral";
  lastUpdated: string;
}

export interface DivergenceEvent {
  type: string;
  intensity: 1 | 2 | 3;
  detectedAt: string;
  persisting: boolean;
  persistingDays: number;
}

export interface CurrencyData {
  currency: Currency;
  name: string;
  flag: string;
  centralBank: string;
  phase: BiasPhase;
  indicators: CurrencyIndicators;
  score: {
    macro: number;
    drivers: number;
    divergence: number;
  };
  cot: COTData | null;
  retailSentiment: {
    pairs: RetailSentimentPair[];
    aggregatedLongPct: number;
    aggregatedSignal: RetailSentimentPair["signal"];
  } | null;
  stir: STIRData | null;
  bond10Y: Bond10YData | null;
  divergences: {
    score: number;
    active: DivergenceEvent[];
  };
  rateExpectations: RateExpectation | null;
  lastUpdated: string;
}

export interface DriverData {
  // Sentiment / Risk-On
  vix:            number | null;
  vixDelta:       number | null;   // pts vs séance précédente
  sp500:          number | null;   // prix SPY (ETF S&P 500)
  sp500Change:    number | null;   // pts vs clôture j-1
  sp500ChangePct: number | null;   // % vs clôture j-1
  btc:            number | null;   // BTC/USD
  btcChange24h:   number | null;   // % variation 24h (legacy)
  btcDeltaPct:    number | null;   // % vs clôture J-1 (Business Insider)
  // Crédit
  hySpread: number | null;
  igSpread: number | null;
  // Taux & FX
  dxy:        number | null;
  dxyDelta:   number | null;   // pts vs clôture précédente (Yahoo Finance DX=F)
  us10y:      number | null;
  us2y:       number | null;
  curveSlope: number | null;
  // Commodités (avec delta vs session précédente)
  gold:           number | null;
  goldDelta:      number | null;
  goldDeltaPct:   number | null;
  silver:         number | null;
  silverDelta:    number | null;
  silverDeltaPct: number | null;
  brent:          number | null;
  brentDelta:     number | null;
  brentDeltaPct:  number | null;
  wti:         number | null;
  wtiDelta:    number | null;
  wtiDeltaPct: number | null;
  // Compat
  copper: number | null;
}

export interface FXRates {
  [pair: string]: number;
  timestamp: number;
}

export interface SentimentPair {
  name:     string;   // ex: "EURUSD"
  longPct:  number;   // % retail long SUR LA PAIRE (pas la devise)
  shortPct: number;
  longIsBaseLong: boolean; // si true, long paire = long devise affichée
}

export interface SentimentEntry {
  longPct:  number;   // agrégé pondéré (gardé pour les signaux existants)
  shortPct: number;
  pair:     string;
  pairs:    SentimentPair[];  // données brutes paire par paire
}

export type MacroSection = "all" | "inflation" | "pmi" | "employment" | "gdp" | "policy";

export interface CotEntry {
  // HF — Leveraged Money (hedge funds / CTAs — spéculation directionnelle)
  net:           number;   // longs - shorts
  hfLongs:       number;   // contrats long bruts
  hfShorts:      number;   // contrats short bruts
  longPct:       number;   // % longs / total HF
  shortPct:      number;   // % shorts / total HF
  totalLev:      number;   // total contrats HF
  // AM — Asset Manager (fonds pension / souverains — hedging institutionnel)
  amNet:         number;
  amLongs:       number;
  amShorts:      number;
  amLongPct:     number;   // % longs / total AM
  amTotal:       number;
  // NC — Non-Commercial Legacy (grands spéculateurs — rapport COT classique CFTC)
  ncNet:         number;
  ncLongs:       number;
  ncShorts:      number;
  ncLongPct:     number;   // % longs / total NC
  ncTotal:       number;
  // Δ semaine précédente (null si pas de données J-7)
  netDelta:      number | null;   // Δ net HF
  longsDelta:    number | null;   // Δ longs HF
  shortsDelta:   number | null;   // Δ shorts HF
  amNetDelta:    number | null;   // Δ net AM
  amLongsDelta:  number | null;   // Δ longs AM
  amShortsDelta: number | null;   // Δ shorts AM
  ncNetDelta:    number | null;   // Δ net NC
  ncLongsDelta:  number | null;   // Δ longs NC
  ncShortsDelta: number | null;   // Δ shorts NC
  // Métadonnées
  weekDate:      string;
  prevWeekDate:  string | null;
}
