import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { saveMember, createEvent, updateEvent, getEvent, setEventStatus, normalizeUrl } from '../server/models.js';
import { announceMessage } from '../server/services/messages.js';
import { buildMemberCalendar } from '../server/services/calendarFeed.js';
import { importEventsTable } from '../server/services/importers.js';

let anna;
const base = { type: 'proba', date: '2027-02-10', startTime: '18:00', city: 'Nyíregyháza', choirs: ['cantemus'], deadlineDate: '2027-02-05' };

before(() => {
  openDb(':memory:');
  anna = saveMember({ lastName: 'Kovács', firstName: 'Anna', email: 'anna@x.hu', choirs: ['cantemus'] }).id;
});

test('kották linkje: https elé kerül, csak http(s) link fogadható el', () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(' drive.google.com/drive/folders/abc '), 'https://drive.google.com/drive/folders/abc');
  assert.equal(normalizeUrl('https://www.dropbox.com/sh/x?dl=0'), 'https://www.dropbox.com/sh/x?dl=0');
  assert.throws(() => normalizeUrl('javascript:alert(1)'), /Érvénytelen link/);
  assert.throws(() => normalizeUrl('kották'), /Érvénytelen link/);
});

test('a kották linkje az eseménynél, az e-mailben és a naptárban is megjelenik', () => {
  const id = createEvent({ ...base, name: 'Heti próba', scoresUrl: 'drive.google.com/drive/folders/abc' });
  assert.equal(getEvent(id).scoresUrl, 'https://drive.google.com/drive/folders/abc');
  setEventStatus(id, 'published');
  assert.match(announceMessage(getEvent(id)).emailHtml, /<a href="https:\/\/drive\.google\.com\/drive\/folders\/abc"[^>]*>🎼 A tanult művek kottái<\/a>/);
  assert.match(buildMemberCalendar(anna, new Date('2027-01-10T10:00:00Z')).replace(/\r\n /g, ''), /Kották: https:\/\/drive\.google\.com\/drive\/folders\/abc/);

  const { importantChange } = updateEvent(id, { ...getEvent(id), scoresUrl: '' });
  assert.equal(getEvent(id).scoresUrl, '');
  assert.equal(importantChange, false, 'a link módosítása nem időpont/helyszín-változás');
});

test('táblázat import: „Kották linkje” oszlop', async () => {
  const csv = 'Esemény neve;Dátum;Kezdés;Típus;Énekkar;Kották linkje\nPróba;2027-02-17;18:00;próba;Cantemus;https://drive.google.com/x\nRossz;2027-02-18;18:00;próba;Cantemus;nem link\n';
  const r = await importEventsTable(Buffer.from(csv), 'k.csv');
  assert.equal(r.created, 1);
  assert.equal(getEvent(r.ids[0]).scoresUrl, 'https://drive.google.com/x');
  assert.match(r.errors[0], /3\. sor: Érvénytelen link/);
});
