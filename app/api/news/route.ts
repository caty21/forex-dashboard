import { NextResponse } from "next/server";
import { fetchAllNews } from "@/lib/newsfeed";
import type { NewsItem } from "@/lib/newsfeed";

export type { NewsItem } from "@/lib/newsfeed";

let _cache: { data: NewsItem[]; ts: number } | null = null;
const TTL = 30 * 60_000; // 30 min

export async function GET() {
  if (_cache && Date.now() - _cache.ts < TTL) {
    return NextResponse.json({ items: _cache.data, fetchedAt: new Date(_cache.ts).toISOString() });
  }

  const items = await fetchAllNews();
  _cache = { data: items, ts: Date.now() };

  return NextResponse.json(
    { items, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" } }
  );
}
