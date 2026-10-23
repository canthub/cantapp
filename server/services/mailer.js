import nodemailer from 'nodemailer';
import { config, emailEnabled } from '../config.js';
import { getDb, nowIso } from '../db.js';

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      pool: true,
      maxConnections: 3,
    });
  }
  return transporter;
}

function log(to, subject, status, error = null) {
  getDb().prepare('INSERT INTO email_log (to_address, subject, status, error, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(to, subject, status, error, nowIso());
}

// SMTP nélkül (fejlesztéskor) a levelek nem mennek ki, csak a konzolra és az email_log táblába kerülnek.
export async function sendMail({ to, subject, html, text, attachments }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return { skipped: true };
  const toStr = recipients.join(', ');
  if (!emailEnabled()) {
    log(toStr, subject, 'logged');
    if (process.env.NODE_ENV !== 'test') {
      console.log(`\n[e-mail – nincs SMTP beállítva, nem lett elküldve]\nCímzett: ${toStr}\nTárgy: ${subject}\n${text || ''}\n`);
    }
    return { logged: true };
  }
  try {
    await getTransporter().sendMail({ from: config.emailFrom, to: toStr, subject, html, text, attachments });
    log(toStr, subject, 'sent');
    return { sent: true };
  } catch (err) {
    log(toStr, subject, 'failed', err.message);
    throw err;
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { esc };

export function emailLayout({ heading, bodyHtml, button }) {
  return `<!doctype html><html lang="hu"><body style="margin:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;color:#2b2622">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:24px 0"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#7a1f2b;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">Cantemus Kórus</td></tr>
    <tr><td style="padding:24px">
      <h2 style="margin:0 0 16px;font-size:20px;color:#7a1f2b">${esc(heading)}</h2>
      ${bodyHtml}
      ${button ? `<p style="margin:24px 0 0"><a href="${esc(button.url)}" style="display:inline-block;background:#7a1f2b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${esc(button.label)}</a></p>` : ''}
    </td></tr>
    <tr><td style="padding:16px 24px;font-size:12px;color:#8a817a;border-top:1px solid #eee">Ezt az üzenetet a Cantemus Kórus alkalmazás küldte.</td></tr>
  </table></td></tr></table></body></html>`;
}
