import webpush from 'web-push';
import { config, pushEnabled } from '../config.js';
import { getDb, nowIso } from '../db.js';

let initialized = false;

function init() {
  if (!initialized && pushEnabled()) {
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
    initialized = true;
  }
  return initialized;
}

export function saveSubscription(memberId, sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw Object.assign(new Error('Hibás feliratkozás.'), { status: 400 });
  getDb().prepare(`INSERT INTO push_subscriptions (member_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(memberId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, nowIso());
}

export function removeSubscription(endpoint, memberId = null) {
  if (memberId) getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND member_id = ?').run(endpoint, memberId);
  else getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export async function sendPushToMember(memberId, payload) {
  if (!init()) return 0;
  const subs = getDb().prepare('SELECT * FROM push_subscriptions WHERE member_id = ?').all(memberId);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 24 * 3600 });
      sent++;
    } catch (err) {
      // A böngésző visszavonta a feliratkozást – töröljük.
      if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(s.endpoint);
      else console.error('Push küldési hiba:', err.statusCode || '', err.message);
    }
  }));
  return sent;
}
