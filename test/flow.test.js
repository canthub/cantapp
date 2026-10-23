import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb, getDb } from '../server/db.js';
import { saveMember, createEvent, setEventStatus, getEventRow, eventStats } from '../server/models.js';
import { sendAnnouncements, runScheduler, reminderDue } from '../server/services/scheduler.js';
import { setResponse } from '../server/services/rsvp.js';
import { buildReport, reportXlsx, reportCsv } from '../server/services/report.js';
import { importMembers, importEventsTable, importIcs } from '../server/services/importers.js';
import { localToUtcIso } from '../server/services/time.js';
import { article, missedMessage, THANK_YOU_MESSAGE } from '../shared/constants.js';

// Budapesti idő szerinti időpont → Date
const at = (date, time = '10:00') => new Date(localToUtcIso(date, time));

const notificationsOf = (memberId, kind) => getDb()
  .prepare(`SELECT * FROM notifications WHERE member_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY id`)
  .all(...(kind ? [memberId, kind] : [memberId]));

let anna; let peter; let eszter;

before(() => {
  openDb(':memory:');
  anna = saveMember({ lastName: 'Kovács', firstName: 'Anna', email: 'anna@example.com', voicePart: 'Szoprán 1', choirs: ['cantemus'] }).id;
  peter = saveMember({ lastName: 'Nagy', firstName: 'Péter', email: 'peter@example.com', voicePart: 'Basszus', choirs: ['cantemus', 'promusica'] }).id;
  eszter = saveMember({ lastName: 'Szabó', firstName: 'Eszter', email: 'eszter@example.com', voicePart: 'Alt', choirs: ['promusica'] }).id;
});

test('névelő és üzenetszövegek', () => {
  assert.equal(article('Adventi koncert'), 'az');
  assert.equal(article('Karácsonyi koncert'), 'a');
  assert.equal(article('5. próba'), 'az');
  assert.equal(article('1956-os emlékkoncert'), 'az');
  assert.equal(article('10. próba'), 'a');
  assert.equal(missedMessage('Adventi koncert'),
    'Sajnáljuk, hogy nem tudsz részt venni az Adventi koncert eseményen, reméljük a következőn találkozunk! 🙂 Ne felejts el visszajelezni a határidőig!');
});

test('emlékeztető ütemezés: hetente, majd az utolsó héten naponta', () => {
  const deadlineAt = localToUtcIso('2026-12-20', '23:59');
  // Még semmit nem kapott → azonnali megjelenési értesítés, napszaktól függetlenül.
  assert.equal(reminderDue({ now: at('2026-11-01', '03:00'), deadlineAt, lastAutoAt: null }), 'announce');
  const last = at('2026-11-01', '15:00').toISOString();
  assert.equal(reminderDue({ now: at('2026-11-07', '10:00'), deadlineAt, lastAutoAt: last }), null);
  assert.equal(reminderDue({ now: at('2026-11-08', '08:00'), deadlineAt, lastAutoAt: last }), null, '9 óra előtt nem');
  assert.equal(reminderDue({ now: at('2026-11-08', '09:05'), deadlineAt, lastAutoAt: last }), 'weekly');
  // Utolsó hét: naponta egyszer.
  const lastDaily = at('2026-12-14', '09:05').toISOString();
  assert.equal(reminderDue({ now: at('2026-12-14', '18:00'), deadlineAt, lastAutoAt: lastDaily }), null);
  assert.equal(reminderDue({ now: at('2026-12-15', '09:05'), deadlineAt, lastAutoAt: lastDaily }), 'daily');
  assert.equal(reminderDue({ now: at('2026-12-20', '09:05'), deadlineAt, lastAutoAt: lastDaily }), 'daily');
  assert.equal(reminderDue({ now: at('2026-12-21', '09:05'), deadlineAt, lastAutoAt: lastDaily }), null, 'határidő után nincs');
});

test('teljes folyamat: közzététel, visszajelzés, főpróba-szabály, emlékeztetők, lezárás, riport', async () => {
  const base = {
    country: 'Magyarország', city: 'Nyíregyháza', address: 'Példa tér 2.', venue: 'Hangversenyterem', choirs: ['cantemus'],
  };
  const drId = createEvent({ ...base, name: 'Adventi koncert főpróba', type: 'foproba', date: '2026-12-05', startTime: '15:00', deadlineDate: '2026-11-25' });
  const concertId = createEvent({ ...base, name: 'Adventi koncert', type: 'koncert', date: '2026-12-06', startTime: '19:00', deadlineDate: '2026-11-25' });
  assert.equal(getEventRow(concertId).dress_rehearsal_id, drId, 'a koncert automatikusan a főpróbához kapcsolódik');
  const pmId = createEvent({ ...base, choirs: ['promusica'], name: 'Pro Musica próba', type: 'proba', date: '2026-11-23', startTime: '17:00', deadlineDate: '2026-11-21' });

  // Piszkozatról nincs értesítés.
  await runScheduler(at('2026-11-01', '10:00'));
  assert.equal(notificationsOf(anna).length, 0);

  const publishTime = at('2026-11-01', '10:00');
  for (const id of [drId, concertId, pmId]) {
    setEventStatus(id, 'published', publishTime);
    await sendAnnouncements(id, publishTime);
  }
  // Csak a saját kórus eseményeiről: Anna (Cantemus) 2, Eszter (Pro Musica) 1, Péter (mindkettő) 3.
  assert.equal(notificationsOf(anna, 'announce').length, 2);
  assert.equal(notificationsOf(eszter, 'announce').length, 1);
  assert.equal(notificationsOf(peter, 'announce').length, 3);
  // Az e-mail is kiment (SMTP nélkül naplózva).
  assert.ok(getDb().prepare(`SELECT 1 FROM email_log WHERE to_address = 'anna@example.com' AND subject LIKE 'Új esemény%'`).get());

  // Eszter nem jelezhet a Cantemus eseményére.
  await assert.rejects(setResponse(drId, eszter, 'yes', { now: at('2026-11-02') }), /nem a te énekkarodé/);

  // Koncertre csak főpróba-igen után lehet igent mondani.
  await assert.rejects(setResponse(concertId, anna, 'yes', { now: at('2026-11-02') }), /főpróbára is jelezted/);
  await setResponse(concertId, anna, 'no', { now: at('2026-11-02') }); // nemet mindig lehet
  await setResponse(drId, anna, 'yes', { now: at('2026-11-02') });
  await setResponse(concertId, anna, 'yes', { now: at('2026-11-02') });
  const thanks = notificationsOf(anna, 'thanks');
  assert.equal(thanks.length, 2, 'köszönő üzenet az első visszajelzéskor (eseményenként egyszer)');
  assert.equal(thanks[0].title, THANK_YOU_MESSAGE);

  // Főpróba „nem”-re váltása törli a koncert-igent.
  await setResponse(drId, anna, 'no', { now: at('2026-11-03') });
  assert.equal(eventStats(concertId).yes, 0);
  assert.equal(notificationsOf(anna, 'rule').length, 1);
  await setResponse(drId, anna, 'yes', { now: at('2026-11-03') });
  await setResponse(concertId, anna, 'yes', { now: at('2026-11-03') });

  // Heti emlékeztető: Péter nem jelzett vissza, Anna igen.
  await runScheduler(at('2026-11-08', '09:30'));
  assert.equal(notificationsOf(peter, 'weekly').length, 3);
  assert.equal(notificationsOf(anna, 'weekly').length, 0);
  // Ugyanazon a napon nincs újabb.
  await runScheduler(at('2026-11-08', '15:00'));
  assert.equal(notificationsOf(peter, 'weekly').length, 3);

  // Az utolsó héten (11-18-tól a Cantemus eseményeknél) naponta.
  for (const day of ['2026-11-18', '2026-11-19', '2026-11-20']) await runScheduler(at(day, '09:30'));
  const daily = notificationsOf(peter, 'daily').filter((n) => n.event_id === drId);
  assert.equal(daily.length, 3);

  // Határidő után: a Pro Musica próba lezárul, Eszter és Péter „sajnáljuk” üzenetet kap.
  await runScheduler(at('2026-11-22', '00:05'));
  assert.ok(getEventRow(pmId).closed_at);
  const missed = notificationsOf(eszter, 'missed');
  assert.equal(missed.length, 1);
  assert.equal(missed[0].body, missedMessage('Pro Musica próba'));
  await assert.rejects(setResponse(pmId, eszter, 'yes', { now: at('2026-11-22', '08:00') }), /határidő lejárt/);

  // Riport: a határidőt követő napon 8:00-tól megy ki a 4 címzettnek.
  const reportCount = () => getDb().prepare(`SELECT COUNT(*) AS n FROM email_log WHERE subject LIKE 'Végleges riport: Pro Musica próba%'`).get().n;
  assert.equal(reportCount(), 0);
  await runScheduler(at('2026-11-22', '08:10'));
  assert.equal(reportCount(), 1);
  const reportMail = getDb().prepare(`SELECT to_address FROM email_log WHERE subject LIKE 'Végleges riport%'`).get();
  assert.equal(reportMail.to_address, 'korusasszisztens@cantemus.hu, foldesi.ildiko@cantemus.hu, szabo.soma@cantemus.hu, support@cantemus.hu');
  await runScheduler(at('2026-11-23', '08:10'));
  assert.equal(reportCount(), 1, 'csak egyszer megy ki');

  // Riport tartalom és exportok.
  const report = buildReport(concertId, at('2026-11-20'));
  assert.deepEqual(report.summary, { total: 2, yes: 1, maybe: 0, no: 0, none: 1 });
  assert.match(reportCsv(report), /Kovács Anna;Szoprán 1;Cantemus Vegyeskar;anna@example.com;;Részt vesz/);
  assert.ok((await reportXlsx(report)).length > 1000);
});

test('tagok importja a sablonból', async () => {
  const result = await importMembers(fs.readFileSync('templates/tagok_import_sablon.xlsx'), 'tagok_import_sablon.xlsx');
  assert.deepEqual(result.errors, []);
  assert.equal(result.created + result.updated, 3);
  const nagy = getDb().prepare(`SELECT id FROM members WHERE email = 'nagy.peter@example.com'`).get();
  const choirs = getDb().prepare('SELECT choir FROM member_choirs WHERE member_id = ? ORDER BY choir').all(nagy.id).map((r) => r.choir);
  assert.deepEqual(choirs, ['cantemus', 'promusica']);

  const csv = await importMembers(fs.readFileSync('templates/tagok_import_sablon.csv'), 'tagok.csv');
  assert.deepEqual(csv.errors, []);
  assert.equal(csv.updated, 3);

  const bad = await importMembers(Buffer.from('Vezetéknév;Keresztnév;E-mail;Cantemus Vegyeskar;Pro Musica\nTeszt;Elek;nem-email;igen;nem\n'), 'x.csv');
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /2\. sor: Érvénytelen e-mail-cím/);
});

test('események importja a sablonból (piszkozatként, koncert a főpróbához kötve)', async () => {
  const result = await importEventsTable(fs.readFileSync('templates/esemenyek_import_sablon.xlsx'), 'esemenyek.xlsx');
  assert.deepEqual(result.errors, []);
  assert.equal(result.created, 4);
  const rows = result.ids.map(getEventRow);
  assert.ok(rows.every((r) => r.status === 'draft'));
  const concert = rows.find((r) => r.type === 'koncert');
  const dr = rows.find((r) => r.type === 'foproba');
  assert.equal(concert.dress_rehearsal_id, dr.id);
  assert.equal(rows.find((r) => r.type === 'utazas').is_tour, 1);
});

test('Google Naptár (.ics) import ismétlődő próbával', async () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Budapest',
    'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:proba-123@google.com', 'DTSTART;TZID=Europe/Budapest:20261103T180000', 'DTEND;TZID=Europe/Budapest:20261103T210000',
    'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Kórus próba', 'LOCATION:Példa utca 1.\\, Nyíregyháza', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:koncert-9@google.com', 'DTSTART;TZID=Europe/Budapest:20261220T190000', 'SUMMARY:Karácsonyi koncert', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const opts = { choirs: ['promusica'], from: '2026-11-01', to: '2027-01-31' };
  const result = await importIcs(ics, opts);
  assert.deepEqual(result.errors, []);
  assert.equal(result.created, 5);
  const rows = result.ids.map(getEventRow);
  const proba = rows.filter((r) => r.type === 'proba');
  assert.deepEqual(proba.map((r) => `${r.date} ${r.start_time}`), ['2026-11-03 18:00', '2026-11-10 18:00', '2026-11-17 18:00', '2026-11-24 18:00']);
  assert.equal(proba[0].address, 'Példa utca 1., Nyíregyháza');
  assert.equal(rows.find((r) => r.type === 'koncert').name, 'Karácsonyi koncert');
  // Újraimportáláskor nincs duplikáció.
  const again = await importIcs(ics, opts);
  assert.equal(again.created, 0);
  assert.equal(again.skipped, 5);
});
