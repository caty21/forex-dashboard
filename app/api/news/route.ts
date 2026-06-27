import { NextResponse } from "next/server";
import { fetchAllNews } from "@/lib/newsfeed";
import type { NewsItem } from "@/lib/newsfeed";

export const dynamic = "force-dynamic";

export type { NewsItem } from "@/lib/newsfeed";

let _cache: { data: NewsItem[]; ts: number } | null = null;
const TTL = 5 * 60_000; // 5 min — actualités fraîches

export async function GET() {
  if (_cache && Date.now() - _cache.ts < TTL) {
    return NextResponse.json({ items: _cache.data, fetchedAt: new Date(_cache.ts).toISOString() });
  }

  const items = await fetchAllNews();
  _cache = { data: items, ts: Date.now() };

  return NextResponse.json(
    { items, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } }
  );
}
