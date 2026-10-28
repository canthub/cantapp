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

function eventLines(ev, response, now) {
  const status = response?.status || 'none';
  const lines = ['BEGIN:VEVENT', `UID:event-${ev.id}@cantapp`, `DTSTAMP:${utcStamp(now.toISOString())}`];
  const lastDay = ev.endDate || ev.date;
  if (ev.startTime) {
    const start = DateTime.fromISO(`${ev.date}T${ev.startTime}`, { zone: TZ });
    let end = ev.endTime
      ? DateTime.fromISO(`${lastDay}T${ev.endTime}`, { zone: TZ })
      : DateTime.fromISO(`${lastDay}T${ev.startTime}`, { zone: TZ }).plus({ hours: DEFAULT_DURATION_HOURS });
    if (end <= start) end = end.plus({ days: 1 }); // éjfélen átnyúló esemény
    lines.push(`DTSTART;TZID=${TZ}:${localStamp(start)}`, `DTEND;TZID=${TZ}:${localStamp(end)}`);
  } else {
    const day = DateTime.fromISO(ev.date, { zone: TZ });
    const after = DateTime.fromISO(lastDay, { zone: TZ }).plus({ days: 1 });
    lines.push(`DTSTART;VALUE=DATE:${day.toFormat('yyyyLLdd')}`, `DTEND;VALUE=DATE:${after.toFormat('yyyyLLdd')}`);
  }
  const cancelled = ev.status === 'cancelled';
  lines.push(`SUMMARY:${escapeText(`${cancelled ? '🚫 ELMARAD: ' : `${PREFIX[status]} `}${ev.name}`)}`);
  const location = [ev.venue, ev.address, ev.city, ev.country].filter(Boolean).join(', ');
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  const link = `${config.appUrl}/#/esemeny/${ev.id}`;
  const description = [
    `${ev.typeLabel}${ev.isTour ? ' (koncertturné)' : ''} – ${ev.choirs.map((c) => CHOIRS[c]).join(', ')}`,
    `Visszajelzésed: ${status === 'none' ? 'még nincs' : RESPONSES[status]}${ev.accommodation && response?.accommodation ? ' (szállást kértél)' : ''}`,
    ev.isOpen ? `Visszajelzési határidő: ${formatIsoHu(ev.deadlineAt)}` : null,
    ev.notes ? `\n${ev.notes}` : null,
    `\nVisszajelzés és részletek az appban: ${link}`,
  ].filter(Boolean).join('\n');
  lines.push(`DESCRIPTION:${escapeText(description)}`, `URL:${link}`);
  lines.push(`STATUS:${cancelled ? 'CANCELLED' : status === 'maybe' || status === 'none' ? 'TENTATIVE' : 'CONFIRMED'}`);
  // Ha nem vesz részt, ne foglalja a naptárát.
  lines.push(`TRANSP:${status === 'no' || cancelled ? 'TRANSPARENT' : 'OPAQUE'}`);
  const modified = [ev.updatedAt, response?.updated_at].filter(Boolean).sort().pop();
  if (modified) lines.push(`LAST-MODIFIED:${utcStamp(modified)}`);
  lines.push('END:VEVENT');
  return lines;
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
  return { eventCount: memberCalendarRows(memberId, now).length, hasChoir: choirs > 0 };
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
