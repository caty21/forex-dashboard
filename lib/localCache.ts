/**
 * localCache — persistance localStorage pour les données du dashboard.
 *
 * Les données économiques (CPI, GDP, PMI…) sont publiées mensuellement.
 * Si une API devient indisponible, on affiche la dernière valeur connue
 * plutôt qu'un tiret vide.
 *
 * Clés stockées :
 *   forex_v1_macro_{USD|EUR|…}     — indicateurs macro (CurrencyCard)
 *   forex_v1_drivers               — marchés globaux (DriversBar)
 *   forex_v1_expectations          — attentes taux
 *   forex_v1_yields                — rendements obligataires
 */

const PREFIX = "forex_v1_";

export interface CacheEntry<T> {
  data: T;
  savedAt: number; // timestamp ms
}

/** Enregistre dans localStorage. Silencieux si indisponible (SSR, storage plein…) */
export function saveCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry<T> = { data, savedAt: Date.now() };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // QuotaExceededError ou autre — on ignore
  }
}

/** Lit depuis localStorage. Retourne null si absent ou corrompu. */
export function loadCache<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

/** Formatte une date de sauvegarde pour l'affichage */
export function formatCacheDate(savedAt: number): string {
  const d = new Date(savedAt);
  const now = new Date();
  const diffH = Math.round((now.getTime() - d.getTime()) / 3_600_000);
  if (diffH < 1)  return "< 1h";
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}j`;
}
