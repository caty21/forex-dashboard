import { NextResponse } from "next/server";

// 10Y sovereign yields — mixed sources per CDC §6.4
// USD: FRED DGS10 (daily)
// EUR: ECB API (daily Bund)
// GBP: BoE API IUDMNPY (daily)
// Others: FRED monthly as fallback

const FRED_KEY = () => process.env.FRED_API_KEY ?? "";

async function fredObs(series: string): Promise<number | null> {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${FRED_KEY()}&file_type=json&sort_order=desc&limit=3`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = await res.json();
    const val = (data?.observations ?? []).find((o: { value: string }) => o.value !== ".")?.value;
    return val ? parseFloat(val) : null;
  } catch {
    return null;
  }
}

async function ecbBund10Y(): Promise<number | null> {
  try {
    const url = "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=jsondata&lastNObservations=1";
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = await res.json();
    const obs = data?.dataSets?.[0]?.series?.["0:0:0:0:0:0:0"]?.observations;
    if (!obs) return null;
    const last = Object.values(obs).at(-1) as number[] | undefined;
    return last?.[0] ?? null;
  } catch {
    return null;
  }
}

async function boeGilt10Y(): Promise<number | null> {
  try {
    // BoE API series IUDMNPY = UK Nominal Par Yield 10Y
    const url = "https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes&Datefrom=01/Jan/2024&Dateto=now&SeriesCodes=IUDMNPY&CSVF=TN&UsingCodes=Y";
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split("\n").filter((l) => l.trim());
    const last = lines.at(-1)?.split(",");
    const val = last?.at(-1)?.trim();
    return val ? parseFloat(val) : null;
  } catch {
    return null;
  }
}

async function bocYield10Y(): Promise<number | null> {
  try {
    const url = "https://www.bankofcanada.ca/valet/observations/BD.CDN.10YR.DQ.YLD/json?recent=5";
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const data = await res.json();
    const obs: { d: string; "BD.CDN.10YR.DQ.YLD": { v: string } }[] =
      data?.observations ?? [];
    const last = obs.findLast((o) => o["BD.CDN.10YR.DQ.YLD"]?.v);
    return last ? parseFloat(last["BD.CDN.10YR.DQ.YLD"].v) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const [usd, eur, gbp, jpy, chf, cad, aud, nzd] = await Promise.all([
    fredObs("DGS10"),
    ecbBund10Y(),
    boeGilt10Y(),
    fredObs("IRLTLT01JPM156N"),
    fredObs("IRLTLT01CHM156N"),
    bocYield10Y(),
    fredObs("IRLTLT01AUM156N"),
    fredObs("IRLTLT01NZM156N"),
  ]);

  const yields = { USD: usd, EUR: eur, GBP: gbp, JPY: jpy, CHF: chf, CAD: cad, AUD: aud, NZD: nzd };

  // Compute spreads vs USD
  const spreads: Record<string, number | null> = {};
  for (const [ccy, yld] of Object.entries(yields)) {
    if (ccy === "USD" || yld === null || usd === null) {
      spreads[ccy] = null;
    } else {
      spreads[ccy] = Math.round((yld - usd) * 100); // bps
    }
  }

  return NextResponse.json({ yields, spreads, timestamp: Date.now() });
}
