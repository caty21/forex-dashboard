// lib/newsfeed.ts
// Agrège les news forex/macro depuis plusieurs sources publiques :
//   1. investinglive.com/forex/  — articles forex de Giuseppe Dellamotta
//   2. Reuters RSS               — flux marchés publics
//   3. Bloomberg meta tags       — best-effort (titres publics malgré paywall)
// Applique un moteur de pertinence devise pour chaque article.

import type { Currency } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NewsImpact {
  ccy:       Currency;
  direction: "bullish" | "bearish" | "neutral";
  reason:    string;
}

export interface NewsItem {
  id:          string;
  title:       string;
  url:         string;
  source:      string;
  publishedAt: string;   // ISO date string
  summary?:    string;
  impacts:     NewsImpact[];
  categories:  string[]; // "Énergie", "Banque Centrale", "Géopolitique", etc.
}

// ── Moteur de pertinence devise ───────────────────────────────────────────────

interface ImpactRule {
  pattern:    RegExp;
  impacts:    { ccy: Currency; dir: "bullish" | "bearish" | "neutral" }[];
  categories: string[];
  reason:     string;
}

const IMPACT_RULES: ImpactRule[] = [
  // ── Fed / USD ──────────────────────────────────────────────────────────────
  {
    pattern:    /\b(hawkish fed|fed hike|fed rate (up|rise)|us inflation (surge|higher|above)|fomc (hike|tighten))\b/i,
    impacts:    [{ ccy: "USD", dir: "bullish" }],
    categories: ["Banque Centrale", "USD"],
    reason:     "Fed hawkish → USD haussier",
  },
  {
    pattern:    /\b(fed (cut|ease|pivot|pause)|dovish fed|us inflation (cool|drop|lower|ease)|fomc (cut|ease|pause))\b/i,
    impacts:    [{ ccy: "USD", dir: "bearish" }],
    categories: ["Banque Centrale", "USD"],
    reason:     "Fed dovish → USD baissier",
  },
  {
    pattern:    /\b(fed|fomc|federal reserve|powell|us monetary policy|us interest rate)\b/i,
    impacts:    [{ ccy: "USD", dir: "neutral" }],
    categories: ["Banque Centrale", "USD"],
    reason:     "Politique monétaire Fed",
  },

  // ── ECB / EUR ──────────────────────────────────────────────────────────────
  {
    pattern:    /\b(ecb (cut|ease|lower rate|dovish)|lagarde (cut|dovish|ease)|eurozone (recession|weak|slow|deflat))\b/i,
    impacts:    [{ ccy: "EUR", dir: "bearish" }],
    categories: ["Banque Centrale", "EUR"],
    reason:     "BCE dovish → EUR baissier",
  },
  {
    pattern:    /\b(ecb (hike|hawkish|hold|tighten)|lagarde (hawkish|hike)|eurozone inflation (higher|above|surge))\b/i,
    impacts:    [{ ccy: "EUR", dir: "bullish" }],
    categories: ["Banque Centrale", "EUR"],
    reason:     "BCE hawkish → EUR haussier",
  },
  {
    pattern:    /\b(ecb|european central bank|lagarde|eurozone (gdp|cpi|inflation|rate|pmi))\b/i,
    impacts:    [{ ccy: "EUR", dir: "neutral" }],
    categories: ["Banque Centrale", "EUR"],
    reason:     "Politique monétaire BCE",
  },

  // ── BoE / GBP ──────────────────────────────────────────────────────────────
  {
    pattern:    /\b(boe (cut|ease|dovish)|bank of england (cut|ease|pause)|uk inflation (drop|lower|cool))\b/i,
    impacts:    [{ ccy: "GBP", dir: "bearish" }],
    categories: ["Banque Centrale", "GBP"],
    reason:     "BoE dovish → GBP baissier",
  },
  {
    pattern:    /\b(boe (hike|hawkish)|bank of england (hike|hawkish)|uk inflation (surge|higher|above|sticky))\b/i,
    impacts:    [{ ccy: "GBP", dir: "bullish" }],
    categories: ["Banque Centrale", "GBP"],
    reason:     "BoE hawkish → GBP haussier",
  },
  {
    pattern:    /\b(bank of england|boe|sterling|uk (gdp|cpi|inflation|jobs|pmi|rate))\b/i,
    impacts:    [{ ccy: "GBP", dir: "neutral" }],
    categories: ["Banque Centrale", "GBP"],
    reason:     "Politique monétaire BoE",
  },

  // ── BoJ / JPY ──────────────────────────────────────────────────────────────
  {
    pattern:    /\b(boj (hike|tighten|hawkish)|bank of japan (hike|raise|hawkish)|yen (strengthens?|stronger|surge)|japan (rate hike|wage))\b/i,
    impacts:    [{ ccy: "JPY", dir: "bullish" }],
    categories: ["Banque Centrale", "JPY"],
    reason:     "BoJ hawkish → JPY haussier",
  },
  {
    pattern:    /\b(boj (cut|ease|hold|pause|dovish)|yen (weak|falls?|slide)|japan (rate hold|deflat))\b/i,
    impacts:    [{ ccy: "JPY", dir: "bearish" }],
    categories: ["Banque Centrale", "JPY"],
    reason:     "BoJ dovish → JPY baissier",
  },
  {
    pattern:    /\b(yen intervention|mof japan|ministry of finance japan|japan (intervene|verbal intervention))\b/i,
    impacts:    [{ ccy: "JPY", dir: "bullish" }],
    categories: ["Géopolitique", "JPY"],
    reason:     "Intervention MoF → JPY haussier (défense du plancher)",
  },
  {
    pattern:    /\b(bank of japan|boj|yen|japan (gdp|cpi|inflation|monetary|pmi))\b/i,
    impacts:    [{ ccy: "JPY", dir: "neutral" }],
    categories: ["Banque Centrale", "JPY"],
    reason:     "Politique monétaire BoJ",
  },

  // ── SNB / CHF ──────────────────────────────────────────────────────────────
  {
    pattern:    /\b(snb|swiss national bank|swiss franc|switzerland (rate|inflation|gdp))\b/i,
    impacts:    [{ ccy: "CHF", dir: "neutral" }],
    categories: ["Banque Centrale", "CHF"],
    reason:     "Politique monétaire SNB",
  },

  // ── BoC / CAD ──────────────────────────────────────────────────────────────
  {
    pattern:    /\b(bank of canada|boc|canada (rate|gdp|inflation|jobs)|loonie)\b/i,
    impacts:    [{ ccy: "CAD", dir: "neutral" }],
    categories: ["Banque Centrale", "CAD"],
    reason:     "Politique monétaire BoC",
  },

  // ── RBA / AUD ──────────────────────────────────────────────────────────────
  {
    pattern:    /\b(rba|reserve bank of australia|australia (rate|gdp|inflation|jobs)|aussie)\b/i,
    impacts:    [{ ccy: "AUD", dir: "neutral" }],
    categories: ["Banque Centrale", "AUD"],
    reason:     "Politique monétaire RBA",
  },

  // ── RBNZ / NZD ────────────────────────────────────────────────────────────
  {
    pattern:    /\b(rbnz|reserve bank of new zealand|new zealand (rate|gdp|inflation)|kiwi)\b/i,
    impacts:    [{ ccy: "NZD", dir: "neutral" }],
    categories: ["Banque Centrale", "NZD"],
    reason:     "Politique monétaire RBNZ",
  },

  // ── Pétrole → CAD haussier / JPY NZD baissiers ────────────────────────────
  {
    pattern:    /\b(oil (price(s)?|surge|rise|higher|rally|soar|spike|record)|crude (oil )?(up|higher|rally|surge)|opec (cut|supply cut|restrict)|energy (price(s)? )?(surge|spike|higher))\b/i,
    impacts:    [
      { ccy: "CAD", dir: "bullish" },
      { ccy: "JPY", dir: "bearish" },
      { ccy: "NZD", dir: "bearish" },
    ],
    categories: ["Énergie", "Commodités"],
    reason:     "Pétrole en hausse → CAD haussier (exportateur), JPY/NZD baissiers (importateurs ~90% énergie)",
  },
  {
    pattern:    /\b(oil (price(s)?|fall|drop|plunge|lower|crash|collapse|weak)|crude (oil )?(down|lower|fall|plunge)|opec (output|increase|supply up)|oil demand (weak|drop|slow))\b/i,
    impacts:    [
      { ccy: "CAD", dir: "bearish" },
      { ccy: "JPY", dir: "bullish" },
      { ccy: "NZD", dir: "bullish" },
    ],
    categories: ["Énergie", "Commodités"],
    reason:     "Pétrole en baisse → CAD baissier (exportateur), JPY/NZD haussiers (importateurs bénéficient)",
  },

  // ── Or → AUD haussier / CHF ────────────────────────────────────────────────
  {
    pattern:    /\b(gold (price(s)?|rise|rally|surge|record|higher|all.time)|gold (up|soar)|precious metal(s)? (up|rally|higher))\b/i,
    impacts:    [
      { ccy: "AUD", dir: "bullish" },
      { ccy: "CHF", dir: "bullish" },
    ],
    categories: ["Commodités", "Or"],
    reason:     "Or en hausse → AUD haussier (3ème producteur mondial), CHF haussier (valeur refuge liée à l'or)",
  },
  {
    pattern:    /\b(gold (fall|drop|plunge|lower|crash)|gold (down|weak)|precious metal(s)? (down|fall|lower))\b/i,
    impacts:    [
      { ccy: "AUD", dir: "bearish" },
    ],
    categories: ["Commodités", "Or"],
    reason:     "Or en baisse → AUD baissier",
  },

  // ── Minerai de fer / Métaux → AUD ─────────────────────────────────────────
  {
    pattern:    /\b(iron ore (price|rise|higher|surge|rally)|steel demand (up|higher|strong)|base metal(s)? (up|rally|higher)|copper (rise|surge|rally|higher))\b/i,
    impacts:    [{ ccy: "AUD", dir: "bullish" }],
    categories: ["Commodités", "Métaux"],
    reason:     "Minerai de fer / métaux en hausse → AUD haussier (1er exportateur mondial minerai de fer)",
  },
  {
    pattern:    /\b(iron ore (fall|drop|lower|plunge|weak)|steel demand (weak|drop|slow|fall)|base metal(s)? (down|fall|lower))\b/i,
    impacts:    [{ ccy: "AUD", dir: "bearish" }],
    categories: ["Commodités", "Métaux"],
    reason:     "Minerai de fer en baisse → AUD baissier",
  },

  // ── Chine / Demande asiatique → AUD / NZD ─────────────────────────────────
  {
    pattern:    /\b(china (growth|gdp|stimulus|pmi|recovery|demand|boom|strong)|chinese (economy|manufacturing|demand) (up|strong|better|recover|boom|grow)|china stimulus|china (fiscal|monetary) (stimulus|ease|boost))\b/i,
    impacts:    [
      { ccy: "AUD", dir: "bullish" },
      { ccy: "NZD", dir: "bullish" },
    ],
    categories: ["Chine", "Géopolitique"],
    reason:     "Croissance chinoise → AUD/NZD haussiers (principaux exportateurs vers la Chine : fer, LNG, produits laitiers)",
  },
  {
    pattern:    /\b(china (slowdown|weak|contraction|deflat|property crisis|debt|evergrande|recession)|chinese (economy|demand|pmi) (weak|slow|contract|drop|fall)|china (trade war|tariff))\b/i,
    impacts:    [
      { ccy: "AUD", dir: "bearish" },
      { ccy: "NZD", dir: "bearish" },
    ],
    categories: ["Chine", "Géopolitique"],
    reason:     "Ralentissement Chine → AUD/NZD baissiers (demande commodités en baisse)",
  },

  // ── Blé / Agriculture → USD / AUD / CAD ───────────────────────────────────
  {
    pattern:    /\b(wheat (price|supply|shortage|disruption|export block|higher)|grain (crisis|supply|shortage)|ukraine (wheat|grain|export)|food (inflation|crisis|price surge))\b/i,
    impacts:    [
      { ccy: "USD", dir: "bullish" },
      { ccy: "AUD", dir: "bullish" },
      { ccy: "CAD", dir: "bullish" },
    ],
    categories: ["Agriculture", "Géopolitique"],
    reason:     "Disruption blé/céréales → USD/AUD/CAD haussiers (grands exportateurs mondiaux)",
  },

  // ── Produits laitiers → NZD ────────────────────────────────────────────────
  {
    pattern:    /\b(dairy (price(s)?|index|gdt|auction|higher|surge)|fonterra|milk (price|higher)|new zealand export(s)? (up|higher|strong))\b/i,
    impacts:    [{ ccy: "NZD", dir: "bullish" }],
    categories: ["Agriculture", "NZD"],
    reason:     "Produits laitiers en hausse → NZD haussier (principal exportateur mondial lait/beurre)",
  },
  {
    pattern:    /\b(dairy (price(s)?|index|gdt|auction) (lower|fall|drop|weak)|fonterra (cut|lower|reduce))\b/i,
    impacts:    [{ ccy: "NZD", dir: "bearish" }],
    categories: ["Agriculture", "NZD"],
    reason:     "Produits laitiers en baisse → NZD baissier",
  },

  // ── Risk-Off → JPY / CHF haussiers, AUD / NZD baissiers ───────────────────
  {
    pattern:    /\b(risk[- ]off|safe[- ]haven (demand|flow|bid|surge)|geopolit(ical)? (tension|risk|crisis|escalat)|war|military (conflict|strike|attack|tension)|sanction(s)?|nuclear (threat|risk)|market (crash|sell.off|panic|rout|turmoil)|recession (fear|risk|warning)|stock(s)? (crash|plunge|sell.off))\b/i,
    impacts:    [
      { ccy: "JPY", dir: "bullish" },
      { ccy: "CHF", dir: "bullish" },
      { ccy: "USD", dir: "bullish" },
      { ccy: "AUD", dir: "bearish" },
      { ccy: "NZD", dir: "bearish" },
    ],
    categories: ["Risk-Off", "Géopolitique"],
    reason:     "Risk-off → JPY/CHF/USD haussiers (valeurs refuges), AUD/NZD baissiers (devises risquées)",
  },
  {
    pattern:    /\b(risk[- ]on|risk appetite (return|improve|recover)|market (rally|surge|boom|exuberance)|stock(s)? (rally|surge|soar|record)|optimism (return|grow)|peace (deal|agreement|ceasefire))\b/i,
    impacts:    [
      { ccy: "AUD", dir: "bullish" },
      { ccy: "NZD", dir: "bullish" },
      { ccy: "JPY", dir: "bearish" },
      { ccy: "CHF", dir: "bearish" },
    ],
    categories: ["Risk-On"],
    reason:     "Risk-on → AUD/NZD haussiers, JPY/CHF baissiers (refuges vendus)",
  },

  // ── Tarifs douaniers / Guerre commerciale ──────────────────────────────────
  {
    pattern:    /\b(tariff(s)?|trade war|trade barrier|import duty|import tax|protectionism|trade (sanction|restriction)|export ban)\b/i,
    impacts:    [
      { ccy: "CAD", dir: "bearish" },
      { ccy: "EUR", dir: "bearish" },
      { ccy: "CNY", dir: "neutral" } as never,
    ].filter(i => ["CAD", "EUR"].includes(i.ccy)) as { ccy: Currency; dir: "bullish" | "bearish" | "neutral" }[],
    categories: ["Géopolitique", "Commerce"],
    reason:     "Tarifs douaniers → EUR/CAD baissiers (forte dépendance export vers US)",
  },

  // ── Inflation générale ─────────────────────────────────────────────────────
  {
    pattern:    /\b(global inflation (surge|spike|higher|accelerat|above)|inflation (surprise|beat|above expect))\b/i,
    impacts:    [
      { ccy: "USD", dir: "bullish" },
      { ccy: "GBP", dir: "bullish" },
    ],
    categories: ["Données Macro", "Inflation"],
    reason:     "Inflation surprend → pression sur les banques centrales pour maintenir des taux élevés",
  },

  // ── Croissance mondiale ────────────────────────────────────────────────────
  {
    pattern:    /\b(global (recession|slowdown|contraction|downturn)|world (growth|gdp) (slow|drop|contract|negative)|imf (cut|lower|downgrade) (forecast|outlook|gdp))\b/i,
    impacts:    [
      { ccy: "AUD", dir: "bearish" },
      { ccy: "NZD", dir: "bearish" },
      { ccy: "CAD", dir: "bearish" },
      { ccy: "JPY", dir: "bullish" },
      { ccy: "CHF", dir: "bullish" },
    ],
    categories: ["Données Macro", "Géopolitique"],
    reason:     "Récession mondiale → refuges (JPY/CHF) haussiers, commodités (AUD/NZD/CAD) baissiers",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyRules(text: string): { impacts: NewsImpact[]; categories: string[] } {
  const impacts: NewsImpact[] = [];
  const categories = new Set<string>();
  const seenCcy = new Set<Currency>();

  for (const rule of IMPACT_RULES) {
    if (!rule.pattern.test(text)) continue;

    for (const cat of rule.categories) categories.add(cat);

    for (const { ccy, dir } of rule.impacts) {
      if (seenCcy.has(ccy)) continue; // première règle matchée par devise gagne
      seenCcy.add(ccy);
      impacts.push({ ccy, direction: dir, reason: rule.reason });
    }

    if (seenCcy.size >= 8) break; // toutes les devises couvertes
  }

  return { impacts, categories: [...categories] };
}

function parseDate(raw: string): string {
  try {
    return new Date(raw).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function extractMeta(html: string, property: string): string {
  const m = html.match(new RegExp(`<meta[^>]*(?:name|property)=["']${property}["'][^>]*content=["']([^"']+)["']`, "i"))
           ?? html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${property}["']`, "i"));
  return m?.[1] ?? "";
}

const TE_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── Source 1 : InvestingLive /forex/ ─────────────────────────────────────────

async function fetchInvestingLiveNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch("https://investinglive.com/forex/", {
      next: { revalidate: 1800 },
      headers: TE_HEADERS,
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Articles listés sous forme <article> ou <div class="...post...">
    // On cherche les liens + titres + dates dans le HTML
    const items: NewsItem[] = [];

    // Pattern : <h2 ...><a href="URL">TITLE</a></h2> + datetime="DATE"
    const articlePattern = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    let m: RegExpExecArray | null;

    while ((m = articlePattern.exec(html)) !== null && items.length < 15) {
      const block = m[1];

      const linkM = block.match(/href=["'](https?:\/\/investinglive\.com\/[^"']+)["']/i);
      const titleM = block.match(/<h[1-4][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[1-4]>/i)
                  ?? block.match(/<a[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
      const dateM  = block.match(/datetime=["']([^"']+)["']/i);

      if (!linkM || !titleM) continue;

      const url       = linkM[1];
      const title     = titleM[1].replace(/<[^>]+>/g, "").trim();
      const dateStr   = dateM ? dateM[1] : "";
      const { impacts, categories } = applyRules(title);

      items.push({
        id:          `il-${Buffer.from(url).toString("base64").slice(0, 12)}`,
        title,
        url,
        source:      "InvestingLive",
        publishedAt: parseDate(dateStr),
        impacts,
        categories,
      });
    }

    return items;
  } catch { return []; }
}

// ── Source 2 : Reuters RSS (marchés) ─────────────────────────────────────────

const REUTERS_FEEDS = [
  "https://feeds.reuters.com/reuters/businessNews",
  "https://feeds.reuters.com/reuters/topNews",
];

function parseRssItems(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];

  for (const block of itemBlocks.slice(0, 20)) {
    const titleM   = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkM    = block.match(/<link>([\s\S]*?)<\/link>/i)
                  ?? block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const dateM    = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const descM    = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);

    if (!titleM || !linkM) continue;

    const title    = titleM[1].replace(/<[^>]+>/g, "").trim();
    const url      = linkM[1].trim();
    const dateStr  = dateM?.[1] ?? "";
    const summary  = descM?.[1].replace(/<[^>]+>/g, "").trim().slice(0, 200);

    const combined = `${title} ${summary ?? ""}`;
    const { impacts, categories } = applyRules(combined);

    items.push({
      id:          `rss-${Buffer.from(url).toString("base64").slice(0, 12)}`,
      title,
      url,
      source,
      publishedAt: parseDate(dateStr),
      summary,
      impacts,
      categories,
    });
  }

  return items;
}

async function fetchReutersNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    REUTERS_FEEDS.map(async (feedUrl) => {
      const res = await fetch(feedUrl, {
        next: { revalidate: 1800 },
        headers: { ...TE_HEADERS, "Accept": "application/rss+xml, application/xml, text/xml, */*" },
      });
      if (!res.ok) return [];
      const xml = await res.text();
      return parseRssItems(xml, "Reuters");
    })
  );

  const all: NewsItem[] = [];
  const seenUrls = new Set<string>();

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        all.push(item);
      }
    }
  }

  return all;
}

// ── Source 3 : Bloomberg (meta tags publics) ─────────────────────────────────

const BLOOMBERG_PAGES = [
  { url: "https://www.bloomberg.com/economics",             source: "Bloomberg Economics" },
  { url: "https://www.bloomberg.com/economics/central-banks", source: "Bloomberg CB" },
  { url: "https://www.bloomberg.com/fx-center",             source: "Bloomberg FX" },
];

async function fetchBloombergMeta(): Promise<NewsItem[]> {
  const items: NewsItem[] = [];

  for (const { url, source } of BLOOMBERG_PAGES) {
    try {
      const res = await fetch(url, {
        next:    { revalidate: 3600 },
        headers: TE_HEADERS,
      });
      if (!res.ok) continue;
      const html = await res.text();

      // Extraire les articles depuis les meta og:title / article JSON-LD
      const ldBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
      for (const block of ldBlocks.slice(0, 5)) {
        try {
          const json = JSON.parse(block.replace(/<script[^>]*>|<\/script>/gi, "").trim());
          const articles = Array.isArray(json) ? json : [json];
          for (const art of articles) {
            if (!art.headline || !art.url) continue;
            const title   = String(art.headline);
            const artUrl  = String(art.url);
            const dateStr = String(art.datePublished ?? art.dateModified ?? "");
            const { impacts, categories } = applyRules(title);
            items.push({
              id:          `bb-${Buffer.from(artUrl).toString("base64").slice(0, 12)}`,
              title,
              url:         artUrl,
              source,
              publishedAt: parseDate(dateStr),
              impacts,
              categories,
            });
          }
        } catch { /* skip malformed JSON-LD */ }
      }

      // Fallback: og:title de la page elle-même
      const ogTitle = extractMeta(html, "og:title");
      const ogDesc  = extractMeta(html, "og:description");
      if (ogTitle && ogTitle.length > 10) {
        const { impacts, categories } = applyRules(`${ogTitle} ${ogDesc}`);
        if (impacts.length > 0) {
          items.push({
            id:          `bb-page-${Buffer.from(url).toString("base64").slice(0, 12)}`,
            title:       ogTitle,
            url,
            source,
            publishedAt: new Date().toISOString(),
            summary:     ogDesc || undefined,
            impacts,
            categories,
          });
        }
      }
    } catch { /* Bloomberg peut bloquer, on continue */ }
  }

  return items;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function fetchAllNews(): Promise<NewsItem[]> {
  const [ilNews, reutersNews, bbNews] = await Promise.allSettled([
    fetchInvestingLiveNews(),
    fetchReutersNews(),
    fetchBloombergMeta(),
  ]);

  const all: NewsItem[] = [
    ...(ilNews.status      === "fulfilled" ? ilNews.value      : []),
    ...(reutersNews.status === "fulfilled" ? reutersNews.value : []),
    ...(bbNews.status      === "fulfilled" ? bbNews.value      : []),
  ];

  // Dédupliquer sur l'URL, trier par date décroissante
  const seenUrls = new Set<string>();
  const deduped = all.filter(item => {
    if (seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  });

  deduped.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return deduped;
}
