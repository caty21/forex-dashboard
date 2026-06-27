import { NextResponse } from "next/server";
import { fetchAllCBPaths } from "@/lib/rateprobability";
import type { RateProbData } from "@/lib/rateprobability";

export const dynamic = "force-dynamic";
export const preferredRegion = ["fra1", "lhr1", "cdg1"]; // Europe (Frankfurt / London / Paris)

export type { RateProbData, CBRatePath, RateProbMeeting } from "@/lib/rateprobability";

export interface RateProbabilitiesResponse {
  data:      RateProbData;
  fetchedAt: string;
}

export async function GET() {
  const data = await fetchAllCBPaths();
  const currencies = Object.keys(data);
  console.log(`[rate-prob] fetched ${currencies.length} CBs: ${currencies.join(", ")}`);
  return NextResponse.json(
    { data, fetchedAt: new Date().toISOString() } satisfies RateProbabilitiesResponse,
    { headers: { "Cache-Control": "no-store" } }
  );
}
