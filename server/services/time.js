import { DateTime } from 'luxon';

export const TZ = 'Europe/Budapest';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function isDate(value) {
  return DATE_RE.test(value || '') && DateTime.fromISO(value, { zone: TZ }).isValid;
}

export function isTime(value) {
  return TIME_RE.test(value || '') && DateTime.fromISO(`2000-01-01T${value}`).isValid;
}

// Budapesti falióra szerinti dátum + idő → UTC ISO.
export function localToUtcIso(date, time = '00:00') {
  const dt = DateTime.fromISO(`${date}T${time || '00:00'}`, { zone: TZ });
  if (!dt.isValid) throw new Error(`Érvénytelen dátum/idő: ${date} ${time}`);
  return dt.toUTC().toISO();
}

// A határidő a megadott nap végéig (vagy a megadott percig) tart.
export function deadlineToUtcIso(date, time = '23:59') {
  const dt = DateTime.fromISO(`${date}T${time || '23:59'}`, { zone: TZ }).endOf('minute');
  if (!dt.isValid) throw new Error(`Érvénytelen határidő: ${date} ${time}`);
  return dt.toUTC().toISO();
}

export function toLocal(iso) {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(TZ);
}

export function localDateOf(iso) {
  return toLocal(iso).toISODate();
}

export function localTimeOf(iso) {
  return toLocal(iso).toFormat('HH:mm');
}

export function nowLocal(now = new Date()) {
  return DateTime.fromJSDate(new Date(now)).setZone(TZ);
}

// Két ISO időpont közti naptári napok száma budapesti idő szerint.
export function calendarDaysBetween(fromIso, toIso) {
  const a = toLocal(fromIso).startOf('day');
  const b = toLocal(toIso).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

export function defaultDeadlineDate(eventDate, daysBefore) {
  return DateTime.fromISO(eventDate, { zone: TZ }).minus({ days: daysBefore }).toISODate();
}

export function formatDateHu(date, time) {
  const dt = DateTime.fromISO(date, { zone: TZ }).setLocale('hu');
  const d = dt.toFormat('yyyy. LLLL d. (cccc)');
  return time ? `${d} ${time}` : d;
}

// Az esemény időpontja szövegesen. Több napos eseménynél a kezdés és a befejezés ugyanarra a napra vonatkozik,
// ezért az első nap mellett áll mindkettő, a napok száma pedig külön: „… 10:00–17:00 · 3 napos esemény (december 5–7.)”.
export function eventWhenHu(ev) {
  const time = ev.startTime ? `${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}` : '';
  const first = formatDateHu(ev.date, time);
  if (!ev.endDate || ev.endDate <= ev.date) return first;
  const a = DateTime.fromISO(ev.date, { zone: TZ }).setLocale('hu');
  const b = DateTime.fromISO(ev.endDate, { zone: TZ }).setLocale('hu');
  const days = Math.round(b.diff(a, 'days').days) + 1;
  const range = a.hasSame(b, 'month') ? `${a.toFormat('LLLL d')}–${b.toFormat('d')}.` : `${a.toFormat('LLLL d.')} – ${b.toFormat('LLLL d.')}`;
  return `${first} · ${days} napos esemény (${range})`;
}

export function formatIsoHu(iso) {
  return toLocal(iso).setLocale('hu').toFormat('yyyy. LLLL d. (cccc) HH:mm');
}
