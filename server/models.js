import { getDb, tx, nowIso } from './db.js';
import { CHOIRS, EVENT_TYPES, mapsUrl } from '../shared/constants.js';
import {
  isDate, isTime, localToUtcIso, deadlineToUtcIso, localDateOf, localTimeOf, defaultDeadlineDate,
} from './services/time.js';
import { config } from './config.js';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const str = (v) => (v == null ? '' : String(v).trim());

// ---------------------------------------------------------------- Tagok

function choirsOfMember(id) {
  return getDb().prepare('SELECT choir FROM member_choirs WHERE member_id = ? ORDER BY choir').all(id).map((r) => r.choir);
}

export function serializeMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    lastName: row.last_name,
    firstName: row.first_name,
    name: fullName(row),
    email: row.email,
    phone: row.phone,
    voicePart: row.voice_part,
    isAdmin: Boolean(row.is_admin),
    active: Boolean(row.active),
    choirs: choirsOfMember(row.id),
  };
}

export function fullName(row) {
  return [row.last_name, row.first_name].filter(Boolean).join(' ') || row.email;
}

export function getMember(id) {
  return serializeMember(getDb().prepare('SELECT * FROM members WHERE id = ?').get(id));
}

export function getMemberByEmail(email) {
  return serializeMember(getDb().prepare('SELECT * FROM members WHERE email = ?').get(str(email).toLowerCase()));
}

export function listMembers({ includeInactive = true } = {}) {
  const rows = getDb()
    .prepare(`SELECT * FROM members ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY last_name, first_name`)
    .all();
  return rows.map(serializeMember);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeMemberInput(input) {
  const m = {
    lastName: str(input.lastName),
    firstName: str(input.firstName),
    email: str(input.email).toLowerCase(),
    phone: str(input.phone),
    voicePart: str(input.voicePart),
    isAdmin: Boolean(input.isAdmin),
    active: input.active === undefined ? true : Boolean(input.active),
    choirs: [...new Set((input.choirs || []).filter((c) => c in CHOIRS))],
  };
  if (!EMAIL_RE.test(m.email)) throw new ValidationError(`Érvénytelen e-mail-cím: „${m.email}”`);
  if (!m.lastName && !m.firstName) throw new ValidationError('A név megadása kötelező.');
  if (m.choirs.length === 0 && !m.isAdmin) throw new ValidationError('Legalább egy énekkart meg kell adni.');
  return m;
}

// Létrehoz vagy (e-mail alapján) frissít egy tagot. Visszaadja: { id, created }.
export function saveMember(input, id = null) {
  const m = normalizeMemberInput(input);
  const db = getDb();
  return tx(() => {
    const existing = id
      ? db.prepare('SELECT id FROM members WHERE id = ?').get(id)
      : db.prepare('SELECT id FROM members WHERE email = ?').get(m.email);
    if (id && !existing) throw Object.assign(new Error('A tag nem található.'), { status: 404 });
    const clash = db.prepare('SELECT id FROM members WHERE email = ? AND id != ?').get(m.email, existing?.id ?? -1);
    if (clash) throw new ValidationError(`Ez az e-mail-cím már egy másik taghoz tartozik: ${m.email}`);
    let memberId;
    if (existing) {
      memberId = existing.id;
      db.prepare(`UPDATE members SET last_name=?, first_name=?, email=?, phone=?, voice_part=?, is_admin=?, active=?, updated_at=? WHERE id=?`)
        .run(m.lastName, m.firstName, m.email, m.phone, m.voicePart, m.isAdmin ? 1 : 0, m.active ? 1 : 0, nowIso(), memberId);
    } else {
      memberId = Number(db.prepare(`INSERT INTO members (last_name, first_name, email, phone, voice_part, is_admin, active) VALUES (?,?,?,?,?,?,?)`)
        .run(m.lastName, m.firstName, m.email, m.phone, m.voicePart, m.isAdmin ? 1 : 0, m.active ? 1 : 0).lastInsertRowid);
    }
    db.prepare('DELETE FROM member_choirs WHERE member_id = ?').run(memberId);
    for (const c of m.choirs) db.prepare('INSERT INTO member_choirs (member_id, choir) VALUES (?, ?)').run(memberId, c);
    return { id: memberId, created: !existing };
  });
}

export function setMemberActive(id, active) {
  getDb().prepare('UPDATE members SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowIso(), id);
  if (!active) getDb().prepare('DELETE FROM sessions WHERE member_id = ?').run(id);
}

// Az ADMIN_EMAILS-ben felsorolt címek mindig adminok (és létrejönnek, ha még nincsenek).
export function ensureAdmins(emails) {
  for (const email of emails) {
    const existing = getDb().prepare('SELECT id FROM members WHERE email = ?').get(email);
    if (existing) {
      getDb().prepare('UPDATE members SET is_admin = 1, active = 1 WHERE id = ?').run(existing.id);
    } else {
      getDb().prepare(`INSERT INTO members (last_name, first_name, email, is_admin) VALUES ('Admin', '', ?, 1)`).run(email);
    }
  }
}

// ---------------------------------------------------------------- Események

function choirsOfEvent(id) {
  return getDb().prepare('SELECT choir FROM event_choirs WHERE event_id = ? ORDER BY choir').all(id).map((r) => r.choir);
}

export function isEventOpen(row, now = new Date()) {
  return row.status === 'published' && new Date(row.deadline_at) > new Date(now);
}

export function serializeEvent(row, now = new Date()) {
  if (!row) return null;
  const ev = {
    id: row.id,
    name: row.name,
    type: row.type,
    typeLabel: EVENT_TYPES[row.type] || row.type,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    startsAt: row.starts_at,
    country: row.country,
    city: row.city,
    address: row.address,
    venue: row.venue,
    isTour: Boolean(row.is_tour),
    deadlineAt: row.deadline_at,
    deadlineDate: localDateOf(row.deadline_at),
    deadlineTime: localTimeOf(row.deadline_at),
    dressRehearsalId: row.dress_rehearsal_id,
    notes: row.notes,
    status: row.status,
    publishedAt: row.published_at,
    closedAt: row.closed_at,
    reportSentAt: row.report_sent_at,
    source: row.source,
    choirs: choirsOfEvent(row.id),
    isOpen: isEventOpen(row, now),
  };
  ev.mapsUrl = mapsUrl(ev);
  return ev;
}

export function getEventRow(id) {
  return getDb().prepare('SELECT * FROM events WHERE id = ?').get(id);
}

export function getEvent(id, now) {
  return serializeEvent(getEventRow(id), now);
}

export function listEvents({ statuses = null, choirs = null } = {}, now) {
  const db = getDb();
  let rows = db.prepare('SELECT * FROM events ORDER BY starts_at, id').all();
  if (statuses) rows = rows.filter((r) => statuses.includes(r.status));
  let events = rows.map((r) => serializeEvent(r, now));
  if (choirs) events = events.filter((e) => e.choirs.some((c) => choirs.includes(c)));
  return events;
}

export function normalizeEventInput(input) {
  const e = {
    name: str(input.name),
    type: str(input.type),
    date: str(input.date),
    startTime: str(input.startTime),
    endTime: str(input.endTime),
    country: str(input.country),
    city: str(input.city),
    address: str(input.address),
    venue: str(input.venue),
    isTour: Boolean(input.isTour),
    deadlineDate: str(input.deadlineDate),
    deadlineTime: str(input.deadlineTime) || '23:59',
    dressRehearsalId: input.dressRehearsalId ? Number(input.dressRehearsalId) : null,
    notes: str(input.notes),
    choirs: [...new Set((input.choirs || []).filter((c) => c in CHOIRS))],
  };
  if (!e.name) throw new ValidationError('Az esemény nevének megadása kötelező.');
  if (!(e.type in EVENT_TYPES)) throw new ValidationError('Érvénytelen eseménytípus.');
  if (!isDate(e.date)) throw new ValidationError(`Érvénytelen dátum: „${e.date}” (formátum: ÉÉÉÉ-HH-NN).`);
  if (e.startTime && !isTime(e.startTime)) throw new ValidationError(`Érvénytelen kezdési időpont: „${e.startTime}” (formátum: ÓÓ:PP).`);
  if (e.endTime && !isTime(e.endTime)) throw new ValidationError(`Érvénytelen befejezési időpont: „${e.endTime}”.`);
  if (e.choirs.length === 0) throw new ValidationError('Legalább egy énekkart ki kell választani.');
  if (!e.deadlineDate) e.deadlineDate = defaultDeadlineDate(e.date, config.defaultDeadlineDays);
  if (!isDate(e.deadlineDate)) throw new ValidationError(`Érvénytelen visszajelzési határidő: „${e.deadlineDate}”.`);
  if (!isTime(e.deadlineTime)) throw new ValidationError('Érvénytelen határidő-időpont.');
  if (e.type !== 'koncert') e.dressRehearsalId = null;
  return e;
}

function eventColumns(e) {
  return {
    name: e.name,
    type: e.type,
    date: e.date,
    start_time: e.startTime,
    end_time: e.endTime,
    starts_at: localToUtcIso(e.date, e.startTime || '00:00'),
    country: e.country,
    city: e.city,
    address: e.address,
    venue: e.venue,
    is_tour: e.isTour ? 1 : 0,
    deadline_at: deadlineToUtcIso(e.deadlineDate, e.deadlineTime),
    dress_rehearsal_id: e.dressRehearsalId,
    notes: e.notes,
  };
}

function checkDressRehearsal(e, selfId = null) {
  if (!e.dressRehearsalId) return;
  const dr = getEventRow(e.dressRehearsalId);
  if (!dr || dr.type !== 'foproba' || dr.id === selfId) throw new ValidationError('A kiválasztott főpróba nem található.');
}

// Koncerthez automatikusan a legközelebbi, legfeljebb 14 nappal korábbi, közös kórusú főpróbát ajánlja.
export function suggestDressRehearsal(e, selfId = null) {
  const startsAt = localToUtcIso(e.date, e.startTime || '23:59');
  const from = new Date(new Date(startsAt).getTime() - 14 * 86400000).toISOString();
  const rows = getDb()
    .prepare(`SELECT * FROM events WHERE type = 'foproba' AND status != 'cancelled' AND starts_at <= ? AND starts_at >= ? AND id != ? ORDER BY starts_at DESC, id DESC`)
    .all(startsAt, from, selfId ?? -1);
  const match = rows.find((r) => choirsOfEvent(r.id).some((c) => e.choirs.includes(c)));
  return match ? match.id : null;
}

const sameName = (a, b) => String(a || '').toLowerCase().replace(/\s+/g, ' ').trim() === String(b || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Ugyanaz az esemény, ha a neve (kis-/nagybetűtől és szóközöktől eltekintve), napja és kezdési ideje egyezik,
// és van közös kórusa. Importnál ez véd a duplikálás ellen.
export function findDuplicateEvent({ name, date, startTime, choirs }) {
  const rows = getDb().prepare('SELECT * FROM events WHERE date = ? AND start_time = ? ORDER BY id').all(date, startTime || '');
  return rows.find((r) => sameName(r.name, name) && choirsOfEvent(r.id).some((c) => choirs.includes(c))) || null;
}

export function createEvent(input, { source = 'manual', externalUid = null, externalData = null, externalSource = null, autoLinkDressRehearsal = true } = {}) {
  const e = normalizeEventInput(input);
  if (e.type === 'koncert' && !e.dressRehearsalId && autoLinkDressRehearsal) e.dressRehearsalId = suggestDressRehearsal(e);
  checkDressRehearsal(e);
  const cols = eventColumns(e);
  const db = getDb();
  return tx(() => {
    const keys = Object.keys(cols);
    const id = Number(db.prepare(`INSERT INTO events (${keys.join(',')}, source, external_uid, external_data, external_source) VALUES (${keys.map(() => '?').join(',')}, ?, ?, ?, ?)`)
      .run(...Object.values(cols), source, externalUid, externalData ? JSON.stringify(externalData) : null, externalSource).lastInsertRowid);
    for (const c of e.choirs) db.prepare('INSERT INTO event_choirs (event_id, choir) VALUES (?, ?)').run(id, c);
    return id;
  });
}

// Visszaadja, hogy változott-e lényeges adat (dátum, idő, helyszín) – erről értesítést lehet küldeni.
export function updateEvent(id, input, now = new Date()) {
  const before = getEventRow(id);
  if (!before) throw Object.assign(new Error('Az esemény nem található.'), { status: 404 });
  const e = normalizeEventInput(input);
  checkDressRehearsal(e, id);
  const cols = eventColumns(e);
  const db = getDb();
  tx(() => {
    const keys = Object.keys(cols);
    db.prepare(`UPDATE events SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...Object.values(cols), nowIso(now), id);
    db.prepare('DELETE FROM event_choirs WHERE event_id = ?').run(id);
    for (const c of e.choirs) db.prepare('INSERT INTO event_choirs (event_id, choir) VALUES (?, ?)').run(id, c);
    // Ha a határidőt kitolták, az esemény újra nyitottá válik.
    if (before.closed_at && new Date(cols.deadline_at) > new Date(now)) {
      db.prepare('UPDATE events SET closed_at = NULL, report_sent_at = NULL WHERE id = ?').run(id);
    }
  });
  const keyFields = ['date', 'start_time', 'end_time', 'country', 'city', 'address', 'venue'];
  return { importantChange: keyFields.some((k) => before[k] !== cols[k]) };
}

export function deleteEvent(id) {
  getDb().prepare('DELETE FROM events WHERE id = ?').run(id);
}

export function setEventStatus(id, status, now = new Date()) {
  const db = getDb();
  if (status === 'published') {
    db.prepare(`UPDATE events SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`).run(nowIso(now), nowIso(now), id);
  } else {
    db.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(now), id);
  }
}

// Az eseményre jogosult (aktív, érintett kórusba tartozó) tagok.
export function eligibleMembers(eventId) {
  return getDb()
    .prepare(`SELECT DISTINCT m.* FROM members m
      JOIN member_choirs mc ON mc.member_id = m.id
      JOIN event_choirs ec ON ec.choir = mc.choir
      WHERE ec.event_id = ? AND m.active = 1
      ORDER BY m.last_name, m.first_name`)
    .all(eventId);
}

export function isEligible(eventId, memberId) {
  return Boolean(getDb()
    .prepare(`SELECT 1 FROM member_choirs mc JOIN event_choirs ec ON ec.choir = mc.choir
      JOIN members m ON m.id = mc.member_id
      WHERE ec.event_id = ? AND mc.member_id = ? AND m.active = 1`)
    .get(eventId, memberId));
}

export function getResponse(eventId, memberId) {
  return getDb().prepare('SELECT * FROM responses WHERE event_id = ? AND member_id = ?').get(eventId, memberId) || null;
}

export function responsesByMember(eventId) {
  const map = new Map();
  for (const r of getDb().prepare('SELECT * FROM responses WHERE event_id = ?').all(eventId)) map.set(r.member_id, r);
  return map;
}

export function eventStats(eventId) {
  const members = eligibleMembers(eventId);
  const responses = responsesByMember(eventId);
  const stats = { total: members.length, yes: 0, no: 0, maybe: 0, none: 0 };
  for (const m of members) {
    const r = responses.get(m.id);
    stats[r ? r.status : 'none']++;
  }
  return stats;
}

// ---------------------------------------------------------------- Beállítások

export function getSetting(key, fallback) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function reportRecipients() {
  return getSetting('reportRecipients', config.reportRecipients);
}
