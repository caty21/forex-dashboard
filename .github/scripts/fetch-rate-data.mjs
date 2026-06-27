// Runs in GitHub Actions (not Vercel) — fetches from rateprobability.com
// GitHub Actions IPs are not blocked by the site.
import { writeFileSync, mkdirSync } from "fs";

const CB_KEYS = [
  ["USD", "fed"],
  ["EUR", "ecb"],
  ["GBP", "boe"],
  ["JPY", "boj"],
  ["CAD", "boc"],
  ["AUD", "rba"],
  ["NZD", "rbnz"],
];

const HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept":          "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "sec-ch-ua":       '"Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile":"?0",
  "sec-fetch-dest":  "empty",
  "sec-fetch-mode":  "cors",
  "sec-fetch-site":  "same-origin",
};

async function fetchCB(ccy, slug) {
  try {
    const res = await fetch(`https://rateprobability.com/api/${slug}/latest`, {
      headers: { ...HEADERS, "Referer": `https://rateprobability.com/${slug}`, "Origin": "https://rateprobability.com" },
    });
    if (!res.ok) { console.error(`[${ccy}] HTTP ${res.status}`); return null; }
    const body = await res.json();
    console.log(`[${ccy}] OK — meetings: ${body?.today?.rows?.length ?? "?"}`);
    return body;
  } catch (e) {
    console.error(`[${ccy}] Error: ${e.message}`);
    return null;
  }
}

const results = {};
for (const [ccy, slug] of CB_KEYS) {
  const data = await fetchCB(ccy, slug);
  if (data) results[ccy] = data;
  await new Promise(r => setTimeout(r, 300)); // 300ms entre requêtes
}

mkdirSync("data", { recursive: true });
writeFileSync(
  "data/rate-probabilities.json",
  JSON.stringify({ data: results, fetchedAt: new Date().toISOString() }, null, 2)
);

console.log(`\nSaved ${Object.keys(results).length} CBs: ${Object.keys(results).join(", ")}`);
