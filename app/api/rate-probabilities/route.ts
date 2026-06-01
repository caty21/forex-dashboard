import { NextResponse } from "next/server";
import { fetchAllCBPaths } from "@/lib/rateprobability";
import type { RateProbData } from "@/lib/rateprobability";

export type { RateProbData, CBRatePath, RateProbMeeting } from "@/lib/rateprobability";

export interface RateProbabilitiesResponse {
  data:      RateProbData;
  fetchedAt: string;
}

export async function GET() {
  const data = await fetchAllCBPaths();
  return NextResponse.json(
    { data, fetchedAt: new Date().toISOString() } satisfies RateProbabilitiesResponse,
    { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=7200" } }
  );
}
