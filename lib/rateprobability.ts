// lib/rateprobability.ts
// Données de probabilités de taux — sources : CME FedWatch + Investing.com
// Collectées par GitHub Actions (toutes les heures) → data/rate-probabilities.json
// InvestingLive (Giuseppe Dellamotta) en enrichissement CHF + deltas hebdo

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Currency } from "./types";
import { fetchILExpectationsWithHistory } from "./investinglive";
import type { ILExpectationsMap, ILExpectationsWithHistory } from "./investinglive";

// ── Cache fichier pour les données InvestingLive (évite 56 HTTP HEAD par appel) ──

const IL_CACHE_FILE = join(process.cwd(), "data", "il-enrichment-cache.json");
const IL_CACHE_TTL  = 2 * 60 * 60 * 1000; // 2h

async function getCachedILHistory(): Promise<ILExpectationsWithHistory> {
  try {
    const raw    = readFileSync(IL_CACHE_FILE, "utf8");
    const cached = JSON.parse(raw) as { ts: number; data: ILExpectationsWithHistory };
    if (Date.now() - cached.ts < IL_CACHE_TTL) {
      console.log(`[IL-cache] HIT (${Math.round((Date.now() - cached.ts) / 60000)}min old)`);
      return cached.data;
    }
    console.log("[IL-cache] STALE — refetch");
  } catch {
    console.log("[IL-cache] MISS — premier fetch");
  }
  const data = await fetchILExpectationsWithHistory();
  try {
    writeFileSync(IL_CACHE_FILE, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* /tmp read-only en prod Vercel — ignoré */ }
  return data;
}

// ── Types publics ──────────────────────────────────────────────────────────────

export interface RateProbMeeting {
  label:       string;   // "Jun 11" — 6 chars max
  dateIso:     string;   // "2026-06-11"
  impliedRate: number;   // taux implicite post-réunion
  probMovePct: number;   // 0–100 : probabilité d'un mouvement
  probIsCut:   boolean;  // true = baisse, false = hausse
  changeBps:   number;   // bps attendus à cette réunion (cumulatif)
}

export interface ILWeeklyDelta {
  probDelta:  number;   // Δ nextMeetingProbPct (courant - semaine précédente)
  bpsDelta:   number;   // Δ bpsYearEnd (courant - semaine précédente)
  isCut:      boolean;  // contexte : le pic actuel est un cut
  prevDate:   string;   // date de l'article de référence (semaine précédente)
}

export interface ILCurrent {
  bpsYearEnd:  number;   // bps fin d'an selon l'article IL courant
  probPct:     number;   // probabilité de move à la prochaine réunion (IL analyste)
  stirProbPct?: number;  // probabilité originale STIR/IC (avant fusion IL)
  isNoChange:  boolean;  // l'analyste anticipe un statu quo
  isCut:       boolean;  // l'analyste anticipe une baisse
  articleDate: string;   // date de publication de l'article (YYYY-MM-DD)
}

export interface CBRatePath {
  currency:       Currency;
  asOf:           string;          // "2026-05-31"
  currentRate:    number;
  meetings:       RateProbMeeting[];
  peakMeeting:    RateProbMeeting | null;  // réunion avec proba max de mouvement
  yearEndImplied: number | null;           // taux impliqué à la dernière réunion connue (SOFR)
  ilCurrent?:     ILCurrent;               // valeurs absolues de l'article IL courant
  ilDelta?:       ILWeeklyDelta;           // delta vs article IL semaine précédente
  prevMeetings?:  RateProbMeeting[];       // réunions semaine précédente (snapshot RP)
  prevWeekDate?:  string;                  // date du snapshot semaine précédente
  history?:       Array<{ date: string; meetings: RateProbMeeting[] }>; // snapshots hebdo accumulés
  instrumentSource?: string;               // instrument réellement utilisé pour produire ces données (ground truth, écrit par le pipeline de fetch)
}

export type RateProbData = Partial<Record<Currency, CBRatePath>>;

// ── Currencies suivies ─────────────────────────────────────────────────────────

const CB_KEYS: Currency[] = ["USD","EUR","GBP","JPY","CAD","AUD","NZD"];

// Heures UTC approximatives des annonces
const ANNOUNCE_UTC: Partial<Record<Currency, number>> = {
  USD: 18, EUR: 12, GBP: 11, JPY: 2, CAD: 14, AUD: 3, NZD: 2, CHF: 8,
};

// Titres pour le calendrier
const MEETING_TITLES: Partial<Record<Currency, string>> = {
  USD: "FOMC — Décision taux Fed",
  EUR: "BCE — Governing Council",
  GBP: "BoE MPC — Décision taux",
  JPY: "BoJ — Policy Board",
  CAD: "BoC — Décision taux",
  AUD: "RBA — Décision taux",
  NZD: "RBNZ — Décision taux",
  CHF: "SNB — Décision taux",
};

// ── Extraction des champs (nommage hétérogène selon les CB) ───────────────────

// .github/scripts/fetch-rate-data.mjs écrit toujours "midpoint", quelle que soit
// la devise (CME/Investing.com/InvestingLive écrivent tous le même schéma). Les
// noms par devise ci-dessous ("current_target", "cash_rate_target"…) datent de
// l'ancienne source rateprobability.com (remplacée par le commit 2673686) et ne
// sont plus jamais écrits par le pipeline actuel — d'où le "0.00%" affiché pour
// toute devise autre que USD/NZD (les deux seules à retomber sur "midpoint").
function getCurrentRate(ccy: Currency, today: Record<string, unknown>): number {
  if (typeof today["midpoint"] === "number") return today["midpoint"] as number;
  switch (ccy) {
    case "EUR": return (today["ecb_main_refinancing"]  as number) ?? (today["ecb_deposit_facility"] as number) ?? 0;
    case "GBP": return (today["current_target"]        as number) ?? 0;
    case "JPY": return (today["current_target"]        as number) ?? 0;
    case "CAD": return (today["Overnight Rate Target"] as number) ?? 0;
    case "AUD": return (today["cash_rate_target"]      as number) ?? 0;
    case "NZD": return (today["Official Cash Rate (OCR)"] as number) ?? (today["current_target"] as number) ?? 0;
    default:    return 0;
  }
}

function getAsOf(today: Record<string, unknown>): string {
  const raw = String(today["As of"] ?? today["as_of"] ?? today["run_date"] ?? "");
  return raw.slice(0, 10);
}


// ── Calendriers officiels par banque centrale ─────────────────────────────────
// Utilisés pour les CB sans page Investing.com dédiée (ou dont le fallback IL
// n'a qu'un seul point "year-end") : on construit une vraie courbe multi-réunions
// à partir des dates réelles + de l'estimation InvestingLive (proba/direction).
// Sources officielles, à mettre à jour quand chaque banque publie son calendrier
// suivant (généralement 1x/an) :
//   SNB  : snb.ch/en/the-snb/mandates-goals/monetary-policy/decisions
//   RBNZ : rbnz.govt.nz
//   ECB  : ecb.europa.eu/press/calendars/mgcgc (jour 2 = décision + conf. presse)
//   BoE  : bankofengland.co.uk/monetary-policy/upcoming-mpc-dates
//   BoJ  : boj.or.jp/en/mopo/mpmsche_minu (2027 pas encore publié à l'écriture de ceci)
//   BoC  : bankofcanada.ca (annonce annuelle du calendrier, pas encore publié pour 2027)
//   RBA  : rba.gov.au/schedules-events/board-meeting-schedules.html (jour 2 = décision)

const SNB_MEETINGS: string[] = [
  "2026-06-19", "2026-09-25", "2026-12-11",
  "2027-03-18", "2027-06-17", "2027-09-23", "2027-12-09",
];

const RBNZ_MEETINGS: string[] = [
  "2026-07-09", "2026-08-19", "2026-10-14", "2026-11-25",
  "2027-02-24", "2027-04-09", "2027-05-26", "2027-07-14",
  "2027-08-18", "2027-10-13", "2027-11-24",
];

const ECB_MEETINGS: string[] = [
  "2026-07-23", "2026-09-10", "2026-10-29", "2026-12-17",
  "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10",
  "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16",
];

const BOE_MEETINGS: string[] = [
  "2026-07-30", "2026-09-17", "2026-11-05", "2026-12-17",
  "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-17",
  "2027-07-29", "2027-09-16", "2027-11-04", "2027-12-16",
];

const BOJ_MEETINGS: string[] = [
  "2026-07-31", "2026-09-18", "2026-10-30", "2026-12-18",
];

const BOC_MEETINGS: string[] = [
  "2026-07-15", "2026-09-02", "2026-10-28", "2026-12-09",
];

const RBA_MEETINGS: string[] = [
  "2026-08-11", "2026-09-29", "2026-11-03", "2026-12-08",
  "2027-02-09", "2027-03-23", "2027-05-04", "2027-06-22",
  "2027-08-10", "2027-09-28", "2027-11-02", "2027-12-14",
];

// Construit un CBRatePath depuis un calendrier officiel + l'estimation InvestingLive
// (proba/direction de la prochaine réunion, biais year-end pour les suivantes).
function buildOfficialCalendarPath(
  currency: Currency,
  officialMeetings: string[],
  il: ILExpectationsMap,
  currentRate: number,
): CBRatePath | null {
  const ilData = il[currency];
  if (!ilData) return null;

  const nowIso = new Date().toISOString().slice(0, 10);
  const upcomingMeetings = officialMeetings.filter(d => d >= nowIso);
  if (upcomingMeetings.length === 0) return null;

  const yearEndIsCut = ilData.bpsYearEnd < 0;

  const meetings: RateProbMeeting[] = upcomingMeetings.map((dateIso, i) => {
    const isNext      = i === 0;
    const probMovePct = isNext ? ilData.nextMeetingProbPct : 0;
    const probIsCut   = isNext
      ? (ilData.nextMeetingIsNoChange ? yearEndIsCut : !ilData.nextMeetingIsHike)
      : yearEndIsCut;
    const changeBps   = isNext ? (probMovePct > 50 ? (probIsCut ? -25 : 25) : 0) : 0;
    const impliedRate = isNext && probMovePct > 50
      ? parseFloat((currentRate + (probIsCut ? -0.25 : 0.25)).toFixed(4))
      : currentRate;

    return { label: dateIso.slice(0, 7), dateIso, impliedRate, probMovePct, probIsCut, changeBps };
  });

  const peakMeeting = meetings.reduce((best, m) =>
    m.probMovePct > best.probMovePct ? m : best, meetings[0]
  );

  return {
    currency,
    asOf:           ilData.publishedDate,
    currentRate,
    meetings,
    peakMeeting:    peakMeeting.probMovePct > 0 ? peakMeeting : null,
    yearEndImplied: meetings.at(-1)?.impliedRate ?? null,
    instrumentSource: "InvestingLive — estimation hebdomadaire analyste (pas de futures/OIS coté public pour cette devise) + calendrier officiel de réunions",
  };
}

// ── Fallback : data JSON committé par GitHub Actions ─────────────────────────

function loadCachedRPBody(ccy: string, _slug: string): Record<string, unknown> | null {
  try {
    const filePath = join(process.cwd(), "data", "rate-probabilities.json");
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { data: Record<string, unknown>; fetchedAt: string };
    const entry = parsed.data?.[ccy] as Record<string, unknown> | undefined;
    if (!entry) return null;
    const ageMs = Date.now() - new Date(parsed.fetchedAt).getTime();
    if (ageMs > 168 * 60 * 60 * 1000) { // ignore si > 7 jours
      console.warn(`[rate-prob] cache stale (${Math.round(ageMs / 3600000)}h), skipping`);
      return null;
    }
    console.log(`[rate-prob] ${ccy} loaded from GitHub Actions cache (${Math.round(ageMs / 60000)}min old)`);
    return entry;
  } catch { return null; }
}

function loadHistorySnapshots(): Array<{ date: string; raw: Record<string, unknown> }> {
  try {
    const filePath = join(process.cwd(), "data", "rate-probabilities.json");
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { snapshots?: Array<{ data: Record<string, unknown>; fetchedAt: string }> };
    if (!parsed.snapshots?.length) return [];
    return parsed.snapshots.map(s => ({ date: s.fetchedAt.slice(0, 10), raw: s.data }));
  } catch { return []; }
}

function loadPrevWeekCachedBody(ccy: string): { body: Record<string, unknown>; date: string } | null {
  try {
    const filePath = join(process.cwd(), "data", "rate-probabilities.json");
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { previousWeek?: Record<string, unknown>; previousWeekFetchedAt?: string };
    if (!parsed.previousWeek || !parsed.previousWeekFetchedAt) return null;
    const entry = parsed.previousWeek[ccy] as Record<string, unknown> | undefined;
    if (!entry) return null;
    const ageMs = Date.now() - new Date(parsed.previousWeekFetchedAt).getTime();
    // Le snapshot semaine précédente doit dater de 4 à 10 jours
    if (ageMs < 3 * 86400000 || ageMs > 11 * 86400000) return null;
    return { body: entry, date: parsed.previousWeekFetchedAt.slice(0, 10) };
  } catch { return null; }
}

// Reparse un body brut de rateprobability.com (même format que fetchCBPath)
function parseCBBody(ccy: Currency, body: Record<string, unknown>): CBRatePath | null {
  const today = body["today"] as Record<string, unknown> | undefined;
  if (!today) return null;
  const currentRate = getCurrentRate(ccy, today);
  const asOf = getAsOf(today);
  const nowIso = new Date().toISOString().slice(0, 10);
  const maxIso = new Date(Date.now() + 380 * 86400000).toISOString().slice(0, 10);
  const rawRows = (today["rows"] as Array<Record<string, unknown>> | undefined) ?? [];
  const meetings: RateProbMeeting[] = rawRows
    .filter(r => typeof r["meeting_iso"] === "string" && (r["meeting_iso"] as string) >= nowIso && (r["meeting_iso"] as string) <= maxIso)
    .map(r => ({
      label:       (r["meeting"] as string).slice(0, 6),
      dateIso:     r["meeting_iso"] as string,
      impliedRate: parseFloat(String(r["implied_rate_post_meeting"] ?? currentRate)),
      probMovePct: parseFloat(String(r["prob_move_pct"] ?? 0)),
      probIsCut:   Boolean(r["prob_is_cut"]),
      changeBps:   parseFloat(String(r["change_bps"] ?? 0)),
    }));
  if (!meetings.length) return null;
  const peakMeeting = meetings.reduce((best, m) => m.probMovePct > best.probMovePct ? m : best, meetings[0]);
  const currentYear = new Date().getFullYear();
  const meetsThisYear = meetings.filter(m => m.dateIso <= `${currentYear}-12-31`);
  const yearEndImplied = meetsThisYear.length > 0 ? meetsThisYear.at(-1)!.impliedRate : meetings[0].impliedRate;
  const instrumentSource = typeof today["source"] === "string" ? today["source"] as string : undefined;
  return { currency: ccy, asOf, currentRate, meetings, peakMeeting, yearEndImplied, instrumentSource };
}

// ── Fetch toutes les CB — depuis le cache GitHub Actions + enrichissement IL ───

export async function fetchAllCBPaths(): Promise<RateProbData> {
  // GitHub Actions met à jour data/rate-probabilities.json toutes les heures
  // (CME FedWatch pour USD, Investing.com pour les autres, InvestingLive en fallback)
  const [ilHistory] = await Promise.all([getCachedILHistory()]);
  const ilData   = ilHistory.current;
  const ilPrev   = ilHistory.prev;
  const prevDate = ilHistory.prevDate;

  const data: RateProbData = {};

  // Charge depuis le cache JSON (GitHub Actions)
  for (const ccy of CB_KEYS) {
    const cachedBody = loadCachedRPBody(ccy, ccy.toLowerCase());
    if (cachedBody) {
      const parsed = parseCBBody(ccy, cachedBody);
      if (parsed) data[ccy] = parsed;
    }
  }

  // Enrichissement prevMeetings depuis snapshot semaine précédente
  for (const ccy of CB_KEYS) {
    const path = data[ccy];
    if (!path) continue;
    const prev = loadPrevWeekCachedBody(ccy);
    if (!prev) continue;
    const prevPath = parseCBBody(ccy, prev.body);
    if (prevPath?.meetings.length) {
      data[ccy] = { ...path, prevMeetings: prevPath.meetings, prevWeekDate: prev.date };
    }
  }

  // Historique multi-semaines (snapshots accumulés par GitHub Actions)
  const historySnaps = loadHistorySnapshots();
  if (historySnaps.length) {
    for (const ccy of CB_KEYS) {
      const path = data[ccy];
      if (!path) continue;
      const history: CBRatePath["history"] = [];
      for (const snap of historySnaps) {
        const entry = snap.raw[ccy] as Record<string, unknown> | undefined;
        if (!entry) continue;
        const snapPath = parseCBBody(ccy, entry);
        if (snapPath?.meetings.length) {
          history.push({ date: snap.date, meetings: snapPath.meetings });
        }
      }
      if (history.length) data[ccy] = { ...path, history };
    }
  }

  // Investing.com n'a de Rate Monitor que pour la Fed (USD) — toutes les autres
  // devises retombent sur le fallback InvestingLive, qui n'a qu'un seul point
  // "year-end" (buildILFallback dans fetch-rate-data.mjs). On reconstruit ici une
  // vraie courbe multi-réunions à partir du calendrier officiel de chaque CB +
  // de l'estimation InvestingLive (proba/direction), comme déjà fait pour NZD/CHF.
  const OFFICIAL_CALENDARS: Partial<Record<Currency, { meetings: string[]; fallbackRate: number }>> = {
    CHF: { meetings: SNB_MEETINGS,  fallbackRate: 0.00 },
    NZD: { meetings: RBNZ_MEETINGS, fallbackRate: 2.25 },
    EUR: { meetings: ECB_MEETINGS,  fallbackRate: 2.15 },
    GBP: { meetings: BOE_MEETINGS,  fallbackRate: 3.75 },
    JPY: { meetings: BOJ_MEETINGS,  fallbackRate: 0.75 },
    CAD: { meetings: BOC_MEETINGS,  fallbackRate: 2.25 },
    AUD: { meetings: RBA_MEETINGS,  fallbackRate: 4.35 },
  };
  for (const [ccyStr, cal] of Object.entries(OFFICIAL_CALENDARS)) {
    const ccy = ccyStr as Currency;
    if (!cal) continue;
    // Reconstruit si aucune donnée, ou si le fallback IL n'a mis qu'un seul point.
    if ((data[ccy] && data[ccy]!.meetings.length > 1) || !ilData[ccy]) continue;
    const rate = data[ccy]?.currentRate || cal.fallbackRate;
    const path = buildOfficialCalendarPath(ccy, cal.meetings, ilData, rate);
    if (path) data[ccy] = path;
  }

  // Enrichissement IL : fusion proba première réunion + deltas hebdo
  for (const [ccyStr, ilEntry] of Object.entries(ilData)) {
    const ccy = ccyStr as keyof RateProbData;
    const path = data[ccy];
    if (!path) continue;
    if (typeof ilEntry.bpsYearEnd !== "number") continue;
    if (ilEntry.nextMeetingIsNoChange && Math.abs(ilEntry.bpsYearEnd) < 5) continue;

    // Giuseppe lit le STIR complet (toutes les réunions jusqu'en déc) et publie le cumul bps year-end.
    // Le Rate Monitor Investing.com ne capture parfois que 2-3 réunions → yearEndImplied partiel.
    // → On utilise toujours Giuseppe comme source authoritative pour le cumul fin d'année.
    const yearEndImplied = parseFloat((path.currentRate + ilEntry.bpsYearEnd / 100).toFixed(4));

    let ilDelta: ILWeeklyDelta | undefined;
    const prevEntry = ilPrev[ccy];
    if (prevEntry && prevDate) {
      ilDelta = {
        probDelta: parseFloat((ilEntry.nextMeetingProbPct - prevEntry.nextMeetingProbPct).toFixed(1)),
        bpsDelta:  ilEntry.bpsYearEnd - prevEntry.bpsYearEnd,
        isCut:     ilEntry.bpsYearEnd < 0,
        prevDate,
      };
    }

    const ilProb    = ilEntry.nextMeetingProbPct;
    // Direction basée sur le signe de bpsYearEnd (plus fiable que nextMeetingIsHike
    // qui est faux quand Giuseppe dit "no change" à la prochaine réunion mais hausse year-end)
    const ilIsCut   = ilEntry.bpsYearEnd < 0;
    const m0        = path.meetings[0];
    const stirProb  = m0?.probMovePct ?? 0;

    const ilCurrent: ILCurrent = {
      bpsYearEnd:   ilEntry.bpsYearEnd,
      probPct:      ilProb,
      stirProbPct:  stirProb || undefined,
      isNoChange:   ilEntry.nextMeetingIsNoChange,
      isCut:        ilIsCut,
      articleDate:  ilEntry.publishedDate,
    };

    // Fusion STIR + IL pour la première réunion :
    // Si l'IL a une proba valide ET qu'elle diffère du STIR de plus de 8pp → on fusionne
    // (le STIR IC peut avoir des artefacts de parsing ; l'analyste IL lit la même donnée proprement)
    let updatedMeetings = path.meetings;
    if (m0 && ilProb > 0 && !ilEntry.nextMeetingIsNoChange && Math.abs(ilProb - stirProb) > 8) {
      const updatedM0: RateProbMeeting = {
        ...m0,
        probMovePct: ilProb,
        probIsCut:   ilIsCut,
        changeBps:   ilProb > 50 ? (ilIsCut ? -25 : 25) : 0,
        impliedRate: ilProb > 50
          ? parseFloat((path.currentRate + (ilIsCut ? -0.25 : 0.25)).toFixed(4))
          : path.currentRate,
      };
      updatedMeetings = [updatedM0, ...path.meetings.slice(1)];
    }

    // Recalcule peakMeeting après fusion
    const peakMeeting = updatedMeetings.length
      ? updatedMeetings.reduce((best, m) => m.probMovePct > best.probMovePct ? m : best, updatedMeetings[0])
      : null;

    data[ccy] = {
      ...path,
      meetings:       updatedMeetings,
      peakMeeting:    peakMeeting && peakMeeting.probMovePct > 0 ? peakMeeting : path.peakMeeting,
      yearEndImplied,
      ilCurrent,
      ...(ilDelta ? { ilDelta } : {}),
    };
  }

  return data;
}

// ── Helper calendrier : dates de réunions extraites des paths ─────────────────

export interface CBMeetingEvent {
  currency:    Currency;
  dateIso:     string;
  utcHour:     number;
  title:       string;
  probMovePct: number;
  probIsCut:   boolean;
  changeBps:   number;
}

export function extractMeetingEvents(data: RateProbData, fromDate: string): CBMeetingEvent[] {
  const events: CBMeetingEvent[] = [];
  for (const entry of Object.entries(data) as [Currency, CBRatePath][]) {
    const [ccy, path] = entry;
    const utcHour = ANNOUNCE_UTC[ccy] ?? 12;
    const title   = MEETING_TITLES[ccy] ?? `Décision taux ${ccy}`;
    for (const m of path.meetings) {
      if (m.dateIso < fromDate) continue;
      events.push({ currency: ccy, dateIso: m.dateIso, utcHour, title, probMovePct: m.probMovePct, probIsCut: m.probIsCut, changeBps: m.changeBps });
    }
  }
  return events;
}
