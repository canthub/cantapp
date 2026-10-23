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
  const query = [ev.venue, ev.address, ev.city, ev.country].filter(Boolean).join(', ');
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
