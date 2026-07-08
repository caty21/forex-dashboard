"use client";

import React, { useState, useMemo, useRef } from "react";
import { ChevronDown, ChevronRight, Loader2, Calendar } from "lucide-react";
import { CURRENCY_META } from "@/lib/constants";
import type { CalendarEvent } from "@/app/api/calendar/route";

interface Props {
  events:        CalendarEvent[];
  loading:       boolean;
  nextWeekAvail: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  employment:    "Emploi",
  pmi:           "PMI",
  policy_rate:   "Taux directeur",
  cb_speech:     "Discours BC",
  inflation:     "Inflation",
  gdp:           "PIB",
  retail_sales:  "Ventes détail",
  trade_balance: "Balance comm.",
  sentiment:      "Confiance",
  housing:        "Immobilier",
  money_supply:   "Masse monétaire",
  trade_detail:   "Commerce (détail)",
  regional_fed:   "Fed régionale",
  portfolio_flows:"Flux portefeuille",
  public_finance: "Finances publiques",
  holiday:        "Jour férié",
  other:         "Autre",
};

// ── Currency → ISO alpha-2 (pour flagcdn.com) ─────────────────────────────────
// Univers élargi (45 pays côté calendrier, au-delà des 8 devises majeures tradées).

const CCY_ISO: Record<string, string> = {
  USD: "us", EUR: "eu", GBP: "gb", JPY: "jp",
  CAD: "ca", AUD: "au", NZD: "nz", CHF: "ch",
  CNY: "cn", SEK: "se", NOK: "no", DKK: "dk",
  SGD: "sg", HKD: "hk", MXN: "mx", BRL: "br",
  ZAR: "za", INR: "in", KRW: "kr", TRY: "tr",
  ARS: "ar", CLP: "cl", COP: "co", CZK: "cz",
  HUF: "hu", ISK: "is", IDR: "id", ILS: "il",
  KWD: "kw", PLN: "pl", RON: "ro", RUB: "ru", VND: "vn",
};

// Ordre d'affichage préféré des chips devise : majeures d'abord, puis le reste
// trié alphabétiquement (calculé dynamiquement depuis les events reçus).
const MAJOR_ORDER = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoToLocalDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function fmtDate(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return {
    day:  d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" }),
    time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function fmtDayLabel(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextMonday(): Date {
  const now = new Date();
  const d   = new Date(now);
  d.setDate(now.getDate() + (now.getDay() === 0 ? 1 : 8 - now.getDay()));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekBounds() {
  const nm = nextMonday();
  const prevStart    = new Date(nm); prevStart.setDate(nm.getDate() - 14);
  const prevEnd      = new Date(nm); prevEnd.setDate(nm.getDate() - 8);
  const currentStart = new Date(nm); currentStart.setDate(nm.getDate() - 7);
  const currentEnd   = new Date(nm); currentEnd.setDate(nm.getDate() - 1);
  const nextEnd      = new Date(nm); nextEnd.setDate(nm.getDate() + 6);
  const next2Start   = new Date(nm); next2Start.setDate(nm.getDate() + 7);
  const next2End     = new Date(nm); next2End.setDate(nm.getDate() + 13);
  const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return {
    prevWeekLabel:    `${fmt(prevStart)} – ${fmt(prevEnd)}`,
    currentWeekLabel: `${fmt(currentStart)} – ${fmt(currentEnd)}`,
    nextWeekLabel:    `${fmt(nm)} – ${fmt(nextEnd)}`,
    next2WeekLabel:   `${fmt(next2Start)} – ${fmt(next2End)}`,
    next2StartLabel:  fmt(next2Start),
    nextMondayIso:    nm.toISOString().slice(0, 10),
  };
}

// ── Impact dot ────────────────────────────────────────────────────────────────

function ImpactDot({ impact }: { impact: string }) {
  const cls = impact === "high"   ? "bg-red-500"
            : impact === "medium" ? "bg-amber-400"
            : "bg-slate-600";
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cls}`} />;
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({ ev, isChild, expanded, onToggle }: {
  ev: CalendarEvent; isChild: boolean; expanded: boolean; onToggle: () => void;
}) {
  const { day, time } = fmtDate(ev.date);

  const borderCls = !ev.isPublished && ev.impact === "high"   ? "border-l-2 border-l-red-500"
                  : !ev.isPublished && ev.impact === "medium" ? "border-l-2 border-l-amber-400"
                  : "border-l-2 border-l-transparent";

  return (
    <tr className={`border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors ${borderCls} ${ev.isPublished ? "opacity-60" : ""} ${isChild ? "bg-slate-900/40" : ""}`}>

      <td className="py-2 px-3 whitespace-nowrap">
        <div className="text-xs font-medium text-slate-300">{day}</div>
        <div className="text-[10px] text-slate-600">{time}</div>
      </td>

      <td className="py-2 px-2 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full overflow-hidden shrink-0 bg-slate-700">
            <img
              src={`https://flagcdn.com/w40/${CCY_ISO[ev.currency] ?? ev.currency.slice(0,2).toLowerCase()}.png`}
              width={20} height={20}
              alt={ev.currency}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <span className="text-xs font-semibold text-slate-300">{ev.currency}</span>
        </div>
      </td>

      <td className="py-2 px-3">
        <button
          onClick={ev.isGroupParent ? onToggle : undefined}
          className={`flex items-center gap-1 text-left text-[12px] ${
            ev.isGroupParent
              ? "cursor-pointer font-medium text-slate-200 hover:text-amber-400"
              : "text-slate-400"
          } ${isChild ? "pl-4 text-[11px]" : ""}`}
        >
          {ev.isGroupParent && (
            expanded
              ? <ChevronDown size={12} className="text-slate-500 flex-shrink-0" />
              : <ChevronRight size={12} className="text-slate-500 flex-shrink-0" />
          )}
          {isChild && <span className="text-slate-600 mr-1">↳</span>}
          {ev.title}
        </button>
        <div className="text-[9px] text-slate-600 mt-0.5 pl-4">{CATEGORY_LABELS[ev.category]}</div>
      </td>

      <td className="py-2 px-3 text-right">
        <span className="text-xs text-slate-500 tabular-nums">{ev.previous ?? "—"}</span>
      </td>

      <td className="py-2 px-3 text-right">
        {ev.forecast
          ? <span className="text-xs font-medium text-amber-400 tabular-nums">{ev.forecast}</span>
          : <span className="text-xs text-slate-700">—</span>}
      </td>

      <td className="py-2 px-3 text-right">
        {ev.actual
          ? <span className={`text-xs font-semibold tabular-nums ${ev.isPublished ? "text-slate-200" : "text-slate-500"}`}>{ev.actual}</span>
          : <span className="text-xs text-slate-700">—</span>}
      </td>

      <td className="py-2 px-3 text-center">
        <ImpactDot impact={ev.impact} />
      </td>
    </tr>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

type WeekTab = "prev" | "current" | "next" | "next2" | "all";

export default function CalendarTab({ events, loading, nextWeekAvail }: Props) {
  const [filterCcy, setFilterCcy] = useState<string>("ALL");
  const [expanded,  setExpanded]  = useState<Set<string>>(new Set());
  const [showLow,   setShowLow]   = useState(false);
  const [weekTab,   setWeekTab]   = useState<WeekTab>("all");
  const [fromDate,  setFromDate]  = useState<string>(todayIso());
  const fromDateRef = useRef<HTMLInputElement>(null);

  const { prevWeekLabel, currentWeekLabel, nextWeekLabel, next2StartLabel, nextMondayIso } = useMemo(getWeekBounds, []);
  void nextMondayIso;

  const toggle = (groupKey: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });

  const filtered = useMemo(() => events.filter(ev => {
    if (filterCcy !== "ALL" && ev.currency !== filterCcy) return false;
    if (!showLow && ev.impact === "low") return false;
    if (ev.isGroupChild && ev.groupKey && !expanded.has(ev.groupKey)) return false;
    if (weekTab === "prev"    && ev.week !== "prev")    return false;
    if (weekTab === "current" && ev.week !== "current") return false;
    if (weekTab === "next"    && ev.week !== "next")    return false;
    if (weekTab === "next2"   && ev.week !== "next2")   return false;
    // Pour "semaine dernière", ne pas filtrer par fromDate (les events sont passés)
    if (weekTab !== "prev" && isoToLocalDate(ev.date) < fromDate) return false;
    return true;
  }), [events, filterCcy, showLow, expanded, weekTab, fromDate]);

  // Chips devise : toutes les devises présentes dans les events reçus,
  // majeures d'abord (ordre trading), puis le reste par ordre alphabétique.
  const availableCurrencies = useMemo(() => {
    const set = new Set(events.map(ev => ev.currency));
    return Array.from(set).sort((a, b) => {
      const ia = MAJOR_ORDER.indexOf(a), ib = MAJOR_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [events]);

  const days: string[] = [];
  const dayMap: Record<string, CalendarEvent[]> = {};
  for (const ev of filtered) {
    const d = isoToLocalDate(ev.date);
    if (!dayMap[d]) { dayMap[d] = []; days.push(d); }
    dayMap[d].push(ev);
  }
  days.sort();

  const countPrev    = events.filter(e => e.week === "prev").length;
  const countCurrent = events.filter(e => e.week === "current").length;
  const countNext    = events.filter(e => e.week === "next").length;
  const countNext2   = events.filter(e => e.week === "next2").length;

  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">

      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Calendrier économique</h2>
            <p className="text-[10px] text-slate-600 mt-0.5">Sources : Trading Economics · investingLive · Banques centrales</p>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showLow}
              onChange={e => setShowLow(e.target.checked)}
              className="w-3 h-3 accent-amber-500"
            />
            Impact faible
          </label>
        </div>
      </div>

      {/* Onglets semaine */}
      <div className="flex gap-0 border-b border-slate-800 bg-slate-900/40">
        {([
          ["all",     "Tout",            null,             null],
          ["prev",    "Sem. dernière",   prevWeekLabel,    countPrev],
          ["current", "Sem. en cours",   currentWeekLabel, countCurrent],
          ["next",    "Sem. prochaine",  nextWeekLabel,    countNext],
          ["next2",   "Sem. +2 et +",   `${next2StartLabel} et +`, countNext2],
        ] as [WeekTab, string, string | null, number | null][]).map(([tab, label, sub, count]) => {
          const isActive = weekTab === tab;
          const disabled = tab === "next" && !nextWeekAvail && countNext === 0;
          return (
            <button
              key={tab}
              onClick={() => !disabled && setWeekTab(tab)}
              disabled={disabled}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors text-left ${
                isActive  ? "border-amber-500 text-amber-400 bg-slate-900/60" :
                disabled  ? "border-transparent text-slate-700 cursor-not-allowed" :
                "border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/40"
              }`}
            >
              <div className="flex items-center gap-1">
                {label}
                {tab === "next2" && countNext2 > 0 && (
                  <span className="text-[8px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1 rounded">FRED</span>
                )}
              </div>
              {sub && (
                <div className={`text-[9px] mt-0.5 ${isActive ? "text-amber-500/70" : disabled ? "text-slate-700" : "text-slate-600"}`}>
                  {disabled ? "Dispo lundi (retry auto)" : sub}
                </div>
              )}
              {tab !== "all" && typeof count === "number" && (
                <div className={`text-[9px] ${count === 0 ? "text-slate-700" : "text-slate-500"}`}>
                  {count} événement{count !== 1 ? "s" : ""}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Filtre devise + date */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-900/20">
        <div className="flex items-center gap-1.5 shrink-0">
          <Calendar size={11} className="text-slate-600" />
          <span className="text-[10px] text-slate-500">Depuis</span>
          {/* defaultValue (pas value) : un input date="" contrôlé re-render à chaque
              frappe et casse la saisie clavier native (les segments jour/mois/année
              se mélangent, y compris si le re-render est déclenché indirectement via
              une key). Non-contrôlé après le mount ; le bouton "Aujourd'hui" resynchronise
              l'affichage à la main via la ref, sans jamais re-render l'input lui-même. */}
          <input
            ref={fromDateRef}
            type="date"
            defaultValue={fromDate}
            onChange={e => {
              const v = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setFromDate(v);
            }}
            className="text-[10px] bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-300 focus:outline-none focus:border-amber-500/50"
          />
          <button
            onClick={() => {
              const today = todayIso();
              setFromDate(today);
              if (fromDateRef.current) fromDateRef.current.value = today;
            }}
            className="text-[9px] text-amber-500 hover:text-amber-400 underline"
          >
            Aujourd&apos;hui
          </button>
        </div>

        <div className="w-px h-4 bg-slate-700 shrink-0" />

        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterCcy("ALL")}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
              filterCcy === "ALL"
                ? "bg-slate-200 text-slate-900"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            }`}
          >
            Tout
          </button>
          {availableCurrencies.map(ccy => (
            <button
              key={ccy}
              onClick={() => setFilterCcy(ccy === filterCcy ? "ALL" : ccy)}
              className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                filterCcy === ccy
                  ? "bg-amber-500 text-slate-900"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              }`}
            >
              {CURRENCY_META[ccy as keyof typeof CURRENCY_META]?.flag ?? ""} {ccy}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-slate-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-slate-500">Aucun événement pour cette sélection</p>
          {weekTab === "next" && !nextWeekAvail && (
            <p className="text-[10px] text-slate-600 mt-1">
              ForexFactory ne publie la semaine prochaine que du lundi au vendredi.<br />
              Données disponibles dans quelques heures.
            </p>
          )}
          {fromDate > todayIso() && (
            <button
              onClick={() => {
                const today = todayIso();
                setFromDate(today);
                if (fromDateRef.current) fromDateRef.current.value = today;
              }}
              className="mt-2 text-[10px] text-amber-500 underline"
            >
              Revenir à aujourd&apos;hui
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-slate-900/60 text-[10px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800">
                <th className="py-2 px-3 text-left">Date / Heure</th>
                <th className="py-2 px-2 text-left">Devise</th>
                <th className="py-2 px-3 text-left">Événement</th>
                <th className="py-2 px-3 text-right">Précédent</th>
                <th className="py-2 px-3 text-right">Prévision</th>
                <th className="py-2 px-3 text-right">Actuel</th>
                <th className="py-2 px-3 text-center">Impact</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const rows: React.ReactNode[] = [];
                let lastWeek: string | null = null;
                for (const day of days) {
                  const dayEvents = dayMap[day];
                  if (!dayEvents?.length) continue;
                  const w = dayEvents[0].week;

                  // Séparateur semaine
                  if (weekTab === "all" && w !== lastWeek) {
                    lastWeek = w;
                    const weekBanners: Record<string, string> = {
                      prev:    `Semaine dernière — ${prevWeekLabel}`,
                      current: `Semaine en cours — ${currentWeekLabel}`,
                      next:    `Semaine prochaine — ${nextWeekLabel}`,
                      next2:   `À partir du ${next2StartLabel} — réunions BC + données`,
                    };
                    const isNext2 = w === "next2";
                    const isPrev  = w === "prev";
                    const bannerCls = isPrev ? "bg-slate-700/30" : isNext2 ? "bg-amber-500/15" : "bg-indigo-500/15";
                    const textCls   = isPrev ? "text-slate-500"  : isNext2 ? "text-amber-400"  : "text-indigo-400";
                    rows.push(
                      <tr key={`wsep_${w}`} className={bannerCls}>
                        <td colSpan={7} className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest ${textCls}`}>
                          📅 {weekBanners[w] ?? w}
                        </td>
                      </tr>
                    );
                  }

                  // Séparateur jour
                  rows.push(
                    <tr key={`dsep_${day}`} className="bg-slate-800/50">
                      <td colSpan={7} className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 capitalize">
                        {fmtDayLabel(day)}
                      </td>
                    </tr>
                  );

                  for (const ev of dayEvents) {
                    rows.push(
                      <EventRow
                        key={ev.id}
                        ev={ev}
                        isChild={ev.isGroupChild}
                        expanded={ev.groupKey ? expanded.has(ev.groupKey) : false}
                        onToggle={() => ev.groupKey && toggle(ev.groupKey)}
                      />
                    );
                  }
                }
                return rows;
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-800 text-[10px] text-slate-600">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Impact élevé</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Impact moyen</span>
        <span className="hidden sm:inline">· Cliquer sur une ligne groupée pour voir les sous-indicateurs</span>
        <span className="hidden sm:inline">· Prévision = consensus marché avant publication</span>
      </div>
    </div>
  );
}
