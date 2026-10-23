import { Router } from 'express';
import { getDb, nowIso } from '../db.js';
import { config, emailEnabled, pushEnabled } from '../config.js';
import {
  SESSION_COOKIE, createLoginCode, verifyLoginCode, createSession, destroySession, requireMember,
} from '../auth.js';
import { getMemberByEmail, getEventRow, getEvent, serializeEvent, isEligible, getResponse, listEvents } from '../models.js';
import { setResponse, concertRuleAllows, concertRuleMessage } from '../services/rsvp.js';
import { saveSubscription, removeSubscription } from '../services/push.js';
import { sendMail, emailLayout, esc } from '../services/mailer.js';

export const memberRouter = Router();

// ---------------------------------------------------------------- Bejelentkezés

memberRouter.post('/auth/request-code', async (req, res) => {
  const member = getMemberByEmail(req.body?.email);
  if (!member || !member.active) {
    return res.status(404).json({ error: 'Ezzel az e-mail-címmel nem található aktív kórustag. Ellenőrizd a címet, vagy fordulj a kórusasszisztenshez!' });
  }
  const code = createLoginCode(member.id);
  await sendMail({
    to: member.email,
    subject: `Belépési kód: ${code}`,
    text: `A belépési kódod: ${code}\nA kód 15 percig érvényes.`,
    html: emailLayout({
      heading: 'Belépési kód',
      bodyHtml: `<p>A belépési kódod:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:8px 0">${esc(code)}</p><p style="color:#8a817a">A kód 15 percig érvényes. Ha nem te kérted, hagyd figyelmen kívül ezt a levelet.</p>`,
    }),
  });
  // Fejlesztői módban (SMTP nélkül) a kódot visszaadjuk, hogy ki lehessen próbálni az appot.
  res.json({ ok: true, ...(!emailEnabled() && !config.isProd ? { devCode: code } : {}) });
});

memberRouter.post('/auth/verify', (req, res) => {
  const member = getMemberByEmail(req.body?.email);
  if (!member || !member.active || !verifyLoginCode(member.id, req.body?.code)) {
    return res.status(400).json({ error: 'Hibás vagy lejárt kód.' });
  }
  const { token, expires } = createSession(member.id);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, expires });
  res.json({ ok: true });
});

memberRouter.post('/auth/logout', (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

memberRouter.get('/me', requireMember, (req, res) => {
  const unread = getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL').get(req.member.id).n;
  res.json({ member: req.member, unread, pushAvailable: pushEnabled(), vapidPublicKey: config.vapid.publicKey || null });
});

// ---------------------------------------------------------------- Események

function memberView(row, memberId, now = new Date()) {
  const ev = serializeEvent(row, now);
  // Mindenki látja a kórusa eseményeit, de visszajelezni csak a meghívottak tudnak.
  ev.invited = isEligible(row.id, memberId);
  ev.myResponse = getResponse(row.id, memberId)?.status || null;
  const canRespond = ev.isOpen && ev.invited;
  ev.allowed = { yes: canRespond, maybe: canRespond, no: canRespond };
  if (row.type === 'koncert' && row.dress_rehearsal_id) {
    const dr = getEventRow(row.dress_rehearsal_id);
    if (dr && isEligible(dr.id, memberId)) {
      const drStatus = getResponse(dr.id, memberId)?.status || null;
      ev.dressRehearsal = { id: dr.id, name: dr.name, date: dr.date, startTime: dr.start_time, myResponse: drStatus };
      ev.allowed.yes = canRespond && concertRuleAllows('yes', drStatus);
      ev.allowed.maybe = canRespond && concertRuleAllows('maybe', drStatus);
      if (!ev.allowed.yes) ev.ruleMessage = concertRuleMessage(dr);
    }
  }
  return ev;
}

memberRouter.get('/events', requireMember, (req, res) => {
  const events = listEvents({ statuses: ['published', 'cancelled'], choirs: req.member.choirs })
    .map((e) => memberView(getEventRow(e.id), req.member.id));
  res.json({ events });
});

memberRouter.get('/events/:id', requireMember, (req, res) => {
  const row = getEventRow(Number(req.params.id));
  const ownChoir = row && getEvent(row.id).choirs.some((c) => req.member.choirs.includes(c));
  const visible = row && (row.status !== 'draft' || req.member.isAdmin) && (ownChoir || req.member.isAdmin);
  if (!visible) return res.status(404).json({ error: 'Az esemény nem található.' });
  res.json({ event: memberView(row, req.member.id) });
});

memberRouter.put('/events/:id/response', requireMember, async (req, res) => {
  const id = Number(req.params.id);
  const result = await setResponse(id, req.member.id, req.body?.status);
  res.json({ ...result, event: memberView(getEventRow(id), req.member.id) });
});

// ---------------------------------------------------------------- Értesítések

memberRouter.get('/notifications', requireMember, (req, res) => {
  const items = getDb()
    .prepare('SELECT id, event_id AS eventId, kind, title, body, created_at AS createdAt, read_at AS readAt FROM notifications WHERE member_id = ? ORDER BY id DESC LIMIT 100')
    .all(req.member.id);
  res.json({ notifications: items });
});

memberRouter.post('/notifications/read-all', requireMember, (req, res) => {
  getDb().prepare('UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL').run(nowIso(), req.member.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Push

memberRouter.post('/push/subscribe', requireMember, (req, res) => {
  saveSubscription(req.member.id, req.body);
  res.json({ ok: true });
});

memberRouter.post('/push/unsubscribe', requireMember, (req, res) => {
  if (req.body?.endpoint) removeSubscription(req.body.endpoint, req.member.id);
  res.json({ ok: true });
});
