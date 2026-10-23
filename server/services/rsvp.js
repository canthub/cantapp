import { getDb, nowIso } from '../db.js';
import {
  ValidationError, getEventRow, getEvent, isEligible, getResponse, isEventOpen,
} from '../models.js';
import { RESPONSES, article } from '../../shared/constants.js';
import { notifyMembers } from './notify.js';
import { thanksMessage, concertResponseRemovedMessage } from './messages.js';

// Koncertre „részt veszek” csak főpróba-„igen” mellett, „talán” főpróba-„igen”/„talán” mellett adható.
// „Nem tudok részt venni” mindig adható.
export function concertRuleAllows(concertStatus, dressRehearsalStatus) {
  if (concertStatus === 'no') return true;
  if (concertStatus === 'yes') return dressRehearsalStatus === 'yes';
  if (concertStatus === 'maybe') return dressRehearsalStatus === 'yes' || dressRehearsalStatus === 'maybe';
  return false;
}

export function concertRuleMessage(dr) {
  return `Erre a koncertre csak akkor jelezhetsz részvételt, ha ${article(dr.name)} „${dr.name}” főpróbára is jelezted, hogy részt veszel. Előbb a főpróbára jelezz vissza!`;
}

// Tagi visszajelzés (vagy admin rögzítése). Az admin a határidő után is módosíthat, és a főpróba-szabály rá nem vonatkozik.
export async function setResponse(eventId, memberId, status, { byAdmin = false, now = new Date() } = {}) {
  const ev = getEventRow(eventId);
  if (!ev) throw Object.assign(new Error('Az esemény nem található.'), { status: 404 });
  if (status !== null && !(status in RESPONSES)) throw new ValidationError('Érvénytelen visszajelzés.');

  if (!byAdmin) {
    if (!isEligible(eventId, memberId)) throw Object.assign(new Error('Ez az esemény nem a te énekkarodé.'), { status: 403 });
    if (ev.status === 'cancelled') throw new ValidationError('Ez az esemény elmarad.');
    if (!isEventOpen(ev, now)) throw new ValidationError('A visszajelzési határidő lejárt, az esemény már nem jelölhető.');
    if (ev.type === 'koncert' && ev.dress_rehearsal_id) {
      const dr = getEventRow(ev.dress_rehearsal_id);
      if (dr && !concertRuleAllows(status, getResponse(dr.id, memberId)?.status)) throw new ValidationError(concertRuleMessage(dr));
    }
  }

  const db = getDb();
  const previous = getResponse(eventId, memberId);
  if (status === null) {
    db.prepare('DELETE FROM responses WHERE event_id = ? AND member_id = ?').run(eventId, memberId);
  } else if (previous) {
    db.prepare('UPDATE responses SET status = ?, set_by_admin = ?, updated_at = ? WHERE event_id = ? AND member_id = ?')
      .run(status, byAdmin ? 1 : 0, nowIso(now), eventId, memberId);
  } else {
    db.prepare('INSERT INTO responses (event_id, member_id, status, set_by_admin, responded_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(eventId, memberId, status, byAdmin ? 1 : 0, nowIso(now), nowIso(now));
  }

  const event = getEvent(eventId, now);
  if (!byAdmin && !previous && status !== null) {
    await notifyMembers([memberId], { ...thanksMessage(event), eventId, now });
  }

  // Ha főpróbára változott a válasz, a hozzá tartozó (még nyitott) koncertek érvénytelenné vált válaszait töröljük.
  const removedConcerts = [];
  if (ev.type === 'foproba') {
    const concerts = db.prepare(`SELECT * FROM events WHERE dress_rehearsal_id = ? AND type = 'koncert'`).all(eventId);
    for (const c of concerts) {
      const cr = getResponse(c.id, memberId);
      if (!cr || !isEventOpen(c, now) || concertRuleAllows(cr.status, status)) continue;
      db.prepare('DELETE FROM responses WHERE event_id = ? AND member_id = ?').run(c.id, memberId);
      removedConcerts.push(c.id);
      await notifyMembers([memberId], { ...concertResponseRemovedMessage(getEvent(c.id, now), event), eventId: c.id, now });
    }
  }

  return { first: !previous, removedConcerts, response: getResponse(eventId, memberId) };
}
