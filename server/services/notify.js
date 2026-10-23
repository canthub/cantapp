import { getDb, nowIso } from '../db.js';
import { sendMail, emailLayout, esc } from './mailer.js';
import { sendPushToMember } from './push.js';

// Egy üzenet kiküldése tagoknak: alkalmazáson belüli értesítés + push + (opcionálisan) e-mail.
// Egy tag kézbesítési hibája nem állítja le a többiekét.
export async function notifyMembers(memberIds, { kind, eventId = null, title, body, url = '/', email = true, greeting: withGreeting = true, emailHtml = null, now = new Date() }) {
  const db = getDb();
  const insert = db.prepare('INSERT INTO notifications (member_id, event_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const getMember = db.prepare('SELECT * FROM members WHERE id = ?');
  let delivered = 0;
  for (const memberId of memberIds) {
    const member = getMember.get(memberId);
    if (!member) continue;
    insert.run(memberId, eventId, kind, title, body, nowIso(now));
    delivered++;
    try {
      await sendPushToMember(memberId, { title, body, url, tag: eventId ? `event-${eventId}` : kind });
    } catch (err) {
      console.error('Push hiba:', err.message);
    }
    if (email) {
      const greeting = !withGreeting ? '' : member.first_name ? `Kedves ${member.first_name}!` : 'Kedves Kórustag!';
      try {
        await sendMail({
          to: member.email,
          subject: title,
          text: `${greeting ? `${greeting}\n\n` : ''}${body}\n\n${absoluteUrl(url)}`,
          html: emailLayout({
            heading: title,
            bodyHtml: `${greeting ? `<p style="margin:0 0 12px">${esc(greeting)}</p>` : ''}<p style="margin:0 0 12px;line-height:1.5">${esc(body)}</p>${emailHtml || ''}`,
            button: { label: 'Megnyitás az alkalmazásban', url: absoluteUrl(url) },
          }),
        });
      } catch (err) {
        console.error(`E-mail hiba (${member.email}):`, err.message);
      }
    }
  }
  return delivered;
}

let appUrl = '';
export function setAppUrl(url) {
  appUrl = url;
}
export function absoluteUrl(path) {
  return path.startsWith('http') ? path : `${appUrl}${path}`;
}

export function logReminder(eventId, memberIds, kind, now = new Date()) {
  const stmt = getDb().prepare('INSERT INTO reminder_log (event_id, member_id, kind, sent_at) VALUES (?, ?, ?, ?)');
  for (const id of memberIds) stmt.run(eventId, id, kind, nowIso(now));
}
