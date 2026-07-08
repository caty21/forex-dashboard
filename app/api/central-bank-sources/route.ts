import { NextResponse } from "next/server";
import { fetchAllCBGovernance } from "@/lib/centralBankGovernance";
import type { CBGovernance } from "@/lib/centralBankGovernance";

export const dynamic = "force-dynamic";

export type { CBGovernance, FedDotPlot, FedDot, FedSepHistoryPoint } from "@/lib/centralBankGovernance";

export interface CentralBankSourcesResponse {
  data:      Record<string, CBGovernance>;
  fetchedAt: string;
}

export async function GET() {
  const data = await fetchAllCBGovernance();
  return NextResponse.json(
    { data, fetchedAt: new Date().toISOString() } satisfies CentralBankSourcesResponse,
    { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=21600" } }
  );
}
