import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import ical from 'node-ical';
import { openDb } from '../server/db.js';
import { config } from '../server/config.js';
import { saveMember, createEvent, setEventStatus, updateEvent, getEvent, setMemberActive } from '../server/models.js';
import { setResponse } from '../server/services/rsvp.js';
import { getCalendarToken, memberByCalendarToken, calendarUrls, buildMemberCalendar, foldLine } from '../server/services/calendarFeed.js';

const now = new Date('2026-11-01T10:00:00Z');
let anna;
let bela;
const ids = {};

before(async () => {
  openDb(':memory:');
  config.appUrl = 'https://korus.cantemus.hu';
  anna = saveMember({ lastName: 'Kovács', firstName: 'Anna', email: 'anna@x.hu', choirs: ['cantemus'] }).id;
  bela = saveMember({ lastName: 'Nagy', firstName: 'Béla', email: 'bela@x.hu', choirs: ['cantemus'] }).id;
  const base = { choirs: ['cantemus'], city: 'Nyíregyháza', address: 'Példa tér 2.', venue: 'Hangversenyterem, nagyterem', country: 'Magyarország' };
  const mk = (key, data, publish = true) => {
    ids[key] = createEvent({ ...base, deadlineDate: '2026-11-20', ...data });
    if (publish) setEventStatus(ids[key], 'published', now);
  };
  mk('proba', { name: 'Heti próba', type: 'proba', date: '2026-11-24', startTime: '18:00', endTime: '20:30', notes: 'Hozz kottát; ceruzát is!' });
  mk('koncert', { name: 'Adventi koncert', type: 'koncert', date: '2026-12-06', startTime: '19:00' });
  mk('utazas', { name: 'Egész napos utazás', type: 'utazas', date: '2026-12-10', startTime: '' });
  mk('nyari', { name: 'Nyári tábor', type: 'proba', date: '2027-07-01', startTime: '10:00' }); // nyári időszámítás
  mk('vazlat', { name: 'Titkos piszkozat', type: 'proba', date: '2026-12-01', startTime: '18:00' }, false);
  mk('csakBela', { name: 'Szólampróba', type: 'proba', date: '2026-11-26', startTime: '17:00', inviteMode: 'selected', invitees: [bela] });
  mk('lemondott', { name: 'Elmaradó próba', type: 'proba', date: '2026-11-27', startTime: '18:00' });
  setEventStatus(ids.lemondott, 'cancelled', now);
  await setResponse(ids.proba, anna, 'yes', { now });
  await setResponse(ids.utazas, anna, 'no', { now });
});

const parse = (text) => Object.values(ical.sync.parseICS(text)).filter((x) => x.type === 'VEVENT');
const byName = (events, name) => events.find((e) => String(e.summary).includes(name));

test('a feed csak a meghívott, közzétett eseményeket tartalmazza, a válasz jelével', () => {
  const events = parse(buildMemberCalendar(anna, now));
  const names = events.map((e) => String(e.summary));
  assert.ok(names.includes('✅ Heti próba'));
  assert.ok(names.includes('⏳ Adventi koncert'));
  assert.ok(names.includes('❌ Egész napos utazás'));
  assert.ok(names.includes('🚫 ELMARAD: Elmaradó próba'));
  assert.ok(!names.some((n) => n.includes('Titkos piszkozat')), 'piszkozat nem kerül bele');
  assert.ok(!names.some((n) => n.includes('Szólampróba')), 'akire nincs meghívva, az nem kerül bele');
  assert.ok(parse(buildMemberCalendar(bela, now)).some((e) => String(e.summary) === '⏳ Szólampróba'));
});

test('időpontok, helyszín, leírás és állapot', () => {
  const events = parse(buildMemberCalendar(anna, now));
  const proba = byName(events, 'Heti próba');
  assert.equal(proba.start.toISOString(), '2026-11-24T17:00:00.000Z', '18:00 budapesti téli idő');
  assert.equal(proba.end.toISOString(), '2026-11-24T19:30:00.000Z');
  assert.equal(String(proba.location), 'Hangversenyterem, nagyterem, Példa tér 2., Nyíregyháza, Magyarország');
  assert.match(String(proba.description), /Visszajelzésed: Részt veszek/);
  assert.match(String(proba.description), /Hozz kottát; ceruzát is!/);
  assert.match(String(proba.description), /https:\/\/korus\.cantemus\.hu\/#\/esemeny\/\d+/);
  assert.equal(proba.status, 'CONFIRMED');
  assert.equal(byName(events, 'Adventi koncert').end - byName(events, 'Adventi koncert').start, 2 * 3600000, 'befejezés nélkül 2 óra');
  assert.equal(byName(events, 'Nyári tábor').start.toISOString(), '2027-07-01T08:00:00.000Z', '10:00 nyári időszámítással');
  const allDay = byName(events, 'Egész napos utazás');
  assert.equal(allDay.datetype, 'date');
  assert.equal(allDay.transparency, 'TRANSPARENT', 'akin nem vesz részt, az nem foglalja a naptárt');
  assert.equal(byName(events, 'Elmaradó próba').status, 'CANCELLED');
  assert.equal(byName(events, 'Adventi koncert').status, 'TENTATIVE');
});

test('módosítás és válaszváltozás megjelenik, a sorok legfeljebb 75 bájtosak', async () => {
  const ev = getEvent(ids.koncert);
  updateEvent(ids.koncert, { ...ev, startTime: '18:00' }, now);
  await setResponse(ids.koncert, anna, 'maybe', { now });
  const text = buildMemberCalendar(anna, now);
  const koncert = byName(parse(text), 'Adventi koncert');
  assert.equal(String(koncert.summary), '❓ Adventi koncert');
  assert.equal(koncert.start.toISOString(), '2026-12-06T17:00:00.000Z');
  for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `túl hosszú sor: ${line}`);
  assert.equal(foldLine('é'.repeat(50)).split('\r\n ').join(''), 'é'.repeat(50), 'ékezet nem törik ketté');
});

test('titkos link: újrakéréskor a régi megszűnik, inaktív tagnál nem érvényes', () => {
  const token = getCalendarToken(anna);
  assert.equal(getCalendarToken(anna), token, 'ugyanaz marad');
  assert.equal(memberByCalendarToken(token).id, anna);
  const urls = calendarUrls(token);
  assert.equal(urls.url, `https://korus.cantemus.hu/api/calendar/${token}.ics`);
  assert.equal(urls.webcalUrl, `webcal://korus.cantemus.hu/api/calendar/${token}.ics`);
  assert.ok(urls.googleUrl.startsWith('https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2F'));
  const fresh = getCalendarToken(anna, { reset: true });
  assert.notEqual(fresh, token);
  assert.equal(memberByCalendarToken(token), null);
  assert.equal(memberByCalendarToken('nem-jo'), null);
  setMemberActive(bela, false);
  assert.equal(memberByCalendarToken(getCalendarToken(bela)), null);
});

test('HTTP: a feed bejelentkezés nélkül, a titkos linkkel tölthető le', async () => {
  const { createApp } = await import('../server/app.js');
  const server = createApp().listen(0);
  try {
    const base = `http://localhost:${server.address().port}/api/calendar`;
    const ok = await fetch(`${base}/${getCalendarToken(anna)}.ics`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /text\/calendar/);
    assert.match(await ok.text(), /BEGIN:VCALENDAR/);
    assert.equal((await fetch(`${base}/${'0'.repeat(48)}.ics`)).status, 404);
  } finally {
    server.close();
  }
});
