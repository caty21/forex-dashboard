import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const AUTHOR_URL   = "https://investinglive.com/author/giuseppe-dellamotta/";
const CATEGORY_URL = "https://investinglive.com/CentralBanks";
const RSS_URLS     = [
  "https://investinglive.com/CentralBanks/feed/",
  "https://investinglive.com/feed/",
];
const KEYWORDS     = ["rate hikes by year-end", "interest rate expectations", "rate cuts by year-end"];
const USER_AGENT   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CB_NAMES: Record<string, string> = {
  fed:  "Fed (USD)",
  ecb:  "ECB (EUR)",
  boe:  "BoE (GBP)",
  boj:  "BoJ (JPY)",
  snb:  "SNB (CHF)",
  boc:  "BoC (CAD)",
  rba:  "RBA (AUD)",
  rbnz: "RBNZ (NZD)",
};

function normalizeCb(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  return CB_NAMES[key] ?? raw.trim().replace(/[:*]/g, "");
}

function dateFromUrl(url: string): string {
  // YYYYMMDD dans le slug
  const m1 = url.match(/(\d{8})/);
  if (m1) return m1[1];
  // Format WordPress /YYYY/MM/DD/
  const m2 = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (m2) return `${m2[1]}${m2[2]}${m2[3]}`;
  return "00000000";
}

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\n+/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function extractArticleData(rawHtml: string, url: string) {
  const text = toText(rawHtml);
  if (!KEYWORDS.some((kw) => text.toLowerCase().includes(kw))) return null;

  const result = {
    url,
    title:      "Rate expectations",
    date:       new Date().toISOString().slice(0, 10),
    scraped_at: new Date().toISOString(),
    rate_cuts:  [] as Array<{ cb: string; bps: number; prob_pct: number; prob_desc: string; direction: string }>,
    rate_hikes: [] as Array<{ cb: string; bps: number; prob_pct: number; prob_desc: string; direction: string }>,
  };

  const titleMatch = rawHtml.match(/<h1[^>]*>(.*?)<\/h1>/i);
  if (titleMatch) result.title = titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const dateMatch = url.match(/(\d{8})/);
  if (dateMatch) {
    const d = dateMatch[1];
    result.date = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  } else {
    const d2 = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
    if (d2) result.date = `${d2[1]}-${d2[2]}-${d2[3]}`;
  }

  let currentSection: "cuts" | "hikes" | null = null;
  const lines = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .split(/\n+/)
    .map((l) => l.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("rate cuts by year-end"))  { currentSection = "cuts";  continue; }
    if (lower.includes("rate hikes by year-end")) { currentSection = "hikes"; continue; }

    if (currentSection && line.length < 250) {
      const match = line.match(
        /([A-Za-z0-9\/\s\-]+?)\s*:\s*(\d+)\s*bps\s*\((\d+)%\s+probability\s+of\s+([^\)]+)\)/i
      );
      if (match) {
        const entry = {
          cb:        normalizeCb(match[1]),
          bps:       Number(match[2]),
          prob_pct:  Number(match[3]),
          prob_desc: match[4].trim(),
          direction: currentSection === "cuts" ? "cut" : "hike",
        };
        if (currentSection === "cuts")  result.rate_cuts.push(entry);
        else                            result.rate_hikes.push(entry);
      }
    }
  }

  if (result.rate_cuts.length === 0 && result.rate_hikes.length === 0) return null;
  return result;
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.8", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      signal:  controller.signal,
      cache:   "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
  finally  { clearTimeout(timeout); }
}

// ── Étape 1 : RSS feeds (plus stables, moins bloqués que les pages HTML) ─────
async function candidatesFromRss(): Promise<string[]> {
  const candidates: string[] = [];
  for (const rssUrl of RSS_URLS) {
    const xml = await fetchHtml(rssUrl);
    if (!xml) continue;

    // Extraire les <item> individuellement pour éviter de confondre avec <channel><link>
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi));
    for (const [, itemXml] of items) {
      const titleMatch   = itemXml.match(/<title[^>]*>(?:<!\[CDATA\[)?([^\]<]+)/i);
      const creatorMatch = itemXml.match(/<dc:creator[^>]*>(?:<!\[CDATA\[)?([^\]<]+)/i);
      const linkMatch    = itemXml.match(/<link>([^<]+)<\/link>/i)
                        ?? itemXml.match(/<guid[^>]*>([^<]+)<\/guid>/i);

      if (!linkMatch) continue;
      const url     = linkMatch[1].trim();
      const title   = (titleMatch?.[1] ?? "").toLowerCase();
      const creator = (creatorMatch?.[1] ?? "").toLowerCase();

      if (
        KEYWORDS.some((kw) => title.includes(kw)) ||
        creator.includes("dellamotta")
      ) {
        candidates.push(url);
      }
    }
    if (candidates.length > 0) break;
  }
  return candidates;
}

// ── Étape 2 : pages HTML auteur/catégorie avec regex flexible ─────────────────
async function candidatesFromHtml(): Promise<string[]> {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const pageUrl of [AUTHOR_URL, CATEGORY_URL]) {
    const html = await fetchHtml(pageUrl);
    if (!html) continue;

    // Pattern A : URL investinglive.com avec date YYYYMMDD dans le slug
    for (const m of Array.from(html.matchAll(/href=["']([^"']*investinglive\.com\/[^"']*\d{8}[^"']*)["']/gi))) {
      const url = m[1];
      if (!seen.has(url)) { seen.add(url); candidates.push(url); }
    }
    // Pattern B : URL relative avec date YYYYMMDD
    for (const m of Array.from(html.matchAll(/href=["'](\/[^"']*\d{8}[^"']*)["']/gi))) {
      const url = `https://investinglive.com${m[1]}`;
      if (!seen.has(url)) { seen.add(url); candidates.push(url); }
    }
    // Pattern C : URL WordPress /YYYY/MM/DD/
    for (const m of Array.from(html.matchAll(/href=["']([^"']*\/\d{4}\/\d{2}\/\d{2}\/[^"']*)["']/gi))) {
      const href = m[1];
      const url  = href.startsWith("http") ? href : `https://investinglive.com${href.startsWith("/") ? href : `/${href}`}`;
      if (!seen.has(url)) { seen.add(url); candidates.push(url); }
    }
  }

  return candidates;
}

// ── Étape 0 : scan URL-date direct (le plus fiable, publié chaque semaine) ────
// Pattern : /news/how-have-interest-rate-expectations-changed-after-this-weeks-event-YYYYMMDD/
// On teste les 14 derniers jours (une publication par semaine environ)
async function candidatesFromUrlScan(): Promise<string[]> {
  const results: string[] = [];
  const now = Date.now();
  const checks = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - i * 86400000);
    const s = d.toISOString().slice(0, 10).replace(/-/g, "");
    return `https://investinglive.com/news/how-have-interest-rate-expectations-changed-after-this-weeks-event-${s}/`;
  });
  // HEAD requests en parallèle (rapide, peu de bande passante)
  const settled = await Promise.allSettled(
    checks.map(url =>
      fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT }, cache: "no-store" })
        .then(r => r.ok ? url : null)
        .catch(() => null)
    )
  );
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) results.push(r.value);
  }
  return results; // déjà triés du plus récent au plus ancien
}

async function loadRemoteExpectation() {
  // 0. Scan direct URL-date (le plus fiable et précis)
  const urlScan = await candidatesFromUrlScan();
  // 1. RSS (stables, moins bloqués)
  const rss  = await candidatesFromRss();
  // 2. HTML auteur/catégorie
  const html = await candidatesFromHtml();

  // Fusion : URL-scan en priorité (le plus récent), puis RSS, puis HTML trié par date
  const htmlSorted = html.slice().sort((a, b) => dateFromUrl(b).localeCompare(dateFromUrl(a)));
  const candidates = [...urlScan, ...rss, ...htmlSorted].slice(0, 15);

  for (const url of candidates) {
    const body   = await fetchHtml(url);
    if (!body) continue;
    const parsed = extractArticleData(body, url);
    if (parsed) return parsed;
  }
  return null;
}

function loadFallback() {
  try {
    const filePath = join(process.cwd(), "data", "rate_expectations.json");
    const raw  = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data[0] : data;
  } catch { return null; }
}

export async function GET() {
  try {
    const remote = await loadRemoteExpectation();
    if (remote) return NextResponse.json(remote);
  } catch (err) {
    console.warn("[expectations] scrape failed, fallback", err);
  }
  const fallback = loadFallback();
  if (fallback) return NextResponse.json(fallback);
  return NextResponse.json({ error: "Unable to load expectation data." }, { status: 404 });
}
