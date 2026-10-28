import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import ical from 'node-ical';
import { DateTime } from 'luxon';
import {
  createEvent, updateEvent, getEvent, findDuplicateEvent, normalizeEventInput, eligibleMembers, eventStats, saveMember, setMemberActive, listMembers,
} from '../models.js';
import { getDb, tx } from '../db.js';
import { TZ, defaultDeadlineDate } from './time.js';
import { config } from '../config.js';
import { notifyMembers } from './notify.js';
import { changeMessage } from './messages.js';

// ---------------------------------------------------------------- Táblázat beolvasása

const normalizeKey = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function cellToValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellToValue(v.result);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('hyperlink' in v) return String(v.hyperlink).replace(/^mailto:/, '');
  }
  return v;
}

// Sorok objektumként, a fejléc normalizált (ékezet és szóköz nélküli, kisbetűs) neveivel kulcsolva.
export async function readTable(buffer, filename = '') {
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows = [];
    let headers = null;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      for (let i = 1; i <= ws.columnCount; i++) values.push(cellToValue(row.getCell(i).value));
      if (!headers) {
        headers = values.map(normalizeKey);
        return;
      }
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = values[i]; });
      rows.push(obj);
    });
    return rows.filter((r) => Object.values(r).some((v) => String(v).trim() !== ''));
  }
  if (/\.xls$/i.test(filename)) throw Object.assign(new Error('A régi .xls formátum nem támogatott. Mentsd el .xlsx vagy .csv formátumban!'), { status: 400 });
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', transformHeader: normalizeKey });
  return parsed.data;
}

const pick = (row, ...keys) => {
  for (const k of keys) {
    const v = row[normalizeKey(k)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
};

const pad = (n) => String(n).padStart(2, '0');

// Excel-dátum (UTC-ként tárolt falióra), „2026-11-03”, „2026.11.03.”, „2026. 11. 03.”, „03.11.2026”.
export function parseDate(v) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return s;
}

export function parseTime(v) {
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === 'number' && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  const s = String(v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})(?:[:.h]\s*(\d{2}))?/);
  return m ? `${pad(m[1])}:${m[2] || '00'}` : s;
}

export function parseBool(v) {
  return ['igen', 'i', 'x', '1', 'true', 'yes', 'y', 'van', 'tag'].includes(normalizeKey(v));
}

export function parseChoirs(v) {
  const s = normalizeKey(v);
  if (!s) return [];
  if (/mindket|mindketto|both|osszes|mind/.test(s)) return ['cantemus', 'promusica'];
  const out = [];
  if (s.includes('cantemus') || s.includes('vegyeskar')) out.push('cantemus');
  if (s.includes('promusica')) out.push('promusica');
  return out;
}

export function parseEventType(v) {
  const s = normalizeKey(v);
  if (s.includes('foproba')) return 'foproba';
  if (s.includes('proba')) return 'proba';
  if (s.includes('koncert') || s.includes('hangverseny')) return 'koncert';
  if (s.includes('utazas') || s.includes('indulas')) return 'utazas';
  return '';
}

// ---------------------------------------------------------------- Tagok importja

export async function importMembers(buffer, filename, { deactivateMissing = false } = {}) {
  const rows = await readTable(buffer, filename);
  const result = { created: 0, updated: 0, deactivated: 0, errors: [] };
  const seen = new Map(); // e-mail → sor száma
  tx(() => {
    rows.forEach((row, i) => {
      const line = i + 2;
      try {
        let lastName = String(pick(row, 'Vezetéknév', 'vezeteknev', 'Családnév')).trim();
        let firstName = String(pick(row, 'Keresztnév', 'Utónév')).trim();
        if (!lastName && !firstName) {
          const full = String(pick(row, 'Név', 'Teljes név')).trim().split(/\s+/);
          lastName = full.shift() || '';
          firstName = full.join(' ');
        }
        const choirs = [];
        if (parseBool(pick(row, 'Cantemus Vegyeskar', 'Cantemus'))) choirs.push('cantemus');
        if (parseBool(pick(row, 'Pro Musica', 'ProMusica'))) choirs.push('promusica');
        for (const c of parseChoirs(pick(row, 'Énekkar', 'Kórus', 'Énekkarok'))) if (!choirs.includes(c)) choirs.push(c);
        const email = String(pick(row, 'E-mail', 'Email', 'E-mail cím', 'Emailcím')).trim().toLowerCase();
        if (email && seen.has(email)) {
          throw new Error(`ez az e-mail-cím (${email}) már szerepel a táblázat ${seen.get(email)}. sorában – a sor kimaradt.`);
        }
        const { created } = saveMember({
          lastName,
          firstName,
          email,
          phone: String(pick(row, 'Telefon', 'Telefonszám', 'Mobil')),
          voicePart: String(pick(row, 'Szólam')),
          postalCode: String(pick(row, 'Irányítószám', 'Irsz')),
          homeCity: String(pick(row, 'Lakóhely (település)', 'Lakóhely', 'Település', 'Város')),
          // Üres Admin cella: a meglévő jogosultság marad; az ADMIN_EMAILS címek mindig adminok.
          isAdmin: config.adminEmails.includes(email) || (pick(row, 'Admin', 'Adminisztrátor') === ''
            ? Boolean(getDb().prepare('SELECT is_admin FROM members WHERE email = ?').get(email)?.is_admin)
            : parseBool(pick(row, 'Admin', 'Adminisztrátor'))),
          choirs,
          active: true,
        });
        seen.set(email, line);
        result[created ? 'created' : 'updated']++;
      } catch (err) {
        result.errors.push(`${line}. sor: ${err.message}`);
      }
    });
    if (deactivateMissing && result.errors.length === 0) {
      for (const m of listMembers({ includeInactive: false })) {
        if (!seen.has(m.email) && !m.isAdmin) {
          setMemberActive(m.id, false);
          result.deactivated++;
        }
      }
    }
  });
  return result;
}

// ---------------------------------------------------------------- Események importja (táblázat)

const sameEvent = (a, b) => a.date === b.date && a.startTime === b.startTime
  && a.name.toLowerCase().replace(/\s+/g, ' ') === b.name.toLowerCase().replace(/\s+/g, ' ')
  && a.choirs.some((c) => b.choirs.includes(c));

export async function importEventsTable(buffer, filename, { defaultChoirs = [], deadlineDaysBefore = config.defaultDeadlineDays } = {}) {
  const rows = await readTable(buffer, filename);
  const result = { created: 0, skipped: 0, skippedItems: [], errors: [], ids: [] };
  // A sorrend számít: a főpróbák előbb kerüljenek be, hogy a koncertek hozzájuk kapcsolódhassanak.
  const parsed = rows.map((row, i) => ({ row, line: i + 2, type: parseEventType(pick(row, 'Típus', 'Esemény típusa')) }));
  const inFile = []; // { e, line } – a fájlon belüli ismétlődések felismeréséhez
  parsed.sort((a, b) => (a.type === 'koncert') - (b.type === 'koncert'));
  tx(() => {
    for (const { row, line, type } of parsed) {
      try {
        const date = parseDate(pick(row, 'Dátum', 'Nap'));
        const choirsCell = pick(row, 'Énekkar', 'Kórus', 'Melyik énekkar');
        const choirs = choirsCell ? parseChoirs(choirsCell) : defaultChoirs;
        const deadlineCell = pick(row, 'Visszajelzési határidő', 'Határidő');
        const input = {
          name: pick(row, 'Esemény neve', 'Név', 'Esemény', 'Megnevezés'),
          type,
          date,
          startTime: parseTime(pick(row, 'Kezdés', 'Időpont', 'Kezdési idő', 'Kezdés időpontja')),
          endTime: parseTime(pick(row, 'Befejezés', 'Vége')),
          endDate: pick(row, 'Utolsó nap', 'Befejezés dátuma', 'Záró dátum') ? parseDate(pick(row, 'Utolsó nap', 'Befejezés dátuma', 'Záró dátum')) : '',
          country: pick(row, 'Ország'),
          city: pick(row, 'Város', 'Település'),
          address: pick(row, 'Cím', 'Utca, házszám'),
          venue: pick(row, 'Épület', 'Épület neve', 'Helyszín'),
          isTour: parseBool(pick(row, 'Turné', 'Koncertturné')),
          deadlineDate: deadlineCell ? parseDate(deadlineCell) : (date ? defaultDeadlineDate(parseDate(date), deadlineDaysBefore) : ''),
          notes: pick(row, 'Megjegyzés', 'Leírás'),
          choirs,
          // Üresen hagyva: ha lehetséges (Nyíregyházán kívüli, több napos esemény), engedélyezett.
          accommodation: pick(row, 'Szálláskérés', 'Szállás') ? parseBool(pick(row, 'Szálláskérés', 'Szállás')) : true,
        };
        const e = normalizeEventInput(input);
        const label = `„${e.name}” (${e.date}${e.startTime ? ` ${e.startTime}` : ''})`;
        const twin = inFile.find((x) => sameEvent(x.e, e));
        if (twin) {
          result.skipped++;
          result.skippedItems.push(`${line}. sor: ${label} már szerepel a táblázat ${twin.line}. sorában – kihagyva.`);
          continue;
        }
        inFile.push({ e, line });
        if (findDuplicateEvent(e)) {
          result.skipped++;
          result.skippedItems.push(`${line}. sor: ${label} már létezik az appban – kihagyva.`);
          continue;
        }
        const id = createEvent(input, { source: 'import' });
        result.created++;
        result.ids.push(id);
      } catch (err) {
        result.errors.push(`${line}. sor: ${err.message}`);
      }
    }
  });
  // A koncertek feldolgozása a végére kerül, ezért az üzeneteket sorszám szerint rendezzük.
  const byLine = (a, b) => parseInt(a, 10) - parseInt(b, 10);
  result.skippedItems.sort(byLine);
  result.errors.sort(byLine);
  return result;
}

// ---------------------------------------------------------------- Google Naptár / iCal import

export async function fetchIcs(url) {
  const clean = url.trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\//i.test(clean)) throw Object.assign(new Error('Csak https:// kezdetű naptárcím adható meg.'), { status: 400 });
  const res = await fetch(clean, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw Object.assign(new Error(`A naptár nem tölthető le (HTTP ${res.status}).`), { status: 400 });
  return res.text();
}

const paramText = (v) => (v && typeof v === 'object' && 'val' in v ? String(v.val) : String(v ?? '')).trim();

// Naptárból szinkronizált mezők. Újraimportáláskor csak az íródik felül, ami a naptárban változott
// az előző import óta – így az appban kézzel pontosított adatok (pl. épület, típus, határidő) megmaradnak.
const SYNC_FIELDS = ['name', 'date', 'endDate', 'startTime', 'endTime', 'address', 'notes'];

// Stabil azonosító: egyszeri eseménynél a naptári UID, ismétlődőnél UID + az alkalom eredeti napja.
// Így az áthelyezett (vagy időpontot váltó) alkalom a meglévő eseményt frissíti, nem újat hoz létre.
function instanceUid(inst) {
  if (!inst.isRecurring) return `ics:${inst.event.uid}`;
  const original = inst.event.recurrenceid || inst.start;
  return `ics:${inst.event.uid}:${DateTime.fromJSDate(new Date(original)).setZone(TZ).toISODate()}`;
}

function calendarValues(inst) {
  const start = DateTime.fromJSDate(inst.start).setZone(TZ);
  const end = inst.end ? DateTime.fromJSDate(inst.end).setZone(TZ) : null;
  const date = inst.isFullDay ? DateTime.fromJSDate(inst.start, { zone: 'utc' }).toISODate() : start.toISODate();
  // Az egész napos esemény vége a naptárban kizárólagos (a következő nap), ezért egy napot visszalépünk.
  let endDate = '';
  if (end) {
    const last = inst.isFullDay ? DateTime.fromJSDate(inst.end, { zone: 'utc' }).minus({ days: 1 }).toISODate() : end.toISODate();
    if (last > date) endDate = last;
  }
  return {
    name: paramText(inst.summary) || 'Névtelen esemény',
    date,
    endDate,
    startTime: inst.isFullDay ? '' : start.toFormat('HH:mm'),
    endTime: inst.isFullDay || !end ? '' : end.toFormat('HH:mm'),
    address: paramText(inst.event.location),
    notes: paramText(inst.event.description).slice(0, 2000),
  };
}

// Meglévő, naptárból importált esemény frissítése. Visszaadja a változott mezőket (üres tömb, ha nincs változás).
function syncFromCalendar(row, cal) {
  const current = getEvent(row.id);
  const previous = row.external_data ? JSON.parse(row.external_data) : current;
  const changes = {};
  for (const f of SYNC_FIELDS) {
    if (previous[f] !== cal[f] && current[f] !== cal[f]) changes[f] = cal[f];
  }
  getDb().prepare('UPDATE events SET external_data = ? WHERE id = ?').run(JSON.stringify(cal), row.id);
  if (Object.keys(changes).length === 0) return { changed: [] };
  const input = { ...current, ...changes };
  // Ha az esemény napja eltolódott, a határidő is ugyanannyival tolódik.
  if (changes.date) {
    const shift = DateTime.fromISO(changes.date).diff(DateTime.fromISO(current.date), 'days').days;
    input.deadlineDate = DateTime.fromISO(current.deadlineDate).plus({ days: shift }).toISODate();
  }
  const { importantChange } = updateEvent(row.id, input);
  return { changed: Object.keys(changes), importantChange };
}

const FIELD_LABELS = { name: 'név', date: 'dátum', endDate: 'utolsó nap', startTime: 'kezdés', endTime: 'befejezés', address: 'helyszín', notes: 'leírás' };

const isCancelled = (inst) => inst.event.status === 'CANCELLED';

// A naptár azonosítója: a naptár neve (Google mindig megadja), ennek hiányában a letöltési cím.
// Csak az ugyanebből a naptárból származó eseményeket tekintjük „törölt”-nek, ha eltűnnek belőle.
function calendarSourceKey(data, url) {
  const name = paramText(Object.values(data).find((x) => x.type === 'VCALENDAR')?.['WR-CALNAME']);
  if (name) return `calname:${name}`;
  if (url) return `url:${crypto.createHash('sha256').update(url.trim()).digest('hex')}`;
  return null;
}

// Az import időszakába eső, ebből a naptárból korábban importált, de a naptárból azóta törölt
// (vagy ott lemondott) események. Ezekről az admin dönt: lemondja / törli, vagy megtartja.
function findMissingEvents(data, sourceKey, fromDate, toDate) {
  const year = 365 * 86400000;
  const live = new Set();
  for (const item of Object.values(data)) {
    if (item.type !== 'VEVENT' || item.status === 'CANCELLED') continue;
    // Széles ablak: a naptárban messzire áthelyezett alkalom se számítson töröltnek.
    const wide = { from: new Date(fromDate.getTime() - year), to: new Date(toDate.getTime() + year) };
    for (const inst of ical.expandRecurringEvent(item, wide)) if (!isCancelled(inst)) live.add(instanceUid(inst));
  }
  return getDb()
    .prepare(`SELECT * FROM events WHERE external_source = ? AND status != 'cancelled' AND starts_at >= ? AND starts_at <= ? ORDER BY starts_at`)
    .all(sourceKey, fromDate.toISOString(), toDate.toISOString())
    .filter((r) => !live.has(r.external_uid))
    .map((r) => {
      const stats = eventStats(r.id);
      return { id: r.id, name: r.name, date: r.date, startTime: r.start_time, status: r.status, responded: stats.total - stats.none };
    });
}

export async function importIcs(text, { choirs, from, to, url = null, deadlineDaysBefore = config.defaultDeadlineDays, defaultType = 'proba' }) {
  if (!choirs?.length) throw Object.assign(new Error('Válaszd ki, melyik énekkar eseményei ezek!'), { status: 400 });
  let data;
  try {
    data = ical.sync.parseICS(text);
  } catch {
    throw Object.assign(new Error('A fájl nem érvényes naptár (.ics).'), { status: 400 });
  }
  const fromDate = from ? DateTime.fromISO(from, { zone: TZ }).startOf('day').toJSDate() : new Date();
  const toDate = to ? DateTime.fromISO(to, { zone: TZ }).endOf('day').toJSDate() : DateTime.now().plus({ months: 12 }).toJSDate();
  const sourceKey = calendarSourceKey(data, url);
  const result = {
    created: 0, updated: 0, skipped: 0, notified: 0, updatedItems: [], skippedItems: [], errors: [], ids: [], missing: [], canDetectMissing: Boolean(sourceKey),
  };
  const byUid = getDb().prepare('SELECT * FROM events WHERE external_uid = ?');
  const toNotify = [];

  const instances = [];
  for (const item of Object.values(data)) {
    if (item.type !== 'VEVENT' || item.status === 'CANCELLED') continue;
    // Az ismétlődő esemény egyetlen lemondott alkalmát sem importáljuk.
    for (const inst of ical.expandRecurringEvent(item, { from: fromDate, to: toDate })) if (!isCancelled(inst)) instances.push(inst);
  }
  instances.sort((a, b) => a.start - b.start);
  // A főpróbák előbb, hogy a koncertek hozzájuk kapcsolódhassanak.
  instances.sort((a, b) => (parseEventType(paramText(a.summary)) === 'koncert') - (parseEventType(paramText(b.summary)) === 'koncert'));

  tx(() => {
    for (const inst of instances) {
      const cal = calendarValues(inst);
      const uid = instanceUid(inst);
      const label = `„${cal.name}” (${cal.date}${cal.startTime ? ` ${cal.startTime}` : ''})`;
      try {
        const existing = byUid.get(uid);
        if (existing && sourceKey && existing.external_source !== sourceKey) {
          getDb().prepare('UPDATE events SET external_source = ? WHERE id = ?').run(sourceKey, existing.id);
        }
        if (existing) {
          const { changed, importantChange } = syncFromCalendar(existing, cal);
          if (changed.length === 0) {
            result.skipped++;
            continue;
          }
          result.updated++;
          result.updatedItems.push(`${label}: módosult (${changed.map((f) => FIELD_LABELS[f]).join(', ')})`);
          if (importantChange && existing.status === 'published') toNotify.push(existing.id);
          continue;
        }
        // Kézzel vagy táblázatból már felvett ugyanilyen esemény: nem duplikáljuk, hanem összekötjük a naptárral.
        const twin = findDuplicateEvent({ ...cal, choirs });
        if (twin) {
          if (!twin.external_uid) {
            getDb().prepare('UPDATE events SET external_uid = ?, external_data = ?, external_source = ? WHERE id = ?').run(uid, JSON.stringify(cal), sourceKey, twin.id);
          }
          result.skipped++;
          result.skippedItems.push(`${label} már létezik az appban – kihagyva.`);
          continue;
        }
        const id = createEvent({
          ...cal,
          type: parseEventType(cal.name) || defaultType,
          isTour: /turn[eé]/i.test(cal.name),
          deadlineDate: defaultDeadlineDate(cal.date, deadlineDaysBefore),
          choirs,
        }, { source: 'ics', externalUid: uid, externalData: cal, externalSource: sourceKey });
        result.created++;
        result.ids.push(id);
      } catch (err) {
        result.errors.push(`${label}: ${err.message}`);
      }
    }
    if (sourceKey) result.missing = findMissingEvents(data, sourceKey, fromDate, toDate);
  });

  // A már közzétett események időpont- vagy helyszínváltozásáról a tagok értesítést kapnak.
  for (const id of toNotify) {
    const ev = getEvent(id);
    result.notified += await notifyMembers(eligibleMembers(id).map((m) => m.id), { ...changeMessage(ev), eventId: id });
  }
  return result;
}
