import type { Currency } from "./types";

export const CURRENCIES: Currency[] = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];

export const CURRENCY_META: Record<Currency, { name: string; flag: string; cb: string; cbShort: string }> = {
  USD: { name: "États-Unis",    flag: "🇺🇸", cb: "Federal Reserve",  cbShort: "Fed"  },
  EUR: { name: "Zone Euro",     flag: "🇪🇺", cb: "Banque Centrale Européenne", cbShort: "BCE" },
  GBP: { name: "Royaume-Uni",  flag: "🇬🇧", cb: "Bank of England",  cbShort: "BoE"  },
  JPY: { name: "Japon",        flag: "🇯🇵", cb: "Bank of Japan",    cbShort: "BoJ"  },
  CHF: { name: "Suisse",       flag: "🇨🇭", cb: "Banque Nationale Suisse", cbShort: "BNS" },
  CAD: { name: "Canada",       flag: "🇨🇦", cb: "Bank of Canada",   cbShort: "BoC"  },
  AUD: { name: "Australie",    flag: "🇦🇺", cb: "Reserve Bank of Australia", cbShort: "RBA" },
  NZD: { name: "Nouvelle-Zélande", flag: "🇳🇿", cb: "Reserve Bank of New Zealand", cbShort: "RBNZ" },
};

// FRED series IDs — corrections audit 2026-05-26
// null = série inexistante ou stale sur FRED → source alternative dans /api/macro
export const FRED_SERIES: Record<Currency, {
  policyRate:   string | null;
  cpiCore:      string | null;
  gdp:          string | null;
  retailSales:  string | null;
  unemployment: string | null;
  employment:   string | null;
}> = {
  USD: {
    policyRate:   "FEDFUNDS",
    cpiCore:      "CPILFESL",
    gdp:          "GDPC1",
    retailSales:  "MARTSSM44W72USS",   // correction : ex-RSXFS (discontinuée)
    unemployment: "UNRATE",
    employment:   "PAYEMS",
  },
  EUR: {
    policyRate:   "ECBDFR",            // ECB deposit rate — disponible sur FRED
    cpiCore:      null,                 // CP0000EZ20M086NEST n'existe pas sur FRED → ECB API
    gdp:          null,                 // CLVMNACSCAB1GQEA20 n'existe pas sur FRED → Eurostat
    retailSales:  "SLRTTO01DEM189S",   // proxy Allemagne — OK sur FRED
    unemployment: null,                 // LRHUTTTTEZM156S arrêtée 2023 → Eurostat
    employment:   null,
  },
  GBP: {
    policyRate:   null,                 // BoE API (IUDBEDR) — séries OECD FRED stale
    cpiCore:      "GBRCPIALLMINMEI",   // OK — mars 2025
    gdp:          "CLVMNACSCAB1GQGB",
    retailSales:  "SLRTTO01GBM189S",
    unemployment: "LRHUTTTTGBM156S",
    employment:   "LNEMNACSCAB1GQGB",
  },
  JPY: {
    policyRate:   "IRSTCB01JPM156N",
    cpiCore:      "JPNCPIALLMINMEI",   // correction : JPNCPICORMINMEI arrêtée 2021 → All Items
    gdp:          "JPNRGDPEXP",
    retailSales:  null,                  // METI Japan CSV — pas sur FRED
    unemployment: "LRHUTTTTJPM156S",
    employment:   null,
  },
  CHF: {
    policyRate:   "IRSTCB01CHM156N",
    cpiCore:      "CHECPICORMINMEI",   // OK — avr 2025
    gdp:          "CHNGDPNQDSMEI",
    retailSales:  null,                  // OFS Suisse CSV
    unemployment: "LRHUTTTTCHM156S",
    employment:   null,
  },
  CAD: {
    policyRate:   "IRSTCB01CAM156N",
    cpiCore:      "CANCPICORMINMEI",   // OK — mars 2025
    gdp:          "CLVMNACSCAB1GQCA",
    retailSales:  "SLRTTO01CAM189S",
    unemployment: "LRHUTTTTCAM156S",
    employment:   null,
  },
  AUD: {
    policyRate:   "IRSTCB01AUM156N",
    cpiCore:      "AUSCPIALLMINMEI",   // trimestriel — pas d'alternative mensuelle FRED
    gdp:          "CLVMNACSCAB1GQAU",
    retailSales:  "SLRTTO01AUM189S",
    unemployment: "LRHUTTTTAUM156S",
    employment:   "LNEMNACSCAB1GQAU",
  },
  NZD: {
    policyRate:   "IRSTCB01NZM156N",
    cpiCore:      "NZLCPIALLMINMEI",   // trimestriel
    gdp:          "CLVMNACSCAB1GQNZ",
    retailSales:  null,                  // Stats NZ API trimestriel
    unemployment: "LRUNTTTTNZQ156S",   // correction : ex-LRHUTTTTNZM156S (inexistante)
    employment:   null,
  },
};

// COT CFTC contract codes per currency
export const COT_CODES: Record<Currency, string> = {
  USD: "098662",  // USD Index DX
  EUR: "099741",  // Euro FX EC
  GBP: "096742",  // British Pound BP
  JPY: "097741",  // Japanese Yen JY
  CHF: "092741",  // Swiss Franc SF
  CAD: "090741",  // Canadian Dollar CD
  AUD: "232741",  // Australian Dollar AD
  NZD: "112741",  // New Zealand Dollar NE
};

// Scoring weights per indicator (§4 CDC)
export const INDICATOR_WEIGHTS = {
  policyRate:   3,
  cpiCore:      2.5,
  pmiMfg:       1.5,
  pmiServices:  1.5,
  gdp:          2,
  retailSales:  1.5,
  unemployment: 1.5,
  employment:   2,
} as const;

// Cycle phase multipliers (§4c CDC)
export const PHASE_MULTIPLIERS: Record<string, { bull: number; bear: number }> = {
  tightening:    { bull: 1.5, bear: 1.0 },
  hawkish_pause: { bull: 1.3, bear: 1.5 },
  easing:        { bull: 1.0, bear: 1.5 },
  dovish_pause:  { bull: 1.5, bear: 1.0 },
  transition:    { bull: 1.0, bear: 1.0 },
};
