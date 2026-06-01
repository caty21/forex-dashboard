"use client";

import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Loader2, Calendar } from "lucide-react";
import { CURRENCIES, CURRENCY_META } from "@/lib/constants";
import type { Currency } from "@/lib/types";
import type { CalendarEvent } from "@/app/api/calendar/route";

interface Props {
  events:        CalendarEvent[];
  loading:       boolean;
  nextWeekAvail: boolean;  // nextweek.json disponible sur le CDN FF
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
};

const IMPACT_COLOR: Record<string, string> = {
  high:   "bg-red-500",
  medium: "bg-amber-400",
  low:    "bg-gray-300",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoToLocalDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function fmtDate(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  const day  = d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return { day, time };
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
  const day = now.getDay();
  const d = new Date(now);
  d.setDate(now.getDate() + (day === 0 ? 1 : 8 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Week bounds ───────────────────────────────────────────────────────────────

function getWeekBounds() {
  const nm = nextMonday();

  const currentStart = new Date(nm);
  currentStart.setDate(nm.getDate() - 7);
  const currentEnd = new Date(nm);
  currentEnd.setDate(nm.getDate() - 1);

  const nextEnd = new Date(nm);
  nextEnd.setDate(nm.getDate() + 6);

  const next2Start = new Date(nm);
  next2Start.setDate(nm.getDate() + 7);
  const next2End = new Date(nm);
  next2End.setDate(nm.getDate() + 13);

  const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return {
    currentWeekLabel: `${fmt(currentStart)} – ${fmt(currentEnd)}`,
    nextWeekLabel:    `${fmt(nm)} – ${fmt(nextEnd)}`,
    next2WeekLabel:   `${fmt(next2Start)} – ${fmt(next2End)}`,
    next2StartLabel:  fmt(next2Start),
    nextMondayIso:    nm.toISOString().slice(0, 10),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ImpactDot({ impact }: { impact: string }) {
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${IMPACT_COLOR[impact] ?? "bg-gray-300"}`} />;
}

function EventRow({ ev, isChild, expanded, onToggle }: {
  ev: CalendarEvent; isChild: boolean; expanded: boolean; onToggle: () => void;
}) {
  const { day, time } = fmtDate(ev.date);
  const meta = CURRENCY_META[ev.currency];

  const rowCls = [
    "border-b border-gray-100 hover:bg-gray-50 transition-colors",
    isChild ? "bg-gray-50/70" : "",
    !ev.isPublished && ev.impact === "high"   ? "border-l-2 border-l-red-400"   : "",
    !ev.isPublished && ev.impact === "medium" ? "border-l-2 border-l-amber-400" : "",
    ev.isPublished ? "opacity-70" : "",
  ].join(" ");

  return (
    <tr className={rowCls}>
      <td className="py-2 px-3 whitespace-nowrap">
        <div className="text-xs font-medium text-gray-700">{day}</div>
        <div className="text-[10px] text-gray-400">{time}</div>
      </td>
      <td className="py-2 px-2 whitespace-nowrap">
        <span className="text-sm">{meta?.flag}</span>
        <span className="ml-1 text-xs font-semibold text-gray-700">{ev.currency}</span>
      </td>
      <td className="py-2 px-3">
        <button
          onClick={ev.isGroupParent ? onToggle : undefined}
          className={`flex items-center gap-1 text-left text-sm ${ev.isGroupParent ? "cursor-pointer font-medium text-gray-800 hover:text-blue-600" : "text-gray-600"} ${isChild ? "pl-4 text-[11px]" : ""}`}
        >
          {ev.isGroupParent && (expanded ? <ChevronDown size={12} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />)}
          {isChild && <span className="text-gray-300 mr-1">↳</span>}
          {ev.title}
        </button>
        <div className="text-[9px] text-gray-400 mt-0.5 pl-4">{CATEGORY_LABELS[ev.category]}</div>
      </td>
      <td className="py-2 px-3 text-right">
        <span className="text-xs text-gray-500 tabular-nums">{ev.previous ?? "—"}</span>
      </td>
      <td className="py-2 px-3 text-right">
        {ev.forecast
          ? <span className="text-xs font-medium text-blue-600 tabular-nums">{ev.forecast}</span>
          : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="py-2 px-3 text-right">
        {ev.actual
          ? <span className={`text-xs font-semibold tabular-nums ${ev.isPublished ? "text-gray-800" : "text-gray-400"}`}>{ev.actual}</span>
          : <span className="text-xs text-gray-200">—</span>}
      </td>
      <td className="py-2 px-3 text-center">
        <ImpactDot impact={ev.impact} />
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type WeekTab = "current" | "next" | "next2" | "all";

export default function CalendarTab({ events, loading, nextWeekAvail }: Props) {
  const [filterCcy, setFilterCcy]   = useState<Currency | "ALL">("ALL");
  const [expanded,  setExpanded]    = useState<Set<string>>(new Set());
  const [showLow,   setShowLow]     = useState(false);
  const [weekTab,   setWeekTab]     = useState<WeekTab>("all");
  const [fromDate,  setFromDate]    = useState<string>(todayIso());

  const { currentWeekLabel, nextWeekLabel, next2WeekLabel, next2StartLabel, nextMondayIso } = useMemo(getWeekBounds, []);

  const toggle = (groupKey: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });

  // Filtrage
  const filtered = useMemo(() => {
    return events.filter((ev) => {
      if (filterCcy !== "ALL" && ev.currency !== filterCcy) return false;
      if (!showLow && ev.impact === "low") return false;
      if (ev.isGroupChild && ev.groupKey && !expanded.has(ev.groupKey)) return false;
      // Filtre semaine
      if (weekTab === "current" && ev.week !== "current") return false;
      if (weekTab === "next"    && ev.week !== "next")    return false;
      if (weekTab === "next2"   && ev.week !== "next2")   return false;
      // Filtre date depuis
      const evDate = isoToLocalDate(ev.date);
      if (evDate < fromDate) return false;
      return true;
    });
  }, [events, filterCcy, showLow, expanded, weekTab, fromDate]);

  // Grouper par jour
  const days: string[] = [];
  const dayMap: Record<string, CalendarEvent[]> = {};
  for (const ev of filtered) {
    const d = isoToLocalDate(ev.date);
    if (!dayMap[d]) { dayMap[d] = []; days.push(d); }
    dayMap[d].push(ev);
  }
  days.sort();

  // Compteurs par semaine pour les onglets
  const countCurrent = events.filter(e => e.week === "current").length;
  const countNext    = events.filter(e => e.week === "next").length;
  const countNext2   = events.filter(e => e.week === "next2").length;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">

      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Calendrier économique</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">Sources : ForexFactory · FRED · Banques centrales</p>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} className="w-3 h-3" />
            Impact faible
          </label>
        </div>
      </div>

      {/* ── Onglets semaine ──────────────────────────────────────────────────── */}
      <div className="flex gap-0 border-b border-gray-200 bg-gray-50/50">
        {([
          ["all",    "Tout",             null,             null],
          ["current","Sem. en cours",    currentWeekLabel, countCurrent],
          ["next",   "Sem. prochaine",   nextWeekLabel,    countNext],
          ["next2",  "Sem. +2 et +",     `${next2StartLabel} et +`, countNext2],
        ] as [WeekTab, string, string | null, number | null][]).map(([tab, label, sub, count]) => {
          const isActive  = weekTab === tab;
          const disabled  = tab === "next" && !nextWeekAvail && countNext === 0;
          const noData    = typeof count === "number" && count === 0 && tab !== "all";
          return (
            <button
              key={tab}
              onClick={() => !disabled && setWeekTab(tab)}
              disabled={disabled}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors text-left ${
                isActive  ? "border-blue-500 text-blue-600 bg-white" :
                disabled  ? "border-transparent text-gray-300 cursor-not-allowed" :
                "border-transparent text-gray-500 hover:text-gray-700 hover:bg-white"
              }`}
            >
              <div className="flex items-center gap-1">
                {label}
                {tab === "next2" && countNext2 > 0 && (
                  <span className="text-[8px] bg-amber-100 text-amber-700 px-1 rounded">FRED</span>
                )}
              </div>
              {sub && (
                <div className={`text-[9px] mt-0.5 ${isActive ? "text-blue-400" : disabled ? "text-gray-300" : "text-gray-400"}`}>
                  {disabled ? "Dispo lundi (retry auto)" : sub}
                </div>
              )}
              {tab !== "all" && typeof count === "number" && (
                <div className={`text-[9px] ${noData ? "text-gray-300" : "text-gray-400"}`}>
                  {count} événement{count !== 1 ? "s" : ""}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Filtre devise + date ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-100">
        {/* Date depuis */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Calendar size={11} className="text-gray-400" />
          <span className="text-[10px] text-gray-500">Depuis</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="text-[10px] border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 focus:outline-none focus:border-blue-400"
          />
          <button
            onClick={() => setFromDate(todayIso())}
            className="text-[9px] text-blue-500 hover:text-blue-700 underline"
          >
            Aujourd&apos;hui
          </button>
        </div>

        <div className="w-px h-4 bg-gray-200 shrink-0" />

        {/* Filtre devise */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilterCcy("ALL")}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${filterCcy === "ALL" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            Tout
          </button>
          {CURRENCIES.map((ccy) => (
            <button
              key={ccy}
              onClick={() => setFilterCcy(ccy === filterCcy ? "ALL" : ccy)}
              className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${filterCcy === ccy ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {CURRENCY_META[ccy].flag} {ccy}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-gray-300" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-gray-400">Aucun événement pour cette sélection</p>
          {weekTab === "next" && !nextWeekAvail && (
            <p className="text-[10px] text-gray-400 mt-1">
              ForexFactory ne publie la semaine prochaine que du lundi au vendredi.<br />
              Données disponibles dans quelques heures.
            </p>
          )}
          {fromDate > todayIso() && (
            <button onClick={() => setFromDate(todayIso())} className="mt-2 text-[10px] text-blue-500 underline">
              Revenir à aujourd&apos;hui
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
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
                let lastWeek: "current" | "next" | "next2" | null = null;
                for (const day of days) {
                  const dayEvents = dayMap[day];
                  if (!dayEvents?.length) continue;
                  const w = dayEvents[0].week;
                  // Séparateur de semaine
                  if (weekTab === "all" && w !== lastWeek) {
                    lastWeek = w;
                    const weekBanners: Record<string, string> = {
                      current: `📅 Semaine en cours — ${currentWeekLabel}`,
                      next:    `📅 Semaine prochaine — ${nextWeekLabel}`,
                      next2:   `📅 À partir du ${next2StartLabel} — réunions CB + données économiques`,
                    };
                    rows.push(
                      <tr key={`wsep_${w}`} className={w === "next2" ? "bg-amber-600" : "bg-indigo-600"}>
                        <td colSpan={7} className="px-4 py-1.5 text-[10px] font-bold text-white uppercase tracking-widest">
                          {weekBanners[w] ?? w}
                        </td>
                      </tr>
                    );
                  }
                  // Séparateur de jour
                  rows.push(
                    <tr key={`dsep_${day}`} className="bg-blue-50">
                      <td colSpan={7} className="px-3 py-1.5 text-[10px] font-semibold text-blue-700 capitalize">
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
      <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Impact élevé</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Impact moyen</span>
        <span>· Cliquer sur une ligne groupée pour voir les sous-indicateurs</span>
        <span>· Prévision = consensus marché avant publication</span>
      </div>
    </div>
  );
}
