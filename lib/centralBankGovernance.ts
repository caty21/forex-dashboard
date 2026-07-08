// lib/centralBankGovernance.ts
// Données de gouvernance des banques centrales : vote de la dernière réunion,
// lien vers le dernier rapport de politique monétaire (PDF), lien vers le site
// officiel, et pour la Fed le dot plot (Summary of Economic Projections).
//
// Sources (HTML public, sans clé API) :
//   Fed : federalreserve.gov — statement (vote) + SEP "accessible version" (dot plot)
//   BoE : bankofengland.co.uk — Monetary Policy Summary and Minutes (vote)
// Les autres banques (ECB, BoJ, SNB, BoC, RBA, RBNZ) exposent au minimum les
// liens statiques (site officiel + dernier rapport connu) ; scraping vote/PDF
// ajouté au fur et à mesure de ce qui est effectivement accessible sans
// contournement de WAF (RBA/RBNZ bloquent tout fetch() non-navigateur).

import type { Currency } from "./types";
import rateDecisionsData from "@/data/rate_decisions.json";
import { fetchTECalendarForCountry } from "./tradingeconomics";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      next: { revalidate: 6 * 3600 },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/&minus;|&#8722;/g, "-")
    .replace(/&#8209;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Types publics ─────────────────────────────────────────────────────────────

export interface FedDotYear {
  year:  string;   // "2026" | "2027" | "2028" | "Longer run"
  median: number | null;
}

export interface FedDot {
  year:  string;
  rate:  number;
  count: number;
}

export interface FedSepHistoryPoint {
  date:         string;               // ISO de la réunion SEP
  medianByYear: Record<string, number>;
}

export interface FedDotPlot {
  asOfDate:      string;
  years:         string[];
  medianByYear:      Record<string, number>;
  prevMedianByYear:  Record<string, number> | null;
  prevLabel:         string | null;   // ex. "March projection"
  dots:              FedDot[];
  history:           FedSepHistoryPoint[]; // dernières réunions SEP, la plus récente en dernier
  gdpMedian:         Record<string, number> | null;
  pceMedian:         Record<string, number> | null;
  sepHtmlUrl:    string;
  sepPdfUrl:     string;
}

// Prévisions macro publiées par la BC elle-même (comment elle perçoit sa propre
// économie) : croissance PIB + inflation, par année. gdp/inflation sont indexés
// par année ("2026", "2027"…) → valeur en %, null si non disponible pour cette
// année précise. isProxy = valeur de substitution (ex. consensus Trading
// Economics) quand la BC elle-même n'est pas accessible en scraping (RBNZ).
export interface CBForecast {
  asOf:        string;              // date de publication de la prévision
  years:       string[];            // ordre d'affichage
  gdp:         Record<string, number | null>;
  inflation:   Record<string, number | null>;
  label:       string;              // ex. "Eurosystem staff projections — juin 2026"
  sourceUrl:   string | null;
  isProxy?:    boolean;
  proxyLabel?: string;
}

export interface CBGovernance {
  currency:        Currency;
  bankName:        string;
  countryLabel:    string;
  officialSiteUrl: string;
  policyPageUrl:   string;
  meetingDate:     string | null;
  rateLevel:       string | null;
  voteSummary:     string | null;   // "12 – 0", "7 – 2", ou "Consensus (pas de vote publié)"
  voteDetail:      string | null;
  statementUrl:    string | null;
  reportPdfUrl:    string | null;
  reportLabel:     string | null;
  dotPlot?:        FedDotPlot;
  forecast?:       CBForecast | null;
  fetchError?:     string;
}

// ── Métadonnées statiques (toujours disponibles, même si le scraping échoue) ──

export const CB_STATIC_INFO: Record<Currency, { bankName: string; countryLabel: string; officialSiteUrl: string; policyPageUrl: string }> = {
  USD: { bankName: "Federal Reserve (Fed)",       countryLabel: "États-Unis",     officialSiteUrl: "https://www.federalreserve.gov", policyPageUrl: "https://www.federalreserve.gov/monetarypolicy.htm" },
  EUR: { bankName: "Banque Centrale Européenne",  countryLabel: "Zone Euro",      officialSiteUrl: "https://www.ecb.europa.eu",       policyPageUrl: "https://www.ecb.europa.eu/press/govcdec/mopo/html/index.en.html" },
  GBP: { bankName: "Bank of England (BoE)",       countryLabel: "Royaume-Uni",    officialSiteUrl: "https://www.bankofengland.co.uk", policyPageUrl: "https://www.bankofengland.co.uk/monetary-policy" },
  JPY: { bankName: "Bank of Japan (BoJ)",         countryLabel: "Japon",          officialSiteUrl: "https://www.boj.or.jp/en",        policyPageUrl: "https://www.boj.or.jp/en/mopo/index.htm" },
  CHF: { bankName: "Swiss National Bank (SNB)",   countryLabel: "Suisse",         officialSiteUrl: "https://www.snb.ch",              policyPageUrl: "https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy" },
  CAD: { bankName: "Bank of Canada (BoC)",        countryLabel: "Canada",         officialSiteUrl: "https://www.bankofcanada.ca",     policyPageUrl: "https://www.bankofcanada.ca/core-functions/monetary-policy/" },
  AUD: { bankName: "Reserve Bank of Australia (RBA)", countryLabel: "Australie",  officialSiteUrl: "https://www.rba.gov.au",          policyPageUrl: "https://www.rba.gov.au/monetary-policy/" },
  NZD: { bankName: "Reserve Bank of New Zealand (RBNZ)", countryLabel: "Nouvelle-Zélande", officialSiteUrl: "https://www.rbnz.govt.nz", policyPageUrl: "https://www.rbnz.govt.nz/monetary-policy" },
};

function staticFallback(ccy: Currency, error: string): CBGovernance {
  const info = CB_STATIC_INFO[ccy];
  return {
    currency: ccy, ...info,
    meetingDate: null, rateLevel: null, voteSummary: null, voteDetail: null,
    statementUrl: null, reportPdfUrl: null, reportLabel: null,
    fetchError: error,
  };
}

// ── Fed (USD) ─────────────────────────────────────────────────────────────────

function parseFedFraction(s: string): number {
  const m = s.match(/^(\d+)(?:-(\d+)\/(\d+))?$/);
  if (!m) return NaN;
  const whole = parseFloat(m[1]);
  return m[2] ? whole + parseFloat(m[2]) / parseFloat(m[3]) : whole;
}

async function findLatestFedDates(): Promise<{ statementDates: string[]; sepDates: string[] } | null> {
  const html = await fetchText("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm");
  if (!html) return null;
  const todayCompact = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const statementDates = Array.from(new Set(Array.from(html.matchAll(/\/newsevents\/pressreleases\/monetary(\d{8})a\.htm/g), m => m[1])))
    .filter(d => d <= todayCompact).sort();
  const sepDates = Array.from(new Set(Array.from(html.matchAll(/\/monetarypolicy\/fomcprojtabl[e]?(\d{8})\.htm/g), m => m[1])))
    .filter(d => d <= todayCompact).sort();
  return { statementDates, sepDates };
}

async function fetchFedStatement(dateCompact: string): Promise<{ rateLevel: string; voteSummary: string; voteDetail: string | null; statementUrl: string } | null> {
  const url = `https://www.federalreserve.gov/newsevents/pressreleases/monetary${dateCompact}a.htm`;
  const html = await fetchText(url);
  if (!html) return null;
  const text = htmlToText(html);

  const rateMatch = text.match(/target range for the federal funds rate[\s\S]{0,60}?(\d+(?:-\d\/\d)?)\s*to\s*(\d+(?:-\d\/\d)?)\s*percent/i);
  const lower = rateMatch ? parseFedFraction(rateMatch[1]) : NaN;
  const upper = rateMatch ? parseFedFraction(rateMatch[2]) : NaN;
  const rateLevel = !isNaN(lower) && !isNaN(upper) ? `${lower}–${upper}%` : null;

  const voteMatch = text.match(/by a\s+(\d+)\s*[–—-]\s*(\d+)\s+vote/i);
  const voteSummary = voteMatch ? `${voteMatch[1]} – ${voteMatch[2]}` : null;

  const dissentMatch = text.match(/Voting against[^:]*:\s*([^.]+)\./i);
  const voteDetail = dissentMatch ? dissentMatch[1].trim() : null;

  if (!rateLevel || !voteSummary) return null;
  return { rateLevel, voteSummary, voteDetail, statementUrl: url };
}

// Table 1 : médiane Fed funds rate (trimestre courant + trimestre précédent, si présent)
// + médianes GDP/PCE inflation (même table, mêmes 4 colonnes années) pour le bloc
// "prévisions" générique (comment le FOMC voit sa propre économie).
function parseSepTable1(text: string): {
  years: string[]; median: Record<string, number>; prevMedian: Record<string, number> | null; prevLabel: string | null;
  gdpMedian: Record<string, number> | null; pceMedian: Record<string, number> | null;
} | null {
  // Les 3 années couvertes glissent d'une publication SEP à l'autre (ex. déc. 2025
  // couvre 2025-2028, juin 2026 couvre 2026-2028+LR) — on les lit depuis l'en-tête
  // de Table 1 plutôt que de les figer, sinon l'historique se retrouve mal étiqueté.
  const headerM = text.match(/(\d{4})\s+(\d{4})\s+(\d{4})\s+Longer run/);
  if (!headerM) return null;
  const years = [headerM[1], headerM[2], headerM[3], "Longer run"];

  const start = text.indexOf("Federal funds rate");
  if (start === -1) return null;
  const noteIdx = text.indexOf("Note:", start);
  const block = noteIdx === -1 ? text.slice(start) : text.slice(start, noteIdx);

  const medM = block.match(/^Federal funds rate\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!medM) return null;

  const prevM = block.match(/(January|March|April|June|July|September|December)\s+projection\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);

  // "Change in real GDP X X X X ..." / "PCE inflation X X X X ..." — même format
  // de ligne que "Federal funds rate", ailleurs dans Table 1 (pas dans `block`,
  // qui commence après ces lignes, donc on cherche dans `text` en entier).
  const toYearRecord = (vals: [string, string, string, string] | null) =>
    vals ? { [years[0]]: parseFloat(vals[0]), [years[1]]: parseFloat(vals[1]), [years[2]]: parseFloat(vals[2]), [years[3]]: parseFloat(vals[3]) } : null;
  const gdpM = text.match(/Change in real GDP\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  const pceM = text.match(/(?<!Core )PCE inflation\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);

  return {
    years,
    median: { [years[0]]: parseFloat(medM[1]), [years[1]]: parseFloat(medM[2]), [years[2]]: parseFloat(medM[3]), [years[3]]: parseFloat(medM[4]) },
    prevMedian: prevM ? { [years[0]]: parseFloat(prevM[2]), [years[1]]: parseFloat(prevM[3]), [years[2]]: parseFloat(prevM[4]), [years[3]]: parseFloat(prevM[5]) } : null,
    prevLabel: prevM ? `${prevM[1]} projection` : null,
    gdpMedian: gdpM ? toYearRecord([gdpM[1], gdpM[2], gdpM[3], gdpM[4]]) : null,
    pceMedian: pceM ? toYearRecord([pceM[1], pceM[2], pceM[3], pceM[4]]) : null,
  };
}

// Figure 2 : dots individuels — table HTML sémantique (th.stub = niveau de taux,
// td.data|td.emptydata = nb de participants par colonne année), bien plus fiable
// qu'un parsing du texte aplati (cellules vides ambiguës une fois le texte collapsé).
function parseSepFigure2(html: string): FedDot[] {
  const dots: FedDot[] = [];
  const figIdx = html.indexOf("Figure 2");
  if (figIdx === -1) return dots;
  const tableStart = html.indexOf("<table", figIdx);
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableStart === -1 || tableEnd === -1) return dots;
  const tableHtml = html.slice(tableStart, tableEnd);

  const headerM = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/);
  const years = headerM
    ? Array.from(headerM[1].matchAll(/<th[^>]*>([^<]+)<\/th>/g), m => m[1].trim()).filter(y => !/midpoint/i.test(y))
    : ["2026", "2027", "2028", "Longer run"];

  const rowRe = /<tr>\s*<th class="stub"[^>]*>([\d.]+)<\/th>([\s\S]*?)<\/tr>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(tableHtml)) !== null) {
    const rate = parseFloat(rm[1]);
    const cells = Array.from(rm[2].matchAll(/<td class="(data|emptydata)"[^>]*>([^<]*)<\/td>/g));
    cells.forEach((c, i) => {
      if (c[1] === "data") {
        const count = parseInt(c[2].trim(), 10);
        if (!isNaN(count) && count > 0 && years[i]) dots.push({ year: years[i], rate, count });
      }
    });
  }
  return dots;
}

async function fetchFedDotPlot(sepDates: string[]): Promise<FedDotPlot | null> {
  if (!sepDates.length) return null;
  const latest = sepDates.at(-1)!;
  const htmlUrl = `https://www.federalreserve.gov/monetarypolicy/fomcprojtabl${latest}.htm`;
  const html = await fetchText(htmlUrl);
  if (!html) return null;
  const text = htmlToText(html);

  const table1 = parseSepTable1(text);
  if (!table1) return null;
  const dots = parseSepFigure2(html);

  // Historique : jusqu'à 6 dernières publications SEP (trimestrielles) pour montrer l'évolution
  const histDates = sepDates.slice(-6);
  const history: FedSepHistoryPoint[] = [];
  const histResults = await Promise.all(histDates.map(async d => {
    if (d === latest) return { date: d, medianByYear: table1.median };
    const h = await fetchText(`https://www.federalreserve.gov/monetarypolicy/fomcprojtabl${d}.htm`);
    if (!h) return null;
    const t1 = parseSepTable1(htmlToText(h));
    return t1 ? { date: d, medianByYear: t1.median } : null;
  }));
  for (const h of histResults) if (h) history.push({ date: `${h.date.slice(0,4)}-${h.date.slice(4,6)}-${h.date.slice(6,8)}`, medianByYear: h.medianByYear });

  return {
    asOfDate:  `${latest.slice(0,4)}-${latest.slice(4,6)}-${latest.slice(6,8)}`,
    years: table1.years,
    medianByYear: table1.median,
    prevMedianByYear: table1.prevMedian,
    prevLabel: table1.prevLabel,
    dots,
    history,
    gdpMedian: table1.gdpMedian,
    pceMedian: table1.pceMedian,
    sepHtmlUrl: htmlUrl,
    sepPdfUrl: `https://www.federalreserve.gov/monetarypolicy/files/fomcprojtabl${latest}.pdf`,
  };
}

export async function fetchFedGovernance(): Promise<CBGovernance> {
  const info = CB_STATIC_INFO.USD;
  const dates = await findLatestFedDates();
  if (!dates || !dates.statementDates.length) return staticFallback("USD", "Impossible de lire le calendrier FOMC");

  const latestStatementDate = dates.statementDates.at(-1)!;
  const [statement, dotPlot] = await Promise.all([
    fetchFedStatement(latestStatementDate),
    fetchFedDotPlot(dates.sepDates),
  ]);

  if (!statement) return staticFallback("USD", "Communiqué FOMC illisible");

  const forecast: CBForecast | null = dotPlot && (dotPlot.gdpMedian || dotPlot.pceMedian)
    ? {
        asOf: dotPlot.asOfDate,
        years: dotPlot.years.filter(y => y !== "Longer run"),
        gdp: dotPlot.gdpMedian ?? {},
        inflation: dotPlot.pceMedian ?? {},
        label: `Fed — Summary of Economic Projections (médianes) — ${dotPlot.asOfDate}`,
        sourceUrl: dotPlot.sepHtmlUrl,
      }
    : null;

  return {
    currency: "USD", ...info,
    meetingDate: `${latestStatementDate.slice(0,4)}-${latestStatementDate.slice(4,6)}-${latestStatementDate.slice(6,8)}`,
    rateLevel: statement.rateLevel,
    voteSummary: statement.voteSummary,
    voteDetail: statement.voteDetail,
    statementUrl: statement.statementUrl,
    reportPdfUrl: dotPlot?.sepPdfUrl ?? null,
    reportLabel: dotPlot ? `Summary of Economic Projections — ${dotPlot.asOfDate}` : null,
    ...(dotPlot ? { dotPlot } : {}),
    forecast,
  };
}

// ── BoE (GBP) ─────────────────────────────────────────────────────────────────

const BOE_MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

interface BoeParsed { rateLevel: string; voteSummary: string; meetingDate: string | null; voteDetail: string | null; }

// "voted by a majority of X–Y to maintain/raise/lower Bank Rate at Z%" ou, si
// unanime, "voted unanimously to maintain/raise/lower Bank Rate at Z%".
function parseBoeVote(text: string): BoeParsed | null {
  const majM = text.match(/voted by a majority of\s+(\d+)\s*[–—-]\s*(\d+)\s+to\s+(?:maintain|reduce|increase|raise|cut)[^.]*?Bank Rate at\s+([\d.]+)%/i);
  const unanM = !majM && text.match(/voted unanimously to\s+(?:maintain|reduce|increase|raise|cut)[^.]*?Bank Rate at\s+([\d.]+)%/i);
  if (!majM && !unanM) return null;

  const dateM = text.match(/At its meeting ending on\s+([^,]+),/i);
  // Périodes tolérées à l'intérieur (ex. "0.25 percentage points") : on ne coupe
  // que sur un point réellement suivi d'un espace (fin de phrase), pas un point décimal.
  const dissentM = text.match(/(\w+\s+members?\s+voted to(?:(?!\.\s)[\s\S])+)\.\s/i);

  return majM
    ? { rateLevel: `${majM[3]}%`, voteSummary: `${majM[1]} – ${majM[2]}`, meetingDate: dateM?.[1]?.trim() ?? null, voteDetail: dissentM?.[1]?.trim() ?? null }
    : { rateLevel: `${(unanM as RegExpMatchArray)[1]}%`, voteSummary: "Unanime", meetingDate: dateM?.[1]?.trim() ?? null, voteDetail: null };
}

export async function fetchBoeGovernance(): Promise<CBGovernance> {
  const info = CB_STATIC_INFO.GBP;
  const now = new Date();

  // Certaines pages du mois courant existent déjà en placeholder avant la réunion
  // ("to be published at Xpm") — on ne valide donc pas sur la simple présence de
  // la page, mais sur un vote réellement trouvé, et on recule au besoin.
  for (let back = 0; back < 5; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const monthName = BOE_MONTHS[d.getMonth()];
    const url = `https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/${d.getFullYear()}/${monthName}-${d.getFullYear()}`;
    const html = await fetchText(url);
    if (!html) continue;
    const parsed = parseBoeVote(htmlToText(html));
    if (!parsed) continue;

    return {
      currency: "GBP", ...info,
      meetingDate: parsed.meetingDate,
      rateLevel: parsed.rateLevel,
      voteSummary: parsed.voteSummary,
      voteDetail: parsed.voteDetail,
      statementUrl: url,
      reportPdfUrl: `${url}.pdf`,
      reportLabel: "Monetary Policy Summary and Minutes",
    };
  }
  return staticFallback("GBP", "Vote MPC introuvable sur les 5 derniers mois");
}

// ── RBA (AUD) ─────────────────────────────────────────────────────────────────
// IMPORTANT : rba.gov.au renvoie 403 (Akamai) dès qu'un User-Agent de navigateur
// est envoyé — la demande "brute" (aucun header custom) passe en revanche très
// bien. Ne PAS utiliser fetchText() ici (il pose un User-Agent Chrome).

async function fetchPlain(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 6 * 3600 } });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

// Prévisions semestrielles (Table 3.2 "Detailed Baseline Forecast Table") de la
// dernière Statement on Monetary Policy — colonnes Dec/Jun (pas des années
// calendaires pleines, la RBA prévoit par semestre).
async function fetchRbaForecast(): Promise<CBForecast | null> {
  const indexHtml = await fetchPlain("https://www.rba.gov.au/publications/smp/");
  if (!indexHtml) return null;
  const linkM = indexHtml.match(/href="(\/publications\/smp\/\d{4}\/[a-z]+\/)"/);
  if (!linkM) return null;
  const pageUrl = `https://www.rba.gov.au${linkM[1]}outlook.html`;

  const html = await fetchPlain(pageUrl);
  if (!html) return null;
  const text = htmlToText(html);

  const tblIdx = text.indexOf("Table 3.2");
  if (tblIdx === -1) return null;
  const endIdx = text.indexOf("Forecasts finalised", tblIdx);
  const win = text.slice(tblIdx, endIdx === -1 ? tblIdx + 6000 : endIdx);

  const headerM = win.match(/(Dec|Jun)\s+(\d{4})\s+(Dec|Jun)\s+(\d{4})\s+(Dec|Jun)\s+(\d{4})\s+(Dec|Jun)\s+(\d{4})\s+(Dec|Jun)\s+(\d{4})\s+(Dec|Jun)\s+(\d{4})/);
  if (!headerM) return null;
  const years = [0, 2, 4, 6, 8, 10].map(i => `${headerM[i + 2]}-${headerM[i + 1] === "Dec" ? "12" : "06"}`);

  const numRe = "(-?[\\d.]+)";
  const seriesRe = `${numRe}\\s+${numRe}\\s+${numRe}\\s+${numRe}\\s+${numRe}\\s+${numRe}`;
  const gdpM = win.match(new RegExp(`Gross domestic product\\s+${seriesRe}`));
  const cpiM = win.match(new RegExp(`Consumer Price Index\\s+${seriesRe}`));
  if (!gdpM && !cpiM) return null;

  const toRecord = (m: RegExpMatchArray | null) =>
    m ? Object.fromEntries(years.map((y, i) => [y, parseFloat(m[i + 1])])) : {};

  return {
    asOf: new Date().toISOString().slice(0, 10),
    years,
    gdp: toRecord(gdpM),
    inflation: toRecord(cpiM),
    label: "RBA — Statement on Monetary Policy, prévisions semestrielles",
    sourceUrl: pageUrl,
  };
}

export async function fetchRbaGovernance(): Promise<CBGovernance> {
  const info = CB_STATIC_INFO.AUD;
  const [indexHtml, forecast] = await Promise.all([
    fetchPlain("https://www.rba.gov.au/monetary-policy/int-rate-decisions/"),
    fetchRbaForecast().catch(() => null),
  ]);
  if (!indexHtml) return staticFallback("AUD", "Index des décisions introuvable");

  const links = Array.from(new Set(Array.from(indexHtml.matchAll(/\/media-releases\/(\d{4})\/mr-(\d{2})-(\d{2})\.html/g), m => m[0])));
  if (!links.length) return staticFallback("AUD", "Aucune décision trouvée sur l'index");
  // Le numéro de séquence (mr-YY-NN) croît avec le temps mais n'est pas daté — on
  // trie par (année, numéro) pour prendre la plus récente.
  links.sort((a, b) => {
    const pa = a.match(/mr-(\d{2})-(\d{2})/)!, pb = b.match(/mr-(\d{2})-(\d{2})/)!;
    return pa[1] !== pb[1] ? +pa[1] - +pb[1] : +pa[2] - +pb[2];
  });
  const url = `https://www.rba.gov.au${links.at(-1)}`;

  const html = await fetchPlain(url);
  if (!html) return staticFallback("AUD", "Communiqué RBA illisible");
  const text = htmlToText(html);

  const dateM = text.match(/\bDate\s+(\d{1,2}\s+\w+\s+\d{4})/);
  const majM = text.match(/made by majority:\s*([a-z]+)\s+members? voted to\s+(increase|decrease|lower|leave)[^;]*?(?:to\s+([\d.]+)\s+per cent)?;\s*([a-z]+)\s+members? voted to\s+(increase|decrease|lower|leave)[^.]*?(?:at\s+([\d.]+)\s+per cent)?/i);
  const unanRateM = text.match(/Board decided to\s+(?:leave the cash rate target unchanged at|increase the cash rate target(?:\s+by[^t]*)?\s*to|lower the cash rate target(?:\s+by[^t]*)?\s*to)\s+([\d.]+)\s+per cent/i);

  const WORDNUM: Record<string, number> = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9 };

  let voteSummary: string, rateLevel: string | null, voteDetail: string | null;
  if (majM) {
    const n1 = WORDNUM[majM[1].toLowerCase()] ?? NaN;
    const n2 = WORDNUM[majM[4].toLowerCase()] ?? NaN;
    voteSummary = !isNaN(n1) && !isNaN(n2) ? `${Math.max(n1,n2)} – ${Math.min(n1,n2)}` : "Majorité (détail ci-dessous)";
    rateLevel = (majM[3] ?? majM[6]) ? `${majM[3] ?? majM[6]}%` : null;
    voteDetail = majM[0];
  } else {
    voteSummary = "Unanime";
    rateLevel = unanRateM ? `${unanRateM[1]}%` : null;
    voteDetail = null;
  }

  return {
    currency: "AUD", ...info,
    meetingDate: dateM ? dateM[1] : null,
    rateLevel,
    voteSummary,
    voteDetail,
    statementUrl: url,
    reportPdfUrl: null, // Statement on Monetary Policy = trimestriel, pas à chaque réunion
    reportLabel: "Statement by the Monetary Policy Board",
    forecast,
  };
}

// ── SNB (CHF) ─────────────────────────────────────────────────────────────────
// Décision collégiale (Direction générale à 3 membres) — aucun vote publié.

export async function fetchSnbGovernance(): Promise<CBGovernance> {
  const info = CB_STATIC_INFO.CHF;
  const listHtml = await fetchText("https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy/decisions");
  const linkM = listHtml?.match(/href="(\/en\/publications\/communication\/press-releases-restricted\/pre_(\d{8})[^"]*)"/);
  if (!linkM) return staticFallback("CHF", "Décision SNB introuvable");
  const dateCompact = linkM[2];
  const dateIso = `${dateCompact.slice(0,4)}-${dateCompact.slice(4,6)}-${dateCompact.slice(6,8)}`;

  const prHtml = await fetchText(`https://www.snb.ch${linkM[1]}`);
  if (!prHtml) return staticFallback("CHF", "Communiqué SNB illisible");
  const prText = htmlToText(prHtml);
  const rateM = prText.match(/SNB policy rate\s+(?:unchanged at|to)\s+(-?[\d.]+)%/i);

  // "Conditional inflation forecast" — pas de prévision de croissance chiffrée
  // publiée par la SNB dans ce même communiqué, seulement l'inflation.
  const inflM = prText.match(/average annual inflation at\s+(-?[\d.]+)%\s+for\s+(\d{4}),\s+(-?[\d.]+)%\s+for\s+(\d{4})\s+and\s+(-?[\d.]+)%\s+for\s+(\d{4})/i);
  const forecast: CBForecast | null = inflM ? {
    asOf: dateIso,
    years: [inflM[2], inflM[4], inflM[6]],
    gdp: {},
    inflation: { [inflM[2]]: parseFloat(inflM[1]), [inflM[4]]: parseFloat(inflM[3]), [inflM[6]]: parseFloat(inflM[5]) },
    label: "SNB — prévision conditionnelle d'inflation",
    sourceUrl: `https://www.snb.ch${linkM[1]}`,
  } : null;

  return {
    currency: "CHF", ...info,
    meetingDate: dateIso,
    rateLevel: rateM ? `${rateM[1]}%` : null,
    voteSummary: "Décision collégiale (3 membres)",
    voteDetail: null,
    statementUrl: `https://www.snb.ch${linkM[1]}`,
    reportPdfUrl: `https://www.snb.ch/public/asset/en/www-snb-ch/publications/communication/press-releases-restricted/pre_${dateCompact}/publications0_en/pre_${dateCompact}.en.pdf`,
    reportLabel: "Monetary Policy Assessment",
    forecast,
  };
}

// Projections du dernier Monetary Policy Report — Table 2 ("Contributions to
// average annual real GDP growth") donne les lignes annuelles GDP et CPI
// inflation ; Table 3 (juste après) redonne un CPI trimestriel qu'on veut
// éviter de capter par erreur, d'où la fenêtre de recherche bornée à
// [Table 2: … Table 3:].
async function fetchBocForecast(): Promise<CBForecast | null> {
  const indexHtml = await fetchText("https://www.bankofcanada.ca/publications/mpr/");
  if (!indexHtml) return null;
  const mprM = indexHtml.match(/href="(https:\/\/www\.bankofcanada\.ca\/publications\/mpr\/mpr-\d{4}-\d{2}-\d{2}\/)"/);
  if (!mprM) return null;
  const projUrl = `${mprM[1]}projections/`;

  const html = await fetchText(projUrl);
  if (!html) return null;
  const text = htmlToText(html);

  const t2Start = text.indexOf("Table 2:");
  const t3Start = text.indexOf("Table 3:", t2Start);
  if (t2Start === -1 || t3Start === -1) return null;
  const window = text.slice(t2Start, t3Start);

  const yearsM = window.match(/(\d{4})\s+(\d{4})\s+(\d{4})\s+(\d{4})/);
  const numRe = "(-?[\\d.]+)(?:\\s*\\([^)]*\\))?";
  const gdpM = window.match(new RegExp(`\\bGDP\\s+${numRe}\\s+${numRe}\\s+${numRe}\\s+${numRe}`));
  const cpiM = window.match(new RegExp(`\\bCPI inflation\\s+${numRe}\\s+${numRe}\\s+${numRe}\\s+${numRe}`));
  if (!yearsM || (!gdpM && !cpiM)) return null;

  const years = [yearsM[1], yearsM[2], yearsM[3], yearsM[4]];
  const toRecord = (m: RegExpMatchArray | null) =>
    m ? { [years[0]]: parseFloat(m[1]), [years[1]]: parseFloat(m[2]), [years[2]]: parseFloat(m[3]), [years[3]]: parseFloat(m[4]) } : {};

  return {
    asOf: new Date().toISOString().slice(0, 10),
    years,
    gdp: toRecord(gdpM),
    inflation: toRecord(cpiM),
    label: "BoC — Monetary Policy Report, projections",
    sourceUrl: projUrl,
  };
}

// ── BoC (CAD) ─────────────────────────────────────────────────────────────────
// Décision par consensus — aucun vote publié.

export async function fetchBocGovernance(): Promise<CBGovernance> {
  const info = CB_STATIC_INFO.CAD;
  const [html, forecast] = await Promise.all([
    fetchText("https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/"),
    fetchBocForecast().catch(() => null),
  ]);
  if (!html) return staticFallback("CAD", "Page taux directeur introuvable");
  const text = htmlToText(html);

  // Tableau "Date* Target (%) Change (%) <date la plus récente> <taux> ..." —
  // la première ligne du tableau est toujours la décision la plus récente.
  const rowM = text.match(/Target \(%\)\s+Change \(%\)\s+([A-Z][a-z]+ \d{1,2},\s*\d{4})\s+([\d.]+)/);

  return {
    currency: "CAD", ...info,
    meetingDate: rowM ? rowM[1] : null,
    rateLevel: rowM ? `${rowM[2]}%` : null,
    voteSummary: "Décision par consensus",
    voteDetail: null,
    statementUrl: "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/",
    reportPdfUrl: null,
    reportLabel: "Monetary Policy Report",
    forecast,
  };
}

// Extrait les projections macroéconomiques (staff projections) du même
// communiqué de décision déjà fetché — phrasé quasi-identique à chaque
// publication trimestrielle : "headline inflation is expected to average X%
// in Y1, Y% in Y2 and Z% in Y3" / "economic growth at an average of X% in Y1…".
function parseEcbForecast(text: string, sourceUrl: string): CBForecast | null {
  const inflM = text.match(/(?:headline )?inflation is expected to average\s+([\d.]+)%\s+in\s+(\d{4}),\s+([\d.]+)%\s+in\s+(\d{4})\s+and\s+([\d.]+)%\s+in\s+(\d{4})/i);
  const gdpM  = text.match(/(?:economic growth|GDP growth) at an average of\s+([\d.]+)%\s+in\s+(\d{4}),\s+([\d.]+)%\s+in\s+(\d{4})\s+and\s+([\d.]+)%\s+in\s+(\d{4})/i);
  if (!inflM && !gdpM) return null;

  const years = Array.from(new Set([inflM?.[2], inflM?.[4], inflM?.[6], gdpM?.[2], gdpM?.[4], gdpM?.[6]].filter((y): y is string => !!y))).sort();

  return {
    asOf: new Date().toISOString().slice(0, 10),
    years,
    gdp:       gdpM  ? { [gdpM[2]]: parseFloat(gdpM[1]), [gdpM[4]]: parseFloat(gdpM[3]), [gdpM[6]]: parseFloat(gdpM[5]) } : {},
    inflation: inflM ? { [inflM[2]]: parseFloat(inflM[1]), [inflM[4]]: parseFloat(inflM[3]), [inflM[6]]: parseFloat(inflM[5]) } : {},
    label: "Eurosystem staff macroeconomic projections",
    sourceUrl,
  };
}

// ── ECB (EUR) ─────────────────────────────────────────────────────────────────
// Décision par consensus — aucun vote publié. Découverte du dernier communiqué
// via le flux RSS (les URLs de communiqués contiennent un hash non prévisible).

export async function fetchEcbGovernance(): Promise<CBGovernance> {
  const info = CB_STATIC_INFO.EUR;
  // Le site ECB charge sa liste de décisions côté client (pas de lien statique
  // fiable vers le dernier communiqué — hash d'URL non prévisible depuis la date).
  // Le flux RSS général capte la décision si elle est encore dans sa fenêtre
  // glissante ; sinon on retombe sur data/rate_decisions.json (déjà tenu à jour
  // manuellement ailleurs dans l'app) pour au moins afficher le taux courant.
  const rss = await fetchText("https://www.ecb.europa.eu/rss/press.html");
  const itemM = rss ? Array.from(rss.matchAll(/<item>([\s\S]*?)<\/item>/g)).map(m => m[1]).find(item => /ecb\.mp\d{6}~/.test(item)) : undefined;

  if (itemM) {
    const urlM = itemM.match(/<link>([^<]+)<\/link>/);
    const dateM = itemM.match(/<pubDate>([^<]+)<\/pubDate>/);
    if (urlM) {
      const html = await fetchText(urlM[1]);
      const text = html ? htmlToText(html) : "";
      const rateM = text.match(/deposit facility rate[^.]*?to\s+([\d.]+)%/i);
      if (rateM || text) {
        return {
          currency: "EUR", ...info,
          meetingDate: dateM ? new Date(dateM[1]).toISOString().slice(0, 10) : null,
          rateLevel: rateM?.[1] ? `${rateM[1]}%` : null,
          voteSummary: "Décision par consensus",
          voteDetail: null,
          statementUrl: urlM[1],
          reportPdfUrl: null,
          reportLabel: "Monetary Policy Decision",
          forecast: parseEcbForecast(text, urlM[1]),
        };
      }
    }
  }

  // Repli : taux courant connu (data/rate_decisions.json), pas de date/URL de communiqué.
  const rateDecEntry = (rateDecisionsData as Array<{ decisions: Record<string, { current: number; source?: string }> }>)[0];
  const eurDecision = rateDecEntry?.decisions?.EUR;
  if (eurDecision === undefined) return staticFallback("EUR", "Communiqué introuvable et rate_decisions.json indisponible");

  // Le champ "source" de rate_decisions.json contient parfois l'URL du
  // communiqué (écrite manuellement lors de la dernière correction) — on la
  // réutilise pour tenter d'en tirer les projections, à défaut de RSS.
  const fallbackUrlM = eurDecision.source?.match(/https:\/\/www\.ecb\.europa\.eu\/press\/pr\/\S+?\.html/);
  const fallbackHtml = fallbackUrlM ? await fetchText(fallbackUrlM[0]) : null;
  const fallbackForecast = fallbackHtml ? parseEcbForecast(htmlToText(fallbackHtml), fallbackUrlM![0]) : null;

  return {
    currency: "EUR", ...info,
    meetingDate: null,
    rateLevel: `${eurDecision.current}%`,
    voteSummary: "Décision par consensus",
    voteDetail: null,
    statementUrl: fallbackUrlM?.[0] ?? null,
    reportPdfUrl: null,
    reportLabel: null,
    forecast: fallbackForecast,
    fetchError: "Dernier communiqué hors de la fenêtre RSS — taux affiché depuis rate_decisions.json",
  };
}

// ── BoJ (JPY) ─────────────────────────────────────────────────────────────────
// Vote numérique publié (ex. "7-1 majority vote"). Statement PDF-only en 2026 ;
// date de réunion découverte par recherche en arrière (par lots concurrents,
// même technique que lib/investinglive.ts) faute de calendrier discret exploitable.

async function tryBojDate(dateCompact: string): Promise<{ text: string; url: string } | null> {
  const url = `https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2026/k${dateCompact}a.pdf`;
  try {
    // Pas de next:{revalidate} ici : le cache fetch de Next.js sur une réponse
    // binaire (PDF) interfère avec la lecture arrayBuffer() qui suit (échec
    // silencieux observé en pratique — un fetch "nu" comme pour RBA fonctionne).
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: Buffer.from(buf) });
    const result = await parser.getText();
    await parser.destroy();
    return { text: result.text, url };
  } catch { return null; }
}

// Outlook for Economic Activity and Prices ("Outlook Report") — publié 4x/an
// (env. jan/avr/jul/oct), pas à chaque réunion. Table "Forecasts of the
// Majority of the Policy Board Members" : pour chaque exercice fiscal, la
// médiane est entre crochets ; on ignore les lignes "Forecasts made in [mois]"
// qui sont l'ancienne prévision de comparaison, pas la prévision actuelle.
async function fetchBojOutlookPdfText(year: number, month: number): Promise<string | null> {
  const yy = String(year % 100).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const url = `https://www.boj.or.jp/en/mopo/outlook/gor${yy}${mm}a.pdf`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: Buffer.from(buf) });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  } catch { return null; }
}

async function fetchBojForecast(): Promise<CBForecast | null> {
  let y = new Date().getFullYear();
  let m = new Date().getMonth() + 1;
  const quarterMonths = [1, 4, 7, 10];

  for (let tries = 0; tries < 8; tries++) {
    if (quarterMonths.includes(m)) {
      const text = await fetchBojOutlookPdfText(y, m);
      if (text) {
        const flat = text.replace(/\s+/g, " ");
        const rows = Array.from(flat.matchAll(
          /Fiscal (20\d{2})\s+[+-][\d.]+\s+to\s+[+-][\d.]+\s+\[([+-][\d.]+)\]\s+([+-][\d.]+)(?:\s+to\s+[+-][\d.]+\s+\[([+-][\d.]+)\])?/g
        ));
        if (rows.length) {
          const years: string[] = [];
          const gdp: Record<string, number> = {};
          const inflation: Record<string, number> = {};
          for (const r of rows) {
            const [, fy, gdpMedian, cpiValue, cpiMedian] = r;
            years.push(fy);
            gdp[fy] = parseFloat(gdpMedian);
            inflation[fy] = parseFloat(cpiMedian ?? cpiValue);
          }
          return {
            asOf: `${y}-${String(m).padStart(2, "0")}`,
            years,
            gdp,
            inflation,
            label: "BoJ — Outlook for Economic Activity and Prices (médianes)",
            sourceUrl: `https://www.boj.or.jp/en/mopo/outlook/gor${String(y % 100).padStart(2, "0")}${String(m).padStart(2, "0")}a.pdf`,
          };
        }
      }
    }
    m--; if (m === 0) { m = 12; y--; }
  }
  return null;
}

export async function fetchBojGovernance(): Promise<CBGovernance> {
  const info = CB_STATIC_INFO.JPY;
  const now = new Date();
  const forecast = await fetchBojForecast().catch(() => null);

  for (let batchStart = 0; batchStart <= 56; batchStart += 7) {
    const days = Array.from({ length: 7 }, (_, i) => batchStart + i);
    const results = await Promise.all(days.map(async d => {
      const dt = new Date(now); dt.setDate(now.getDate() - d);
      const compact = dt.toISOString().slice(0, 10).replace(/-/g, "").slice(2); // YYMMDD
      const r = await tryBojDate(compact);
      return r ? { ...r, daysAgo: d, dateIso: dt.toISOString().slice(0, 10) } : null;
    }));
    const found = results.filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => a.daysAgo - b.daysAgo)[0];
    if (found) {
      const voteM = found.text.match(/by an?\s+(\d+)-(\d+)\s+majority vote/i);
      // Ex. "encourage the uncollateralized overnight call rate to remain at around 1.0 percent"
      const rateM = found.text.match(/(?:overnight call rate|policy rate)[^.]*?around\s+(-?[\d.]+)\s*percent/i);
      const namesM = found.text.match(/Voting against[^:]*:\s*([^.]+)\./i);
      return {
        currency: "JPY", ...info,
        meetingDate: found.dateIso,
        rateLevel: rateM ? `${rateM[1]}%` : null,
        voteSummary: voteM ? `${voteM[1]} – ${voteM[2]}` : "Unanime",
        voteDetail: namesM ? namesM[1].trim() : null,
        statementUrl: found.url,
        reportPdfUrl: found.url,
        reportLabel: "Statement on Monetary Policy",
        forecast,
      };
    }
  }
  return staticFallback("JPY", "Communiqué BoJ introuvable sur les 8 dernières semaines");
}

// ── RBNZ (NZD) ────────────────────────────────────────────────────────────────
// rbnz.govt.nz bloque toute requête automatisée derrière un challenge Cloudflare
// interactif ("Verify you are human") — vérifié avec un vrai navigateur headless,
// pas seulement fetch(). Ce n'est pas contournable proprement (et on ne cherche
// pas à résoudre un captcha anti-bot / évader une protection délibérée).
//
// Repli légitime (aucune requête vers rbnz.govt.nz) :
//   - Taux OCR courant : data/rate_decisions.json (auto-maintenu par
//     update-rate-decisions.yml).
//   - Date de la dernière réunion : calendrier économique Trading Economics
//     (lib/tradingeconomics.ts, déjà utilisé ailleurs dans l'app pour le
//     calendrier), qui couvre la Nouvelle-Zélande — pas de scraping du site
//     RBNZ lui-même.
//   - Vote : la RBNZ ne publie de toute façon pas de décompte individuel des
//     votes (confirmé via TE/interest.co.nz — décision par consensus du
//     comité, contrairement à la Fed/BoE), donc "non publié" est correct sur
//     le fond, pas seulement une conséquence du blocage.

export async function fetchRbnzGovernance(): Promise<CBGovernance> {
  const info = CB_STATIC_INFO.NZD;
  const rateDecEntry = (rateDecisionsData as Array<{ decisions: Record<string, { current: number }> }>)[0];
  const nzdRate = rateDecEntry?.decisions?.NZD?.current;
  if (nzdRate === undefined) return staticFallback("NZD", "rbnz.govt.nz bloque les requêtes non-navigateur (Cloudflare) et rate_decisions.json indisponible");

  let meetingDate: string | null = null;
  try {
    const to = new Date();
    const from = new Date(to); from.setDate(from.getDate() - 70);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    // "new-zealand" n'est pas dans le G20 → absent de fetchTECalendarHTML (page
    // /calendar générique), d'où l'usage du fetcher mono-pays dédié.
    const events = await fetchTECalendarForCountry("new-zealand", iso(from), iso(to));
    const decisions = events
      .filter(e => e.category === "policy_rate" && e.isPublished)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (decisions[0]) meetingDate = decisions[0].date.slice(0, 10);
  } catch { /* meetingDate reste null, pas bloquant */ }

  return {
    currency: "NZD", ...info,
    meetingDate,
    rateLevel: `${nzdRate}%`,
    voteSummary: "Non publié",
    voteDetail: "La RBNZ ne publie pas de décompte de vote (décision par consensus du comité) ; communiqué détaillé indisponible — rbnz.govt.nz bloque le scraping automatisé (challenge Cloudflare).",
    statementUrl: null,
    reportPdfUrl: null,
    reportLabel: null,
    fetchError: "rbnz.govt.nz bloque les requêtes non-navigateur (Cloudflare) — taux (rate_decisions.json) et date de réunion (Trading Economics) affichés en repli.",
  };
}

// ── Agrégateur ────────────────────────────────────────────────────────────────

export async function fetchAllCBGovernance(): Promise<Record<Currency, CBGovernance>> {
  const [usd, gbp, eur, jpy, chf, cad, aud, nzd] = await Promise.all([
    fetchFedGovernance().catch(() => staticFallback("USD", "Erreur de scraping")),
    fetchBoeGovernance().catch(() => staticFallback("GBP", "Erreur de scraping")),
    fetchEcbGovernance().catch(() => staticFallback("EUR", "Erreur de scraping")),
    fetchBojGovernance().catch(() => staticFallback("JPY", "Erreur de scraping")),
    fetchSnbGovernance().catch(() => staticFallback("CHF", "Erreur de scraping")),
    fetchBocGovernance().catch(() => staticFallback("CAD", "Erreur de scraping")),
    fetchRbaGovernance().catch(() => staticFallback("AUD", "Erreur de scraping")),
    fetchRbnzGovernance().catch(() => staticFallback("NZD", "Erreur de scraping")),
  ]);
  return { USD: usd, GBP: gbp, EUR: eur, JPY: jpy, CHF: chf, CAD: cad, AUD: aud, NZD: nzd };
}
