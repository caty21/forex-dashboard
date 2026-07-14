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
  try {
    const data = await fetchAllCBPaths();
    const currencies = Object.keys(data);
    console.log(`[rate-prob] fetched ${currencies.length} CBs: ${currencies.join(", ")}`);
    return NextResponse.json(
      { data, fetchedAt: new Date().toISOString() } satisfies RateProbabilitiesResponse,
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    // Ne jamais laisser une exception (ex: timeout InvestingLive) faire planter la route
    // entière — ça faisait échouer le fetch() client pour les 8 devises d'un coup au lieu
    // de dégrader currency par currency. On renvoie un JSON valide (vide) : le client bascule
    // sur son cache localStorage plutôt que de rester bloqué sur "Données OIS indisponibles".
    console.error(`[rate-prob] fatal error: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json(
      { data: {}, fetchedAt: new Date().toISOString() } satisfies RateProbabilitiesResponse,
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
