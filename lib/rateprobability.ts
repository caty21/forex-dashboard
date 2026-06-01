// lib/rateprobability.ts
// Données de probabilités de taux depuis rateprobability.com (API publique OIS/futures)
// Endpoint pattern: https://rateprobability.com/api/{cb}/latest

import type { Currency } from "./types";
import { fetchILExpectations } from "./investinglive";
import type { ILExpectationsMap } from "./investinglive";

// ── Types publics ──────────────────────────────────────────────────────────────

export interface RateProbMeeting {
  label:       string;   // "Jun 11" — 6 chars max
  dateIso:     string;   // "2026-06-11"
  impliedRate: number;   // taux implicite post-réunion
  probMovePct: number;   // 0–100 : probabilité d'un mouvement
  probIsCut:   boolean;  // true = baisse, false = hausse
  changeBps:   number;   // bps attendus à cette réunion (cumulatif)
}

export interface CBRatePath {
  currency:       Currency;
  asOf:           string;          // "2026-05-31"
  currentRate:    number;
  meetings:       RateProbMeeting[];
  peakMeeting:    RateProbMeeting | null;  // réunion avec proba max de mouvement
  yearEndImplied: number | null;           // taux impliqué à la dernière réunion connue
}

export type RateProbData = Partial<Record<Currency, CBRatePath>>;

// ── Mapping CB → endpoint ──────────────────────────────────────────────────────

const CB_KEYS: [Currency, string][] = [
  ["USD", "fed"],
  ["EUR", "ecb"],
  ["GBP", "boe"],
  ["JPY", "boj"],
  ["CAD", "boc"],
  ["AUD", "rba"],
  ["NZD", "rbnz"],
];

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

function getCurrentRate(ccy: Currency, today: Record<string, unknown>): number {
  switch (ccy) {
    case "USD": return (today["midpoint"]              as number) ?? 0;
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

// ── Fetch une CB ───────────────────────────────────────────────────────────────

async function fetchCBPath(ccy: Currency, slug: string): Promise<CBRatePath | null> {
  try {
    const res = await fetch(`https://rateprobability.com/api/${slug}/latest`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Referer":    `https://rateprobability.com/${slug}`,
        "Accept":     "application/json, */*",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const body  = await res.json() as Record<string, unknown>;
    const today = body["today"] as Record<string, unknown> | undefined;
    if (!today) return null;

    const currentRate = getCurrentRate(ccy, today);
    const asOf        = getAsOf(today);
    const nowIso      = new Date().toISOString().slice(0, 10);
    const maxIso      = new Date(Date.now() + 380 * 86400000).toISOString().slice(0, 10);

    const rawRows = (today["rows"] as Array<Record<string, unknown>> | undefined) ?? [];
    const meetings: RateProbMeeting[] = rawRows
      .filter(r =>
        typeof r["meeting_iso"] === "string" &&
        (r["meeting_iso"] as string) >= nowIso &&
        (r["meeting_iso"] as string) <= maxIso
      )
      .map(r => ({
        label:       (r["meeting"] as string).slice(0, 6),
        dateIso:     r["meeting_iso"] as string,
        impliedRate: parseFloat(String(r["implied_rate_post_meeting"] ?? currentRate)),
        probMovePct: parseFloat(String(r["prob_move_pct"] ?? 0)),
        probIsCut:   Boolean(r["prob_is_cut"]),
        changeBps:   parseFloat(String(r["change_bps"] ?? 0)),
      }));

    const peakMeeting = meetings.length > 0
      ? meetings.reduce((best, m) => m.probMovePct > best.probMovePct ? m : best, meetings[0])
      : null;

    const yearEndImplied = meetings.length > 0
      ? meetings[meetings.length - 1].impliedRate
      : null;

    return { currency: ccy, asOf, currentRate, meetings, peakMeeting, yearEndImplied };
  } catch { return null; }
}

// ── SNB meeting dates (published par la SNB, trimestrielles) ─────────────────
// Mise à jour annuelle : mars, juin, septembre, décembre

const SNB_MEETINGS: string[] = [
  // 2026
  "2026-06-19",
  "2026-09-25",
  "2026-12-11",
  // 2027
  "2027-03-18",
  "2027-06-17",
  "2027-09-23",
  "2027-12-09",
];

// Construit un CBRatePath CHF depuis les données InvestingLive (probabilités OIS-équivalent)
function buildSNBPath(il: ILExpectationsMap, currentRate: number): CBRatePath | null {
  const chfData = il["CHF"];
  if (!chfData) return null;

  const nowIso = new Date().toISOString().slice(0, 10);
  const upcomingMeetings = SNB_MEETINGS.filter(d => d >= nowIso);
  if (upcomingMeetings.length === 0) return null;

  // Direction par défaut : bpsYearEnd > 0 = hausse, < 0 = baisse
  const yearEndIsHike = chfData.bpsYearEnd >= 0;

  const meetings: RateProbMeeting[] = upcomingMeetings.map((dateIso, i) => {
    const isNext = i === 0;
    const probMovePct = isNext ? chfData.nextMeetingProbPct : 0;
    // Si "no change" à la prochaine réunion, la direction vient du biais year-end
    const probIsCut = isNext
      ? (chfData.nextMeetingIsNoChange ? !yearEndIsHike : !chfData.nextMeetingIsHike)
      : !yearEndIsHike;
    const changeBps = isNext ? (probIsCut ? -chfData.bpsYearEnd : chfData.bpsYearEnd) : 0;
    const impliedRate  = isNext && probMovePct > 50
      ? currentRate + (probIsCut ? -0.25 : 0.25)
      : currentRate;

    return {
      label:       dateIso.slice(0, 7), // "2026-06"
      dateIso,
      impliedRate,
      probMovePct,
      probIsCut,
      changeBps,
    };
  });

  const peakMeeting = meetings.reduce((best, m) =>
    m.probMovePct > best.probMovePct ? m : best, meetings[0]
  );

  return {
    currency:       "CHF",
    asOf:           chfData.publishedDate,
    currentRate,
    meetings,
    peakMeeting:    peakMeeting.probMovePct > 0 ? peakMeeting : null,
    yearEndImplied: meetings.at(-1)?.impliedRate ?? null,
  };
}

// ── Fetch toutes les CB en parallèle ──────────────────────────────────────────

export async function fetchAllCBPaths(): Promise<RateProbData> {
  // rateprobability.com (7 CBs) + InvestingLive (tous CBs + CHF) en parallèle
  const [rpResults, ilData] = await Promise.all([
    Promise.allSettled(CB_KEYS.map(([ccy, slug]) => fetchCBPath(ccy, slug))),
    fetchILExpectations(),
  ]);

  const data: RateProbData = {};

  // Intègre les données rateprobability.com
  for (let i = 0; i < CB_KEYS.length; i++) {
    const [ccy] = CB_KEYS[i];
    const r = rpResults[i];
    if (r.status === "fulfilled" && r.value) data[ccy] = r.value;
  }

  // CHF/SNB : rateprobability ne couvre pas la SNB → InvestingLive est la seule source
  if (!data["CHF"] && ilData["CHF"]) {
    const snbPath = buildSNBPath(ilData, 0.00); // taux actuel SNB = 0%
    if (snbPath) data["CHF"] = snbPath;
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
