import { NextResponse } from "next/server";
import rateDecisionsData from "@/data/rate_decisions.json";
import { fetchFFEvents, nextWeekAvailable } from "@/lib/forexfactory";

export const dynamic = "force-dynamic";
import type { FFEvent } from "@/lib/forexfactory";
import type { Currency } from "@/lib/types";
import { fetchAllCBPaths, extractMeetingEvents } from "@/lib/rateprobability";
import { fetchTECalendarWide } from "@/lib/tradingeconomics";
import { fetchFXStreetCalendar } from "@/lib/fxstreetCalendar";
import { isExcludedEventTitle, applyImpactFloor } from "@/lib/calendar-taxonomy";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EventCategory =
  | "employment"
  | "pmi"
  | "policy_rate"
  | "cb_speech"
  | "inflation"
  | "gdp"
  | "retail_sales"
  | "trade_balance"
  | "sentiment"
  | "housing"
  | "money_supply"
  | "trade_detail"
  | "regional_fed"
  | "portfolio_flows"
  | "public_finance"
  | "holiday"
  | "other";

export interface CalendarEvent {
  id:            string;
  date:          string;          // ISO string from FF
  currency:      string;          // ISO 4217 — univers élargi (45 pays), pas seulement les 8 majeures
  countryCode:   string;          // code pays (plusieurs pays peuvent partager une devise, ex. EUR)
  category:      EventCategory;
  title:         string;          // display-friendly
  rawTitle:      string;          // original FF title
  impact:        "high" | "medium" | "low";
  actual:        string | null;
  forecast:      string | null;
  previous:      string | null;
  isPublished:   boolean;
  week:          "prev" | "current" | "next" | "next2"; // semaine de l'événement
  source:        "ff" | "fred";   // source de la donnée
  groupKey:      string | null;
  isGroupParent: boolean;
  isGroupChild:  boolean;
}

export interface CalendarResponse {
  events:        CalendarEvent[];
  nextWeekAvail: boolean;
  fetchedAt:     string;
  source:        string;
}

// ── Currencies supported ───────────────────────────────────────────────────────

const CURRENCIES = new Set<string>(["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"]);

// Devise majeure → code pays CALENDAR_COUNTRIES (pour aligner les réunions BC,
// qui sont par nature au niveau devise, avec le dédupe par pays de TE/investingLive).
const MAJOR_CCY_TO_COUNTRY: Record<string, string> = {
  USD: "US", EUR: "EMU", GBP: "UK", JPY: "JP", CHF: "CH", CAD: "CA", AUD: "AU", NZD: "NZ",
};

// ── Category detection ─────────────────────────────────────────────────────────

function detectCategory(title: string): EventCategory {
  const t = title.toLowerCase();

  if (/nonfarm|non.farm|employment\s+change|jobs\s+added|employment\s+report|claimant|jobless\s+claims|unemployment\s+rate|jobless\s+rate|\badp\b|jolts|job\s+openings|job\s+quits|ism\s+\w+\s+employ/.test(t))
    return "employment";

  if (/\bpmi\b|purchasing\s+managers/.test(t))
    return "pmi";

  if (/interest\s+rate|rate\s+decision|monetary\s+policy\s+decision|fomc\s+(fed\s+funds|statement)|bank\s+rate\s+vote|mpc\s+.*rate|boe.*rate|ecb.*rate|boj.*rate|rba.*rate|rbnz.*rate|snb.*rate|boc.*rate/.test(t))
    return "policy_rate";

  if (/speaks?|press\s+conf|testimony|speech|statement\b|governor|chair\b|president\b/.test(t))
    return "cb_speech";

  if (/\bcpi\b|\bhicp\b|core\s+inflation|flash\s+cpi|inflation\s+rate|consumer\s+price|\bppi\b|producer\s+price/.test(t))
    return "inflation";

  if (/\bgdp\b|gross\s+domestic/.test(t))
    return "gdp";

  if (/retail\s+sales|core\s+retail|household\s+spending/.test(t))
    return "retail_sales";

  if (/trade\s+balance|current\s+account/.test(t))
    return "trade_balance";

  return "other";
}

// ── Impact mapping ─────────────────────────────────────────────────────────────

function detectImpact(ff: FFEvent, category: EventCategory): "high" | "medium" | "low" {
  const raw = (ff.impact ?? "").toLowerCase();
  if (raw.includes("high"))   return "high";
  if (raw.includes("medium")) return "medium";
  if (raw.includes("low"))    return "low";
  // Fallback by category
  if (["policy_rate", "inflation", "employment"].includes(category)) return "high";
  if (["pmi", "gdp", "retail_sales"].includes(category))             return "medium";
  return "low";
}

// ── Display title mapping ──────────────────────────────────────────────────────

function displayTitle(rawTitle: string, currency: string): string {
  const t = rawTitle;
  // USD-specific
  if (/nonfarm\s+payrolls/i.test(t) && currency === "USD") return "NFP (Non-Farm Payrolls)";
  if (/adp\s+non.farm/i.test(t))                           return "ADP Employment";
  if (/jobless.*4.?week|4.?week.*jobless|claims.*4.?week/i.test(t)) return "Dem. alloc. (moy. 4 sem.)";
  if (/unemployment\s+claims/i.test(t))                    return "Demandes d'allocations";
  if (/unemployment\s+rate/i.test(t))                      return "Taux de chômage";
  if (/employment\s+change/i.test(t))                      return "Emploi Δ";
  if (/jolts|job\s+openings/i.test(t))                     return "JOLTS (offres d'emploi)";
  if (/job\s+quits/i.test(t))                              return "JOLTS (démissions)";
  if (/ism\s+\w+\s+employ/i.test(t))                      return "ISM Emploi Manufacturier";
  if (/procure\.ch/i.test(t))                               return "PMI Manufacturier";
  if (/manufacturing\s+pmi|mfg\s+pmi/i.test(t))           return "PMI Manufacturier";
  if (/services?\s+pmi/i.test(t))                          return "PMI Services";
  if (/composite\s+pmi/i.test(t))                          return "PMI Composite";
  if (/ism\s+non.manufactur/i.test(t))                     return "ISM Services PMI";
  if (/ism\s+manufactur/i.test(t))                         return "ISM Manufacturier";
  if (/flash.*cpi|cpi.*flash/i.test(t))                    return "IPC Flash";
  if (/final.*cpi|cpi.*final/i.test(t))                   return "IPC Final";
  if (/core.*cpi/i.test(t))                                return "IPC Core";
  if (/ppi.*m.?m|producer.*price.*m.?m/i.test(t))        return "IPP (MoM)";
  if (/ppi.*y.?y|producer.*price.*y.?y/i.test(t))        return "IPP (YoY)";
  if (/\bppi\b|producer\s+price/i.test(t))                return "IPP";
  if (/\bhicp\b/i.test(t))                                 return "HICP (YoY)";
  if (/\bcpi\b.*y.*y/i.test(t))                           return "IPC (YoY)";
  if (/\bcpi\b.*m.*m/i.test(t))                           return "IPC (MoM)";
  if (/\bcpi\b/i.test(t))                                  return "IPC";
  if (/gdp.*q.*q/i.test(t))                               return "PIB (QoQ)";
  if (/gdp.*m.*m/i.test(t))                               return "PIB (MoM)";
  if (/\bgdp\b/i.test(t))                                  return "PIB";
  if (/core\s+retail/i.test(t))                            return "Ventes détail Core";
  if (/household\s+spending.*m.?m/i.test(t))              return "Dép. ménages (MoM)";
  if (/household\s+spending.*y.?y/i.test(t))              return "Dép. ménages (YoY)";
  if (/household\s+spending/i.test(t))                    return "Dép. ménages";
  if (/retail\s+sales/i.test(t))                          return "Ventes au détail";
  if (/trade\s+balance/i.test(t))                          return "Balance commerciale";
  if (/interest\s+rate|rate\s+decision/i.test(t))          return "Décision de taux";
  if (/speaks?\b|speech\b/i.test(t))                       return "Discours BC";
  if (/press\s+conf/i.test(t))                             return "Conférence de presse BC";
  return rawTitle;
}

// ── Grouping logic ─────────────────────────────────────────────────────────────

function dayKey(dateStr: string): string {
  return dateStr.slice(0, 10); // YYYY-MM-DD
}

interface GroupingResult {
  groupKey:      string | null;
  isGroupParent: boolean;
  isGroupChild:  boolean;
}

const EMPLOYMENT_PARENTS = /nonfarm|non.farm|employment\s+change|claimant|jobless\s+claims/i;
const EMPLOYMENT_CHILDREN = /unemployment\s+rate|jobless\s+rate/i;
const PMI_PARENTS  = /composite\s+pmi|ism\s+(manufactur|non.manufactur)/i;
const PMI_CHILDREN = /manufacturing\s+pmi|services?\s+pmi|mfg\s+pmi|procure\.ch/i;
const CPI_PARENTS  = /\bcpi\b.*y.*y|flash.*cpi|\bhicp\b/i;
const CPI_CHILDREN = /core.*cpi|core.*inflation/i;

function resolveGrouping(ev: FFEvent, category: EventCategory): GroupingResult {
  const t = ev.title;
  const day = dayKey(ev.date ?? "");
  const base = `${ev.country}_${day}`;

  if (category === "employment") {
    if (EMPLOYMENT_PARENTS.test(t))  return { groupKey: `emp_${base}`, isGroupParent: true,  isGroupChild: false };
    if (EMPLOYMENT_CHILDREN.test(t)) return { groupKey: `emp_${base}`, isGroupParent: false, isGroupChild: true  };
  }
  if (category === "pmi") {
    if (PMI_PARENTS.test(t))  return { groupKey: `pmi_${base}`, isGroupParent: true,  isGroupChild: false };
    if (PMI_CHILDREN.test(t)) return { groupKey: `pmi_${base}`, isGroupParent: false, isGroupChild: true  };
  }
  if (category === "inflation") {
    if (CPI_PARENTS.test(t))  return { groupKey: `cpi_${base}`, isGroupParent: true,  isGroupChild: false };
    if (CPI_CHILDREN.test(t)) return { groupKey: `cpi_${base}`, isGroupParent: false, isGroupChild: true  };
  }
  return { groupKey: null, isGroupParent: false, isGroupChild: false };
}

// ── Map FF event → CalendarEvent ──────────────────────────────────────────────

function mapEvent(ff: FFEvent): CalendarEvent | null {
  if (!CURRENCIES.has(ff.country)) return null;

  const category = detectCategory(ff.title);
  if (category === "other") return null; // filter low-relevance events

  const { groupKey, isGroupParent, isGroupChild } = resolveGrouping(ff, category);

  const actual = ff.actual?.trim() || null;
  const forecast = ff.forecast?.trim() || null;
  const previous = ff.previous?.trim() || null;

  return {
    id:            `${ff.country}_${ff.title}_${ff.date}`.replace(/\s+/g, "_"),
    date:          ff.date,
    currency:      ff.country as Currency,
    countryCode:   ff.country,
    category,
    title:         displayTitle(ff.title, ff.country),
    rawTitle:      ff.title,
    impact:        detectImpact(ff, category),
    actual:        actual,
    forecast:      forecast,
    previous:      previous,
    isPublished:   actual !== null && actual !== "",
    week:          "current" as const, // overridden in GET()
    source:        "ff" as const,
    groupKey,
    isGroupParent,
    isGroupChild,
  };
}

// ── FRED release calendar ──────────────────────────────────────────────────────
// Complément fiable pour les semaines où ForexFactory n'est pas disponible
// (samedi/dimanche) ou pour la semaine +2 (non couverte par FF).

interface FREDReleaseDef {
  title:    string;
  currency: Currency;
  category: EventCategory;
  impact:   "high" | "medium" | "low";
  utcHour:  number; // heure UTC approximative de la publication
}

const FRED_KEY_RELEASES: Record<number, FREDReleaseDef> = {
  // USD — publications majeures BLS/BEA/Census
  50:  { title: "NFP & Taux de chômage (Employment Situation)", currency: "USD", category: "employment",   impact: "high",   utcHour: 13 },
  10:  { title: "IPC (CPI) — USD",                              currency: "USD", category: "inflation",    impact: "high",   utcHour: 13 },
  9:   { title: "Ventes au détail — USD",                        currency: "USD", category: "retail_sales", impact: "high",   utcHour: 13 },
  194: { title: "ADP National Employment — USD",                 currency: "USD", category: "employment",   impact: "medium", utcHour: 13 },
  180: { title: "Demandes allocations chômage hebdo — USD",      currency: "USD", category: "employment",   impact: "medium", utcHour: 13 },
  13:  { title: "Production industrielle — USD",                 currency: "USD", category: "gdp",          impact: "medium", utcHour: 14 },
  321: { title: "Empire State Manufacturing Survey — USD",       currency: "USD", category: "pmi",          impact: "medium", utcHour: 13 },
  // EUR — publications Eurostat/ECB
  267: { title: "PIB Zone Euro — Eurostat Flash",               currency: "EUR", category: "gdp",          impact: "high",   utcHour: 10 },
  251: { title: "HICP / IPC Zone Euro",                         currency: "EUR", category: "inflation",    impact: "high",   utcHour: 10 },
  // JPY
  269: { title: "PIB Japon — Comptes nationaux",                currency: "JPY", category: "gdp",          impact: "high",   utcHour:  1 },
  266: { title: "Comptes BoJ (Bank of Japan)",                  currency: "JPY", category: "policy_rate",  impact: "medium", utcHour:  2 },
};

// CB_MEETINGS_2026 supprimé — dates désormais dynamiques via lib/rateprobability.ts
// (rateprobability.com OIS futures, mis à jour en temps réel, dates toujours exactes)

async function fetchFREDCalendar(
  fredKey: string,
  fromDate: string,
  toDate:   string,
): Promise<CalendarEvent[]> {
  try {
    const url = [
      "https://api.stlouisfed.org/fred/releases/dates",
      `?api_key=${fredKey}`,
      "&file_type=json",
      `&realtime_start=${fromDate}`,
      `&realtime_end=${toDate}`,
      "&include_release_dates_with_no_data=true",
      "&limit=500",
    ].join("");
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    const releaseDates: Array<{ release_id: number; date: string; release_name: string }> =
      data.release_dates ?? [];

    const events: CalendarEvent[] = [];
    const seen = new Set<string>();
    for (const rd of releaseDates) {
      const def = FRED_KEY_RELEASES[rd.release_id];
      if (!def) continue;
      const key = `${rd.release_id}_${rd.date}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Construire une date ISO avec l'heure UTC approximative
      const isoDate = `${rd.date}T${String(def.utcHour).padStart(2, "0")}:30:00Z`;
      const evDate  = new Date(isoDate);

      events.push({
        id:           `fred_${rd.release_id}_${rd.date}`,
        date:         isoDate,
        currency:     def.currency,
        countryCode:  def.currency,
        category:     def.category,
        title:        def.title,
        rawTitle:     def.title,
        impact:       def.impact,
        actual:       null,
        forecast:     null,
        previous:     null,
        isPublished:  evDate < new Date(),
        week:         "current", // recalculé dans GET()
        source:       "fred",
        groupKey:     null,
        isGroupParent: false,
        isGroupChild:  false,
      });
    }
    return events;
  } catch { return []; }
}

// ── Dedup key ─────────────────────────────────────────────────────────────────
// Clé déterministe pour identifier un doublon entre TE et investingLive.
// Clé par PAYS (pas devise) : plusieurs pays partagent l'EUR (France, Allemagne,
// Italie...) et publient chacun leurs propres indicateurs le même jour — dédupliquer
// par devise fusionnerait à tort des events distincts (ex. CPI FR ≠ CPI DE).
// PMI et discours BC peuvent avoir plusieurs events dans la même journée →
// on affine à l'heure UTC pour les distinguer.

function dedupeKey(countryCode: string, category: EventCategory, isoDate: string): string {
  if (category === "pmi" || category === "cb_speech") {
    return `${countryCode}_${category}_${isoDate.slice(0, 13)}`; // YYYY-MM-DDTHH
  }
  return `${countryCode}_${category}_${isoDate.slice(0, 10)}`; // YYYY-MM-DD
}

// ── GET ────────────────────────────────────────────────────────────────────────

// Calcule les bornes des 3 semaines (cette semaine, prochaine, +2)
function getWeekBounds(): { nextMonday: Date; next2Monday: Date } {
  const now = new Date();
  const day = now.getDay(); // 0=dim
  const daysToNext = day === 0 ? 1 : 8 - day;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysToNext);
  nextMonday.setHours(0, 0, 0, 0);
  const next2Monday = new Date(nextMonday);
  next2Monday.setDate(nextMonday.getDate() + 7);
  return { nextMonday, next2Monday };
}

export async function GET() {
  const fredKey = process.env.FRED_API_KEY;
  const { nextMonday, next2Monday } = getWeekBounds();

  // Fetch depuis le lundi de la semaine précédente pour inclure "Semaine dernière"
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=dim, 1=lun…6=sam
  const daysToThisMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - daysToThisMonday);
  thisMonday.setHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const fromDate  = lastMonday.toISOString().slice(0, 10);
  const toDateObj = new Date();
  toDateObj.setDate(toDateObj.getDate() + 14);
  const toDate = toDateObj.toISOString().slice(0, 10);

  // Fetch TE (45 pays) + investingLive (widget FXStreet, 45 pays) + CB paths en parallèle
  // FF+FRED uniquement si les deux scraping tombent à vide
  const [teEvents, ilEvents, cbPaths] = await Promise.all([
    fetchTECalendarWide(fromDate, toDate),
    fetchFXStreetCalendar(fromDate, toDate),
    fetchAllCBPaths(),
  ]);

  const useScraping = teEvents.length > 0 || ilEvents.length > 0;

  // Fetch FF+FRED en secours seulement si les deux scrapers ont échoué
  const [ffEvents, fredEvents] = useScraping
    ? [[], []]
    : await Promise.all([
        fetchFFEvents(),
        fredKey ? fetchFREDCalendar(fredKey, fromDate, toDate) : Promise.resolve([]),
      ]);

  const events: CalendarEvent[] = [];

  const weekOf = (date: Date): "prev" | "current" | "next" | "next2" =>
    date >= next2Monday ? "next2" :
    date >= nextMonday  ? "next"  :
    date >= thisMonday  ? "current" : "prev";

  if (useScraping) {
    // ── BASE : Trading Economics (45 pays) ─────────────────────────────────────
    // Index de dédupe : clé → index dans events[]
    const dedupeIndex = new Map<string, number>();

    for (const te of teEvents) {
      if (isExcludedEventTitle(te.title)) continue; // adjudications, prod. industrielle, énergie/hypothécaire hebdo US, CPI infranational, réunions institutionnelles
      const evDate = new Date(te.date);
      const key = dedupeKey(te.countryCode, te.category, te.date);
      dedupeIndex.set(key, events.length);
      events.push({
        id:            te.id,
        date:          te.date,
        currency:      te.currency,
        countryCode:   te.countryCode,
        category:      te.category,
        title:         te.title,
        rawTitle:      te.title,
        impact:        applyImpactFloor(te.title, te.impact),
        actual:        te.actual,
        forecast:      te.forecast,
        previous:      te.previous,
        isPublished:   te.isPublished,
        week:          weekOf(evDate),
        source:        "fred",
        groupKey:      null,
        isGroupParent: false,
        isGroupChild:  false,
      });
    }

    // ── COMPLÉMENT : investingLive (widget FXStreet) ───────────────────────────
    // Dédupe immédiat via dedupeIndex : même clé = doublon, on enrichit seulement.
    // Absent de TE = on ajoute l'event investingLive directement — c'est ce qui
    // permet aux deux sources de se compléter l'une l'autre.
    for (const il of ilEvents) {
      if (isExcludedEventTitle(il.title)) continue;
      const key = dedupeKey(il.countryCode, il.category, il.date);
      const existingIdx = dedupeIndex.get(key);
      if (existingIdx !== undefined) {
        // Doublon — enrichir avec les valeurs manquantes d'investingLive
        const ev = events[existingIdx];
        if (!ev.actual   && il.actual)   ev.actual   = il.actual;
        if (!ev.forecast && il.forecast) ev.forecast = il.forecast;
        if (!ev.previous && il.previous) ev.previous = il.previous;
      } else {
        // Présent sur investingLive mais absent de TE — on l'ajoute
        const evDate = new Date(il.date);
        dedupeIndex.set(key, events.length);
        events.push({
          id:            il.id,
          date:          il.date,
          currency:      il.currency,
          countryCode:   il.countryCode,
          category:      il.category,
          title:         il.title,
          rawTitle:      il.title,
          impact:        applyImpactFloor(il.title, il.impact),
          actual:        il.actual,
          forecast:      il.forecast,
          previous:      il.previous,
          isPublished:   il.isPublished,
          week:          weekOf(evDate),
          source:        "fred",
          groupKey:      null,
          isGroupParent: false,
          isGroupChild:  false,
        });
      }
    }
  } else {
    // ── SECOURS : ForexFactory + FRED ─────────────────────────────────────────
    const ffKeys = new Set<string>();
    for (const ff of ffEvents as FFEvent[]) {
      const ev = mapEvent(ff);
      if (!ev) continue;
      ev.week = weekOf(new Date(ff.date));
      events.push(ev);
      ffKeys.add(`${ev.currency}_${ev.category}_${ff.date.slice(0, 10)}`);
    }
    for (const fredEv of fredEvents as CalendarEvent[]) {
      const key = `${fredEv.currency}_${fredEv.category}_${fredEv.date.slice(0, 10)}`;
      if (ffKeys.has(key)) continue;
      fredEv.week = weekOf(new Date(fredEv.date));
      events.push(fredEv);
    }
  }

  // ── Réunions CB + probabilités OIS (rateprobability.com / InvestingLive) ───
  const cbMeetings = extractMeetingEvents(cbPaths, fromDate);

  // Cherche un event policy_rate existant dans une fenêtre ±1 jour
  // (nécessaire car certains providers décalent d'un jour : TE ≠ rateprobability pour le SNB)
  function findExistingRateDecision(currency: Currency, dateIso: string): CalendarEvent | undefined {
    const target = new Date(dateIso).getTime();
    return events.find(e =>
      e.currency === currency &&
      e.category === "policy_rate" &&
      Math.abs(new Date(e.date).getTime() - target) <= 86_400_000 // ±1 jour
    );
  }

  const cbDedup = new Set(
    events
      .filter(e => e.category === "policy_rate")
      .map(e => `${e.currency}_${e.date.slice(0, 10)}`)
  );

  for (const meeting of cbMeetings) {
    const existing = findExistingRateDecision(meeting.currency, meeting.dateIso);
    if (existing) {
      // Enrichir l'event existant avec la probabilité OIS
      if (meeting.probMovePct > 0) {
        const probStr = `${meeting.probMovePct.toFixed(0)}% ${meeting.probIsCut ? "▼" : "▲"}`;
        if (!existing.forecast) existing.forecast = probStr;
        if (meeting.probMovePct > 50 && !existing.title.includes("▼") && !existing.title.includes("▲")) {
          existing.title += ` · ${meeting.probMovePct.toFixed(0)}% ${meeting.probIsCut ? "▼ baisse" : "▲ hausse"}`;
        }
      }
      continue;
    }
    // Vérifier aussi par la clé jour (pour ne pas dupliquer si le meeting IL tombe le même jour qu'un event TE)
    const dayKey2 = `${meeting.currency}_${meeting.dateIso}`;
    if (cbDedup.has(dayKey2)) continue;
    cbDedup.add(dayKey2);

    const isoDate = `${meeting.dateIso}T${String(meeting.utcHour).padStart(2, "0")}:30:00Z`;
    const evDate  = new Date(isoDate);
    const probLabel = meeting.probMovePct > 50
      ? ` · ${meeting.probMovePct.toFixed(0)}% ${meeting.probIsCut ? "▼ baisse" : "▲ hausse"}`
      : "";
    events.push({
      id:            `cb_${meeting.currency}_${meeting.dateIso}`,
      date:          isoDate,
      currency:      meeting.currency,
      countryCode:   MAJOR_CCY_TO_COUNTRY[meeting.currency] ?? meeting.currency,
      category:      "policy_rate",
      title:         meeting.title + probLabel,
      rawTitle:      meeting.title,
      impact:        "high",
      actual:        null,
      forecast:      meeting.probMovePct > 0 ? `${meeting.probMovePct.toFixed(0)}% ${meeting.probIsCut ? "▼" : "▲"}` : null,
      previous:      null,
      isPublished:   evDate < new Date(),
      week:          weekOf(evDate),
      source:        "fred",
      groupKey:      null,
      isGroupParent: false,
      isGroupChild:  false,
    });
  }

  // ── Remplissage previous pour décisions de taux sans valeur ────────────────
  // Les events futurs n'ont pas de previous dans TE/Investing ; on utilise
  // rate_decisions.json (taux directeur actuel) comme valeur de référence.
  // On exclut : discours, minutes, projections, votes, Beige Book, press conf.
  const SKIP_RATE_PREV = /speech|speaks?|testimony|press\s+conf|minutes|projection|beige\s+book|vote\s+(cut|hike|unchanged)|balance\s+sheet|chart\s+pack|payments\s+system/i;
  const rateDecEntry = (rateDecisionsData as Array<{ decisions: Record<string, { current: number }> }>)[0];
  const currentRates: Record<string, string> = {};
  if (rateDecEntry?.decisions) {
    for (const [ccy, d] of Object.entries(rateDecEntry.decisions)) {
      currentRates[ccy] = `${d.current}%`;
    }
  }
  for (const ev of events) {
    if (ev.category === "policy_rate" && !ev.previous && !SKIP_RATE_PREV.test(ev.rawTitle)) {
      ev.previous = currentRates[ev.currency] ?? null;
    }
  }

  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const sourceLabel = useScraping
    ? `tradingeconomics-html(${teEvents.length})+investinglive(${ilEvents.length})+rateprobability`
    : (fredKey ? "forexfactory+fred+rateprobability" : "forexfactory+rateprobability");

  const result: CalendarResponse = {
    events,
    nextWeekAvail: useScraping ? true : nextWeekAvailable(),
    fetchedAt: new Date().toISOString(),
    source: sourceLabel,
  };

  return NextResponse.json(result, {
    headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" },
  });
}
