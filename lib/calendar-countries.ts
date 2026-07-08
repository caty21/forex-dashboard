// lib/calendar-countries.ts
// Univers de pays pour le calendrier économique — restreint le 2026-07-08 à la
// demande explicite de l'utilisateur : les 8 devises majeures tradées par le
// dashboard + la France en complément (grosse économie de la zone euro, dont
// les publications (Ifo-like, PMI, CPI...) précèdent souvent l'agrégat EMU).
//
// Sert de table de correspondance commune entre :
//   - Trading Economics : slug URL (/xxx/calendar) + nom affiché en data-country
//   - investingLive (widget FXStreet calendar.fxstreet.com) : code pays + data-countryname
//
// currency = devise ISO 4217 associée (EMU et FR partagent EUR).

export interface CalendarCountry {
  code:        string; // code FXStreet (aussi utilisé comme identifiant canonique)
  teSlug:      string; // slug Trading Economics : https://tradingeconomics.com/{slug}/calendar
  teName:      string; // valeur data-country de TE (lowercase)
  fxName:      string; // valeur data-countryname du widget FXStreet
  currency:    string; // ISO 4217
  displayName: string;
}

export const CALENDAR_COUNTRIES: CalendarCountry[] = [
  { code: "EMU", teSlug: "euro-area",      teName: "euro area",      fxName: "Eurozone",        currency: "EUR", displayName: "Zone Euro" },
  { code: "FR",  teSlug: "france",         teName: "france",         fxName: "France",          currency: "EUR", displayName: "France" },
  { code: "US",  teSlug: "united-states",  teName: "united states",  fxName: "United States",   currency: "USD", displayName: "États-Unis" },
  { code: "CA",  teSlug: "canada",         teName: "canada",         fxName: "Canada",          currency: "CAD", displayName: "Canada" },
  { code: "UK",  teSlug: "united-kingdom", teName: "united kingdom", fxName: "United Kingdom",  currency: "GBP", displayName: "Royaume-Uni" },
  { code: "CH",  teSlug: "switzerland",    teName: "switzerland",    fxName: "Switzerland",     currency: "CHF", displayName: "Suisse" },
  { code: "JP",  teSlug: "japan",          teName: "japan",          fxName: "Japan",           currency: "JPY", displayName: "Japon" },
  { code: "AU",  teSlug: "australia",      teName: "australia",      fxName: "Australia",       currency: "AUD", displayName: "Australie" },
  { code: "NZ",  teSlug: "new-zealand",    teName: "new zealand",    fxName: "New Zealand",     currency: "NZD", displayName: "Nouvelle-Zélande" },
];

export const TE_NAME_TO_CURRENCY: Record<string, string> = Object.fromEntries(
  CALENDAR_COUNTRIES.map(c => [c.teName, c.currency])
);

export const FX_NAME_TO_CURRENCY: Record<string, string> = Object.fromEntries(
  CALENDAR_COUNTRIES.map(c => [c.fxName, c.currency])
);

export const TE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  CALENDAR_COUNTRIES.map(c => [c.teName, c.code])
);

export const FX_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  CALENDAR_COUNTRIES.map(c => [c.fxName, c.code])
);

export const FXSTREET_COUNTRYCODES = CALENDAR_COUNTRIES.map(c => c.code).join(",");
