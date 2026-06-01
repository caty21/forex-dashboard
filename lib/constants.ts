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
  policyRate:    string | null;
  cpiCore:       string | null;  // CPI core (hors alim+énergie si dispo) → YoY
  cpiHeadline:   string | null;  // CPI headline (tous articles) → MoM (série différente de cpiCore !)
  gdp:           string | null;
  retailSales:   string | null;
  unemployment:  string | null;
  employment:    string | null;
}> = {
  USD: {
    policyRate:   "FEDFUNDS",
    cpiCore:      "CPILFESL",          // Core CPI (less food+energy) → YoY%
    cpiHeadline:  "CPIAUCSL",          // Headline CPI All Items SA → MoM% (série différente !)
    gdp:          "GDPC1",
    retailSales:  "USASLRTTO01GPSAM",
    unemployment: "UNRATE",
    employment:   "PAYEMS",
  },
  EUR: {
    policyRate:   "ECBDFR",
    cpiCore:      "CP0000EZCCM086NEST", // HICP total → YoY%
    cpiHeadline:  null,                  // → Eurostat HICP (mêmes obs, MoM calculé)
    gdp:          null,
    retailSales:  "DEUSLRTTO01GPSAM",
    unemployment: null,
    employment:   null,
  },
  GBP: {
    policyRate:   null,
    cpiCore:      "GBRCPIALLMINMEI",   // Headline All Items → YoY (pas de série core mensuelle)
    cpiHeadline:  "GBRCPIALLMINMEI",   // Même série : headline → MoM depuis mêmes obs
    gdp:          "NGDPRSAXDCGBQ",
    retailSales:  "GBRSLRTTO01GPSAM",
    unemployment: "LRHUTTTTGBM156S",
    employment:   null,
  },
  JPY: {
    policyRate:   "IR3TIB01JPM156N",
    cpiCore:      null,                  // DBnomics M.JP.PCPI_IX → YoY
    cpiHeadline:  null,                  // DBnomics M.JP.PCPI_IX → MoM (mêmes obs)
    gdp:          "JPNRGDPEXP",
    retailSales:  "JPNSLRTTO01GPSAM",
    unemployment: "LRHUTTTTJPM156S",
    employment:   "LFEMTTTTJPM647S",
  },
  CHF: {
    policyRate:   "IR3TIB01CHM156N",
    cpiCore:      "CHECPICORMINMEI",   // Core CPI → YoY
    cpiHeadline:  "CHECPIALLMINMEI",   // Headline CPI → MoM (si absent sur FRED → fallback core MoM)
    gdp:          "CHNGDPNQDSMEI",
    retailSales:  "CHESLRTTO01GPSAM",
    unemployment: "LRHUTTTTCHQ156S",
    employment:   null,
  },
  CAD: {
    policyRate:   "IR3TIB01CAM156N",
    cpiCore:      "CANCPICORMINMEI",   // Core CPI → YoY
    cpiHeadline:  "CANCPIALLMINMEI",   // Headline CPI → MoM (si absent → fallback core MoM)
    gdp:          "NGDPRSAXDCCAQ",
    retailSales:  "CANSLRTTO01GPSAM",
    unemployment: "LRHUTTTTCAM156S",
    employment:   "LFEMTTTTCAM647S",
  },
  AUD: {
    policyRate:   "IR3TIB01AUM156N",
    cpiCore:      "AUSCPIALLQINMEI",   // trimestriel → YoY
    cpiHeadline:  "AUSCPIALLQINMEI",   // même série trimestrielle → QoQ (pas de MoM mensuel AUS)
    gdp:          "NGDPRSAXDCAUQ",
    retailSales:  null,
    unemployment: "LRHUTTTTAUM156S",
    employment:   "LFEMTTTTAUM647S",
  },
  NZD: {
    policyRate:   "IR3TIB01NZM156N",
    cpiCore:      "NZLCPIALLQINMEI",   // trimestriel → YoY
    cpiHeadline:  "NZLCPIALLQINMEI",   // même série trimestrielle → QoQ
    gdp:          "NAEXKP01NZQ657S",
    retailSales:  null,
    unemployment: "LRUNTTTTNZQ156S",
    employment:   "LFEMTTTTNZQ647S",
  },
};

// ── Profils pays : énergie et matières premières ──────────────────────────────
// Données structurelles stables (mise à jour ~annuelle)
// energy: position nette pétrole/gaz du pays vis-à-vis du monde
// commodities: principales exportations de matières premières (impact forex notable)
export interface CountryProfile {
  energy:          "exporter" | "importer" | "neutral";
  energyNote:      string;   // description courte (tooltip)
  commodities:     string[]; // matières clés en cas de choc prix
}

export const COUNTRY_PROFILES: Record<Currency, CountryProfile> = {
  USD: {
    energy:      "exporter",
    energyNote:  "1er producteur mondial pétrole + gaz (EIA). Exportateur net depuis 2019.",
    commodities: ["Pétrole", "GNL", "Blé", "Soja", "Maïs"],
  },
  EUR: {
    energy:      "importer",
    energyNote:  "Import ~55% énergie (MENA, Russie réduit). Très sensible aux chocs pétrole.",
    commodities: ["Blé (FR, DE)", "Machines industrielles"],
  },
  GBP: {
    energy:      "neutral",
    energyNote:  "Mer du Nord en déclin. Production ≈ consommation (~neutre).",
    commodities: ["Services financiers"],
  },
  JPY: {
    energy:      "importer",
    energyNote:  "Import ~90% énergie. 3ème importateur GNL mondial. Très sensible Détroit d'Hormuz.",
    commodities: [],
  },
  CHF: {
    energy:      "importer",
    energyNote:  "Import ~75% énergie (gaz naturel Europe, pétrole OPEP).",
    commodities: [],
  },
  CAD: {
    energy:      "exporter",
    energyNote:  "3ème réserves mondiales pétrole (sables bitumineux Alberta). Export ~4 Mb/j.",
    commodities: ["Pétrole", "Gaz naturel", "Blé", "Potasse", "Bois d'œuvre"],
  },
  AUD: {
    energy:      "exporter",
    energyNote:  "2ème exportateur GNL mondial. Export charbon thermique + métallurgique.",
    commodities: ["Minerai de fer", "GNL", "Charbon", "Or", "Blé", "Cuivre"],
  },
  NZD: {
    energy:      "importer",
    energyNote:  "Import pétrole. Renouvelables ~85% électricité (hydro), indépendant localement.",
    commodities: ["Lait / Produits laitiers", "Viande bovine", "Bois", "Laine"],
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
