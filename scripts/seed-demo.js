// Demóadatok a kipróbáláshoz: npm run seed  (csak üres adatbázisba tölt!)
import { config } from '../server/config.js';
import { openDb, getDb } from '../server/db.js';
import { saveMember, createEvent, setEventStatus } from '../server/models.js';
import { sendAnnouncements } from '../server/services/scheduler.js';
import { setResponse } from '../server/services/rsvp.js';
import { DateTime } from 'luxon';

openDb(config.dbPath);
if (getDb().prepare('SELECT COUNT(*) AS n FROM events').get().n > 0) {
  console.log('Az adatbázisban már vannak események – a demóadatok nem lettek betöltve.');
  process.exit(0);
}

const day = (n) => DateTime.now().setZone('Europe/Budapest').plus({ days: n }).toISODate();
const admin = saveMember({ lastName: 'Admin', firstName: 'Demó', email: 'admin@example.com', voicePart: 'Tenor 1', choirs: ['cantemus', 'promusica'], isAdmin: true }).id;
const names = [
  ['Kovács', 'Anna', 'Szoprán 1', ['cantemus'], '4400', 'Nyíregyháza'], ['Nagy', 'Péter', 'Basszus 2', ['cantemus', 'promusica'], '4300', 'Nyírbátor'],
  ['Szabó', 'Eszter', 'Alt 1', ['promusica'], '4024', 'Debrecen'], ['Tóth', 'Gábor', 'Tenor 2', ['cantemus'], '4400', 'Nyíregyháza'],
  ['Varga', 'Júlia', 'Szoprán 2', ['cantemus', 'promusica'], '4600', 'Kisvárda'], ['Kiss', 'Bence', 'Basszus 1', ['promusica'], '4400', 'Nyíregyháza'],
  ['Molnár', 'Réka', 'Alt 2', ['cantemus'], '', ''], ['Horváth', 'Dávid', 'Tenor 1', ['promusica'], '4431', 'Nyíregyháza'],
  ['Fekete', 'Lilla', 'Szoprán 1', ['cantemus'], '4600', 'Kisvárda'], ['Balogh', 'Zsófia', 'Szoprán 1', ['cantemus'], '4431', 'Nyíregyháza'],
];
const ids = names.map(([last, first, voice, choirs, postalCode, homeCity], i) => saveMember({
  lastName: last, firstName: first, email: `tag${i + 1}@example.com`, voicePart: voice, choirs, postalCode, homeCity,
}).id);

const place = { country: 'Magyarország', city: 'Nyíregyháza', address: 'Példa utca 1.', venue: 'Kórusterem' };
const hall = { country: 'Magyarország', city: 'Nyíregyháza', address: 'Példa tér 2.', venue: 'Hangversenyterem' };
const ev = (data, publish = true) => {
  const id = createEvent(data);
  if (publish) setEventStatus(id, 'published');
  return id;
};
const p1 = ev({ ...place, name: 'Heti próba', type: 'proba', date: day(4), startTime: '18:00', endTime: '21:00', choirs: ['cantemus'], deadlineDate: day(2) });
const p2 = ev({ ...place, name: 'Pro Musica próba', type: 'proba', date: day(6), startTime: '17:00', endTime: '19:30', choirs: ['promusica'], deadlineDate: day(3) });
const dr = ev({ ...hall, name: 'Adventi koncert – főpróba', type: 'foproba', date: day(20), startTime: '15:00', endTime: '18:00', choirs: ['cantemus', 'promusica'], deadlineDate: day(12) });
const c = ev({ ...hall, name: 'Adventi koncert', type: 'koncert', date: day(21), startTime: '19:00', choirs: ['cantemus', 'promusica'], deadlineDate: day(12), notes: 'Fellépő ruha: fekete. Gyülekező 18:00-kor.' });
ev({ country: 'Ausztria', city: 'Bécs', address: 'Bösendorferstraße 12', venue: 'Musikverein', name: 'Bécsi turné – indulás', type: 'utazas', date: day(45), startTime: '07:00', choirs: ['promusica'], isTour: true, deadlineDate: day(30) });
ev({ ...place, name: 'Tavaszi koncert (tervezet)', type: 'koncert', date: day(120), startTime: '19:00', choirs: ['cantemus'], deadlineDate: day(100) }, false);

for (const id of [p1, p2, dr, c]) await sendAnnouncements(id);
await setResponse(p1, ids[0], 'yes');
await setResponse(p1, ids[1], 'maybe');
await setResponse(dr, ids[0], 'yes');
await setResponse(c, ids[0], 'yes');
await setResponse(dr, ids[4], 'no');
await setResponse(dr, ids[1], 'yes');
console.log(`Demóadatok betöltve. Admin belépés: admin@example.com (tagok: tag1…tag10@example.com) – admin id: ${admin}`);
