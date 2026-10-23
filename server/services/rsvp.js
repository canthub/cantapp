import { getDb, nowIso } from '../db.js';
import {
  ValidationError, getEventRow, getEvent, getMember, isEligible, getResponse, isEventOpen,
} from '../models.js';
import { RESPONSES, article } from '../../shared/constants.js';
import { notifyMembers } from './notify.js';
import { thanksMessage, concertResponseRemovedMessage, uninvitedMessage } from './messages.js';

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
    if (!isEligible(eventId, memberId)) {
      const memberChoirs = getMember(memberId)?.choirs || [];
      const ownChoir = getEvent(eventId, now).choirs.some((c) => memberChoirs.includes(c));
      throw Object.assign(new Error(ownChoir ? 'Erre az eseményre most nem vagy meghívva.' : 'Ez az esemény nem a te énekkarodé.'), { status: 403 });
    }
    if (ev.status === 'cancelled') throw new ValidationError('Ez az esemény elmarad.');
    if (!isEventOpen(ev, now)) throw new ValidationError('A visszajelzési határidő lejárt, az esemény már nem jelölhető.');
    if (ev.type === 'koncert' && ev.dress_rehearsal_id) {
      const dr = getEventRow(ev.dress_rehearsal_id);
      // A szabály csak azokra vonatkozik, akik a főpróbára is meg vannak hívva.
      if (dr && isEligible(dr.id, memberId) && !concertRuleAllows(status, getResponse(dr.id, memberId)?.status)) {
        throw new ValidationError(concertRuleMessage(dr));
      }
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

  const removedConcerts = ev.type === 'foproba' ? await revalidateConcerts(event, memberId, status, now) : [];
  return { first: !previous, removedConcerts, response: getResponse(eventId, memberId) };
}

// Ha főpróbára változott (vagy törlődött) a válasz, a hozzá tartozó (még nyitott) koncertek
// érvénytelenné vált válaszait töröljük, és erről a tag üzenetet kap.
async function revalidateConcerts(dressRehearsal, memberId, status, now) {
  const db = getDb();
  const removed = [];
  const concerts = db.prepare(`SELECT * FROM events WHERE dress_rehearsal_id = ? AND type = 'koncert'`).all(dressRehearsal.id);
  for (const c of concerts) {
    const cr = getResponse(c.id, memberId);
    if (!cr || !isEventOpen(c, now) || concertRuleAllows(cr.status, status)) continue;
    db.prepare('DELETE FROM responses WHERE event_id = ? AND member_id = ?').run(c.id, memberId);
    removed.push(c.id);
    await notifyMembers([memberId], { ...concertResponseRemovedMessage(getEvent(c.id, now), dressRehearsal), eventId: c.id, now });
  }
  return removed;
}

// A meghívottak közül kivett tagok: a válaszuk és az emlékeztető-előzményük törlődik
// (ha később újra meghívják őket, ismét megkapják az értesítést), és megkapják az üzenetet.
// A koncertválaszaik maradnak: a főpróba-szabály csak a főpróbára meghívottakra vonatkozik.
export async function withdrawInvitations(eventId, memberIds, now = new Date()) {
  if (memberIds.length === 0) return 0;
  const db = getDb();
  const event = getEvent(eventId, now);
  for (const memberId of memberIds) {
    db.prepare('DELETE FROM responses WHERE event_id = ? AND member_id = ?').run(eventId, memberId);
    db.prepare('DELETE FROM reminder_log WHERE event_id = ? AND member_id = ?').run(eventId, memberId);
  }
  if (event.status !== 'published') return 0;
  return notifyMembers(memberIds, { ...uninvitedMessage(event), eventId, now });
}
