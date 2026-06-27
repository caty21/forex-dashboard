// Runs in GitHub Actions (not Vercel) — fetches from rateprobability.com
// GitHub Actions IPs are not blocked by the site.
import { writeFileSync, mkdirSync, readFileSync } from "fs";

const CB_KEYS = [
  ["USD", "fed"],
  ["EUR", "ecb"],
  ["GBP", "boe"],
  ["JPY", "boj"],
  ["CAD", "boc"],
  ["AUD", "rba"],
  ["NZD", "rbnz"],
];

const HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept":          "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "sec-ch-ua":       '"Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile":"?0",
  "sec-fetch-dest":  "empty",
  "sec-fetch-mode":  "cors",
  "sec-fetch-site":  "same-origin",
};

async function fetchCB(ccy, slug) {
  try {
    const res = await fetch(`https://rateprobability.com/api/${slug}/latest`, {
      headers: { ...HEADERS, "Referer": `https://rateprobability.com/${slug}`, "Origin": "https://rateprobability.com" },
    });
    if (!res.ok) { console.error(`[${ccy}] HTTP ${res.status}`); return null; }
    const body = await res.json();
    console.log(`[${ccy}] OK — meetings: ${body?.today?.rows?.length ?? "?"}`);
    return body;
  } catch (e) {
    console.error(`[${ccy}] Error: ${e.message}`);
    return null;
  }
}

const results = {};
for (const [ccy, slug] of CB_KEYS) {
  const data = await fetchCB(ccy, slug);
  if (data) results[ccy] = data;
  await new Promise(r => setTimeout(r, 300)); // 300ms entre requêtes
}

// Rotation : si les données existantes datent de 5–9 jours → les sauvegarder comme previousWeek
let previousWeek = null;
let previousWeekFetchedAt = null;
try {
  const existing = JSON.parse(readFileSync("data/rate-probabilities.json", "utf8"));
  const ageMs = Date.now() - new Date(existing.fetchedAt).getTime();
  const day = 86400000;
  if (ageMs >= 5 * day && ageMs <= 9 * day) {
    // Les données courantes datent d'une semaine → les promouvoir en previousWeek
    previousWeek = existing.data;
    previousWeekFetchedAt = existing.fetchedAt;
    console.log(`\nRotated existing data (${(ageMs / day).toFixed(1)}d old) to previousWeek`);
  } else if (existing.previousWeek && existing.previousWeekFetchedAt) {
    // Conserver le previousWeek existant s'il est encore dans la fenêtre utile (< 11 jours)
    const prevAge = Date.now() - new Date(existing.previousWeekFetchedAt).getTime();
    if (prevAge < 11 * day) {
      previousWeek = existing.previousWeek;
      previousWeekFetchedAt = existing.previousWeekFetchedAt;
    }
  }
} catch { /* pas de fichier existant */ }

mkdirSync("data", { recursive: true });
writeFileSync(
  "data/rate-probabilities.json",
  JSON.stringify({
    data: results,
    fetchedAt: new Date().toISOString(),
    ...(previousWeek ? { previousWeek, previousWeekFetchedAt } : {}),
  }, null, 2)
);

console.log(`\nSaved ${Object.keys(results).length} CBs: ${Object.keys(results).join(", ")}`);
if (previousWeek) console.log(`previousWeek preserved (${Object.keys(previousWeek).join(", ")})`);
