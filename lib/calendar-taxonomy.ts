// lib/calendar-taxonomy.ts
// Règles de tri du fourre-tout "other" du calendrier économique, décidées avec
// l'utilisateur devise par devise (session du 2026-07-08) :
//   - Confiance/sentiment, immobilier (prix uniquement), M3 (EUR uniquement),
//     commerce extérieur détaillé, Fed régionale (Philly uniquement), flux de
//     portefeuille étrangers, finances publiques, jours fériés → catégories
//     dédiées (visibles, triables séparément).
//   - Adjudications obligataires, production industrielle, énergie hebdo US,
//     hypothécaires hebdo US, CPI infranational, réunions institutionnelles
//     sans chiffre → exclus du calendrier (bruit, cf. décisions utilisateur).
// Tout le reste (non couvert par une règle ci-dessous) continue d'apparaître
// sous "other" / "Autre".

import type { EventCategory } from "@/app/api/calendar/route";

const SENTIMENT_RE = /\bifo\b|\bzew\b|\bgfk\b|consumer confidence|business confidence|business climate|economic sentiment|\bsentix\b|westpac consumer confidence|anz.*consumer confidence|anz business confidence|anz activity outlook|nab business confidence|cbi business optimism|cbi distributive trades|cbi industrial trends|eco watchers survey|reuters tankan/i;

const HOUSING_PRICE_RE = /house price|housing price|nationwide housing|case-shiller|rightmove|rics house price|cotality dwelling|residential property price/i;

const MONEY_SUPPLY_RE = /m3 money supply/i;

const TRADE_DETAIL_RE = /^exports?\b|^imports?\b|export price|import price/i;

const REGIONAL_FED_RE = /philly fed|philadelphia fed/i;

const PORTFOLIO_FLOWS_RE = /tic flows|net capital flows|foreign bond investment|stock investment by foreigners|cftc \w+ nc net positions/i;

const PUBLIC_FINANCE_RE = /budget balance|monthly budget statement|public sector net borrowing/i;

const HOLIDAY_RE = /\bholiday\b|\b(independence|canada|marine|labor|labour|thanksgiving|christmas|boxing|memorial|veterans|presidents?|columbus|mlk|good friday|easter monday)\s+day\b/i;

// ── Exclusions (bruit écarté du calendrier, décision utilisateur) ────────────

const AUCTION_RE = /\bauction\b|\btender\b|conventional gilt|index-linked gilt/i;
const INDUSTRIAL_PROD_RE = /industrial production|industrial output|manufacturing production|capacity utilization|tertiary industry index/i;
const US_ENERGY_WEEKLY_RE = /\beia\b|\bapi\b crude|baker hughes|crude oil stock|natural gas stock|gasoline stock|distillate|heating oil stock|refinery crude/i;
const US_MORTGAGE_WEEKLY_RE = /\bmba\b|mortgage application|mortgage market index|mortgage refinance index|mba purchase index/i;
const SUBNATIONAL_CPI_RE = /baden wuerttemberg cpi|bavaria cpi|brandenburg cpi|hesse cpi|north rhine westphalia cpi|saxony cpi|tokyo cpi|tokyo core cpi/i;
const INSTITUTIONAL_MEETING_RE = /ecofin meeting|eurogroup meeting|iea oil market report|wasde report|nopa crush report/i;

export function classifyOtherTitle(title: string): EventCategory {
  if (SENTIMENT_RE.test(title))       return "sentiment";
  if (HOUSING_PRICE_RE.test(title))   return "housing";
  if (MONEY_SUPPLY_RE.test(title))    return "money_supply";
  if (TRADE_DETAIL_RE.test(title))    return "trade_detail";
  if (REGIONAL_FED_RE.test(title))    return "regional_fed";
  if (PORTFOLIO_FLOWS_RE.test(title)) return "portfolio_flows";
  if (PUBLIC_FINANCE_RE.test(title))  return "public_finance";
  if (HOLIDAY_RE.test(title))         return "holiday";
  return "other";
}

export function isExcludedEventTitle(title: string): boolean {
  return (
    AUCTION_RE.test(title) ||
    INDUSTRIAL_PROD_RE.test(title) ||
    US_ENERGY_WEEKLY_RE.test(title) ||
    US_MORTGAGE_WEEKLY_RE.test(title) ||
    SUBNATIONAL_CPI_RE.test(title) ||
    INSTITUTIONAL_MEETING_RE.test(title)
  );
}

// ── Plancher d'impact (demande explicite : PPI, Trade Balance, Construction PMI
// ne doivent jamais rester masqués par le filtre "Impact faible" par défaut) ──
// TE/investingLive taggent souvent ces indicateurs "low" par pays (surtout hors
// USD), ce qui les cache dans le calendrier tant que la case "Impact faible"
// n'est pas cochée. On relève le plancher à "medium" sans jamais rétrograder
// un impact déjà "high" décidé par la source (ex. PPI MoM US, Balance of Trade JP).

const IMPACT_FLOOR_RE = /construction pmi|\bppi\b|producer price|balance of trade|trade balance|goods trade balance|foreign trade balance/i;

export function applyImpactFloor(
  title: string,
  impact: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  if (impact === "low" && IMPACT_FLOOR_RE.test(title)) return "medium";
  return impact;
}
