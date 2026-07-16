const countryCodes: Record<string, string> = {
  'united arab emirates':'AE', uae:'AE', malaysia:'MY', 'united states':'US', usa:'US',
  'united kingdom':'GB', uk:'GB', singapore:'SG', india:'IN', 'sri lanka':'LK',
  australia:'AU', canada:'CA', germany:'DE', france:'FR', italy:'IT', spain:'ES',
  netherlands:'NL', sweden:'SE', norway:'NO', finland:'FI', switzerland:'CH',
  japan:'JP', china:'CN', indonesia:'ID', thailand:'TH', philippines:'PH', vietnam:'VN',
  pakistan:'PK', bangladesh:'BD', 'saudi arabia':'SA', qatar:'QA', kuwait:'KW', oman:'OM',
  bahrain:'BH', turkey:'TR', brazil:'BR', mexico:'MX', 'south africa':'ZA', nigeria:'NG'
};
export function countryFlag(country?: string | null) { if (!country) return '🌐'; const clean=country.trim(); const code=clean.length===2?clean.toUpperCase():countryCodes[clean.toLowerCase()]; return code&&/^[A-Z]{2}$/.test(code)?String.fromCodePoint(...[...code].map(letter=>127397+letter.charCodeAt(0))):'🌐'; }
export function countryLabel(country?: string | null) { return country ? `${countryFlag(country)} ${country}` : '🌐 Unknown'; }
