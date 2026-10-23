import crypto from 'node:crypto';
import { getDb, nowIso } from './db.js';
import { getMember } from './models.js';

export const SESSION_COOKIE = 'cantapp_session';
const SESSION_DAYS = 180;
const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createLoginCode(memberId, now = new Date()) {
  const db = getDb();
  const recent = db.prepare('SELECT created_at FROM login_codes WHERE member_id = ? ORDER BY id DESC LIMIT 1').get(memberId);
  if (recent && new Date(now) - new Date(recent.created_at) < 30_000) {
    throw Object.assign(new Error('Kérlek, várj fél percet az újabb kód kérése előtt.'), { status: 429 });
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare('UPDATE login_codes SET used = 1 WHERE member_id = ? AND used = 0').run(memberId);
  db.prepare('INSERT INTO login_codes (member_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(memberId, sha256(code), new Date(new Date(now).getTime() + CODE_MINUTES * 60000).toISOString(), nowIso(now));
  return code;
}

export function verifyLoginCode(memberId, code, now = new Date()) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM login_codes WHERE member_id = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(memberId);
  if (!row || new Date(row.expires_at) < new Date(now) || row.attempts >= MAX_ATTEMPTS) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(sha256(String(code).trim())));
  if (ok) db.prepare('UPDATE login_codes SET used = 1 WHERE id = ?').run(row.id);
  else db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
  return ok;
}

export function createSession(memberId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  getDb().prepare('INSERT INTO sessions (token_hash, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), memberId, expires.toISOString(), nowIso());
  return { token, expires };
}

export function destroySession(token) {
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function loadSession(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const row = getDb().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
    if (row && new Date(row.expires_at) > new Date()) {
      const member = getMember(row.member_id);
      if (member?.active) req.member = member;
    }
  }
  next();
}

export function requireMember(req, res, next) {
  if (!req.member) return res.status(401).json({ error: 'Kérlek, jelentkezz be!' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.member) return res.status(401).json({ error: 'Kérlek, jelentkezz be!' });
  if (!req.member.isAdmin) return res.status(403).json({ error: 'Ehhez admin jogosultság szükséges.' });
  next();
}
