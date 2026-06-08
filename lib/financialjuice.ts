// lib/financialjuice.ts
// Fetch news depuis FinancialJuice / Forex Crunch (https://www.financialjuice.com)
// Stratégie :
//   1. Essai RSS public  (company feed + global feed)
//   2. Authentification via session cookie si RSS échoue
//   3. Headers "full browser" pour passer Cloudflare basic protection
//
// Credentials stockés dans .env.local — jamais dans le code source.

import type { NewsItem } from "./newsfeed";
import { applyRulesPublic } from "./newsfeed";

const FJ_BASE = "https://www.financialjuice.com";

// Headers qui imitent un vrai navigateur Chrome — meilleure chance de passer Cloudflare
const BROWSER_HEADERS = {
  "User-Agent":                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language":           "en-US,en;q=0.9,fr;q=0.8",
  "Accept-Encoding":           "gzip, deflate, br",
  "Connection":                "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest":            "document",
  "Sec-Fetch-Mode":            "navigate",
  "Sec-Fetch-Site":            "none",
  "Sec-Fetch-User":            "?1",
  "Cache-Control":             "max-age=0",
};

// ── Parseur RSS ───────────────────────────────────────────────────────────────

function parseRssBlock(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi) ?? [];

  for (const block of blocks.slice(0, 50)) {
    const titleM = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkM  = block.match(/<link[^>]*href=["']([^"']+)["']/i)
                ?? block.match(/<link>([\s\S]*?)<\/link>/i)
                ?? block.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/i);
    const dateM  = block.match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/i);
    const descM  = block.match(/<(?:description|summary)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary)>/i);

    if (!titleM || !linkM) continue;

    const title   = titleM[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#\d+;/g, "").trim();
    const url     = linkM[1].trim();
    const dateStr = dateM?.[1]?.trim() ?? "";
    const summary = descM?.[1].replace(/<[^>]+>/g, "").trim().slice(0, 300);

    if (!title || !url.startsWith("http")) continue;

    // Filtre 8 jours
    const pubDate = new Date(dateStr);
    if (!isNaN(pubDate.getTime()) && Date.now() - pubDate.getTime() > 8 * 86400_000) continue;

    const combined = `${title} ${summary ?? ""}`;
    const { impacts, categories } = applyRulesPublic(combined);

    items.push({
      id:          `fj-${Buffer.from(url).toString("base64").slice(0, 12)}`,
      title,
      url,
      source,
      publishedAt: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
      summary,
      impacts,
      categories,
    });
  }

  return items;
}

// ── Essai RSS public ──────────────────────────────────────────────────────────

const PUBLIC_RSS_URLS = [
  `${FJ_BASE}/company/Forex%20Crunch/feed`,
  `${FJ_BASE}/feed`,
  `${FJ_BASE}/rss`,
  `${FJ_BASE}/news/feed`,
];

async function tryPublicRss(): Promise<NewsItem[]> {
  for (const url of PUBLIC_RSS_URLS) {
    try {
      const res = await fetch(url, {
        next:    { revalidate: 300 }, // 5 min
        headers: { ...BROWSER_HEADERS, "Accept": "application/rss+xml, application/xml, text/xml, */*" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<item>") && !xml.includes("<entry>")) continue;
      const items = parseRssBlock(xml, "FinancialJuice");
      if (items.length > 0) return items;
    } catch { /* essai suivant */ }
  }
  return [];
}

// ── Authentification + scraping session ──────────────────────────────────────
// Utilisé si RSS public échoue (Cloudflare peut bloquer même les RSS)

let _sessionCookie = "";
let _sessionExpiry = 0;

async function authenticate(): Promise<string> {
  if (_sessionCookie && Date.now() < _sessionExpiry) return _sessionCookie;

  const email    = process.env.FINANCIALJUICE_EMAIL    ?? "";
  const password = process.env.FINANCIALJUICE_PASSWORD ?? "";
  if (!email || !password) return "";

  try {
    // Étape 1 : récupérer le token CSRF
    const loginPage = await fetch(`${FJ_BASE}/login`, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });
    if (!loginPage.ok) return "";

    const html       = await loginPage.text();
    const cookieHdr  = loginPage.headers.get("set-cookie") ?? "";
    const csrfMatch  = html.match(/(?:name=["']_token["']|name=["']csrf_token["'])[^>]*value=["']([^"']+)["']/i)
                    ?? html.match(/meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i);
    const csrfToken  = csrfMatch?.[1] ?? "";

    // Étape 2 : POST credentials
    const body = new URLSearchParams({
      email,
      password,
      ...(csrfToken ? { _token: csrfToken } : {}),
      remember: "on",
    });

    const loginRes = await fetch(`${FJ_BASE}/login`, {
      method:   "POST",
      headers:  {
        ...BROWSER_HEADERS,
        "Content-Type":  "application/x-www-form-urlencoded",
        "Referer":       `${FJ_BASE}/login`,
        "Cookie":        cookieHdr.split(",").map(c => c.split(";")[0]).join("; "),
      },
      body:     body.toString(),
      redirect: "manual",
    });

    const newCookies = loginRes.headers.get("set-cookie") ?? "";
    if (!newCookies) return "";

    // Extraire les cookies de session
    const session = newCookies.split(",")
      .map(c => c.split(";")[0].trim())
      .filter(c => c.includes("=") && !c.startsWith("expires"))
      .join("; ");

    _sessionCookie = session;
    _sessionExpiry = Date.now() + 3600_000; // valide 1h
    return session;
  } catch { return ""; }
}

async function fetchWithSession(): Promise<NewsItem[]> {
  const cookie = await authenticate();
  if (!cookie) return [];

  try {
    const res = await fetch(`${FJ_BASE}/company/Forex%20Crunch`, {
      next:    { revalidate: 300 },
      headers: { ...BROWSER_HEADERS, "Cookie": cookie, "Referer": FJ_BASE },
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Extraire les articles depuis le HTML (structure probable FinancialJuice)
    const items: NewsItem[] = [];
    const articleRe = /<(?:article|div)[^>]*class=["'][^"']*(?:news|post|headline|feed)[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
    let m: RegExpExecArray | null;

    while ((m = articleRe.exec(html)) !== null && items.length < 30) {
      const block  = m[1];
      const linkM  = block.match(/href=["'](https?:\/\/[^"']+)["']/i);
      const titleM = block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)
                  ?? block.match(/<a[^>]*>([\s\S]{5,200}?)<\/a>/i);
      const dateM  = block.match(/datetime=["']([^"']+)["']/i)
                  ?? block.match(/data-time=["']([^"']+)["']/i);

      if (!linkM || !titleM) continue;

      const title   = titleM[1].replace(/<[^>]+>/g, "").trim();
      const url     = linkM[1];
      const dateStr = dateM?.[1] ?? "";

      if (title.length < 10) continue;

      const pubDate = dateStr ? new Date(dateStr) : new Date();
      if (!isNaN(pubDate.getTime()) && Date.now() - pubDate.getTime() > 8 * 86400_000) continue;

      const { impacts, categories } = applyRulesPublic(title);
      items.push({
        id:          `fj-${Buffer.from(url).toString("base64").slice(0, 12)}`,
        title,
        url,
        source:      "FinancialJuice",
        publishedAt: pubDate.toISOString(),
        impacts,
        categories,
      });
    }

    return items;
  } catch { return []; }
}

// ── Export principal ──────────────────────────────────────────────────────────

export async function fetchFinancialJuiceNews(): Promise<NewsItem[]> {
  // Essai 1 : RSS public (plus léger, moins de risque Cloudflare)
  const rssItems = await tryPublicRss();
  if (rssItems.length > 0) return rssItems;

  // Essai 2 : Session authentifiée
  const sessionItems = await fetchWithSession();
  return sessionItems;
}
