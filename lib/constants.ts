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

// FRED series IDs — corrections audit 2026-05-28
// null = série inexistante sur FRED → source alternative dans /api/macro
//
// Retail Sales : séries GPSAM (déjà en MoM%, ne pas convertir)
//   Format : {PAYS3}SLRTTO01GPSAM (OECD monthly retail trade, % growth prev. period, SA)
//   EUR utilise l'Allemagne comme proxy (plus grande économie, données mensuelles récentes)
// Employment : séries LFEMTTTT*647S (niveaux en milliers → MoM% calculé localement)
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
    cpiCore:      "CPILFESL",          // indice niveau → MoM%
    gdp:          "GDPC1",             // indice niveau → QoQ%
    retailSales:  "USASLRTTO01GPSAM", // déjà MoM% — ex-MARTSSM44W72USS (niveau)
    unemployment: "UNRATE",
    employment:   "PAYEMS",            // niveau → MoM%
  },
  EUR: {
    policyRate:   "ECBDFR",            // taux dépôt BCE
    cpiCore:      null,                 // → Eurostat dans /api/macro
    gdp:          null,                 // → Eurostat dans /api/macro
    retailSales:  "DEUSLRTTO01GPSAM", // proxy Allemagne, déjà MoM%
    unemployment: null,                 // → Eurostat dans /api/macro
    employment:   null,
  },
  GBP: {
    policyRate:   null,                 // → BoE API dans /api/macro
    cpiCore:      "GBRCPIALLMINMEI",   // indice niveau → MoM%
    gdp:          "NGDPRSAXDCGBQ",    // Real GDP UK (BEA/ONS) indice niveau → QoQ%
    retailSales:  "GBRSLRTTO01GPSAM", // déjà MoM%
    unemployment: "LRHUTTTTGBM156S",
    employment:   null,                 // pas de série mensuelle FRED pour GBP
  },
  JPY: {
    policyRate:   "IRSTCB01JPM156N",
    cpiCore:      null,                 // JPNCPIALLMINMEI stale depuis 2021 sur FRED
    gdp:          "JPNRGDPEXP",        // indice niveau → QoQ%
    retailSales:  "JPNSLRTTO01GPSAM", // déjà MoM%
    unemployment: "LRHUTTTTJPM156S",
    employment:   "LFEMTTTTJPM647S",  // niveau mensuel → MoM%
  },
  CHF: {
    policyRate:   "IRSTCB01CHM156N",
    cpiCore:      "CHECPICORMINMEI",   // indice niveau → MoM%
    gdp:          "CHNGDPNQDSMEI",     // indice niveau → QoQ% (peut être stale)
    retailSales:  "CHESLRTTO01GPSAM", // déjà MoM%
    unemployment: "LRHUTTTTCHQ156S",  // trimestriel (LRHUTTTTCHM156S n'existe pas)
    employment:   null,                 // pas de série FRED pour CHF
  },
  CAD: {
    policyRate:   "IRSTCB01CAM156N",
    cpiCore:      "CANCPICORMINMEI",   // indice niveau → MoM%
    gdp:          "NGDPRSAXDCCAQ",    // Real GDP Canada (BEA/StatCan) indice niveau → QoQ%
    retailSales:  "CANSLRTTO01GPSAM", // déjà MoM%
    unemployment: "LRHUTTTTCAM156S",
    employment:   "LFEMTTTTCAM647S",  // niveau mensuel → MoM%
  },
  AUD: {
    policyRate:   "IRSTCB01AUM156N",
    cpiCore:      "AUSCPIALLMINMEI",   // trimestriel
    gdp:          "NGDPRSAXDCAUQ",    // Real GDP Australia (ABS) indice niveau → QoQ%
    retailSales:  null,                 // pas de série mensuelle FRED pour AUD
    unemployment: "LRHUTTTTAUM156S",
    employment:   "LFEMTTTTAUM647S",  // niveau mensuel → MoM%
  },
  NZD: {
    policyRate:   "IRSTCB01NZM156N",
    cpiCore:      "NZLCPIALLMINMEI",   // trimestriel
    gdp:          "NAEXKP01NZQ661S",  // indice niveau → QoQ% (stale ~2023, best available)
    retailSales:  null,                 // pas de série mensuelle FRED pour NZD
    unemployment: "LRUNTTTTNZQ156S",
    employment:   "LFEMTTTTNZQ647S",  // niveau trimestriel → QoQ% (proxy)
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
