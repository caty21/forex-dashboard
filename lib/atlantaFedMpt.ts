// lib/atlantaFedMpt.ts
// Atlanta Fed Market Probability Tracker — méthodologie alternative aux 30-day
// Fed Fund Futures (Investing.com Fed Rate Monitor) : distribution du niveau
// de taux Fed déduite des options sur futures SOFR 3 mois (CME). Donnée
// statique maintenue par .github/workflows/fetch-atlanta-mpt.yml (quotidien).
// Source : https://www.atlantafed.org/cenfis/market-probability-tracker

import atlantaMptRaw from "@/data/atlanta-fed-mpt.json";

export interface AtlantaMptDistributionBucket {
  rangeLabel: string;  // "375bps - 400bps"
  probPct:    number;
}

export interface AtlantaMptWindow {
  windowStartIso: string;               // début de la fenêtre 3 mois référencée par le contrat SOFR
  anchorRange:    string | null;         // fourchette cible FOMC à la date d'observation
  probCutPct:     number | null;
  probHikePct:    number | null;
  rate25:         number | null;         // bps
  rateMean:       number | null;         // bps
  rateMode:       number | null;         // bps
  rate75:         number | null;         // bps
  distribution:   AtlantaMptDistributionBucket[];
}

export interface AtlantaFedMpt {
  updated_at: string;
  asOf:       string;   // date d'observation des données (publication Atlanta Fed)
  source:     string;
  note:       string;
  windows:    AtlantaMptWindow[];
}

export function getAtlantaFedMpt(): AtlantaFedMpt | null {
  try {
    const data = atlantaMptRaw as AtlantaFedMpt;
    if (!data?.windows?.length) return null;
    return data;
  } catch {
    return null;
  }
}
