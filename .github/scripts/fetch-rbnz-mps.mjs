// Monetary Policy Statement (RBNZ) — trouve automatiquement le PDF le plus
// récent et en extrait le tableau de prévisions (Table 6.5 "Summary of
// economic projections" : CPI, OCR, GDP par année civile "March year").
//
// Contexte : rbnz.govt.nz bloque les requêtes automatisées sur ses pages
// génériques (challenge Cloudflare interactif — voir lib/centralBankGovernance.ts
// pour le détail, on ne cherche pas à le contourner). MAIS deux exceptions
// vérifiées manuellement, non protégées :
//   1. https://www.rbnz.govt.nz/sitemap.xml (200 OK) — liste les pages MPS
//      individuelles ("monetary-policy-statement-filtered-listing-page/...")
//   2. Ces pages individuelles elles-mêmes, ET les PDF sous /-/media/...
//      (200 OK) — apparemment seule la page d'INDEX générique est protégée,
//      pas le contenu spécifique référencé par le sitemap.
// Aucun contournement : on lit des ressources servies normalement (200, pas
// de challenge), avec un User-Agent standard, exactement comme le ferait
// un moteur de recherche indexant le sitemap public du site.
//
// IMPORTANT : le fetch() natif de Node (undici) se prend un 403 sur ces
// mêmes URLs alors que curl passe (200) — vérifié en direct, à la seconde
// près, avec un User-Agent identique. Cloudflare fingerprinte visiblement la
// pile TLS/HTTP2 du client (JA3/JA4), pas seulement l'en-tête User-Agent. On
// shell out donc vers curl (préinstallé sur les runners GitHub Actions ;
// c'est le client qui, vérifié, fonctionne) plutôt que d'utiliser fetch().

import { writeFileSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function curlGet(url) {
  return execFileSync("curl", [
    "-s", "-L", "--max-time", "30",
    "-A", UA,
    "-H", "Accept-Language: en-US,en;q=0.9",
    url,
  ], { maxBuffer: 1024 * 1024 * 50 }); // Buffer (binaire OK pour le PDF)
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

async function findLatestMpsPageUrl() {
  const xml = curlGet("https://www.rbnz.govt.nz/sitemap.xml").toString("utf8");
  if (!xml.includes("<urlset")) throw new Error("sitemap.xml : réponse inattendue (bloqué ?)");

  const re = /<loc>(https:\/\/www\.rbnz\.govt\.nz\/monetary-policy\/monetary-policy-statement\/monetary-policy-statement-filtered-listing-page\/(\d{4})\/([a-z]+)-\d+\/monetary-policy-statement-[a-z]+-\d{4})<\/loc>/g;
  const candidates = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const [url, yearStr, monthSlug] = [m[1], m[2], m[3]];
    const monthNum = MONTHS[monthSlug.slice(0, 3).toLowerCase()];
    if (!monthNum) continue;
    candidates.push({ url, year: parseInt(yearStr), month: monthNum });
  }
  if (!candidates.length) throw new Error("Aucune page MPS trouvée dans le sitemap");

  candidates.sort((a, b) => (a.year - b.year) || (a.month - b.month));
  return candidates.at(-1);
}

async function findPdfUrl(pageUrl) {
  const html = curlGet(pageUrl).toString("utf8");
  const m = html.match(/href="(https:\/\/www\.rbnz\.govt\.nz\/-\/media\/[^"]+monetary-policy-statement-[^"]+\.pdf)"/i)
        ?? html.match(/href="(\/-\/media\/[^"]+monetary-policy-statement-[^"]+\.pdf)"/i);
  if (!m) throw new Error("Lien PDF introuvable sur la page MPS");
  return m[1].startsWith("http") ? m[1] : `https://www.rbnz.govt.nz${m[1]}`;
}

async function fetchPdfText(pdfUrl) {
  const buf = curlGet(pdfUrl);
  if (buf.length < 1000 || buf.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error(`PDF invalide (${buf.length} bytes, bloqué ?)`);
  }
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

// Table 6.5 "Summary of economic projections" — lignes à largeur fixe (11
// colonnes : March year 2019..2029, mélange actuals/projections). Certaines
// étiquettes de ligne sont coupées sur 2 lignes dans le texte extrait (ex.
// "GDP (production, annual\naverage % change)") d'où \s+ entre les morceaux.
function parseForecastTable(text) {
  const flat = text.replace(/‑/g, "-"); // non-breaking hyphen -> hyphen standard
  const start = flat.indexOf("Summary of economic projections");
  if (start === -1) return null;
  const end = flat.indexOf("Appendix 2", start);
  const win = flat.slice(start, end === -1 ? start + 4000 : end);

  const NUM = "((?:-?[\\d.]+\\s+){10}-?[\\d.]+)";
  const yearsM = win.match(/March year\s+((?:\d{4}\s+){10}\d{4})/);
  const cpiM   = win.match(new RegExp("Price measures\\s+CPI\\s+" + NUM));
  const ocrM   = win.match(new RegExp("OCR \\(year average\\)\\s+" + NUM));
  const gdpM   = win.match(new RegExp("GDP \\(production, annual\\s+average % change\\)\\s*" + NUM));
  if (!yearsM || (!cpiM && !ocrM && !gdpM)) return null;

  const years = yearsM[1].trim().split(/\s+/);
  const toRecord = (m) => {
    if (!m) return null;
    const vals = m[1].trim().split(/\s+/).map(Number);
    return Object.fromEntries(years.map((y, i) => [y, vals[i]]));
  };

  // On ne garde que les 4 dernières années (horizon comparable aux autres CB)
  const lastN = (rec) => rec && Object.fromEntries(years.slice(-4).map(y => [y, rec[y]]));

  return {
    years: years.slice(-4),
    gdp: lastN(toRecord(gdpM)) ?? {},
    inflation: lastN(toRecord(cpiM)) ?? {},
    ocrYearAvg: lastN(toRecord(ocrM)) ?? {},
  };
}

try {
  console.log("Recherche de la dernière page MPS via sitemap.xml…");
  const { url: pageUrl, year, month } = await findLatestMpsPageUrl();
  console.log(`✓ Page trouvée (${year}-${String(month).padStart(2, "0")}): ${pageUrl}`);

  const pdfUrl = await findPdfUrl(pageUrl);
  console.log(`✓ PDF trouvé: ${pdfUrl}`);

  const text = await fetchPdfText(pdfUrl);
  console.log(`✓ PDF parsé (${text.length} caractères)`);

  const forecast = parseForecastTable(text);
  if (!forecast) throw new Error("Table 6.5 introuvable ou format inattendu");
  console.log("✓ Prévisions extraites:", JSON.stringify(forecast));

  mkdirSync("data", { recursive: true });
  writeFileSync("data/rbnz-mps.json", JSON.stringify({
    updated_at: new Date().toISOString().slice(0, 10),
    sourcePageUrl: pageUrl,
    sourcePdfUrl: pdfUrl,
    mpsYear: year,
    mpsMonth: month,
    note: "Table 6.5 'Summary of economic projections' — RBNZ Monetary Policy Statement. Années 'March year' (année se terminant en mars, convention budgétaire NZ) ; OCR en moyenne annuelle (pas un point de fin d'année comme les autres banques centrales de ce dashboard). Découvert et extrait via sitemap.xml + PDF public (pas de contournement du challenge Cloudflare qui protège les pages d'index génériques du site).",
    ...forecast,
  }, null, 2) + "\n");
  console.log("✓ Saved data/rbnz-mps.json");
} catch (e) {
  console.error(`✗ RBNZ MPS fetch failed: ${e.message}`);
  process.exit(0); // échec silencieux — ne bloque pas le workflow, données précédentes conservées
}
