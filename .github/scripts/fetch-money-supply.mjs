// Scrape Trading Economics pour la masse monétaire M3 (niveau, devise locale)
// de chaque zone monétaire suivie par le dashboard.
//
// Source : meta description de https://tradingeconomics.com/{slug}/money-supply-m3
// Format observé : "Money Supply M3 in/In the {Country} increased/decreased to
//   {value} {CCY} {Million|Billion} in {Month} from {value} {CCY} {Million|Billion}
//   in {Month} of {Year}."
//
// USD : la Fed a arrêté de publier M3 en 2006 → proxy M2
//   (https://tradingeconomics.com/united-states/money-supply-m2, même format de meta desc).
//
// Cadence : ces données sont mensuelles avec ~4-6 semaines de retard (le mois le
// plus récent apparaît des semaines après sa clôture) → un scraping hebdomadaire
// suffit largement, pas besoin d'une fréquence horaire comme pour les taux/OIS.

import { writeFileSync, readFileSync, mkdirSync } from "fs";

const CHROME_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control":   "no-cache",
  "Pragma":          "no-cache",
};

const MONTHS = { January:"01",February:"02",March:"03",April:"04",May:"05",June:"06",
                 July:"07",August:"08",September:"09",October:"10",November:"11",December:"12" };

// slug TE + éventuel slug d'indicateur différent (USD → money-supply-m2, proxy)
const SERIES = {
  USD: { slug: "united-states",  indicator: "money-supply-m2", isProxy: true,  proxyLabel: "M2 (M3 non publié par la Fed depuis 2006)" },
  EUR: { slug: "euro-area",      indicator: "money-supply-m3", isProxy: false },
  GBP: { slug: "united-kingdom", indicator: "money-supply-m3", isProxy: false },
  JPY: { slug: "japan",          indicator: "money-supply-m3", isProxy: false },
  CHF: { slug: "switzerland",    indicator: "money-supply-m3", isProxy: false },
  CAD: { slug: "canada",         indicator: "money-supply-m3", isProxy: false },
  AUD: { slug: "australia",      indicator: "money-supply-m3", isProxy: false },
  NZD: { slug: "new-zealand",    indicator: "money-supply-m3", isProxy: false },
};

const DESC_RE = /Money Supply M[23][^.]*?\bto\s+([\d.]+)\s+([A-Z]{3})\s+(Million|Billion)\s+in\s+(\w+)\s+from\s+[\d.]+\s+[A-Z]{3}\s+(?:Million|Billion)\s+in\s+\w+\s+of\s+(\d{4})/i;

async function fetchMoneySupply(ccy, { slug, indicator }) {
  try {
    const res = await fetch(`https://tradingeconomics.com/${slug}/${indicator}`, { headers: CHROME_HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    const meta = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
              ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (!meta) return null;

    const m = meta[1].match(DESC_RE);
    if (!m) return null;
    const [, value, ccyCode, unitWord, month, year] = m;
    const monthNum = MONTHS[month];
    if (!monthNum) return null;

    return {
      value:  parseFloat(value),
      unit:   `${ccyCode} ${unitWord === "Billion" ? "Bn" : "Mn"}`,
      period: `${year}-${monthNum}`,
      source: `https://tradingeconomics.com/${slug}/${indicator}`,
    };
  } catch { return null; }
}

// ── Fusionne avec le fichier existant : garde l'ancienne valeur si le scrape échoue ──

let existing = {};
try {
  existing = JSON.parse(readFileSync("data/money-supply-m3.json", "utf8"))[0]?.series ?? {};
} catch {}

const series = {};
for (const [ccy, cfg] of Object.entries(SERIES)) {
  const fetched = await fetchMoneySupply(ccy, cfg);
  if (fetched) {
    series[ccy] = { ...fetched, isProxy: cfg.isProxy, ...(cfg.proxyLabel ? { proxyLabel: cfg.proxyLabel } : {}) };
    console.log(`[TE] ${ccy} ✓ ${fetched.value} ${fetched.unit} (${fetched.period})`);
  } else if (existing[ccy]) {
    series[ccy] = existing[ccy];
    console.log(`[TE] ${ccy} ✗ scrape échoué → conservé (${existing[ccy].period})`);
  } else {
    console.log(`[TE] ${ccy} ✗ scrape échoué, pas de fallback disponible`);
  }
  await new Promise(r => setTimeout(r, 800)); // évite le rate-limiting TE
}

mkdirSync("data", { recursive: true });
writeFileSync("data/money-supply-m3.json", JSON.stringify([{
  updated_at: new Date().toISOString().slice(0, 10),
  note: "Masse monétaire M3 (niveau, devise locale) par zone — scrapé automatiquement depuis tradingeconomics.com (meta description des pages /money-supply-m3). USD : proxy M2 (Fed n'a plus publié M3 depuis 2006). Mis à jour par .github/workflows/fetch-money-supply.yml (hebdomadaire).",
  series,
}], null, 2) + "\n");

const ok     = Object.keys(SERIES).filter(c => series[c]);
const failed = Object.keys(SERIES).filter(c => !series[c]);
console.log(`\n✓ Saved  : ${ok.join(", ")}`);
if (failed.length) console.log(`✗ Failed : ${failed.join(", ")}`);
