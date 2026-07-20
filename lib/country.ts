const isoCountryCodes = `AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW`.split(' ');
const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryOptions = isoCountryCodes.map((code) => ({ code, name: displayNames.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name));
const countryCodes: Record<string, string> = Object.fromEntries(countryOptions.map(({ code, name }) => [name.toLowerCase(), code]));
Object.assign(countryCodes, {
  'united arab emirates':'AE', uae:'AE', malaysia:'MY', 'united states':'US', usa:'US',
  'united kingdom':'GB', uk:'GB', singapore:'SG', india:'IN', 'sri lanka':'LK',
  australia:'AU', canada:'CA', germany:'DE', france:'FR', italy:'IT', spain:'ES',
  netherlands:'NL', sweden:'SE', norway:'NO', finland:'FI', switzerland:'CH',
  japan:'JP', china:'CN', indonesia:'ID', thailand:'TH', philippines:'PH', vietnam:'VN',
  pakistan:'PK', bangladesh:'BD', 'saudi arabia':'SA', qatar:'QA', kuwait:'KW', oman:'OM',
  bahrain:'BH', turkey:'TR', brazil:'BR', mexico:'MX', 'south africa':'ZA', nigeria:'NG'
});
export function countryCode(country?: string | null) {
  if (!country) return null;
  const clean = country.trim();
  const code = clean.length === 2 ? clean.toUpperCase() : countryCodes[clean.toLowerCase()];
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

export function countryName(country?: string | null) {
  const code = countryCode(country);
  return code ? displayNames.of(code) || country?.trim() || code : country?.trim() || 'Unknown';
}

export function countryFlag(country?: string | null) {
  const code = countryCode(country);
  return code ? String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0))) : '🌐';
}

export function countryLabel(country?: string | null) {
  return country ? `${countryFlag(country)} ${countryName(country)}` : '🌐 Unknown';
}
