import { NextResponse } from "next/server";
import rateDecisionsData from "@/data/rate_decisions.json";
import { fetchFFEvents, nextWeekAvailable } from "@/lib/forexfactory";
import type { FFEvent } from "@/lib/forexfactory";
import type { Currency } from "@/lib/types";
import { fetchAllCBPaths, extractMeetingEvents } from "@/lib/rateprobability";
import { fetchTECalendarHTML } from "@/lib/tradingeconomics";
import { fetchInvestingCalendar } from "@/lib/investing";

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
  | "other";

export interface CalendarEvent {
  id:            string;
  date:          string;          // ISO string from FF
  currency:      Currency;
  category:      EventCategory;
  title:         string;          // display-friendly
  rawTitle:      string;          // original FF title
  impact:        "high" | "medium" | "low";
  actual:        string | null;
  forecast:      string | null;
  previous:      string | null;
  isPublished:   boolean;
  week:          "current" | "next" | "next2"; // semaine de l'événement
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

// ── Category detection ─────────────────────────────────────────────────────────

function detectCategory(title: string): EventCategory {
  const t = title.toLowerCase();

  if (/nonfarm|non.farm|employment\s+change|jobs\s+added|employment\s+report|claimant|jobless\s+claims|unemployment\s+rate|jobless\s+rate/.test(t))
    return "employment";

  if (/\bpmi\b|purchasing\s+managers/.test(t))
    return "pmi";

  if (/interest\s+rate|rate\s+decision|monetary\s+policy\s+decision|fomc\s+(fed\s+funds|statement)|bank\s+rate\s+vote|mpc\s+.*rate|boe.*rate|ecb.*rate|boj.*rate|rba.*rate|rbnz.*rate|snb.*rate|boc.*rate/.test(t))
    return "policy_rate";

  if (/speaks?|press\s+conf|testimony|speech|statement\b|governor|chair\b|president\b/.test(t))
    return "cb_speech";

  if (/\bcpi\b|\bhicp\b|core\s+inflation|flash\s+cpi|inflation\s+rate|consumer\s+price/.test(t))
    return "inflation";

  if (/\bgdp\b|gross\s+domestic/.test(t))
    return "gdp";

  if (/retail\s+sales|core\s+retail/.test(t))
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
  if (/unemployment\s+claims/i.test(t))                    return "Demandes d'allocations";
  if (/unemployment\s+rate/i.test(t))                      return "Taux de chômage";
  if (/employment\s+change/i.test(t))                      return "Emploi Δ";
  if (/manufacturing\s+pmi|mfg\s+pmi/i.test(t))           return "PMI Manufacturier";
  if (/services?\s+pmi/i.test(t))                          return "PMI Services";
  if (/composite\s+pmi/i.test(t))                          return "PMI Composite";
  if (/ism\s+non.manufactur/i.test(t))                     return "ISM Services PMI";
  if (/ism\s+manufactur/i.test(t))                         return "ISM Manufacturier";
  if (/flash.*cpi|cpi.*flash/i.test(t))                    return "IPC Flash (YoY)";
  if (/core.*cpi/i.test(t))                                return "IPC Core";
  if (/\bhicp\b/i.test(t))                                 return "HICP (YoY)";
  if (/\bcpi\b.*y.*y/i.test(t))                           return "IPC (YoY)";
  if (/\bcpi\b.*m.*m/i.test(t))                           return "IPC (MoM)";
  if (/\bcpi\b/i.test(t))                                  return "IPC";
  if (/gdp.*q.*q/i.test(t))                               return "PIB (QoQ)";
  if (/gdp.*m.*m/i.test(t))                               return "PIB (MoM)";
  if (/\bgdp\b/i.test(t))                                  return "PIB";
  if (/core\s+retail/i.test(t))                            return "Ventes détail Core";
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
const PMI_CHILDREN = /manufacturing\s+pmi|services?\s+pmi|mfg\s+pmi/i;
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
// Clé déterministe pour identifier un doublon entre TE et Investing.
// PMI et discours BC peuvent avoir plusieurs events dans la même journée →
// on affine à l'heure UTC pour les distinguer.
// Toutes les autres catégories sont uniques par (devise, catégorie, jour).

function dedupeKey(currency: string, category: EventCategory, isoDate: string): string {
  if (category === "pmi" || category === "cb_speech") {
    return `${currency}_${category}_${isoDate.slice(0, 13)}`; // YYYY-MM-DDTHH
  }
  return `${currency}_${category}_${isoDate.slice(0, 10)}`; // YYYY-MM-DD
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

  const fromDate  = new Date().toISOString().slice(0, 10);
  const toDateObj = new Date();
  toDateObj.setDate(toDateObj.getDate() + 14);
  const toDate = toDateObj.toISOString().slice(0, 10);

  // Fetch TE HTML + Investing + CB paths toujours en parallèle
  // FF+FRED uniquement si les deux scraping tombent à vide
  const [teEvents, invEvents, cbPaths] = await Promise.all([
    fetchTECalendarHTML(fromDate, toDate),
    fetchInvestingCalendar(fromDate, toDate),
    fetchAllCBPaths(),
  ]);

  const useScraping = teEvents.length > 0 || invEvents.length > 0;

  // Fetch FF+FRED en secours seulement si les deux scrapers ont échoué
  const [ffEvents, fredEvents] = useScraping
    ? [[], []]
    : await Promise.all([
        fetchFFEvents(),
        fredKey ? fetchFREDCalendar(fredKey, fromDate, toDate) : Promise.resolve([]),
      ]);

  const events: CalendarEvent[] = [];

  const weekOf = (date: Date): "current" | "next" | "next2" =>
    date >= next2Monday ? "next2" :
    date >= nextMonday  ? "next"  : "current";

  if (useScraping) {
    // ── BASE : TE HTML ────────────────────────────────────────────────────────
    // Index de dédupe : clé → index dans events[]
    const dedupeIndex = new Map<string, number>();

    for (const te of teEvents) {
      if (te.category === "other") continue; // filtre les events sans catégorie pertinente
      const evDate = new Date(te.date);
      const key = dedupeKey(te.currency, te.category, te.date);
      dedupeIndex.set(key, events.length);
      events.push({
        id:            te.id,
        date:          te.date,
        currency:      te.currency,
        category:      te.category,
        title:         te.title,
        rawTitle:      te.title,
        impact:        te.impact,
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

    // ── COMPLÉMENT : Investing.com ────────────────────────────────────────────
    // Dédupe immédiat via dedupeIndex : même clé = doublon, on enrichit seulement.
    // Absent de TE = on ajoute l'event Investing directement.
    for (const inv of invEvents) {
      if (inv.category === "other") continue;
      const key = dedupeKey(inv.currency, inv.category, inv.date);
      const existingIdx = dedupeIndex.get(key);
      if (existingIdx !== undefined) {
        // Doublon — enrichir avec les valeurs manquantes d'Investing
        const ev = events[existingIdx];
        if (!ev.actual   && inv.actual)   ev.actual   = inv.actual;
        if (!ev.forecast && inv.forecast) ev.forecast = inv.forecast;
        if (!ev.previous && inv.previous) ev.previous = inv.previous;
      } else {
        // Présent sur Investing mais absent de TE — on l'ajoute
        const evDate = new Date(inv.date);
        dedupeIndex.set(key, events.length);
        events.push({
          id:            inv.id,
          date:          inv.date,
          currency:      inv.currency,
          category:      inv.category,
          title:         inv.title,
          rawTitle:      inv.title,
          impact:        inv.impact,
          actual:        inv.actual,
          forecast:      inv.forecast,
          previous:      inv.previous,
          isPublished:   inv.isPublished,
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
    ? `tradingeconomics-html(${teEvents.length})+investing(${invEvents.length})+rateprobability`
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
