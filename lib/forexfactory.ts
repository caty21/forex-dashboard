// ── ForexFactory calendar — shared fetch utility ──────────────────────────────
// Utilisé par /api/macro (PMI + forecasts) et /api/calendar (calendrier complet).
//
// Disponibilité :
//   • ff_calendar_thisweek.json  : toujours disponible
//   • ff_calendar_nextweek.json  : disponible du lundi au samedi matin environ
//     → Le samedi soir / dimanche matin le fichier est en 404 (FF ne l'a pas encore publié)

export interface FFEvent {
  title:    string;
  country:  string;   // "USD", "EUR", "GBP", etc.
  date:     string;   // ISO string: "2026-05-29T08:30:00-04:00"
  impact:   string;   // "High", "Medium", "Low", "Holiday"
  actual:   string;
  forecast: string;
  previous: string;
}

// Cache séparé par semaine pour un retry rapide si nextweek est indisponible
let _cacheThisWeek: { events: FFEvent[]; ts: number } | null = null;
let _cacheNextWeek: { events: FFEvent[]; ts: number; ok: boolean } | null = null;

const TTL_OK    = 3_600_000; // 1h si le JSON est dispo
const TTL_RETRY = 300_000;   // 5 min si le JSON était absent (réessaie fréquemment)

async function fetchFFWeek(week: "thisweek" | "nextweek"): Promise<FFEvent[]> {
  try {
    const url = `https://nfs.faireconomy.media/ff_calendar_${week}.json`;
    // cache: "no-store" pour éviter que Next.js mette en cache une 404
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ForexDashboard/1.0)" },
    });
    if (!res.ok) return [];
    const text = await res.text();
    const trimmed = text.trim();
    // Rejeter silencieusement les réponses HTML (404/503 pages)
    if (!trimmed.startsWith("[")) return [];
    return JSON.parse(trimmed) as FFEvent[];
  } catch { return []; }
}

/** Retourne les events ForexFactory de cette semaine + semaine prochaine (si dispo). */
export async function fetchFFEvents(): Promise<FFEvent[]> {
  const now = Date.now();

  // Fetch thisweek et nextweek en parallèle pour réduire la latence
  const [thisWeek, nextWeek] = await Promise.all([
    (async () => {
      if (_cacheThisWeek && now - _cacheThisWeek.ts <= TTL_OK) return _cacheThisWeek.events;
      const events = await fetchFFWeek("thisweek");
      _cacheThisWeek = { events, ts: now };
      return events;
    })(),
    (async () => {
      const ttl = _cacheNextWeek?.ok ? TTL_OK : TTL_RETRY;
      if (_cacheNextWeek && now - _cacheNextWeek.ts <= ttl) return _cacheNextWeek.events;
      const events = await fetchFFWeek("nextweek");
      _cacheNextWeek = { events, ts: now, ok: events.length > 0 };
      return events;
    })(),
  ]);

  return [...thisWeek, ...nextWeek];
}

/** Events de cette semaine seulement (pour PMI/forecasts macro). */
export async function fetchFFThisWeek(): Promise<FFEvent[]> {
  const all = await fetchFFEvents();
  const monday = new Date();
  monday.setDate(monday.getDate() - monday.getDay() + 1);
  monday.setHours(0, 0, 0, 0);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return all.filter((e) => {
    const d = new Date(e.date);
    return d >= monday && d < nextMonday;
  });
}

/** Indique si les données de la semaine prochaine sont disponibles. */
export function nextWeekAvailable(): boolean {
  return (_cacheNextWeek?.ok) ?? false;
}
