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
  btcChange24h:   number | null;   // % variation 24h (CoinGecko)
  // Crédit
  hySpread: number | null;
  igSpread: number | null;
  // Taux & FX
  dxy:        number | null;
  us10y:      number | null;
  us2y:       number | null;
  curveSlope: number | null;
  // Commodités (avec delta vs session précédente)
  gold:        number | null;
  goldDelta:   number | null;
  silver:      number | null;
  silverDelta: number | null;
  brent:       number | null;
  brentDelta:  number | null;
  wti:         number | null;
  wtiDelta:    number | null;
  // Compat
  copper: number | null;
}

export interface FXRates {
  [pair: string]: number;
  timestamp: number;
}
