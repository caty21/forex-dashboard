// Sources (in priority order):
//   1. CME FedWatch API       — USD seul, JSON officieux, fiable
//   2. Investing.com monitors — toutes CBs, HTML scraped (Cloudflare possible)
//   3. InvestingLive fallback — articles Giuseppe Dellamotta, hebdo, toutes CBs

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

// ── 1. CME FedWatch (USD) ─────────────────────────────────────────────────────

async function fetchCMEFedWatch() {
  const year = new Date().getFullYear();
  const candidates = [
    // API officieuse FedWatch — essai sur SR3 (SOFR) et ZQ (30-day FF)
    `https://www.cmegroup.com/CmeWS/mvc/MeetingCalendar/V1/getMeetingCalendarByYear.json?marketCode=SR3&year=${year}`,
    `https://www.cmegroup.com/CmeWS/mvc/MeetingCalendar/V1/getMeetingCalendarByYear.json?marketCode=FF&year=${year}`,
    `https://www.cmegroup.com/CmeWS/mvc/MeetingCalendar/V1/getMeetingCalendarByYear.json?marketCode=ZQ&year=${year}`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          ...CHROME_HEADERS,
          "Accept":       "application/json, text/plain, */*",
          "Referer":      "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
          "Origin":       "https://www.cmegroup.com",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        }
      });
      console.log(`[CME] ${url.split('?')[1]} → ${res.status}`);
      if (!res.ok) continue;

      const body = await res.json();
      console.log(`[CME] keys: ${Object.keys(body).join(", ")}`);
      console.log(`[CME] preview: ${JSON.stringify(body).slice(0, 600)}`);

      const parsed = parseCMEBody(body);
      if (parsed) { console.log(`[CME] ✓ ${parsed.today.rows.length} meetings`); return parsed; }
    } catch (e) {
      console.error(`[CME] error: ${e.message}`);
    }
  }
  return null;
}

function parseCMEBody(body) {
  // Format A : { meetings: [{ date|meetingDate, currentProbs:{minus25,unch,plus25,...}, impliedRate }] }
  const arr = body.meetings ?? body.data ?? (Array.isArray(body) ? body : null);
  if (!arr?.length) return null;

  const nowIso = new Date().toISOString().slice(0,10);
  let currentRate = null;
  const rows = [];

  for (const m of arr) {
    const dateIso = normalizeDate(
      m.date ?? m.meetingDate ?? m.meetDate ?? m.meeting_date ?? ""
    );
    if (!dateIso || dateIso < nowIso) continue;

    const probs = m.currentProbs ?? m.probs ?? m.probabilities ?? m.probability ?? {};
    const probCut  = parseFloat(probs.minus25 ?? probs.cut25  ?? probs["-25"] ?? probs.minus50 ?? 0)
                   + parseFloat(probs.minus50 ?? probs.cut50  ?? probs["-50"] ?? 0);
    const probHike = parseFloat(probs.plus25  ?? probs.hike25 ?? probs["+25"] ?? probs.plus50  ?? 0)
                   + parseFloat(probs.plus50  ?? probs.hike50 ?? probs["+50"] ?? 0);
    const probHold = parseFloat(probs.unch    ?? probs.hold   ?? probs.unchanged ?? 0);

    const probIsCut   = probCut >= probHike;
    const probMovePct = probIsCut ? probCut : probHike;

    const impliedRate = parseFloat(
      m.impliedRate ?? m.implied_rate ?? m.rate ?? m.impliedFedFunds ?? 0
    );
    if (currentRate === null)
      currentRate = parseFloat(m.priorRate ?? m.currentRate ?? m.prior_rate ?? impliedRate ?? 0);

    const changeBps = (impliedRate - (currentRate ?? 0)) * 100;
    const dateLabel = new Date(dateIso + "T12:00:00Z")
      .toLocaleDateString("en-US", { month:"short", day:"numeric" });

    rows.push({
      meeting:                  dateLabel,
      meeting_iso:              dateIso,
      implied_rate_post_meeting: impliedRate,
      prob_move_pct:            probMovePct,
      prob_is_cut:              probIsCut,
      change_bps:               changeBps,
      num_moves:                changeBps / 25,
    });
  }

  if (!rows.length) return null;
  return { today: { midpoint: currentRate ?? 0, rows } };
}

// ── 2. Investing.com Rate Monitors (all CBs) ──────────────────────────────────

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

// Taux directeurs actuels — fallback si non trouvés dans le HTML
const FALLBACK_RATES = {
  USD: 4.33, EUR: 2.40, GBP: 4.25, JPY: 0.50,
  CAD: 2.75, AUD: 4.10, NZD: 3.25, CHF: 0.00,
};

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

function parseRateMonitorTable(ccy, html) {
  // Find all <table> blocks
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  console.log(`[IC/${ccy}] ${tables.length} tables found`);

  for (const [table] of tables) {
    // Extract header row to detect probability columns
    const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g,"").trim().toLowerCase());

    const hasProbCols = headers.some(h => /cut|hike|unch|hold|basis|bps|prob|\-\d|\+\d/.test(h));
    const hasDate     = headers.some(h => /meeting|date|month/.test(h));
    if (!hasProbCols || !hasDate) continue;

    console.log(`[IC/${ccy}] table headers: ${headers.join(" | ")}`);

    const dateIdx   = headers.findIndex(h => /meeting|date|month/.test(h));
    const cutCols   = headers.reduce((acc,h,i) => /cut|\-25|\-50|decr/.test(h) ? [...acc,i] : acc, []);
    const hikeCols  = headers.reduce((acc,h,i) => /hike|\+25|\+50|incr/.test(h) ? [...acc,i] : acc, []);
    const holdCols  = headers.reduce((acc,h,i) => /unch|hold|no.?change/.test(h) ? [...acc,i] : acc, []);
    const rateIdx   = headers.findIndex(h => /implied|rate/.test(h));

    const rows2 = [];
    const nowIso  = new Date().toISOString().slice(0,10);
    const trs = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].slice(1); // skip header

    for (const [tr] of trs) {
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m => m[1].replace(/<[^>]+>/g,"").trim());
      if (cells.length < 2) continue;

      const dateIso = normalizeDate(cells[dateIdx] ?? "");
      if (!dateIso || dateIso < nowIso) continue;

      const pct = s => parseFloat((s ?? "0").replace(/[^0-9.]/g,"")) || 0;
      const probCut  = cutCols.reduce((s,i)  => s + pct(cells[i]),  0);
      const probHike = hikeCols.reduce((s,i) => s + pct(cells[i]),  0);
      const probIsCut   = probCut >= probHike;
      const probMovePct = Math.max(probCut, probHike);
      const impliedRate = rateIdx >= 0 ? pct(cells[rateIdx]) : FALLBACK_RATES[ccy] ?? 0;
      const changeBps   = (impliedRate - (FALLBACK_RATES[ccy] ?? 0)) * 100;
      const dateLabel   = new Date(dateIso + "T12:00:00Z")
        .toLocaleDateString("en-US", { month:"short", day:"numeric" });

      rows2.push({
        meeting: dateLabel, meeting_iso: dateIso,
        implied_rate_post_meeting: impliedRate,
        prob_move_pct: probMovePct, prob_is_cut: probIsCut,
        change_bps: changeBps, num_moves: changeBps / 25,
      });
    }

    if (rows2.length) {
      console.log(`[IC/${ccy}] ✓ table parsed: ${rows2.length} rows`);
      return { today: { midpoint: FALLBACK_RATES[ccy] ?? 0, rows: rows2 } };
    }
  }

  console.warn(`[IC/${ccy}] no parseable table found`);
  return null;
}

// ── 3. InvestingLive fallback (Giuseppe Dellamotta, hebdomadaire) ─────────────

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
    const url = `https://investinglive.com/news/how-have-interest-rate-expectations-changed-after-this-weeks-event-${yyyymmdd}/`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": CHROME_HEADERS["User-Agent"] } });
      if (!res.ok) continue;
      const html = await res.text();
      console.log(`[IL] found article ${yyyymmdd}`);
      return { data: parseILArticle(html), date: d.toISOString().slice(0,10) };
    } catch {}
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
    const bps      = parseInt(m[2]);
    const probPct  = parseInt(m[3]);
    const isHike   = /hike/i.test(m[5]);
    const isNoChg  = /no.?change/i.test(m[5]);
    results[ccy] = { bpsYearEnd: isHike ? bps : -bps, probMovePct: isNoChg ? 0 : probPct, isCut: !isHike && !isNoChg };
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

// 1 — CME FedWatch → USD
console.log("\n=== CME FedWatch ===");
const cmeData = await fetchCMEFedWatch();
if (cmeData) { results["USD"] = cmeData; console.log("[CME] USD ✓"); }

// 2 — Investing.com → all CBs (USD as backup if CME failed)
console.log("\n=== Investing.com Rate Monitors ===");
for (const ccy of CCYS) {
  if (results[ccy]) { console.log(`[IC/${ccy}] skipped (CME)`); continue; }
  const data = await fetchInvestingCom(ccy);
  if (data) results[ccy] = data;
  await new Promise(r => setTimeout(r, 600));
}

// 3 — InvestingLive → fallback for any missing CB
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

// ── Previous week rotation ────────────────────────────────────────────────────
let previousWeek = null, previousWeekFetchedAt = null;
try {
  const existing = JSON.parse(readFileSync("data/rate-probabilities.json","utf8"));
  const ageMs = Date.now() - new Date(existing.fetchedAt).getTime();
  const day   = 86400000;
  if (ageMs >= 5*day && ageMs <= 9*day) {
    previousWeek = existing.data; previousWeekFetchedAt = existing.fetchedAt;
    console.log(`\nRotated ${(ageMs/day).toFixed(1)}d-old data → previousWeek`);
  } else if (existing.previousWeek) {
    const prevAge = Date.now() - new Date(existing.previousWeekFetchedAt).getTime();
    if (prevAge < 11*day) { previousWeek = existing.previousWeek; previousWeekFetchedAt = existing.previousWeekFetchedAt; }
  }
} catch {}

mkdirSync("data", { recursive: true });
writeFileSync("data/rate-probabilities.json", JSON.stringify({
  data: results,
  fetchedAt: new Date().toISOString(),
  ...(previousWeek ? { previousWeek, previousWeekFetchedAt } : {}),
}, null, 2));

const saved  = CCYS.filter(c => results[c]);
const failed = CCYS.filter(c => !results[c]);
console.log(`\n✓ Saved  : ${saved.join(", ")}`);
if (failed.length) console.log(`✗ Failed : ${failed.join(", ")}`);
