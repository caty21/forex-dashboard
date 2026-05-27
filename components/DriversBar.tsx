"use client";

import type { DriverData } from "@/lib/types";

interface Props { drivers: DriverData }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null, dec: number, unit = "") {
  if (v === null) return "—";
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec })}${unit}`;
}

function DeltaTag({ delta, pct = false, dec = 2 }: { delta: number | null; pct?: boolean; dec?: number }) {
  if (delta === null) return null;
  const pos = delta > 0;
  const neg = delta < 0;
  const color = pos ? "text-emerald-600" : neg ? "text-red-500" : "text-gray-400";
  const arrow = pos ? "▲" : neg ? "▼" : "▬";
  return (
    <span className={`text-[10px] font-medium tabular-nums ml-0.5 ${color}`}>
      {arrow}{Math.abs(delta).toFixed(dec)}{pct ? "%" : ""}
    </span>
  );
}

/** Un indicateur : label · valeur · delta — hauteur fixe garantie */
function M({
  label, value, dec = 2, unit = "", delta, deltaPct, deltaDec, tooltip,
}: {
  label:     string;
  value:     number | null;
  dec?:      number;
  unit?:     string;
  delta?:    number | null;
  deltaPct?: boolean;
  deltaDec?: number;
  tooltip?:  string;
}) {
  const labelNode = tooltip ? (
    <span className="relative group inline-block">
      <span className="text-[9px] text-gray-400 border-b border-dotted border-gray-300 cursor-help whitespace-nowrap leading-tight">
        {label}
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-800 text-white text-[10px] rounded px-2 py-1.5 w-56 z-50 leading-snug shadow-lg whitespace-normal text-left">
        {tooltip}
      </span>
    </span>
  ) : (
    <span className="text-[9px] text-gray-400 whitespace-nowrap leading-tight">{label}</span>
  );

  return (
    <div className="flex flex-col items-center text-center flex-shrink-0">
      {/* Ligne 1 — label */}
      <div className="h-4 flex items-center justify-center">{labelNode}</div>
      {/* Ligne 2 — valeur */}
      <div className="h-5 flex items-center justify-center">
        <span className={`text-sm font-semibold tabular-nums ${value === null ? "text-gray-300" : "text-gray-800"}`}>
          {fmt(value, dec, unit)}
        </span>
      </div>
      {/* Ligne 3 — delta (slot réservé = alignement garanti) */}
      <div className="h-4 flex items-center justify-center">
        {delta !== undefined && delta !== null && (
          <DeltaTag delta={delta} pct={deltaPct} dec={deltaDec ?? dec} />
        )}
      </div>
    </div>
  );
}

/** Séparateur vertical */
function VSep() {
  return <div className="w-px bg-gray-100 self-stretch mx-2 flex-shrink-0" />;
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function DriversBar({ drivers }: Props) {
  const {
    vix, vixDelta,
    sp500, sp500ChangePct,
    btc, btcChange24h,
    hySpread, igSpread,
    us10y, curveSlope,
    gold, goldDelta,
    silver, silverDelta,
    brent, brentDelta,
    wti, wtiDelta,
  } = drivers as DriverData & { dxy?: number | null };

  const dxy    = (drivers as DriverData & { dxy?: number | null }).dxy ?? null;
  const riskOff = (vix ?? 0) > 25 || (hySpread ?? 0) > 500;

  return (
    <div className="mb-4 bg-white border border-gray-200 rounded-xl px-5 py-3">

      {/* En-tête */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest">
          Drivers globaux
        </span>
        {riskOff && (
          <span className="text-[9px] font-medium bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5">
            ⚠ Risk-Off
          </span>
        )}
      </div>

      {/* ── Ligne unique — tous les indicateurs ── */}
      <div className="flex items-start gap-4 overflow-x-auto pb-0.5">

        {/* Sentiment / Risk-On */}
        <M label="VIX"     value={vix}   dec={1} delta={vixDelta}       deltaDec={1} />
        <M label="S&P 500" value={sp500} dec={0} delta={sp500ChangePct} deltaPct deltaDec={2} />
        <M label="Bitcoin" value={btc}   dec={0} unit=" $" delta={btcChange24h} deltaPct deltaDec={2} />

        <VSep />

        {/* Crédit */}
        <M
          label="HY Spread" value={hySpread} dec={0} unit=" bps"
          tooltip="High Yield spread : écart entre les obligations d'entreprises à haut risque (< BBB) et les Treasuries US. >500 bps = signal risk-off fort."
        />
        <M
          label="IG Spread" value={igSpread} dec={0} unit=" bps"
          tooltip="Investment Grade spread : écart entre les obligations bien notées (BBB+) et les Treasuries US. Mesure le coût du crédit des grandes entreprises."
        />

        <VSep />

        {/* Taux & FX */}
        <M label="DXY"    value={dxy}        dec={2} />
        <M label="US 10Y" value={us10y}       dec={2} unit="%" />
        <M
          label="Crb 2-10" value={curveSlope} dec={0} unit=" bps"
          tooltip="Spread US 10Y − US 2Y. Positif = courbe normale. Négatif = courbe inversée (signal récessif historiquement, se matérialise ~12–18 mois après)."
        />

        <VSep />

        {/* Commodités */}
        <M label="Or $/oz"     value={gold}   dec={0} delta={goldDelta}   deltaDec={1} />
        <M label="Argent $/oz" value={silver} dec={2} delta={silverDelta} deltaDec={2} />
        <M label="Brent $/b"   value={brent}  dec={1} delta={brentDelta}  deltaDec={1} />
        <M label="WTI $/b"     value={wti}    dec={1} delta={wtiDelta}    deltaDec={1} />

      </div>
    </div>
  );
}
