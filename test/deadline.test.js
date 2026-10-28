import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { openDb } from '../server/db.js';
import { config } from '../server/config.js';
import { saveMember, createEvent, getEvent, getEventRow } from '../server/models.js';
import { createSession, SESSION_COOKIE } from '../server/auth.js';
import { importEventsTable } from '../server/services/importers.js';
import { TZ } from '../server/services/time.js';

// Valós „most”-hoz viszonyított dátumok, mert a közzétételi ellenőrzés a valódi időt nézi.
const inDays = (n) => DateTime.now().setZone(TZ).plus({ days: n }).toISODate();
const base = { type: 'koncert', startTime: '19:00', city: 'Nyíregyháza', choirs: ['cantemus'] };
let server; let url; let cookie;

before(async () => {
  openDb(':memory:');
  const admin = saveMember({ lastName: 'Admin', firstName: 'Anna', email: 'admin@x.hu', choirs: ['cantemus'], isAdmin: true }).id;
  cookie = `${SESSION_COOKIE}=${createSession(admin).token}`;
  const { createApp } = await import('../server/app.js');
  server = createApp().listen(0);
  url = `http://127.0.0.1:${server.address().port}/api/admin`;
});
after(() => server?.close());

const post = (path, body) => fetch(`${url}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cantapp', Cookie: cookie },
  body: JSON.stringify(body || {}),
});

test('alapértelmezett határidő: 14 nappal az esemény előtt', () => {
  assert.equal(config.defaultDeadlineDays, 14);
  const id = createEvent({ ...base, name: 'Tavaszi koncert', date: '2027-04-20' });
  assert.equal(getEvent(id).deadlineDate, '2027-04-06');
});

test('lejárt határidejű esemény nem tehető közzé (egyenként, csoportosan, létrehozáskor)', async () => {
  const late = createEvent({ ...base, name: 'Közeli koncert', date: inDays(5) }); // 14 nap előtt = már elmúlt
  const fine = createEvent({ ...base, name: 'Távoli koncert', date: inDays(40) });

  const single = await post(`/events/${late}/publish`);
  assert.equal(single.status, 400);
  assert.match((await single.json()).error, /„Közeli koncert”: a visszajelzési határidő már lejárt/);
  assert.equal(getEventRow(late).status, 'draft');

  const bulk = await (await post('/events/publish-bulk', { ids: [late, fine] })).json();
  assert.equal(bulk.published, 1);
  assert.deepEqual(bulk.expired, ['Közeli koncert']);
  assert.equal(getEventRow(fine).status, 'published');
  assert.equal(getEventRow(late).status, 'draft');

  const created = await post('/events', { ...base, name: 'Azonnali', date: inDays(3), publish: true });
  assert.equal(created.status, 400);
});

test('táblázat import: figyelmeztet, ha a határidő már lejárt', async () => {
  const csv = `Esemény neve;Dátum;Kezdés;Típus;Énekkar\nHolnapi koncert;${inDays(1)};19:00;koncert;Cantemus\nKésőbbi koncert;${inDays(60)};19:00;koncert;Cantemus\n`;
  const r = await importEventsTable(Buffer.from(csv), 'x.csv');
  assert.equal(r.created, 2);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /„Holnapi koncert”.*már lejárt/);
});
