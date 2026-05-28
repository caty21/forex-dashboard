"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, TrendingUp, AlertTriangle, Zap, Database } from "lucide-react";
import { CURRENCIES, CURRENCY_META } from "@/lib/constants";
import type { Currency, DriverData } from "@/lib/types";
import { saveCache, loadCache, formatCacheDate } from "@/lib/localCache";
import CurrencyCard from "@/components/CurrencyCard";
import DriversBar from "@/components/DriversBar";

const REFRESH_MS = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL_MS ?? "3600000");

export default function Dashboard() {
  const [drivers, setDrivers] = useState<DriverData | null>(null);
  const [expectations, setExpectations] = useState<Record<string, unknown> | null>(null);
  const [yields, setYields] = useState<{ yields: Record<string, number | null>; spreads: Record<string, number | null> } | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [activeDivergences, setActiveDivergences] = useState<{ currency: Currency; score: number }[]>([]);
  const [driversFromCache, setDriversFromCache] = useState(false);
  const [driversCacheAge, setDriversCacheAge]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [driversRes, expectRes, yieldsRes, fxRes] = await Promise.allSettled([
        fetch("/api/drivers").then((r) => r.json()),
        fetch("/api/expectations").then((r) => r.json()),
        fetch("/api/yields").then((r) => r.json()),
        fetch("/api/fx").then((r) => r.json()),
      ]);

      // ── Drivers (marchés globaux) ──────────────────────────────────────────
      if (driversRes.status === "fulfilled" && !driversRes.value?.error) {
        const driversData = driversRes.value as DriverData;
        if (fxRes.status === "fulfilled" && fxRes.value?.dxy != null) {
          driversData.dxy = fxRes.value.dxy;
        }
        setDrivers(driversData);
        setDriversFromCache(false);
        setDriversCacheAge(null);
        saveCache("drivers", driversData);
      } else {
        // Fallback localStorage
        const cached = loadCache<DriverData>("drivers");
        if (cached) {
          setDrivers(cached.data);
          setDriversFromCache(true);
          setDriversCacheAge(formatCacheDate(cached.savedAt));
        }
      }

      // ── Attentes de taux ──────────────────────────────────────────────────
      if (expectRes.status === "fulfilled" && !expectRes.value?.error) {
        setExpectations(expectRes.value);
        saveCache("expectations", expectRes.value);
      } else {
        const cached = loadCache<Record<string, unknown>>("expectations");
        if (cached) setExpectations(cached.data);
      }

      // ── Rendements obligataires ───────────────────────────────────────────
      if (yieldsRes.status === "fulfilled" && !yieldsRes.value?.error) {
        setYields(yieldsRes.value);
        saveCache("yields", yieldsRes.value);
      } else {
        const cached = loadCache<typeof yields>("yields");
        if (cached && cached.data) setYields(cached.data);
      }

      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const handleDivergenceUpdate = useCallback((currency: Currency, score: number) => {
    setActiveDivergences((prev) => {
      const filtered = prev.filter((d) => d.currency !== currency);
      if (Math.abs(score) >= 2) return [...filtered, { currency, score }];
      return filtered;
    });
  }, []);

  const divergenceCount = activeDivergences.filter((d) => Math.abs(d.score) >= 2).length;

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-4">
      {/* Header */}
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Forex Macro Dashboard
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            USD · EUR · GBP · JPY · CHF · CAD · AUD · NZD — v8.0
          </p>
        </div>

        <div className="flex items-center gap-3">
          {divergenceCount > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
              <Zap size={13} className="text-amber-600" />
              <span className="text-xs font-medium text-amber-700">
                {divergenceCount} divergence{divergenceCount > 1 ? "s" : ""} active{divergenceCount > 1 ? "s" : ""}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {driversFromCache && driversCacheAge && (
              <span className="flex items-center gap-0.5 text-amber-500" title="Marchés affichés depuis le cache local — API indisponible">
                <Database size={11} />
                <span>cache {driversCacheAge}</span>
              </span>
            )}
            {lastRefresh.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </div>

          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            {loading ? "Chargement…" : "Rafraîchir"}
          </button>
        </div>
      </header>

      {/* Global drivers bar */}
      {drivers && <DriversBar drivers={drivers} />}

      {/* Active divergences summary */}
      {activeDivergences.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {activeDivergences
            .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
            .map(({ currency, score }) => (
              <div
                key={currency}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium ${
                  score < 0
                    ? "bg-red-50 border-red-200 text-red-700"
                    : "bg-green-50 border-green-200 text-green-700"
                }`}
              >
                <Zap size={10} />
                {CURRENCY_META[currency].flag} {currency} SD:{score > 0 ? "+" : ""}{score}
              </div>
            ))}
        </div>
      )}

      {/* Currency cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {CURRENCIES.map((currency) => (
          <CurrencyCard
            key={currency}
            currency={currency}
            expectations={expectations}
            yields={yields}
            onDivergenceUpdate={handleDivergenceUpdate}
          />
        ))}
      </div>

      {/* Footer */}
      <footer className="mt-6 text-center text-xs text-gray-400 space-y-1">
        <p>
          Sources: FRED · ECB · BoE · BoC · CFTC · Frankfurter · OANDA · investinglive.com
        </p>
        <p>
          LLM: Groq (Llama 3.1) · Données à titre informatif uniquement — pas de conseil financier
        </p>
      </footer>
    </div>
  );
}
