// Közös konstansok – a szerver és a kliens is ezt használja.

export const CHOIRS = {
  cantemus: 'Cantemus Vegyeskar',
  promusica: 'Pro Musica',
};

export const EVENT_TYPES = {
  proba: 'Próba',
  foproba: 'Főpróba',
  koncert: 'Koncert',
  utazas: 'Utazás',
};

export const RESPONSES = {
  yes: 'Részt veszek',
  maybe: 'Talán',
  no: 'Nem tudok részt venni',
};

export const RESPONSE_REPORT_LABELS = {
  yes: 'Részt vesz',
  maybe: 'Talán',
  no: 'Nem vesz részt',
  none: 'Nem jelzett vissza',
};

export const EVENT_STATUSES = {
  draft: 'Piszkozat',
  published: 'Közzétéve',
  cancelled: 'Elmarad',
};

export const THANK_YOU_MESSAGE = 'Köszönjük, hogy visszajeleztél nekünk! 🙂';

// Ezt kapja, akit közzététel után kivesznek az esemény meghívottjai közül.
export const UNINVITED_MESSAGE = 'Kedves Kórustag!, A megbeszéltek szerint most erre az eseményre mégsem kell jönnöd!';

// Szólamok szokásos sorrendje: szoprán, mezzo, alt, tenor, bariton, basszus – azon belül sorszám szerint.
const VOICE_GROUPS = [/^(szopr|sopr|s\d|s$)/, /^(mezzo|mz)/, /^(alt|a\d|a$)/, /^(tenor|t\d|t$)/, /^(barit|bar)/, /^(bassz|bass|b\d|b$)/];

export function voiceRank(voice) {
  const v = String(voice || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s.]+/g, '');
  if (!v) return 9999;
  const group = VOICE_GROUPS.findIndex((re) => re.test(v));
  const num = Number((v.match(/\d+/) || [0])[0]);
  return (group === -1 ? 9 : group) * 100 + num;
}

export function compareVoices(a, b) {
  return voiceRank(a) - voiceRank(b) || String(a || '').localeCompare(String(b || ''), 'hu');
}

// Magyar névelő (a / az) a következő szó kiejtése alapján – egyszerűsített szabály.
export function article(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return 'a';
  if (/^[aáeéiíoóöőuúüű]/.test(w)) return 'az';
  // Számok: 5… (öt, ötven, ötszáz), 1 (egy) és 1000–1999 (ezer…) magánhangzóval kezdődik.
  if (/^5/.test(w) || /^1(\d{3})?(\D|$)/.test(w)) return 'az';
  return 'a';
}

export function missedMessage(eventName) {
  return `Sajnáljuk, hogy nem tudsz részt venni ${article(eventName)} ${eventName} eseményen, reméljük a következőn találkozunk! 🙂 Ne felejts el visszajelezni a határidőig!`;
}

export function mapsUrl(ev) {
  // Csak országgal nincs értelme térképet nyitni.
  if (!ev.venue && !ev.address && !ev.city) return null;
  const query = [ev.venue, ev.address, ev.city, ev.country].filter(Boolean).join(', ');
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
