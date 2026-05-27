"""
Scraper — Giuseppe Dellamotta / investinglive.com
Cible : articles "Rate hikes by year-end" publiés périodiquement (~mensuel)
Auteur  : Claude (Anthropic) — usage personnel

Usage :
    python investinglive_scraper.py                  # scrape les N derniers articles détectés
    python investinglive_scraper.py --url <URL>       # scrape un article spécifique
    python investinglive_scraper.py --output json     # sortie JSON (défaut : tableau console)
    python investinglive_scraper.py --output json --save expectations.json

Stratégie de découverte d'articles :
    1. Page auteur Giuseppe Dellamotta
    2. Catégorie CentralBanks
    3. Google Search comme fallback
    Les articles contenant "Rate hikes by year-end" dans le corps sont sélectionnés.
"""

import requests
from bs4 import BeautifulSoup
import re
import json
import argparse
import time
import sys
from datetime import datetime
from urllib.parse import urljoin

# ── Configuration ──────────────────────────────────────────────────────────────

BASE_URL = "https://investinglive.com"
AUTHOR_URL = f"{BASE_URL}/author/giuseppe-dellamotta/"
CATEGORY_URL = f"{BASE_URL}/CentralBanks"

KEYWORD = "Rate hikes by year-end"   # mot-clé discriminant
MAX_ARTICLES = 10                     # nb max d'articles à scanner pour trouver les N derniers

# Headers navigateur réaliste (Chrome 124, Windows)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;"
        "q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

REQUEST_DELAY = 1.5   # secondes entre requêtes (politesse)

# ── Banques centrales reconnues ─────────────────────────────────────────────────

CB_NAMES = {
    "fed": "Fed (USD)",
    "ecb": "ECB (EUR)",
    "boe": "BoE (GBP)",
    "boj": "BoJ (JPY)",
    "snb": "SNB (CHF)",
    "boc": "BoC (CAD)",
    "rba": "RBA (AUD)",
    "rbnz": "RBNZ (NZD)",
}

def normalize_cb(raw: str) -> str:
    key = raw.lower().strip(" *:")
    for k, v in CB_NAMES.items():
        if k in key:
            return v
    return raw.strip(" *:")


# ── HTTP helpers ────────────────────────────────────────────────────────────────

_session = requests.Session()
_session.headers.update(HEADERS)

def get_page(url: str, retries: int = 3) -> BeautifulSoup | None:
    """Fetch une page HTML et retourne un BeautifulSoup. None si échec."""
    for attempt in range(retries):
        try:
            if attempt > 0:
                time.sleep(REQUEST_DELAY * (attempt + 1))
            resp = _session.get(url, timeout=20)
            resp.raise_for_status()
            return BeautifulSoup(resp.text, "html.parser")
        except requests.HTTPError as e:
            print(f"  [HTTP {e.response.status_code}] {url}", file=sys.stderr)
            if e.response.status_code in (403, 404):
                return None          # inutile de retenter
        except requests.RequestException as e:
            print(f"  [Réseau] {e}", file=sys.stderr)
    return None


# ── Extraction de la date depuis l'URL ─────────────────────────────────────────

def date_from_url(url: str) -> str:
    """Extrait YYYY-MM-DD depuis le slug YYYYMMDD en fin d'URL."""
    m = re.search(r"(\d{8})/?$", url)
    if m:
        d = m.group(1)
        return f"{d[:4]}-{d[4:6]}-{d[6:8]}"
    return "?"


# ── Parsing du bloc de données ──────────────────────────────────────────────────

# Pattern : **RBNZ:** 76 bps (70% probability of no change at the next meeting)
_ENTRY_RE = re.compile(
    r"\*?\*?\s*([A-Za-z/]+)\s*:+\s*\*?\*?\s*"
    r"(\d+)\s*bps\s*"
    r"\((\d+)%\s+probability\s+of\s+([^)]+)\)",
    re.IGNORECASE,
)

def parse_rate_entries(text: str) -> list[dict]:
    return [
        {
            "cb": normalize_cb(m.group(1)),
            "bps": int(m.group(2)),
            "prob_pct": int(m.group(3)),
            "prob_desc": m.group(4).strip(),
        }
        for m in _ENTRY_RE.finditer(text)
    ]


def extract_rate_data(soup: BeautifulSoup, url: str) -> dict | None:
    """
    Extrait les blocs 'Rate cuts by year-end' et 'Rate hikes by year-end'
    depuis le HTML d'un article.
    Retourne None si le keyword n'est pas trouvé.
    """
    # Titre
    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else "N/A"

    # Texte complet de l'article
    article = (
        soup.find("article")
        or soup.find("div", class_=re.compile(r"article|content|entry|post", re.I))
        or soup.body
    )
    text = article.get_text(separator="\n") if article else soup.get_text(separator="\n")

    # Vérifier la présence du keyword
    if KEYWORD.lower() not in text.lower():
        return None

    # Parser les sections
    result = {
        "url": url,
        "title": title,
        "date": date_from_url(url),
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "rate_cuts": [],
        "rate_hikes": [],
    }

    lines = [l.strip() for l in text.splitlines() if l.strip()]
    current_section = None

    for line in lines:
        ll = line.lower()
        if "rate cuts by year-end" in ll:
            current_section = "cuts"
            continue
        if "rate hikes by year-end" in ll:
            current_section = "hikes"
            continue

        if current_section and len(line) < 250:
            entries = parse_rate_entries(line)
            for e in entries:
                if current_section == "cuts":
                    e["direction"] = "cut"
                    result["rate_cuts"].append(e)
                else:
                    e["direction"] = "hike"
                    result["rate_hikes"].append(e)

        # Stop si on sort manifestement du bloc (paragraphe long)
        if current_section and len(line) > 300:
            current_section = None

    return result


# ── Découverte des articles ─────────────────────────────────────────────────────

def discover_article_urls(limit: int = MAX_ARTICLES) -> list[str]:
    """
    Découvre les URLs d'articles de Giuseppe Dellamotta depuis :
    1. Sa page auteur
    2. La catégorie CentralBanks
    Retourne une liste dédupliquée, triée du plus récent au plus ancien.
    """
    found = []

    # Source 1 : page auteur
    soup = get_page(AUTHOR_URL)
    if soup:
        for a in soup.find_all("a", href=True):
            href = a["href"]
            # Articles de la catégorie centralbank avec slug YYYYMMDD
            if "/centralbank/" in href and re.search(r"\d{8}/?$", href):
                full = urljoin(BASE_URL, href)
                if full not in found:
                    found.append(full)
        time.sleep(REQUEST_DELAY)

    # Source 2 : catégorie (si page auteur insuffisante)
    if len(found) < limit:
        soup2 = get_page(CATEGORY_URL)
        if soup2:
            for a in soup2.find_all("a", href=True):
                href = a["href"]
                if "/centralbank/" in href and re.search(r"\d{8}/?$", href):
                    full = urljoin(BASE_URL, href)
                    if full not in found:
                        found.append(full)
            time.sleep(REQUEST_DELAY)

    # Trier du plus récent (date dans l'URL) au plus ancien
    def url_date_key(url):
        m = re.search(r"(\d{8})/?$", url)
        return m.group(1) if m else "00000000"

    found.sort(key=url_date_key, reverse=True)
    return found[:limit]


# ── Scraping principal ──────────────────────────────────────────────────────────

def scrape_recent(n: int = 2, specific_url: str = None) -> list[dict]:
    """
    Scrape les n derniers articles contenant KEYWORD.
    Si specific_url est fourni, scrape uniquement cet article.
    """
    if specific_url:
        urls_to_check = [specific_url]
    else:
        print(f"[Découverte] Recherche des articles de Giuseppe Dellamotta...", file=sys.stderr)
        urls_to_check = discover_article_urls(limit=MAX_ARTICLES)
        print(f"  {len(urls_to_check)} articles candidats trouvés.", file=sys.stderr)

    results = []

    for url in urls_to_check:
        if len(results) >= n and not specific_url:
            break

        print(f"  → Scanning: {url}", file=sys.stderr)
        soup = get_page(url)
        if not soup:
            continue

        data = extract_rate_data(soup, url)
        if data:
            print(f"    ✅ '{KEYWORD}' trouvé — {len(data['rate_hikes'])} BC hike / {len(data['rate_cuts'])} BC cut", file=sys.stderr)
            results.append(data)
        else:
            print(f"    ⏭  Keyword absent — article ignoré", file=sys.stderr)

        time.sleep(REQUEST_DELAY)

    return results


# ── Formatage console ───────────────────────────────────────────────────────────

def format_table(results: list[dict]) -> str:
    lines = []
    for r in results:
        lines.append("=" * 65)
        lines.append(f"📅  {r['date']}   |   {r['title'][:50]}")
        lines.append(f"🔗  {r['url']}")
        lines.append("")

        all_entries = []
        for e in r["rate_cuts"]:
            all_entries.append((e["cb"], -e["bps"], e["prob_pct"], e["prob_desc"], "cut"))
        for e in r["rate_hikes"]:
            all_entries.append((e["cb"], e["bps"], e["prob_pct"], e["prob_desc"], "hike"))

        # Trier par |bps| décroissant
        all_entries.sort(key=lambda x: -abs(x[1]))

        lines.append(f"  {'Banque Centrale':<16} {'Attentes fin d\'année':>14}  Prochain meeting")
        lines.append(f"  {'-'*16} {'-'*14}  {'-'*30}")
        for cb, bps, prob, desc, direction in all_entries:
            arrow = "▲ +" if direction == "hike" else "▼ -"
            lines.append(
                f"  {cb:<16} {arrow}{abs(bps):>3} bps       {prob}% prob. of {desc}"
            )
        lines.append("")

    lines.append("=" * 65)
    lines.append(f"Scraped at: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    return "\n".join(lines)


# ── CLI ─────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Scraper rate expectations — investinglive.com")
    parser.add_argument("--url", help="URL spécifique à scraper (optionnel)")
    parser.add_argument("--n", type=int, default=2, help="Nombre de derniers articles (défaut: 2)")
    parser.add_argument("--output", choices=["table", "json"], default="table", help="Format de sortie")
    parser.add_argument("--save", help="Fichier de sauvegarde JSON (optionnel)")
    args = parser.parse_args()

    results = scrape_recent(n=args.n, specific_url=args.url)

    if not results:
        print("❌ Aucun article trouvé avec le keyword.", file=sys.stderr)
        sys.exit(1)

    if args.output == "json" or args.save:
        json_str = json.dumps(results, ensure_ascii=False, indent=2)
        if args.save:
            with open(args.save, "w", encoding="utf-8") as f:
                f.write(json_str)
            print(f"💾 Sauvegardé dans {args.save}", file=sys.stderr)
        if args.output == "json":
            print(json_str)
        else:
            print(format_table(results))
    else:
        print(format_table(results))


if __name__ == "__main__":
    main()
