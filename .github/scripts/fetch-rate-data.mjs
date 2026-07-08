// Sources (in priority order):
//   1. Investing.com Fed Rate Monitor — USD seul (seule CB pour laquelle Investing.com
//      publie cet outil ; les autres slugs *-rate-monitor n'existent pas → 404 attendus)
//   2. InvestingLive fallback         — articles Giuseppe Dellamotta, hebdo, toutes CBs
//
// (CME FedWatch retiré : endpoint derrière le WAF Akamai de cmegroup.com, 403/404
//  systématique, et de toute façon redondant avec la source 1 pour l'USD.)

import { writeFileSync, mkdirSync, readFileSync } from "fs";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = { Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",
                 Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12" };

function normalizeDate(raw) {
  if (!raw) return null;
  if (/^\d{8}$/.test(raw))
    return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) return `${m[3]}-${MONTHS[m[1]]??'01'}-${m[2].padStart(2,'0')}`;
  return null;
}

const CHROME_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control":   "no-cache",
  "Pragma":          "no-cache",
  "Sec-Fetch-Dest":  "document",
  "Sec-Fetch-Mode":  "navigate",
  "Sec-Fetch-Site":  "none",
  "Sec-Fetch-User":  "?1",
  "Upgrade-Insecure-Requests": "1",
};

// ── 1. Investing.com Rate Monitors (Fed only — voir note en tête de fichier) ──

const IC_SLUGS = {
  USD: "fed-rate-monitor",
  EUR: "ecb-rate-monitor",
  GBP: "boe-rate-monitor",
  JPY: "boj-rate-monitor",
  CAD: "boc-rate-monitor",
  AUD: "rba-rate-monitor",
  NZD: "rbnz-rate-monitor",
  CHF: "snb-rate-monitor",
};

// Taux directeurs actuels — lus depuis data/rate_decisions.json (source unique,
// maintenue manuellement "après chaque décision") pour éviter qu'une copie
// codée en dur ici ne dérive silencieusement de la réalité au fil des mois.
const rateDecisions = JSON.parse(readFileSync("data/rate_decisions.json", "utf8"))[0]?.decisions ?? {};
const FALLBACK_RATES = Object.fromEntries(
  Object.entries(rateDecisions).map(([ccy, d]) => [ccy, d.current])
);

// ── SNB officiel (CHF) ─────────────────────────────────────────────────────────
// snb.ch publie ses décisions sous /press-releases-restricted/pre_YYYYMMDD.
// On découvre la plus récente depuis la page listing (1er lien du pattern),
// puis on lit le taux dans le titre : "leaves ... unchanged at X%" / "lowers/raises ... to X%".
async function fetchSnbRate() {
  try {
    const listRes = await fetch("https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy/decisions", { headers: CHROME_HEADERS });
    if (!listRes.ok) return null;
    const listHtml = await listRes.text();
    const linkMatch = listHtml.match(/href="(\/en\/publications\/communication\/press-releases-restricted\/pre_(\d{8})[^"]*)"/);
    if (!linkMatch) return null;
    const dateIso = `${linkMatch[2].slice(0,4)}-${linkMatch[2].slice(4,6)}-${linkMatch[2].slice(6,8)}`;

    const prRes = await fetch(`https://www.snb.ch${linkMatch[1]}`, { headers: CHROME_HEADERS });
    if (!prRes.ok) return null;
    const prHtml = await prRes.text();
    const rateMatch = prHtml.match(/SNB policy rate\s+(?:unchanged at|to)\s+(-?[\d.]+)%/i);
    if (!rateMatch) return null;

    console.log(`[SNB] official: ${rateMatch[1]}% (decision ${dateIso})`);
    return parseFloat(rateMatch[1]);
  } catch (e) {
    console.error(`[SNB] error: ${e.message}`);
    return null;
  }
}

// ── Fed officiel (USD) ──────────────────────────────────────────────────────────
// federalreserve.gov/monetarypolicy/fomccalendars.htm liste, pour chaque réunion,
// un lien de statement /newsevents/pressreleases/monetary(YYYYMMDD)a.htm. On prend
// la réunion passée la plus récente, puis on lit la fourchette officielle dans le
// texte : "target range for the federal funds rate at/to X to Y percent" (X/Y en
// fractions type "3-1/2"). On retourne le haut de fourchette (convention "upper
// bound" déjà utilisée ailleurs dans ce repo pour l'USD).
function parseFedFraction(s) {
  const m = s.match(/^(\d+)(?:-(\d+)\/(\d+))?$/);
  if (!m) return NaN;
  const whole = parseFloat(m[1]);
  return m[2] ? whole + parseFloat(m[2]) / parseFloat(m[3]) : whole;
}

async function fetchFedRate() {
  try {
    const calRes = await fetch("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", { headers: CHROME_HEADERS });
    if (!calRes.ok) return null;
    const calHtml = await calRes.text();

    const todayCompact = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const dates = new Set();
    for (const m of calHtml.matchAll(/\/newsevents\/pressreleases\/monetary(\d{8})a\.htm/g)) dates.add(m[1]);
    const latestPast = [...dates].filter(d => d <= todayCompact).sort().reverse()[0];
    if (!latestPast) return null;
    const dateIso = `${latestPast.slice(0,4)}-${latestPast.slice(4,6)}-${latestPast.slice(6,8)}`;

    const stRes = await fetch(`https://www.federalreserve.gov/newsevents/pressreleases/monetary${latestPast}a.htm`, { headers: CHROME_HEADERS });
    if (!stRes.ok) return null;
    const stHtml = await stRes.text();
    const rateMatch = stHtml.match(/target range for the federal funds rate[\s\S]{0,60}?(\d+(?:-\d\/\d)?)\s*to\s*(\d+(?:-\d\/\d)?)\s*percent/i);
    if (!rateMatch) return null;

    const upper = parseFedFraction(rateMatch[2]);
    if (isNaN(upper)) return null;
    console.log(`[FED] official: ${rateMatch[1]}-${rateMatch[2]}% → upper=${upper}% (decision ${dateIso})`);
    return upper;
  } catch (e) {
    console.error(`[FED] error: ${e.message}`);
    return null;
  }
}

async function fetchInvestingCom(ccy) {
  const slug = IC_SLUGS[ccy];
  const url  = `https://www.investing.com/central-banks/${slug}`;
  try {
    const res = await fetch(url, {
      headers: { ...CHROME_HEADERS, "Referer": "https://www.investing.com/central-banks/" }
    });
    console.log(`[IC/${ccy}] ${res.status}`);
    if (!res.ok) return null;

    const html = await res.text();
    console.log(`[IC/${ccy}] html ${html.length} chars`);

    if (/just a moment|cf-browser-verification|enable javascript/i.test(html)) {
      console.error(`[IC/${ccy}] Cloudflare challenge`);
      return null;
    }

    return parseInvestingComHtml(ccy, html);
  } catch (e) {
    console.error(`[IC/${ccy}] error: ${e.message}`);
    return null;
  }
}

function parseInvestingComHtml(ccy, html) {
  // ── Attempt A: __NEXT_DATA__ (Next.js SSR) ────────────────────────────────
  const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (ndMatch) {
    try {
      const nd = JSON.parse(ndMatch[1]);
      console.log(`[IC/${ccy}] __NEXT_DATA__ found`);
      const result = parseNextData(ccy, nd);
      if (result) return result;
    } catch (e) { console.error(`[IC/${ccy}] nextData parse: ${e.message}`); }
  }

  // ── Attempt B: JSON-LD / embedded JSON with "meetingDate" or "probability" ─
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  for (const [, content] of scripts) {
    if (!content.includes("meetingDate") && !content.includes("probability")) continue;
    try {
      const json = JSON.parse(content.trim());
      console.log(`[IC/${ccy}] embedded JSON found`);
      const result = parseJsonData(ccy, json);
      if (result) return result;
    } catch {}
  }

  // ── Attempt C: HTML table ──────────────────────────────────────────────────
  return parseRateMonitorTable(ccy, html);
}

function parseNextData(ccy, nd) {
  const pageProps = nd?.props?.pageProps ?? nd?.props ?? {};
  console.log(`[IC/${ccy}] pageProps keys: ${Object.keys(pageProps).slice(0,10).join(", ")}`);

  // Navigate common paths where rate monitor data lives
  const candidates = [
    pageProps?.rateMonitorData,
    pageProps?.data?.rateMonitor,
    pageProps?.initialData,
    pageProps?.dehydratedState?.queries?.[0]?.state?.data,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const result = parseJsonData(ccy, c);
    if (result) return result;
  }
  // Log for debugging first run
  console.log(`[IC/${ccy}] nextData pageProps preview: ${JSON.stringify(pageProps).slice(0, 400)}`);
  return null;
}

function parseJsonData(ccy, json) {
  // Try to find meetings array in various shapes
  const meetings = json?.meetings ?? json?.data?.meetings ?? json?.rows ?? json?.items ?? null;
  if (!Array.isArray(meetings) || !meetings.length) return null;

  const nowIso  = new Date().toISOString().slice(0,10);
  const rows    = [];
  let currentRate = FALLBACK_RATES[ccy] ?? 0;

  for (const m of meetings) {
    const dateIso = normalizeDate(
      m.meetingDate ?? m.date ?? m.meeting_date ?? m.dateIso ?? ""
    );
    if (!dateIso || dateIso < nowIso) continue;

    // Probabilities can be in many shapes
    const probCut  = parseFloat(m.probCut  ?? m.cut  ?? m.decrease ?? m.minus25 ?? 0)
                   + parseFloat(m.probCut50 ?? m.minus50 ?? 0);
    const probHike = parseFloat(m.probHike ?? m.hike ?? m.increase ?? m.plus25  ?? 0)
                   + parseFloat(m.probHike50 ?? m.plus50 ?? 0);
    const probHold = parseFloat(m.probHold ?? m.hold ?? m.unchanged ?? 0);

    const probIsCut   = probCut >= probHike;
    const probMovePct = Math.max(probCut, probHike, 0);

    const impliedRate = parseFloat(
      m.impliedRate ?? m.implied_rate ?? m.rate ?? currentRate
    );
    const changeBps = (impliedRate - currentRate) * 100;
    const dateLabel = new Date(dateIso + "T12:00:00Z")
      .toLocaleDateString("en-US", { month:"short", day:"numeric" });

    rows.push({
      meeting: dateLabel, meeting_iso: dateIso,
      implied_rate_post_meeting: impliedRate,
      prob_move_pct: probMovePct, prob_is_cut: probIsCut,
      change_bps: changeBps, num_moves: changeBps / 25,
    });
  }

  if (!rows.length) return null;
  return { today: { midpoint: currentRate, rows } };
}

// Structure réelle de la page (vérifiée juillet 2026) : chaque réunion FOMC est un
// bloc "Meeting Time: <i>Jul 29, 2026 02:00PM ET</i>" suivi d'un <table class="fedRateTbl">
// dont les lignes sont des fourchettes de taux ("3.50 - 3.75") + probabilité courante.
// Il n'y a AUCUNE colonne date dans la table elle-même (elle vit dans le bloc parent) —
// c'est pourquoi l'ancienne heuristique par en-têtes de colonnes ne trouvait jamais rien.
function parseRateMonitorTable(ccy, html) {
  const currentRate = FALLBACK_RATES[ccy] ?? 0;
  const nowIso  = new Date().toISOString().slice(0,10);
  const blockRe = /Meeting Time:<\/span>\s*<i>([^<]+)<\/i>[\s\S]*?<table class="genTbl openTbl fedRateTbl">([\s\S]*?)<\/table>/g;
  const rowRe   = /<td class="left">\s*([\d.]+\s*-\s*[\d.]+)[\s\S]*?<\/td>\s*<td>\s*([\d.]+)%<\/td>/g;

  const rows = [];
  let bm;
  while ((bm = blockRe.exec(html)) !== null) {
    const dateIso = normalizeDate(bm[1].trim());
    if (!dateIso || dateIso < nowIso) continue;

    let rm, totalProb = 0, weightedRate = 0, probBelow = 0, probAbove = 0;
    rowRe.lastIndex = 0;
    while ((rm = rowRe.exec(bm[2])) !== null) {
      const parts = rm[1].match(/([\d.]+)\s*-\s*([\d.]+)/);
      if (!parts) continue;
      const hi   = parseFloat(parts[2]);
      const prob = parseFloat(rm[2]);
      totalProb    += prob;
      // currentRate suit la convention "upper bound" (ex: 3.75 pour la fourchette
      // 3.50-3.75, cf. data/rate_decisions.json / app/api/macro) : chaque fourchette
      // doit donc être représentée par SON haut (hi), pas son milieu — sinon la
      // fourchette actuelle (mid=3.625) ne matche jamais currentRate (3.75), ce qui
      // introduit un biais fantôme de ~-12.5bps même à 100% de probabilité de statu quo.
      weightedRate += hi * prob;
      // La fourchette dont le haut == currentRate EST la fourchette actuelle → ni cut ni hike.
      if (Math.abs(hi - currentRate) < 0.01) continue;
      if (hi < currentRate) probBelow += prob;
      else probAbove += prob;
    }
    if (!totalProb) continue;

    const impliedRate = parseFloat((weightedRate / totalProb).toFixed(4));
    const probIsCut   = probBelow > probAbove; // strict : à 0/0 (aucun biais), ne pas défaulter sur "cut"
    const probMovePct = Math.round(Math.max(probBelow, probAbove));
    const changeBps   = (impliedRate - currentRate) * 100;
    const dateLabel   = new Date(dateIso + "T12:00:00Z")
      .toLocaleDateString("en-US", { month:"short", day:"numeric" });

    rows.push({
      meeting: dateLabel, meeting_iso: dateIso,
      implied_rate_post_meeting: impliedRate,
      prob_move_pct: probMovePct, prob_is_cut: probIsCut,
      change_bps: changeBps, num_moves: changeBps / 25,
    });
  }

  if (!rows.length) { console.warn(`[IC/${ccy}] no parseable meeting block found`); return null; }
  console.log(`[IC/${ccy}] ✓ table parsed: ${rows.length} meetings`);
  return { today: { midpoint: currentRate, rows } };
}

// ── 2. InvestingLive fallback (Giuseppe Dellamotta, hebdomadaire) ─────────────

const IL_CB_MAP = {
  fed:  "USD", fomc: "USD",
  ecb:  "EUR",
  boe:  "GBP",
  boj:  "JPY",
  boc:  "CAD",
  rba:  "AUD",
  rbnz: "NZD",
  snb:  "CHF",
};

async function fetchInvestingLive() {
  for (let daysAgo = 0; daysAgo <= 14; daysAgo++) {
    const d = new Date(Date.now() - daysAgo * 86_400_000);
    const yyyymmdd = d.toISOString().slice(0,10).replace(/-/g,"");
    const candidates = [
      `https://investinglive.com/centralbank/how-have-interest-rate-expectations-changed-after-this-weeks-events-${yyyymmdd}/`,
      `https://investinglive.com/centralbank/how-have-interest-rate-expectations-changed-after-this-weeks-event-${yyyymmdd}/`,
      `https://investinglive.com/news/how-have-interest-rate-expectations-changed-after-this-weeks-events-${yyyymmdd}/`,
      `https://investinglive.com/news/how-have-interest-rate-expectations-changed-after-this-weeks-event-${yyyymmdd}/`,
    ];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": CHROME_HEADERS["User-Agent"] } });
        if (!res.ok) continue;
        const html = await res.text();
        console.log(`[IL] found article ${yyyymmdd} at ${url}`);
        return { data: parseILArticle(html), date: d.toISOString().slice(0,10) };
      } catch {}
    }
  }
  return { data: {}, date: null };
}

function parseILArticle(html) {
  const results = {};

  // Extract articleBody from JSON-LD
  const jldMatch = html.match(/"articleBody"\s*:\s*"([\s\S]*?)(?<!\\)"/);
  const text = jldMatch
    ? jldMatch[1].replace(/\\n/g," ").replace(/\\"/g,'"')
    : html.replace(/<[^>]+>/g," ");

  // Pattern: "CB: XX bps (YY% probability of rate hike/cut/no change)"
  const re = /\b(fed|fomc|ecb|boe|boj|boc|rba|rbnz|snb)\b[\s\S]{0,150}?(\d+)\s*bps?[\s\S]{0,80}?(\d+)%\s*probability\s*of\s*(rate\s*)?(hike|cut|no.?change)/gi;
  for (const m of text.matchAll(re)) {
    const ccy = IL_CB_MAP[m[1].toLowerCase()];
    if (!ccy || results[ccy]) continue;
    const bps           = parseInt(m[2]);
    const probPct       = parseInt(m[3]);
    const isNoChg       = /no.?change/i.test(m[5]);
    const isCutDirection = !isNoChg && /cut/i.test(m[5]);

    // "XX bps" est une magnitude signée du biais year-end : on ne la force négative
    // que si la direction annoncée est explicitement "cut". Pour "no change", le bps
    // reste positif par défaut (biais hausse), comme pour "hike" — le bug précédent
    // négativait TOUT ce qui n'était pas explicitement "hike", cassant EUR/GBP/JPY/
    // CAD/AUD/CHF (tous en "no change" la plupart des semaines).
    const bpsYearEnd = isCutDirection && bps > 0 ? -bps : bps;
    // "no change" à la prochaine réunion : la probabilité de mouvement est le complément
    // de la probabilité de statu quo (ex: "72% no change" → 28% de mouvement), pas 0.
    const probMovePct = isNoChg ? 100 - probPct : probPct;

    results[ccy] = { bpsYearEnd, probMovePct, isCut: bpsYearEnd < 0 };
  }

  console.log(`[IL] parsed: ${Object.keys(results).join(", ")}`);
  return results;
}

function buildILFallback(ccy, il) {
  const nowIso = new Date().toISOString().slice(0,10);
  const yearEnd = `${new Date().getFullYear()}-12-31`;
  const rate = FALLBACK_RATES[ccy] ?? 0;
  return {
    today: {
      midpoint: rate,
      rows: [{
        meeting:                  "Dec",
        meeting_iso:              yearEnd,
        implied_rate_post_meeting: rate + il.bpsYearEnd / 100,
        prob_move_pct:            il.probMovePct ?? 50,
        prob_is_cut:              il.isCut,
        change_bps:               il.bpsYearEnd,
        num_moves:                Math.abs(il.bpsYearEnd) / 25,
      }]
    }
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const CCYS = ["USD","EUR","GBP","JPY","CAD","AUD","NZD","CHF"];
const results = {};

// Charge les données déjà en place AVANT tout fetch — sert de filet de sécurité
// plus bas : investing.com renvoie parfois 403 spécifiquement aux IPs GitHub
// Actions (bloc IP anti-bot, confirmé en direct — pas un problème de parsing),
// et ce blocage est intermittent. Sans ce filet, un seul run bloqué écrasait
// la vraie courbe multi-réunions USD par le fallback InvestingLive (un unique
// point "year-end"), et cette dégradation restait visible jusqu'au prochain
// run réussi. On préfère désormais garder la dernière bonne donnée connue.
let existingData = {};
try {
  existingData = JSON.parse(readFileSync("data/rate-probabilities.json", "utf8")).data ?? {};
} catch {}

// 0 — Sources officielles → écrasent les ancres si data/rate_decisions.json a dérivé
console.log("\n=== Fed (official) ===");
const fedRate = await fetchFedRate();
if (fedRate !== null) FALLBACK_RATES.USD = fedRate;

console.log("\n=== SNB (official) ===");
const snbRate = await fetchSnbRate();
if (snbRate !== null) FALLBACK_RATES.CHF = snbRate;

// 1 — Investing.com Fed Rate Monitor → USD uniquement (seule CB avec cet outil ;
// les autres slugs *-rate-monitor n'existent pas sur investing.com → 404 attendus)
// Retry (403/erreur réseau ponctuels) — n'aide pas contre un vrai bloc IP
// persistant sur tout le run, mais couvre les échecs vraiment transitoires.
const IC_SUPPORTED = ["USD"];
console.log("\n=== Investing.com Rate Monitors ===");
for (const ccy of IC_SUPPORTED) {
  let data = null;
  for (let attempt = 1; attempt <= 3 && !data; attempt++) {
    if (attempt > 1) {
      console.log(`[IC/${ccy}] retry ${attempt}/3…`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
    data = await fetchInvestingCom(ccy);
  }
  if (data) results[ccy] = data;
  await new Promise(r => setTimeout(r, 600));
}

// 2 — InvestingLive → fallback for any missing CB
const missing = CCYS.filter(c => !results[c]);
if (missing.length) {
  console.log(`\n=== InvestingLive fallback (missing: ${missing.join(", ")}) ===`);
  const { data: ilData } = await fetchInvestingLive();
  for (const ccy of missing) {
    if (ilData[ccy]) {
      results[ccy] = buildILFallback(ccy, ilData[ccy]);
      console.log(`[IL] ${ccy} ✓ (${ilData[ccy].bpsYearEnd}bps year-end)`);
    }
  }
}

// 3 — Filet de sécurité : si le résultat du jour n'a qu'1 réunion (fallback IL
// dégradé) alors qu'on avait déjà une vraie courbe multi-réunions, on la garde.
for (const ccy of CCYS) {
  const newRows = results[ccy]?.today?.rows?.length ?? 0;
  const oldRows = existingData[ccy]?.today?.rows?.length ?? 0;
  if (newRows <= 1 && oldRows > 1) {
    console.log(`[preserve] ${ccy}: nouveau fetch dégradé (${newRows} réunion) → conserve l'ancienne courbe (${oldRows} réunions)`);
    results[ccy] = existingData[ccy];
  }
}

// ── Multi-week snapshot rotation ──────────────────────────────────────────────
// snapshots = tableau chronologique (plus récent en [0]) de jusqu'à 12 semaines
let snapshots = [];
let previousWeek = null, previousWeekFetchedAt = null; // rétrocompatibilité
try {
  const existing = JSON.parse(readFileSync("data/rate-probabilities.json","utf8"));
  const ageMs = Date.now() - new Date(existing.fetchedAt).getTime();
  const day   = 86400000;

  // Récupère les snapshots existants et filtre < 12 semaines
  const existingSnaps = existing.snapshots ?? [];
  const validSnaps = existingSnaps.filter(s => {
    const age = Date.now() - new Date(s.fetchedAt).getTime();
    return age < 84 * day;
  });

  // Si les données actuelles ont 5-9 jours → les pousser en snapshot[0]
  if (ageMs >= 5*day && ageMs <= 9*day) {
    snapshots = [{ data: existing.data, fetchedAt: existing.fetchedAt }, ...validSnaps].slice(0, 12);
    console.log(`\nRotated ${(ageMs/day).toFixed(1)}d-old data → snapshots[${snapshots.length}]`);
  } else {
    snapshots = validSnaps;
  }

  // Rétrocompatibilité previousWeek
  if (snapshots[0]) {
    previousWeek = snapshots[0].data;
    previousWeekFetchedAt = snapshots[0].fetchedAt;
  }
} catch {}

mkdirSync("data", { recursive: true });
writeFileSync("data/rate-probabilities.json", JSON.stringify({
  data: results,
  fetchedAt: new Date().toISOString(),
  snapshots,
  ...(previousWeek ? { previousWeek, previousWeekFetchedAt } : {}),
}, null, 2));

const saved  = CCYS.filter(c => results[c]);
const failed = CCYS.filter(c => !results[c]);
console.log(`\n✓ Saved  : ${saved.join(", ")}`);
if (failed.length) console.log(`✗ Failed : ${failed.join(", ")}`);
