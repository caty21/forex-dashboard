// Atlanta Fed Market Probability Tracker (MPT) — méthodologie alternative à
// Investing.com Fed Rate Monitor : au lieu des 30-day Fed Fund Futures, la
// Fed d'Atlanta déduit une distribution de probabilité du niveau du taux Fed
// à partir des OPTIONS sur futures SOFR 3 mois cotées au CME (le rationnel :
// la Fed conduit sa politique via des opérations repo, donc la distribution
// implicite du SOFR composé sur la fenêtre de référence du contrat permet de
// déduire les anticipations sur la fourchette cible du FOMC).
// Doc + téléchargements : https://www.atlantafed.org/cenfis/market-probability-tracker
//
// Format du fichier xl/worksheets/sheet3.xml (vérifié 2026-07-08) — format
// long, une ligne par (date, reference_start, target_range, field) :
//   date            : date d'observation (YYYY-MM-DD), publiée quotidiennement
//   reference_start : date de début de la fenêtre de 3 mois référencée par le
//                     contrat SOFR (trimestrielle, style IMM)
//   target_range    : pour les champs agrégés (Rate:*, Prob: cut, Prob: hike)
//                     = fourchette cible ACTUELLE (contexte) ; pour les champs
//                     "Prob: XXXbps - YYYbps" = LA fourchette évaluée
//   field / value   : nom du champ + valeur (en bps, ex. "373.91" = 3.7391%)
//
// Pas de dépendance xlsx npm (le paquet du registre public a des CVE critiques
// non patchées depuis que SheetJS a arrêté d'y publier) — on lit le zip et le
// XML OOXML directement avec les modules Node natifs (zlib + regex).

import { writeFileSync, mkdirSync } from "fs";
import { inflateRawSync } from "zlib";

const XLSX_URL = "https://www.atlantafed.org/-/media/Project/Atlanta/FRBA/Documents/cenfis/market-probability-tracker/mpt_histdata.xlsx";

// ── Lecteur ZIP minimal (central directory + inflate raw deflate) ────────────

function readZip(buf) {
  let eocdOff = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdOff = i; break; }
  }
  if (eocdOff === -1) throw new Error("ZIP: End Of Central Directory introuvable");
  const cdEntries = buf.readUInt16LE(eocdOff + 10);
  const cdOffset  = buf.readUInt32LE(eocdOff + 16);

  const entries = {};
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`ZIP: central directory corrompue à l'offset ${p}`);
    const compMethod = buf.readUInt16LE(p + 10);
    const compSize   = buf.readUInt32LE(p + 20);
    const nameLen    = buf.readUInt16LE(p + 28);
    const extraLen   = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lfhOffset  = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries[name] = { compMethod, compSize, lfhOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    read(name) {
      const e = entries[name];
      if (!e) return null;
      const nameLen  = buf.readUInt16LE(e.lfhOffset + 26);
      const extraLen = buf.readUInt16LE(e.lfhOffset + 28);
      const dataStart = e.lfhOffset + 30 + nameLen + extraLen;
      const raw = buf.subarray(dataStart, dataStart + e.compSize);
      return e.compMethod === 0 ? raw : inflateRawSync(raw);
    },
  };
}

function parseSharedStrings(xml) {
  return Array.from(xml.matchAll(/<si>(?:<t[^>]*>([^<]*)<\/t>|<r>[\s\S]*?<\/r>)*<\/si>/g))
    .map(m => m[0].match(/<t[^>]*>([^<]*)<\/t>/g)?.map(t => t.replace(/<[^>]+>/g, "")).join("") ?? "");
}

function parseSheetRows(xml, strings) {
  const rowRe  = /<row r="\d+"[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c r="([A-Z]+)\d+"(?:\s+t="([a-z]+)")?[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>/g;
  const rows = [];
  let rm, first = true;
  while ((rm = rowRe.exec(xml)) !== null) {
    if (first) { first = false; continue; } // ligne d'en-tête
    const cells = {};
    let cm; cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const [, ref, type, val] = cm;
      cells[ref] = val === undefined ? null : (type === "s" ? strings[+val] : val);
    }
    rows.push(cells);
  }
  return rows;
}

function excelSerialToIso(serial) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + Number(serial) * 86400000).toISOString().slice(0, 10);
}

// ── Fetch + parse ─────────────────────────────────────────────────────────────

async function fetchAtlantaMpt() {
  const res = await fetch(XLSX_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const zip = readZip(buf);
  const strings = parseSharedStrings(zip.read("xl/sharedStrings.xml").toString("utf8"));
  const rows = parseSheetRows(zip.read("xl/worksheets/sheet3.xml").toString("utf8"), strings);

  // { A: date, B: reference_start (serial), C: target_range, D: field, E: value }
  const records = rows
    .filter(r => r.A && r.B && r.D && r.E !== null)
    .map(r => ({ date: r.A, ref: Number(r.B), range: r.C, field: r.D, value: parseFloat(String(r.E).trim()) }));

  if (!records.length) throw new Error("aucune ligne exploitable trouvée dans sheet3");

  const maxDate = records.reduce((m, r) => (r.date > m ? r.date : m), "");
  const latest = records.filter(r => r.date === maxDate);
  const refStarts = [...new Set(latest.map(r => r.ref))].sort((a, b) => a - b);

  const windows = refStarts.map(ref => {
    const windowRows = latest.filter(r => r.ref === ref);
    const get = (field) => windowRows.find(r => r.field === field)?.value ?? null;
    const anchorRange = windowRows.find(r => r.field === "Prob: hike")?.range ?? null;
    // La colonne "range" (C) vaut toujours la fourchette ACTUELLE/ancre pour
    // toutes les lignes de la fenêtre (y compris les lignes de distribution) —
    // la fourchette évaluée par chaque bucket est encodée dans le nom du champ
    // lui-même ("Prob: 375bps - 400bps"), pas dans la colonne range.
    const distribution = windowRows
      .filter(r => r.field.startsWith("Prob: ") && r.field !== "Prob: cut" && r.field !== "Prob: hike")
      .map(r => ({ rangeLabel: r.field.replace(/^Prob:\s*/, ""), probPct: r.value }))
      .sort((a, b) => parseInt(a.rangeLabel) - parseInt(b.rangeLabel));
    return {
      windowStartIso: excelSerialToIso(ref),
      anchorRange,
      probCutPct:  get("Prob: cut"),
      probHikePct: get("Prob: hike"),
      rate25:      get("Rate: 25th percentile"),
      rateMean:    get("Rate: mean"),
      rateMode:    get("Rate: mode"),
      rate75:      get("Rate: 75th percentile"),
      distribution,
    };
  });

  return { asOf: maxDate, windows };
}

// ── Main ──────────────────────────────────────────────────────────────────────

try {
  console.log("Fetching Atlanta Fed MPT historical data…");
  const data = await fetchAtlantaMpt();
  console.log(`✓ asOf=${data.asOf}, ${data.windows.length} fenêtres trimestrielles`);
  console.log(`  front window: ${data.windows[0].windowStartIso} — hike=${data.windows[0].probHikePct}% cut=${data.windows[0].probCutPct}%`);

  mkdirSync("data", { recursive: true });
  writeFileSync("data/atlanta-fed-mpt.json", JSON.stringify({
    updated_at: new Date().toISOString().slice(0, 10),
    source: "https://www.atlantafed.org/cenfis/market-probability-tracker",
    note: "Probabilités dérivées des options sur futures SOFR 3 mois (CME) — méthodologie Atlanta Fed, mise à jour quotidienne. Fourchettes exprimées en bps (350bps-375bps = 3.50%-3.75%). Alternative aux 30-day Fed Fund Futures (Investing.com Fed Rate Monitor).",
    ...data,
  }, null, 2) + "\n");
  console.log("✓ Saved data/atlanta-fed-mpt.json");
} catch (e) {
  console.error(`✗ Atlanta Fed MPT fetch failed: ${e.message}`);
  process.exit(0); // échec silencieux — ne bloque pas le workflow, données précédentes conservées
}
