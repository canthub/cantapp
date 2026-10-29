import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import ical from 'node-ical';
import { openDb, getDb } from '../server/db.js';
import { saveMember, getMember, createEvent, updateEvent, setEventStatus, eligibleMembers, isEligible, getEventGuests } from '../server/models.js';
import { sendAnnouncements } from '../server/services/scheduler.js';
import { buildReport } from '../server/services/report.js';
import { importMembers } from '../server/services/importers.js';
import { createSession, SESSION_COOKIE } from '../server/auth.js';
import { TZ } from '../server/services/time.js';

const inDays = (n) => DateTime.now().setZone(TZ).plus({ days: n }).toISODate();
const base = { type: 'koncert', startTime: '19:00', endTime: '21:00', venue: 'Kodály terem', city: 'Nyíregyháza', choirs: ['cantemus'] };
let anna; let gabor; let lili; let server; let url;

before(async () => {
  openDb(':memory:');
  anna = saveMember({ lastName: 'Kovács', firstName: 'Anna', email: 'anna@x.hu', voicePart: 'Szoprán 1', choirs: ['cantemus'] }).id;
  gabor = saveMember({ lastName: 'Tóth', firstName: 'Gábor', email: 'gabor@x.hu', voicePart: 'Tenor', isGuest: true }).id;
  lili = saveMember({ lastName: 'Kis', firstName: 'Lili', email: 'lili@x.hu', voicePart: 'hegedű', isGuest: true, choirs: ['cantemus'] }).id;
  const { createApp } = await import('../server/app.js');
  server = createApp().listen(0);
  url = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server?.close());

const get = (path, member) => fetch(`${url}${path}`, {
  headers: { 'X-Requested-With': 'cantapp', ...(member ? { Cookie: `${SESSION_COOKIE}=${createSession(member).token}` } : {}) },
});

test('kisegítő művész: nem kell kórus, és nem lehet kórustag', () => {
  assert.equal(getMember(gabor).isGuest, true);
  assert.deepEqual(getMember(lili).choirs, [], 'a kisegítő művész kórustagsága törlődik');
  assert.throws(() => saveMember({ lastName: 'X', email: 'x@x.hu' }), /Legalább egy énekkart/);
});

test('csak az egyenként meghívott kisegítő kap meghívást; levétel = kikerül a meghívottak közül', async () => {
  const id = createEvent({ ...base, name: 'Adventi koncert', date: inDays(40), guests: [gabor, anna] });
  assert.deepEqual(getEventGuests(id), [gabor], 'kórustagot nem lehet kisegítőként felvenni');
  assert.deepEqual(eligibleMembers(id).map((m) => m.id).sort(), [anna, gabor].sort());
  assert.equal(isEligible(id, lili), false);

  setEventStatus(id, 'published');
  assert.equal(await sendAnnouncements(id), 2, 'a kórustag és a meghívott kisegítő is értesítést kap');
  const report = buildReport(id);
  assert.equal(report.rows.find((r) => r.memberId === gabor).choirs, 'Kisegítő művész');

  const other = createEvent({ ...base, name: 'Másik koncert', date: inDays(50) });
  assert.equal(isEligible(other, gabor), false, 'más eseményre nem kap automatikusan meghívást');

  const { removed, added } = updateEvent(id, { ...base, name: 'Adventi koncert', date: inDays(40), guests: [lili] });
  assert.deepEqual(removed, [gabor]);
  assert.deepEqual(added, [lili]);
  // A kisegítők listáját nem küldő mentés (pl. naptárszinkron) nem módosítja őket.
  updateEvent(id, { ...base, name: 'Adventi koncert', date: inDays(40) });
  assert.deepEqual(getEventGuests(id), [lili]);
});

test('a kisegítő csak a meghívott eseményeit látja, és egyenként mentheti a naptárába', async () => {
  const mine = createEvent({ ...base, name: 'Újévi koncert', date: inDays(60), guests: [gabor] });
  const notMine = createEvent({ ...base, name: 'Kórusest', date: inDays(61) });
  for (const id of [mine, notMine]) setEventStatus(id, 'published');

  const { events } = await (await get('/events', gabor)).json();
  assert.deepEqual(events.map((e) => e.name), ['Újévi koncert']);
  const ev = events[0];
  assert.equal(ev.invited, true);
  assert.match(ev.calendar.icsUrl, new RegExp(`/api/calendar/[0-9a-f]{48}/event-${mine}\\.ics$`));
  const google = new URL(ev.calendar.googleUrl);
  assert.equal(google.searchParams.get('text'), 'Újévi koncert');
  assert.equal(google.searchParams.get('dates'), `${inDays(60).replaceAll('-', '')}T190000/${inDays(60).replaceAll('-', '')}T210000`);
  assert.equal(google.searchParams.get('ctz'), 'Europe/Budapest');
  assert.equal(google.searchParams.get('location'), 'Kodály terem, Nyíregyháza');

  assert.equal((await get(`/events/${notMine}`, gabor)).status, 404, 'a nem meghívott eseményt nem látja');
  const choirView = await (await get('/events', anna)).json();
  assert.ok(choirView.events.every((e) => !e.calendar), 'a kórustagok a naptár-feliratkozást használják');

  // Az .ics link bejelentkezés nélkül működik (a telefon naptára nyitja meg).
  const ics = await fetch(ev.calendar.icsUrl.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${server.address().port}`));
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  const parsed = Object.values(ical.sync.parseICS(await ics.text())).filter((c) => c.type === 'VEVENT');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].summary, 'Újévi koncert', 'nincs válasz-jel a címben');
  assert.equal(parsed[0].uid, `event-${mine}@cantapp`);

  const token = ev.calendar.icsUrl.match(/calendar\/([0-9a-f]{48})\//)[1];
  assert.equal((await fetch(`${url}/calendar/${token}/event-${notMine}.ics`)).status, 404, 'más eseményt nem tölthet le');
  assert.equal((await fetch(`${url}/calendar/${'0'.repeat(48)}/event-${mine}.ics`)).status, 404);
});

test('tagimport: „Kisegítő művész” oszlop; nélküle a kisegítők megmaradnak és nem inaktiválódnak', async () => {
  const r = await importMembers(Buffer.from('Vezetéknév;Keresztnév;E-mail;Kisegítő művész\nNagy;Bence;bence@x.hu;igen\n'), 'g.csv');
  assert.deepEqual(r.errors, []);
  assert.equal(getMember(getDb().prepare(`SELECT id FROM members WHERE email = 'bence@x.hu'`).get().id).isGuest, true);

  const choirOnly = await importMembers(Buffer.from('Vezetéknév;Keresztnév;E-mail;Cantemus Vegyeskar\nKovács;Anna;anna@x.hu;igen\nTóth;Gábor;gabor@x.hu;\n'), 'k.csv', { deactivateMissing: true });
  assert.deepEqual(choirOnly.errors, []);
  assert.equal(getMember(gabor).isGuest, true, 'üres cella: a besorolás marad');
  assert.equal(getMember(lili).active, true, 'kisegítő oszlop nélkül a kisegítőket nem inaktiváljuk');
});
