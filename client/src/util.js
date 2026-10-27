import { CHOIRS } from '../../shared/constants.js';

const TZ = 'Europe/Budapest';

// 'YYYY-MM-DD' → „2026. november 3., kedd”
export function formatDate(date, opts = {}) {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', ...opts }).format(d);
}

export function formatDateTimeIso(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatShortIso(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function dateParts(date) {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    day: d.getUTCDate(),
    month: new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', month: 'short' }).format(d).replace('.', ''),
    weekday: new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', weekday: 'short' }).format(d),
  };
}

// Több napos eseménynél: „nov. 12–14.” vagy „nov. 30. – dec. 2.”
export function dayRange(ev) {
  if (!ev.endDate) return '';
  const f = (d, opts) => new Intl.DateTimeFormat('hu-HU', { timeZone: 'UTC', ...opts }).format(new Date(`${d}T12:00:00Z`));
  const sameMonth = ev.date.slice(0, 7) === ev.endDate.slice(0, 7);
  return sameMonth
    ? `${f(ev.date, { month: 'short', day: 'numeric' }).replace(/\.$/, '')}–${f(ev.endDate, { day: 'numeric' })}`
    : `${f(ev.date, { month: 'short', day: 'numeric' })} – ${f(ev.endDate, { month: 'short', day: 'numeric' })}`;
}

export function timeRange(ev) {
  if (!ev.startTime) return '';
  return ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime;
}

export function placeText(ev) {
  return [ev.venue, ev.address, ev.city, ev.country].filter(Boolean).join(', ');
}

export function choirNames(choirs) {
  return (choirs || []).map((c) => CHOIRS[c]).join(' · ');
}

export function todayIso() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());
}

export function relativeDeadline(iso) {
  const ms = new Date(iso) - new Date();
  if (ms <= 0) return 'lejárt';
  const days = Math.floor(ms / 86400000);
  if (days >= 2) return `még ${days} nap`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `még ${hours} óra`;
  return 'hamarosan lejár';
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
