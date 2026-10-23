import { getDb, nowIso } from '../db.js';
import { config } from '../config.js';
import { getEvent, eligibleMembers, responsesByMember } from '../models.js';
import { notifyMembers, logReminder } from './notify.js';
import { announceMessage, reminderMessage, missedEventMessage } from './messages.js';
import { emailReport } from './report.js';
import { kickGeocoding } from './geo.js';
import { toLocal, nowLocal, calendarDaysBetween } from './time.js';

const AUTO_KINDS = ['announce', 'weekly', 'daily'];

/**
 * Melyik automatikus értesítés esedékes egy tagnak (null = egyik sem).
 * - Ha még semmit nem kapott: azonnal „announce” (az esemény megjelenése).
 * - A határidő előtti utolsó 7 naptári napon naponta egyszer („daily”).
 * - Előtte az utolsó automatikus értesítéstől számított 7 naponként („weekly”).
 * Az emlékeztetők csak a beállított óra (alapból 9:00) után mennek ki.
 */
export function reminderDue({ now, deadlineAt, lastAutoAt, reminderHour = config.reminderHour }) {
  const nowIsoStr = new Date(now).toISOString();
  if (new Date(deadlineAt) <= new Date(now)) return null;
  if (!lastAutoAt) return 'announce';
  if (nowLocal(now).hour < reminderHour) return null;
  const daysToDeadline = calendarDaysBetween(nowIsoStr, deadlineAt);
  const daysSinceLast = calendarDaysBetween(lastAutoAt, nowIsoStr);
  if (daysToDeadline <= 7) return daysSinceLast >= 1 ? 'daily' : null;
  return daysSinceLast >= 7 ? 'weekly' : null;
}

function lastAutoReminders(eventId) {
  const rows = getDb()
    .prepare(`SELECT member_id, MAX(sent_at) AS last FROM reminder_log WHERE event_id = ? AND kind IN (${AUTO_KINDS.map(() => '?').join(',')}) GROUP BY member_id`)
    .all(eventId, ...AUTO_KINDS);
  return new Map(rows.map((r) => [r.member_id, r.last]));
}

// Az esemény megjelenésekor (és később csatlakozó tagoknak) kiküldi az értesítést.
export async function sendAnnouncements(eventId, now = new Date()) {
  const ev = getEvent(eventId, now);
  if (!ev || ev.status !== 'published' || !ev.isOpen) return 0;
  const last = lastAutoReminders(eventId);
  const targets = eligibleMembers(eventId).filter((m) => !last.has(m.id)).map((m) => m.id);
  if (targets.length === 0) return 0;
  logReminder(eventId, targets, 'announce', now);
  await notifyMembers(targets, { ...announceMessage(ev), eventId, now });
  return targets.length;
}

async function sendDueReminders(now) {
  const events = getDb().prepare(`SELECT id FROM events WHERE status = 'published' AND deadline_at > ?`).all(nowIso(now));
  let count = 0;
  for (const { id } of events) {
    count += await sendAnnouncements(id, now);
    const ev = getEvent(id, now);
    const last = lastAutoReminders(id);
    const responses = responsesByMember(id);
    const due = { weekly: [], daily: [] };
    for (const m of eligibleMembers(id)) {
      if (responses.has(m.id)) continue;
      const kind = reminderDue({ now, deadlineAt: ev.deadlineAt, lastAutoAt: last.get(m.id) });
      if (kind === 'weekly' || kind === 'daily') due[kind].push(m.id);
    }
    for (const kind of ['weekly', 'daily']) {
      if (due[kind].length === 0) continue;
      logReminder(id, due[kind], kind, now);
      await notifyMembers(due[kind], { ...reminderMessage(ev, kind), eventId: id, now });
      count += due[kind].length;
    }
  }
  return count;
}

// Határidő lejárta: az esemény inaktív lesz, a vissza nem jelzők üzenetet kapnak.
async function closeExpiredEvents(now) {
  const rows = getDb()
    .prepare(`SELECT * FROM events WHERE status = 'published' AND closed_at IS NULL AND deadline_at <= ?`)
    .all(nowIso(now));
  for (const row of rows) {
    getDb().prepare('UPDATE events SET closed_at = ? WHERE id = ?').run(nowIso(now), row.id);
    // Ha az eseményt már a határidő után tették közzé (pl. utólag rögzített múltbeli esemény), nem küldünk semmit.
    if (!row.published_at || row.published_at >= row.deadline_at) {
      getDb().prepare('UPDATE events SET report_sent_at = ? WHERE id = ?').run(nowIso(now), row.id);
      continue;
    }
    const ev = getEvent(row.id, now);
    const responses = responsesByMember(row.id);
    const missing = eligibleMembers(row.id).filter((m) => !responses.has(m.id)).map((m) => m.id);
    if (missing.length) {
      logReminder(row.id, missing, 'missed', now);
      await notifyMembers(missing, { ...missedEventMessage(ev), eventId: row.id, now });
    }
  }
  return rows.length;
}

// A határidő napját követő napon (alapból 8:00-tól) kimegy a végleges riport.
export function reportDueAt(deadlineAt, reportHour = config.reportHour) {
  return toLocal(deadlineAt).startOf('day').plus({ days: 1 }).set({ hour: reportHour }).toUTC().toISO();
}

async function sendDueReports(now) {
  const rows = getDb()
    .prepare(`SELECT * FROM events WHERE status = 'published' AND closed_at IS NOT NULL AND report_sent_at IS NULL`)
    .all();
  let sent = 0;
  for (const row of rows) {
    if (new Date(reportDueAt(row.deadline_at)) > new Date(now)) continue;
    try {
      await emailReport(row.id, undefined, now, { final: true });
      getDb().prepare('UPDATE events SET report_sent_at = ? WHERE id = ?').run(nowIso(now), row.id);
      sent++;
    } catch (err) {
      console.error(`Riport küldési hiba (esemény #${row.id}):`, err.message);
    }
  }
  return sent;
}

let running = false;

export async function runScheduler(now = new Date()) {
  if (running) return null;
  running = true;
  try {
    const closed = await closeExpiredEvents(now);
    const reports = await sendDueReports(now);
    const reminders = await sendDueReminders(now);
    return { closed, reports, reminders };
  } finally {
    running = false;
  }
}

export function startScheduler() {
  const tick = () => {
    runScheduler().catch((err) => console.error('Ütemező hiba:', err));
    // A még nem megtalált lakóhelyeket (pl. hálózati hiba után) újra próbáljuk.
    kickGeocoding();
  };
  setTimeout(tick, 5000);
  return setInterval(tick, config.schedulerIntervalMs);
}
