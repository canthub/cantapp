import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { getDb } from '../db.js';
import { getEvent, isEligible, getResponse } from '../models.js';
import { CHOIRS, RESPONSES } from '../../shared/constants.js';
import { TZ, formatIsoHu } from './time.js';
import { config } from '../config.js';

// Személyes naptár-feliratkozás (iCalendar, RFC 5545): a tag minden eseménye, amelyre meg van hívva,
// a válasza szerinti jellel a címben. A naptárprogramok időnként újra letöltik, így a változások is átjönnek.

const PREFIX = { yes: '✅', maybe: '❓', no: '❌', none: '⏳' };
const DEFAULT_DURATION_HOURS = 2;
const PAST_DAYS = 60;

export function getCalendarToken(memberId, { reset = false } = {}) {
  const row = getDb().prepare('SELECT calendar_token FROM members WHERE id = ?').get(memberId);
  if (row?.calendar_token && !reset) return row.calendar_token;
  const token = crypto.randomBytes(24).toString('hex');
  getDb().prepare('UPDATE members SET calendar_token = ? WHERE id = ?').run(token, memberId);
  return token;
}

export function memberByCalendarToken(token) {
  if (!/^[0-9a-f]{48}$/.test(token || '')) return null;
  return getDb().prepare('SELECT * FROM members WHERE calendar_token = ? AND active = 1').get(token) || null;
}

export function calendarUrls(token) {
  const https = `${config.appUrl}/api/calendar/${token}.ics`;
  const webcal = https.replace(/^https?:\/\//, 'webcal://');
  return {
    url: https,
    webcalUrl: webcal,
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}

// ---------------------------------------------------------------- iCalendar formázás

const escapeText = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

// Sorhatár: legfeljebb 75 bájt, a folytatósor szóközzel kezdődik (UTF-8 karaktert nem vágunk ketté).
export function foldLine(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + len > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += len;
  }
  out.push(current);
  return out.join('\r\n ');
}

const utcStamp = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'");
const localStamp = (dt) => dt.toFormat("yyyyLLdd'T'HHmmss");

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

// Az esemény kezdete és vége (luxon DateTime), illetve egész napos eseménynél a napok.
function eventSpan(ev) {
  const lastDay = ev.endDate || ev.date;
  if (!ev.startTime) {
    return { allDay: true, start: DateTime.fromISO(ev.date, { zone: TZ }), end: DateTime.fromISO(lastDay, { zone: TZ }).plus({ days: 1 }) };
  }
  const start = DateTime.fromISO(`${ev.date}T${ev.startTime}`, { zone: TZ });
  let end = ev.endTime
    ? DateTime.fromISO(`${lastDay}T${ev.endTime}`, { zone: TZ })
    : DateTime.fromISO(`${lastDay}T${ev.startTime}`, { zone: TZ }).plus({ hours: DEFAULT_DURATION_HOURS });
  if (end <= start) end = end.plus({ days: 1 }); // éjfélen átnyúló esemény
  return { allDay: false, start, end };
}

const eventLocation = (ev) => [ev.venue, ev.address, ev.city, ev.country].filter(Boolean).join(', ');
const eventLink = (ev) => `${config.appUrl}/#/esemeny/${ev.id}`;

// single: egyetlen esemény naptárba mentése (nem frissül), ezért a címben és a leírásban nincs a pillanatnyi válasz.
function eventLines(ev, response, now, { single = false } = {}) {
  const status = response?.status || 'none';
  const lines = ['BEGIN:VEVENT', `UID:event-${ev.id}@cantapp`, `DTSTAMP:${utcStamp(now.toISOString())}`];
  const span = eventSpan(ev);
  if (span.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${span.start.toFormat('yyyyLLdd')}`, `DTEND;VALUE=DATE:${span.end.toFormat('yyyyLLdd')}`);
  } else {
    lines.push(`DTSTART;TZID=${TZ}:${localStamp(span.start)}`, `DTEND;TZID=${TZ}:${localStamp(span.end)}`);
  }
  const cancelled = ev.status === 'cancelled';
  const prefix = cancelled ? '🚫 ELMARAD: ' : single ? '' : `${PREFIX[status]} `;
  lines.push(`SUMMARY:${escapeText(`${prefix}${ev.name}`)}`);
  const location = eventLocation(ev);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  const link = eventLink(ev);
  lines.push(`DESCRIPTION:${escapeText(eventDescription(ev, single ? null : { status, response }))}`, `URL:${link}`);
  lines.push(`STATUS:${cancelled ? 'CANCELLED' : single || status === 'yes' || status === 'no' ? 'CONFIRMED' : 'TENTATIVE'}`);
  // Ha nem vesz részt, ne foglalja a naptárát.
  lines.push(`TRANSP:${(!single && status === 'no') || cancelled ? 'TRANSPARENT' : 'OPAQUE'}`);
  const modified = [ev.updatedAt, response?.updated_at].filter(Boolean).sort().pop();
  if (modified) lines.push(`LAST-MODIFIED:${utcStamp(modified)}`);
  lines.push('END:VEVENT');
  return lines;
}

function eventDescription(ev, answer) {
  return [
    `${ev.typeLabel}${ev.isTour ? ' (koncertturné)' : ''} – ${ev.choirs.map((c) => CHOIRS[c]).join(', ')}`,
    answer ? `Visszajelzésed: ${answer.status === 'none' ? 'még nincs' : RESPONSES[answer.status]}${ev.accommodation && answer.response?.accommodation ? ' (szállást kértél)' : ''}` : null,
    ev.isOpen ? `Visszajelzési határidő: ${formatIsoHu(ev.deadlineAt)}` : null,
    ev.notes ? `\n${ev.notes}` : null,
    `\nVisszajelzés és részletek az appban: ${eventLink(ev)}`,
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- Egy esemény naptárba mentése

// Kisegítő művészeknek: az eseményeket egyenként menthetik a naptárukba (.ics fájl vagy Google Naptár link).
// A link a tag titkos naptárkulcsát használja, így a telefon naptára bejelentkezés nélkül is megnyitja.
export function singleEventUrls(token, ev) {
  const span = eventSpan(ev);
  const fmt = span.allDay ? 'yyyyLLdd' : "yyyyLLdd'T'HHmmss";
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.name,
    dates: `${span.start.toFormat(fmt)}/${span.end.toFormat(fmt)}`,
    details: eventDescription(ev, null),
    location: eventLocation(ev),
  });
  if (!span.allDay) params.set('ctz', TZ);
  return {
    icsUrl: `${config.appUrl}/api/calendar/${token}/event-${ev.id}.ics`,
    googleUrl: `https://calendar.google.com/calendar/render?${params}`,
  };
}

export function buildSingleEventCalendar(eventId, now = new Date()) {
  const ev = getEvent(eventId, now);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cantemus Korus//cantapp//HU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...VTIMEZONE,
    ...eventLines(ev, null, now, { single: true }),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// A tag naptárába kerülő események: közzétett (vagy utólag lemondott), legfeljebb 60 napja volt, és meg van rá hívva.
function memberCalendarRows(memberId, now) {
  const from = DateTime.fromJSDate(now).minus({ days: PAST_DAYS }).toISODate();
  return getDb()
    .prepare(`SELECT id, updated_at FROM events WHERE status IN ('published', 'cancelled') AND published_at IS NOT NULL AND date >= ? ORDER BY starts_at`)
    .all(from)
    .filter((r) => isEligible(r.id, memberId));
}

// A Profil oldalon megjelenő állapot: hány esemény kerül a naptárba, és ha egy sem, miért.
export function calendarStatus(memberId, now = new Date()) {
  const choirs = getDb().prepare('SELECT COUNT(*) AS n FROM member_choirs WHERE member_id = ?').get(memberId).n;
  const guest = Boolean(getDb().prepare('SELECT is_guest FROM members WHERE id = ?').get(memberId)?.is_guest);
  return { eventCount: memberCalendarRows(memberId, now).length, hasChoir: choirs > 0 || guest };
}

export function buildMemberCalendar(memberId, now = new Date()) {
  const rows = memberCalendarRows(memberId, now);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cantemus Korus//cantapp//HU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Cantemus Kórus', `X-WR-TIMEZONE:${TZ}`, 'X-WR-CALDESC:Próbák\\, főpróbák\\, koncertek és utazások',
    // Javaslat a naptárprogramoknak: óránként frissítsenek (nem mindegyik veszi figyelembe).
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  for (const { id, updated_at: updatedAt } of rows) {
    const ev = { ...getEvent(id, now), updatedAt };
    lines.push(...eventLines(ev, getResponse(id, memberId), now));
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
