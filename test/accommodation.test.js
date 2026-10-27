import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ical from 'node-ical';
import { openDb } from '../server/db.js';
import { saveMember, createEvent, updateEvent, getEvent, getEventRow, setEventStatus, getResponse } from '../server/models.js';
import { setResponse } from '../server/services/rsvp.js';
import { buildReport, reportCsv } from '../server/services/report.js';
import { changeMessage } from '../server/services/messages.js';
import { buildMemberCalendar } from '../server/services/calendarFeed.js';
import { importEventsTable, importIcs } from '../server/services/importers.js';
import { accommodationAllowed } from '../shared/constants.js';

const now = new Date('2027-01-10T10:00:00Z');
let anna;
const tour = {
  name: 'Bécsi turné', type: 'utazas', date: '2027-03-12', endDate: '2027-03-15', startTime: '07:00', endTime: '20:00',
  city: 'Bécs', country: 'Ausztria', choirs: ['promusica'], deadlineDate: '2027-02-20', accommodation: true,
};

before(() => {
  openDb(':memory:');
  anna = saveMember({ lastName: 'Kovács', firstName: 'Anna', email: 'anna@x.hu', voicePart: 'Alt 1', choirs: ['promusica'] }).id;
});

test('szálláskérés csak Nyíregyházán kívüli, több napos eseménynél', () => {
  assert.equal(accommodationAllowed({ date: '2027-03-12', endDate: '2027-03-15', city: 'Bécs' }), true);
  assert.equal(accommodationAllowed({ date: '2027-03-12', endDate: '2027-03-15', city: 'Nyíregyháza' }), false);
  assert.equal(accommodationAllowed({ date: '2027-03-12', endDate: '2027-03-15', city: ' nyiregyhaza ' }), false);
  assert.equal(accommodationAllowed({ date: '2027-03-12', endDate: '', city: 'Debrecen' }), false, 'egynapos');
  assert.equal(accommodationAllowed({ date: '2027-03-12', endDate: '2027-03-15', city: '' }), false, 'város nélkül');

  const home = createEvent({ ...tour, name: 'Hazai fesztivál', city: 'Nyíregyháza' });
  assert.equal(getEventRow(home).accommodation, 0, 'Nyíregyházán automatikusan kikapcsol');
  const sameDay = createEvent({ ...tour, name: 'Egynapos', endDate: '2027-03-12' });
  assert.equal(getEventRow(sameDay).end_date, '', 'azonos utolsó nap = egynapos');
  assert.throws(() => createEvent({ ...tour, endDate: '2027-03-10' }), /nem lehet korábbi/);
});

test('a tag a válaszával szállást kérhet; „nem” válasznál törlődik; az admin módosítása megtartja', async () => {
  const id = createEvent(tour);
  setEventStatus(id, 'published', now);
  assert.equal(getEvent(id).accommodation, true);

  await setResponse(id, anna, 'yes', { accommodation: true, now });
  assert.equal(getResponse(id, anna).accommodation, 1);
  await setResponse(id, anna, 'maybe', { now });
  assert.equal(getResponse(id, anna).accommodation, 1, 'válaszváltáskor megmarad');
  await setResponse(id, anna, 'yes', { accommodation: true, byAdmin: true, now });
  await setResponse(id, anna, 'maybe', { byAdmin: true, now });
  assert.equal(getResponse(id, anna).accommodation, 1, 'admin csak a választ módosítja');

  const report = buildReport(id, now);
  assert.equal(report.summary.accommodation, 1);
  const csv = reportCsv(report);
  assert.match(csv.split('\r\n')[0], /;Szállást kér$/);
  assert.match(csv, /Kovács Anna;.*;igen\r\n/);

  await setResponse(id, anna, 'no', { accommodation: true, now });
  assert.equal(getResponse(id, anna).accommodation, 0, '„nem” mellett nem kérhet szállást');

  // Ha az eseményt egynaposra módosítják, a szálláskérés kikapcsol, és a riportból is eltűnik az oszlop.
  updateEvent(id, { ...getEvent(id), endDate: '' }, now);
  assert.equal(getEvent(id).accommodation, false);
  assert.doesNotMatch(reportCsv(buildReport(id, now)).split('\r\n')[0], /Szállást kér/);
});

test('több napos esemény az értesítésben és a naptár-feliratkozásban', () => {
  const id = createEvent({ ...tour, name: 'Prágai turné' });
  setEventStatus(id, 'published', now);
  assert.match(changeMessage(getEvent(id)).body, /2027\. március 12\. \(péntek\) 07:00 – 2027\. március 15\. \(hétfő\) 20:00/);
  const allDay = createEvent({ ...tour, name: 'Egész napos tábor', startTime: '', endTime: '', date: '2027-04-01', endDate: '2027-04-03' });
  setEventStatus(allDay, 'published', now);

  const events = Object.values(ical.sync.parseICS(buildMemberCalendar(anna, now))).filter((x) => x.type === 'VEVENT');
  const prague = events.find((e) => String(e.summary).includes('Prágai turné'));
  assert.equal(prague.start.toISOString(), '2027-03-12T06:00:00.000Z');
  assert.equal(prague.end.toISOString(), '2027-03-15T19:00:00.000Z');
  const camp = events.find((e) => String(e.summary).includes('Egész napos tábor'));
  assert.equal(camp.datetype, 'date');
  assert.equal((camp.end - camp.start) / 86400000, 3, 'három teljes nap (a vége kizárólagos)');
});

test('import: utolsó nap és szálláskérés a táblázatból, több napos esemény a naptárból', async () => {
  // A sablon Bécsi turné sora ugyanaz, mint a fent kézzel felvett esemény – nem duplikálódik.
  const table = await importEventsTable(fs.readFileSync('templates/esemenyek_import_sablon.xlsx'), 'e.xlsx');
  assert.deepEqual(table.errors, []);
  assert.ok(table.skippedItems.some((m) => m.includes('Bécsi turné')));

  const csv = 'Esemény neve;Dátum;Utolsó nap;Kezdés;Típus;Énekkar;Város;Szálláskérés\n'
    + 'Szegedi fesztivál;2027-05-01;2027-05-03;10:00;koncert;Pro Musica;Szeged;\n'
    + 'Kassai út;2027-06-01;2027-06-02;08:00;utazás;Pro Musica;Kassa;nem\n';
  const r = await importEventsTable(Buffer.from(csv), 'x.csv');
  assert.deepEqual(r.errors, []);
  const rows = r.ids.map(getEventRow);
  const szeged = rows.find((x) => x.name === 'Szegedi fesztivál');
  const kassa = rows.find((x) => x.name === 'Kassai út');
  assert.deepEqual([szeged.end_date, szeged.accommodation], ['2027-05-03', 1], 'üresen hagyva engedélyezett');
  assert.deepEqual([kassa.end_date, kassa.accommodation], ['2027-06-02', 0]);

  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Teszt', 'BEGIN:VEVENT', 'UID:tabor@g',
    'DTSTART;VALUE=DATE:20270701', 'DTEND;VALUE=DATE:20270704', 'SUMMARY:Nyári tábor', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const fromCal = await importIcs(ics, { choirs: ['promusica'], from: '2027-06-01', to: '2027-08-01' });
  assert.equal(getEventRow(fromCal.ids[0]).end_date, '2027-07-03');
});
