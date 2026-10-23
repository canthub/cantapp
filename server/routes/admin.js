import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db.js';
import {
  listEvents, getEvent, getEventRow, createEvent, updateEvent, deleteEvent, setEventStatus, eventStats,
  eligibleMembers, responsesByMember, listMembers, getMember, saveMember, setMemberActive,
  reportRecipients, setSetting, ValidationError, suggestDressRehearsal, normalizeEventInput, getInvitees,
} from '../models.js';
import { setResponse, withdrawInvitations } from '../services/rsvp.js';
import { notifyMembers, logReminder } from '../services/notify.js';
import { reminderMessage, generalReminderMessage, changeMessage, cancelMessage } from '../services/messages.js';
import { sendAnnouncements } from '../services/scheduler.js';
import { buildReport, reportXlsx, reportCsv, reportPrintPage, emailReport, fileBase } from '../services/report.js';
import { importMembers, importEventsTable, importIcs, fetchIcs } from '../services/importers.js';
import { sendMail, emailLayout } from '../services/mailer.js';
import { sendPushToMember } from '../services/push.js';
import { memberDistances, kickGeocoding } from '../services/geo.js';

export const adminRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const eventId = (req) => {
  const id = Number(req.params.id);
  if (!getEventRow(id)) throw Object.assign(new Error('Az esemény nem található.'), { status: 404 });
  return id;
};

// ---------------------------------------------------------------- Események

adminRouter.get('/events', (_req, res) => {
  const events = listEvents().map((e) => ({ ...e, stats: eventStats(e.id) }));
  res.json({ events });
});

adminRouter.post('/events/suggest-dress-rehearsal', (req, res) => {
  try {
    const e = normalizeEventInput({ ...req.body, type: 'koncert' });
    res.json({ id: suggestDressRehearsal(e, req.body.id ? Number(req.body.id) : null) });
  } catch {
    res.json({ id: null });
  }
});

adminRouter.post('/events', async (req, res) => {
  const id = createEvent(req.body);
  if (req.body.publish) {
    setEventStatus(id, 'published');
    await sendAnnouncements(id);
  }
  res.status(201).json({ event: getEvent(id) });
});

adminRouter.get('/events/:id', (req, res) => {
  const id = eventId(req);
  const report = buildReport(id);
  const lastReminders = new Map(getDb()
    .prepare('SELECT member_id, MAX(sent_at) AS last, COUNT(*) AS n FROM reminder_log WHERE event_id = ? GROUP BY member_id')
    .all(id).map((r) => [r.member_id, { last: r.last, count: r.n }]));
  const rows = report.rows.map((r) => ({ ...r, reminders: lastReminders.get(r.memberId) || null }));
  const concerts = getDb().prepare(`SELECT id, name, date FROM events WHERE dress_rehearsal_id = ?`).all(id);
  const invitees = report.event.inviteMode === 'selected' ? getInvitees(id) : null;
  res.json({ event: { ...report.event, invitees }, summary: report.summary, byVoice: report.byVoice, rows, concerts, recipients: reportRecipients() });
});

adminRouter.put('/events/:id', async (req, res) => {
  const id = eventId(req);
  const { importantChange, removed, added } = updateEvent(id, req.body);
  const ev = getEvent(id);
  let notified = 0;
  // Akit kivettek a meghívottak közül: üzenetet kap, a válasza törlődik.
  const uninvited = await withdrawInvitations(id, removed);
  // Az újonnan meghívottak a szokásos „Új esemény” értesítést kapják, nekik nem kell külön változásjelzés.
  const announced = ev.status === 'published' ? await sendAnnouncements(id) : 0;
  if (importantChange && req.body.notifyChange && ev.status === 'published') {
    const targets = eligibleMembers(id).map((m) => m.id).filter((m) => !added.includes(m));
    notified = await notifyMembers(targets, { ...changeMessage(ev), eventId: id });
  }
  res.json({ event: ev, importantChange, notified, uninvited, announced });
});

adminRouter.delete('/events/:id', (req, res) => {
  deleteEvent(eventId(req));
  res.json({ ok: true });
});

adminRouter.post('/events/:id/publish', async (req, res) => {
  const id = eventId(req);
  setEventStatus(id, 'published');
  const announced = await sendAnnouncements(id);
  res.json({ event: getEvent(id), announced });
});

adminRouter.post('/events/publish-bulk', async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter((id) => getEventRow(id)?.status === 'draft');
  let announced = 0;
  for (const id of ids) {
    setEventStatus(id, 'published');
    announced += await sendAnnouncements(id);
  }
  res.json({ published: ids.length, announced });
});

adminRouter.post('/events/:id/unpublish', (req, res) => {
  const id = eventId(req);
  setEventStatus(id, 'draft');
  res.json({ event: getEvent(id) });
});

// Lemondás: a már közzétett esemény tagjai értesítést kapnak róla.
async function cancelEvent(id) {
  const wasPublished = getEventRow(id).status === 'published';
  setEventStatus(id, 'cancelled');
  const ev = getEvent(id);
  const notified = wasPublished ? await notifyMembers(eligibleMembers(id).map((m) => m.id), { ...cancelMessage(ev), eventId: id }) : 0;
  return { event: ev, notified };
}

adminRouter.post('/events/:id/cancel', async (req, res) => {
  res.json(await cancelEvent(eventId(req)));
});

// Kézi emlékeztető: alapból csak a még vissza nem jelzőknek, kérésre mindenkinek.
adminRouter.post('/events/:id/remind', async (req, res) => {
  const id = eventId(req);
  const ev = getEvent(id);
  if (ev.status !== 'published') throw new ValidationError('Csak közzétett eseményhez lehet emlékeztetőt küldeni.');
  const responses = responsesByMember(id);
  const targets = eligibleMembers(id).filter((m) => req.body?.target === 'all' || !responses.has(m.id)).map((m) => m.id);
  const msg = req.body?.target === 'all' ? generalReminderMessage(ev) : reminderMessage(ev, 'manual');
  if (req.body?.message) msg.body = String(req.body.message).slice(0, 2000);
  logReminder(id, targets, 'manual');
  const sent = await notifyMembers(targets, { ...msg, eventId: id });
  res.json({ sent });
});

adminRouter.put('/events/:id/responses/:memberId', async (req, res) => {
  const id = eventId(req);
  const status = req.body?.status || null;
  const result = await setResponse(id, Number(req.params.memberId), status, { byAdmin: true });
  res.json(result);
});

// ---------------------------------------------------------------- Riport / export

adminRouter.get('/events/:id/export.xlsx', async (req, res) => {
  const report = buildReport(eventId(req));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase(report.event)}.xlsx"`);
  res.send(await reportXlsx(report));
});

adminRouter.get('/events/:id/export.csv', (req, res) => {
  const report = buildReport(eventId(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase(report.event)}.csv"`);
  res.send(reportCsv(report));
});

adminRouter.get('/events/:id/print', (req, res) => {
  res.type('html').send(reportPrintPage(buildReport(eventId(req))));
});

adminRouter.post('/events/:id/send-report', async (req, res) => {
  const id = eventId(req);
  const recipients = (req.body?.recipients?.length ? req.body.recipients : reportRecipients()).map((s) => String(s).trim()).filter(Boolean);
  const bad = recipients.find((r) => !EMAIL_RE.test(r));
  if (bad) throw new ValidationError(`Érvénytelen e-mail-cím: ${bad}`);
  res.json(await emailReport(id, recipients));
});

// ---------------------------------------------------------------- Távolságok

// A tagok lakóhelyének távolsága az esemény helyszínétől – a meghívottak kijelöléséhez.
adminRouter.post('/geo/distances', async (req, res) => {
  const { address, city, country } = req.body || {};
  const result = await memberDistances({ address, city, country });
  const withoutLocation = getDb().prepare(`SELECT COUNT(*) AS n FROM members WHERE active = 1 AND home_lat IS NULL`).get().n;
  res.json({ ...result, withoutLocation });
});

// ---------------------------------------------------------------- Tagok

adminRouter.get('/members', (_req, res) => {
  res.json({ members: listMembers() });
});

adminRouter.post('/members', (req, res) => {
  if (listMembers().some((m) => m.email === String(req.body?.email || '').trim().toLowerCase())) {
    throw new ValidationError('Ezzel az e-mail-címmel már van tag.');
  }
  const { id } = saveMember(req.body);
  kickGeocoding();
  res.status(201).json({ member: getMember(id) });
});

adminRouter.put('/members/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.member.id && !req.body.isAdmin) throw new ValidationError('A saját admin jogosultságodat nem veheted el.');
  saveMember(req.body, id);
  kickGeocoding();
  res.json({ member: getMember(id) });
});

adminRouter.post('/members/:id/active', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.member.id) throw new ValidationError('Saját magadat nem inaktiválhatod.');
  setMemberActive(id, Boolean(req.body?.active));
  res.json({ member: getMember(id) });
});

// ---------------------------------------------------------------- Import

const requireFile = (req) => {
  if (!req.file) throw new ValidationError('Nem érkezett fájl.');
  return req.file;
};

adminRouter.post('/import/members', upload.single('file'), async (req, res) => {
  const file = requireFile(req);
  const result = await importMembers(file.buffer, file.originalname, { deactivateMissing: req.body.deactivateMissing === 'true' });
  kickGeocoding();
  res.json(result);
});

adminRouter.post('/import/events', upload.single('file'), async (req, res) => {
  const file = requireFile(req);
  const defaultChoirs = String(req.body.choirs || '').split(',').filter(Boolean);
  res.json(await importEventsTable(file.buffer, file.originalname, {
    defaultChoirs,
    deadlineDaysBefore: Number(req.body.deadlineDaysBefore || 7),
  }));
});

adminRouter.post('/import/ics', upload.single('file'), async (req, res) => {
  const text = req.file ? req.file.buffer.toString('utf8') : await fetchIcs(String(req.body.url || ''));
  res.json(await importIcs(text, {
    url: req.file ? null : String(req.body.url || ''),
    choirs: String(req.body.choirs || '').split(',').filter(Boolean),
    from: req.body.from || null,
    to: req.body.to || null,
    deadlineDaysBefore: Number(req.body.deadlineDaysBefore || 7),
    defaultType: req.body.defaultType || 'proba',
  }));
});

// A naptárból törölt események kezelése: a kijelöltek lemondása (piszkozat esetén törlése),
// a többi megtartása – ezeket leválasztjuk a naptárról, így a következő import már nem jelzi őket.
adminRouter.post('/import/ics/resolve', async (req, res) => {
  const fromCalendar = (id) => getEventRow(Number(id))?.external_uid?.startsWith('ics:');
  const result = { cancelled: 0, deleted: 0, kept: 0, notified: 0 };
  for (const id of (req.body?.cancel || []).filter(fromCalendar).map(Number)) {
    const row = getEventRow(id);
    if (row.status === 'draft') {
      deleteEvent(id);
      result.deleted++;
    } else if (row.status === 'published') {
      result.notified += (await cancelEvent(id)).notified;
      result.cancelled++;
    }
  }
  for (const id of (req.body?.keep || []).filter(fromCalendar).map(Number)) {
    getDb().prepare('UPDATE events SET external_uid = NULL, external_data = NULL, external_source = NULL WHERE id = ?').run(id);
    result.kept++;
  }
  res.json(result);
});

const TEMPLATES = {
  'tagok-xlsx': 'tagok_import_sablon.xlsx',
  'tagok-csv': 'tagok_import_sablon.csv',
  'esemenyek-xlsx': 'esemenyek_import_sablon.xlsx',
  'esemenyek-csv': 'esemenyek_import_sablon.csv',
};

adminRouter.get('/templates/:name', (req, res) => {
  const file = TEMPLATES[req.params.name];
  if (!file) return res.status(404).json({ error: 'Nincs ilyen sablon.' });
  res.download(path.join(TEMPLATES_DIR, file), file);
});

// ---------------------------------------------------------------- Beállítások

adminRouter.get('/settings', (_req, res) => {
  res.json({ reportRecipients: reportRecipients() });
});

adminRouter.put('/settings', (req, res) => {
  const recipients = (req.body?.reportRecipients || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const bad = recipients.find((r) => !EMAIL_RE.test(r));
  if (bad) throw new ValidationError(`Érvénytelen e-mail-cím: ${bad}`);
  if (recipients.length === 0) throw new ValidationError('Legalább egy címzett szükséges.');
  setSetting('reportRecipients', recipients);
  res.json({ reportRecipients: recipients });
});

adminRouter.post('/test/email', async (req, res) => {
  const result = await sendMail({
    to: req.member.email,
    subject: 'Teszt e-mail – Cantemus Kórus app',
    text: 'Ha ezt olvasod, az e-mail-küldés működik.',
    html: emailLayout({ heading: 'Teszt e-mail', bodyHtml: '<p>Ha ezt olvasod, az e-mail-küldés működik. 🎶</p>' }),
  });
  res.json(result);
});

adminRouter.post('/test/push', async (req, res) => {
  const sent = await sendPushToMember(req.member.id, { title: 'Teszt értesítés', body: 'A push értesítések működnek! 🎶', url: '/' });
  res.json({ sent });
});
