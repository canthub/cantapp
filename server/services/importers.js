import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import ical from 'node-ical';
import { DateTime } from 'luxon';
import { createEvent, saveMember, setMemberActive, listMembers } from '../models.js';
import { getDb, tx } from '../db.js';
import { TZ, defaultDeadlineDate } from './time.js';
import { config } from '../config.js';

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
  const seen = new Set();
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
        const { created } = saveMember({
          lastName,
          firstName,
          email,
          phone: String(pick(row, 'Telefon', 'Telefonszám', 'Mobil')),
          voicePart: String(pick(row, 'Szólam')),
          isAdmin: parseBool(pick(row, 'Admin', 'Adminisztrátor')),
          choirs,
          active: true,
        });
        seen.add(email);
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

export async function importEventsTable(buffer, filename, { defaultChoirs = [], deadlineDaysBefore = config.defaultDeadlineDays } = {}) {
  const rows = await readTable(buffer, filename);
  const result = { created: 0, skipped: 0, errors: [], ids: [] };
  // A sorrend számít: a főpróbák előbb kerüljenek be, hogy a koncertek hozzájuk kapcsolódhassanak.
  const parsed = rows.map((row, i) => ({ row, line: i + 2, type: parseEventType(pick(row, 'Típus', 'Esemény típusa')) }));
  parsed.sort((a, b) => (a.type === 'koncert') - (b.type === 'koncert'));
  tx(() => {
    for (const { row, line, type } of parsed) {
      try {
        const date = parseDate(pick(row, 'Dátum', 'Nap'));
        const choirsCell = pick(row, 'Énekkar', 'Kórus', 'Melyik énekkar');
        const choirs = choirsCell ? parseChoirs(choirsCell) : defaultChoirs;
        const deadlineCell = pick(row, 'Visszajelzési határidő', 'Határidő');
        const id = createEvent({
          name: pick(row, 'Esemény neve', 'Név', 'Esemény', 'Megnevezés'),
          type,
          date,
          startTime: parseTime(pick(row, 'Kezdés', 'Időpont', 'Kezdési idő', 'Kezdés időpontja')),
          endTime: parseTime(pick(row, 'Befejezés', 'Vége')),
          country: pick(row, 'Ország'),
          city: pick(row, 'Város', 'Település'),
          address: pick(row, 'Cím', 'Utca, házszám'),
          venue: pick(row, 'Épület', 'Épület neve', 'Helyszín'),
          isTour: parseBool(pick(row, 'Turné', 'Koncertturné')),
          deadlineDate: deadlineCell ? parseDate(deadlineCell) : (date ? defaultDeadlineDate(parseDate(date), deadlineDaysBefore) : ''),
          notes: pick(row, 'Megjegyzés', 'Leírás'),
          choirs,
        }, { source: 'import' });
        result.created++;
        result.ids.push(id);
      } catch (err) {
        result.errors.push(`${line}. sor: ${err.message}`);
      }
    }
  });
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

export async function importIcs(text, { choirs, from, to, deadlineDaysBefore = config.defaultDeadlineDays, defaultType = 'proba' }) {
  if (!choirs?.length) throw Object.assign(new Error('Válaszd ki, melyik énekkar eseményei ezek!'), { status: 400 });
  let data;
  try {
    data = ical.sync.parseICS(text);
  } catch {
    throw Object.assign(new Error('A fájl nem érvényes naptár (.ics).'), { status: 400 });
  }
  const fromDate = from ? DateTime.fromISO(from, { zone: TZ }).startOf('day').toJSDate() : new Date();
  const toDate = to ? DateTime.fromISO(to, { zone: TZ }).endOf('day').toJSDate() : DateTime.now().plus({ months: 12 }).toJSDate();
  const result = { created: 0, skipped: 0, errors: [], ids: [] };
  const existsStmt = getDb().prepare('SELECT 1 FROM events WHERE external_uid = ?');

  const instances = [];
  for (const item of Object.values(data)) {
    if (item.type !== 'VEVENT' || item.status === 'CANCELLED') continue;
    for (const inst of ical.expandRecurringEvent(item, { from: fromDate, to: toDate })) instances.push(inst);
  }
  instances.sort((a, b) => a.start - b.start);
  // A főpróbák előbb, hogy a koncertek hozzájuk kapcsolódhassanak.
  instances.sort((a, b) => (parseEventType(paramText(a.summary)) === 'koncert') - (parseEventType(paramText(b.summary)) === 'koncert'));

  tx(() => {
    for (const inst of instances) {
      const name = paramText(inst.summary) || 'Névtelen esemény';
      const start = DateTime.fromJSDate(inst.start).setZone(TZ);
      const end = inst.end ? DateTime.fromJSDate(inst.end).setZone(TZ) : null;
      const uid = `ics:${inst.event.uid}:${start.toUTC().toISO()}`;
      if (existsStmt.get(uid)) {
        result.skipped++;
        continue;
      }
      try {
        const date = inst.isFullDay ? DateTime.fromJSDate(inst.start, { zone: 'utc' }).toISODate() : start.toISODate();
        const id = createEvent({
          name,
          type: parseEventType(name) || defaultType,
          date,
          startTime: inst.isFullDay ? '' : start.toFormat('HH:mm'),
          endTime: inst.isFullDay || !end ? '' : end.toFormat('HH:mm'),
          address: paramText(inst.event.location),
          isTour: /turn[eé]/i.test(name),
          deadlineDate: defaultDeadlineDate(date, deadlineDaysBefore),
          notes: paramText(inst.event.description).slice(0, 2000),
          choirs,
        }, { source: 'ics', externalUid: uid });
        result.created++;
        result.ids.push(id);
      } catch (err) {
        result.errors.push(`${name}: ${err.message}`);
      }
    }
  });
  return result;
}
