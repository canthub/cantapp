import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getDb } from '../server/db.js';
import { config } from '../server/config.js';
import { sendMail, parseAddress } from '../server/services/mailer.js';

const realFetch = globalThis.fetch;
let calls = [];
let reply = { ok: true, status: 201, text: async () => '{}' };

before(() => {
  openDb(':memory:');
  config.emailFrom = 'Cantemus Kórus <noreply@cantemus.hu>';
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return reply;
  };
});

after(() => {
  globalThis.fetch = realFetch;
  config.emailApi = { provider: '', apiKey: '' };
});

test('feladó szétbontása', () => {
  assert.deepEqual(parseAddress('Cantemus Kórus <noreply@cantemus.hu>'), { name: 'Cantemus Kórus', email: 'noreply@cantemus.hu' });
  assert.deepEqual(parseAddress('"Kórus" <a@b.hu>'), { name: 'Kórus', email: 'a@b.hu' });
  assert.deepEqual(parseAddress('a@b.hu'), { name: '', email: 'a@b.hu' });
});

test('Brevo API: címzettek, feladó, csatolmány base64-ben', async () => {
  config.emailApi = { provider: 'brevo', apiKey: 'xkeysib-teszt' };
  calls = [];
  const res = await sendMail({
    to: ['a@example.com', 'b@example.com'], subject: 'Riport', html: '<p>Szia</p>', text: 'Szia',
    attachments: [{ filename: 'riport.csv', content: 'Név;Válasz\r\n' }],
  });
  assert.deepEqual(res, { sent: true });
  const [c] = calls;
  assert.equal(c.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(c.opts.headers['api-key'], 'xkeysib-teszt');
  assert.deepEqual(c.body.sender, { name: 'Cantemus Kórus', email: 'noreply@cantemus.hu' });
  assert.deepEqual(c.body.to, [{ email: 'a@example.com' }, { email: 'b@example.com' }]);
  assert.equal(c.body.htmlContent, '<p>Szia</p>');
  assert.equal(Buffer.from(c.body.attachment[0].content, 'base64').toString(), 'Név;Válasz\r\n');
});

test('Resend API és hibakezelés', async () => {
  config.emailApi = { provider: 'resend', apiKey: 're_teszt' };
  calls = [];
  await sendMail({ to: 'a@example.com', subject: 'Teszt', html: '<p>x</p>', text: 'x' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer re_teszt');
  assert.deepEqual(calls[0].body.to, ['a@example.com']);
  assert.equal(calls[0].body.from, 'Cantemus Kórus <noreply@cantemus.hu>');

  reply = { ok: false, status: 403, text: async () => 'domain not verified' };
  await assert.rejects(sendMail({ to: 'a@example.com', subject: 'Hibás', text: 'x' }), /HTTP 403.*domain not verified/);
  assert.equal(getDb().prepare(`SELECT status FROM email_log WHERE subject = 'Hibás'`).get().status, 'failed');
});

test('VAPID kulcs: generálás egyszer, utána ugyanaz marad', async () => {
  const { ensureVapidKeys } = await import('../server/services/push.js');
  config.vapid.publicKey = '';
  config.vapid.privateKey = '';
  ensureVapidKeys();
  const first = config.vapid.publicKey;
  assert.ok(first.length > 40);
  config.vapid.publicKey = '';
  config.vapid.privateKey = '';
  ensureVapidKeys();
  assert.equal(config.vapid.publicKey, first);
  config.vapid.publicKey = '';
  config.vapid.privateKey = '';
});
