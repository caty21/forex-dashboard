// Détecte automatiquement les changements de taux directeur (Trading Economics)
// et fait glisser l'ancien "current" vers "prev" — sans perte de donnée, sans
// intervention manuelle.
//
// Principe (demandé explicitement) :
//   - Si le taux scrapé == data/rate_decisions.json[ccy].current → rien ne bouge
//     (le "prev" existant reste tel quel, ce n'est pas une nouvelle décision).
//   - Si le taux scrapé != .current → c'est une nouvelle décision de la banque
//     centrale : l'ancien "current" glisse vers "prev", le nouveau taux devient
//     "current". Le "source" de cette devise est réécrit pour tracer le switch.
//   - Si le scrape échoue (page indisponible / format changé) → on garde les
//     valeurs existantes telles quelles, aucune perte de données.
//
// Source : meta description de https://tradingeconomics.com/{slug}/interest-rate
// Format observé : "The benchmark interest rate in/In {Country} was last
//   recorded at {value} percent."
// Note EUR : TE reporte directement le taux MRO sur cette page (2.40% le
//   2026-07-08), cohérent avec la convention MRO déjà utilisée dans ce fichier.

import { writeFileSync, readFileSync, mkdirSync } from "fs";

const CHROME_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control":   "no-cache",
  "Pragma":          "no-cache",
};

const TE_SLUGS = {
  USD: "united-states",
  EUR: "euro-area",
  GBP: "united-kingdom",
  JPY: "japan",
  CHF: "switzerland",
  CAD: "canada",
  AUD: "australia",
  NZD: "new-zealand",
};

const CB_NAME = {
  USD: "Fed (FOMC)", EUR: "BCE", GBP: "BoE MPC", JPY: "BoJ",
  CHF: "SNB", CAD: "BoC", AUD: "RBA", NZD: "RBNZ",
};

async function fetchTERate(slug) {
  try {
    const res = await fetch(`https://tradingeconomics.com/${slug}/interest-rate`, { headers: CHROME_HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const meta = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
              ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (!meta) return null;
    const m = meta[1].match(/at\s+([\d.]+)\s*percent/i);
    return m ? parseFloat(m[1]) : null;
  } catch { return null; }
}

const today = new Date().toISOString().slice(0, 10);

let existing;
try {
  existing = JSON.parse(readFileSync("data/rate_decisions.json", "utf8"))[0];
} catch {
  console.error("✗ Impossible de lire data/rate_decisions.json existant, abandon.");
  process.exit(1);
}

const decisions = { ...existing.decisions };
let changed = false;
const changeLog = [];

for (const [ccy, slug] of Object.entries(TE_SLUGS)) {
  const scraped = await fetchTERate(slug);
  const prevEntry = decisions[ccy];

  if (scraped === null) {
    console.log(`[TE] ${ccy} ✗ scrape échoué → conservé (${prevEntry?.current ?? "?"}%)`);
    await new Promise(r => setTimeout(r, 800));
    continue;
  }

  if (!prevEntry) {
    // Devise jamais vue — initialisation sans historique de "prev"
    decisions[ccy] = {
      current: scraped,
      prev:    scraped,
      source:  `${CB_NAME[ccy] ?? ccy} — initialisation automatique via Trading Economics (${slug}/interest-rate), pas d'historique disponible pour "prev".`,
    };
    changed = true;
    changeLog.push(`${ccy}: init @ ${scraped}%`);
    console.log(`[TE] ${ccy} ⊕ init ${scraped}%`);
  } else if (Math.abs(scraped - prevEntry.current) > 0.001) {
    // Changement détecté : l'ancien "current" glisse vers "prev"
    decisions[ccy] = {
      current: scraped,
      prev:    prevEntry.current,
      source:  `${CB_NAME[ccy] ?? ccy} — changement détecté automatiquement le ${today} via Trading Economics (${slug}/interest-rate) : ${prevEntry.current}% → ${scraped}%.`,
    };
    changed = true;
    changeLog.push(`${ccy}: ${prevEntry.current}% → ${scraped}% (prev glisse)`);
    console.log(`[TE] ${ccy} ⚡ CHANGEMENT ${prevEntry.current}% → ${scraped}%`);
  } else {
    console.log(`[TE] ${ccy} = ${scraped}% (inchangé)`);
  }

  await new Promise(r => setTimeout(r, 800)); // évite le rate-limiting TE
}

if (!changed) {
  console.log("\nAucun changement de taux directeur détecté — fichier inchangé.");
  process.exit(0);
}

mkdirSync("data", { recursive: true });
writeFileSync("data/rate_decisions.json", JSON.stringify([{
  updated_at: today,
  note: existing.note,
  decisions,
}], null, 2) + "\n");

console.log(`\n✓ Mis à jour : ${changeLog.join(" | ")}`);
