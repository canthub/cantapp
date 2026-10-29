import ExcelJS from 'exceljs';
import { getEvent, eligibleMembers, responsesByMember, fullName, reportRecipients } from '../models.js';
import { getDb } from '../db.js';
import { CHOIRS, GUEST_LABEL, RESPONSE_REPORT_LABELS, EVENT_STATUSES, compareVoices } from '../../shared/constants.js';
import { formatDateHu, formatIsoHu } from './time.js';
import { sendMail, emailLayout, esc } from './mailer.js';

const STATUS_ORDER = { yes: 0, maybe: 1, no: 2, none: 3 };

export function buildReport(eventId, now = new Date()) {
  const event = getEvent(eventId, now);
  if (!event) throw Object.assign(new Error('Az esemény nem található.'), { status: 404 });
  const responses = responsesByMember(eventId);
  const choirsStmt = getDb().prepare('SELECT choir FROM member_choirs WHERE member_id = ?');
  const rows = eligibleMembers(eventId).map((m) => {
    const r = responses.get(m.id);
    const status = r ? r.status : 'none';
    return {
      memberId: m.id,
      name: fullName(m),
      voicePart: m.voice_part,
      choirs: m.is_guest ? GUEST_LABEL : choirsStmt.all(m.id).map((c) => CHOIRS[c.choir]).join(', '),
      isGuest: Boolean(m.is_guest),
      email: m.email,
      phone: m.phone,
      status,
      statusLabel: RESPONSE_REPORT_LABELS[status],
      respondedAt: r ? r.updated_at : null,
      setByAdmin: Boolean(r?.set_by_admin),
      accommodation: event.accommodation && Boolean(r?.accommodation),
    };
  });
  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || compareVoices(a.voicePart, b.voicePart) || a.name.localeCompare(b.name, 'hu'));

  const summary = { total: rows.length, yes: 0, maybe: 0, no: 0, none: 0, accommodation: rows.filter((r) => r.accommodation).length };
  const byVoice = {};
  // A szólamonkénti összesítő a szokásos szólamsorrendben (S, A, T, B).
  for (const v of [...new Set(rows.map((r) => r.voicePart || 'Nincs megadva'))].sort(compareVoices)) byVoice[v] = { yes: 0, maybe: 0, no: 0, none: 0 };
  for (const r of rows) {
    summary[r.status]++;
    const v = r.voicePart || 'Nincs megadva';
    byVoice[v] ??= { yes: 0, maybe: 0, no: 0, none: 0 };
    byVoice[v][r.status]++;
  }
  return { event, rows, summary, byVoice, generatedAt: new Date(now).toISOString() };
}

function eventInfoLines(ev) {
  const time = ev.startTime ? `${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}` : '';
  return [
    ['Esemény', ev.name],
    ['Típus', ev.typeLabel + (ev.isTour ? ' (koncertturné)' : '')],
    ['Énekkar', ev.choirs.map((c) => CHOIRS[c]).join(', ')],
    ['Időpont', ev.endDate ? `${formatDateHu(ev.date, ev.startTime)} – ${formatDateHu(ev.endDate, ev.endTime)}` : formatDateHu(ev.date, time)],
    ['Helyszín', [ev.venue, ev.address, ev.city, ev.country].filter(Boolean).join(', ') || '–'],
    ['Visszajelzési határidő', formatIsoHu(ev.deadlineAt)],
    ['Állapot', ev.isOpen ? 'Visszajelzés folyamatban' : EVENT_STATUSES[ev.status] + (ev.status === 'published' ? ' – lezárva' : '')],
  ];
}

const summaryLine = (report) => {
  const s = report.summary;
  const room = report.event.accommodation ? ` · Szállást kér: ${s.accommodation}` : '';
  return `Részt vesz: ${s.yes} · Talán: ${s.maybe} · Nem vesz részt: ${s.no} · Nem jelzett vissza: ${s.none} · Összesen: ${s.total}${room}`;
};

// A „Szállást kér” oszlop csak akkor szerepel, ha az eseménynél engedélyezett a szálláskérés.
const tableHeaders = (report) => ['Név', 'Szólam', 'Énekkar', 'E-mail', 'Telefon', 'Visszajelzés', 'Visszajelzés ideje',
  ...(report.event.accommodation ? ['Szállást kér'] : [])];
const rowValues = (report) => (r) => [r.name, r.voicePart, r.choirs, r.email, r.phone, r.statusLabel + (r.setByAdmin ? ' (admin rögzítette)' : ''),
  r.respondedAt ? formatIsoHu(r.respondedAt) : '', ...(report.event.accommodation ? [r.accommodation ? 'igen' : ''] : [])];

export async function reportXlsx(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cantemus Kórus alkalmazás';
  const ws = wb.addWorksheet('Visszajelzések');
  for (const [k, v] of eventInfoLines(report.event)) {
    const row = ws.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
  ws.addRow(['Összesítés', summaryLine(report)]).getCell(1).font = { bold: true };
  ws.addRow(['Riport készült', formatIsoHu(report.generatedAt)]).getCell(1).font = { bold: true };
  ws.addRow([]);
  const header = ws.addRow(tableHeaders(report));
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A1F2B' } };
  });
  const colors = { yes: 'FFD9F2DC', maybe: 'FFFFF2CC', no: 'FFF8D7DA', none: 'FFEDEDED' };
  for (const r of report.rows) {
    const row = ws.addRow(rowValues(report)(r));
    row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors[r.status] } };
  }
  ws.addRow([]);
  ws.addRow(['Szólamonként']).getCell(1).font = { bold: true };
  ws.addRow(['Szólam', 'Részt vesz', 'Talán', 'Nem vesz részt', 'Nem jelzett vissza']).font = { bold: true };
  for (const [voice, c] of Object.entries(report.byVoice)) ws.addRow([voice, c.yes, c.maybe, c.no, c.none]);
  [26, 14, 30, 32, 16, 28, 28, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function reportCsv(report) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [tableHeaders(report), ...report.rows.map(rowValues(report))].map((r) => r.map(cell).join(';'));
  // BOM + pontosvessző: így a magyar Excel helyesen nyitja meg.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function reportHtmlTable(report) {
  const bg = { yes: '#d9f2dc', maybe: '#fff2cc', no: '#f8d7da', none: '#ededed' };
  const info = eventInfoLines(report.event).map(([k, v]) => `<tr><th style="text-align:left;padding:3px 12px 3px 0;color:#555">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const head = tableHeaders(report).map((h) => `<th style="text-align:left;padding:6px;background:#7a1f2b;color:#fff">${esc(h)}</th>`).join('');
  const body = report.rows.map((r) => `<tr>${rowValues(report)(r).map((v, i) => `<td style="padding:6px;border-bottom:1px solid #ddd;${i === 5 ? `background:${bg[r.status]}` : ''}">${esc(v)}</td>`).join('')}</tr>`).join('');
  const voices = Object.entries(report.byVoice).map(([v, c]) => `<tr><td style="padding:4px 8px">${esc(v)}</td><td style="padding:4px 8px">${c.yes}</td><td style="padding:4px 8px">${c.maybe}</td><td style="padding:4px 8px">${c.no}</td><td style="padding:4px 8px">${c.none}</td></tr>`).join('');
  return `<table style="border-collapse:collapse;font-size:14px;margin-bottom:12px">${info}</table>
  <p style="font-weight:bold">${esc(summaryLine(report))}</p>
  <table style="border-collapse:collapse;font-size:13px;width:100%"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <h3 style="margin-top:20px">Szólamonként</h3>
  <table style="border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:4px 8px">Szólam</th><th style="padding:4px 8px">Részt vesz</th><th style="padding:4px 8px">Talán</th><th style="padding:4px 8px">Nem vesz részt</th><th style="padding:4px 8px">Nem jelzett vissza</th></tr></thead><tbody>${voices}</tbody></table>`;
}

export function reportPrintPage(report) {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Riport – ${esc(report.event.name)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#222}h1{font-size:20px;color:#7a1f2b}
  @media print{.no-print{display:none}body{margin:0}} table{page-break-inside:auto} tr{page-break-inside:avoid}
  .no-print button{font-size:16px;padding:10px 18px;background:#7a1f2b;color:#fff;border:0;border-radius:8px;cursor:pointer}</style></head>
  <body><div class="no-print" style="margin-bottom:16px"><button onclick="window.print()">🖨️ Nyomtatás / mentés PDF-be</button></div>
  <h1>Visszajelzések – ${esc(report.event.name)}</h1>
  ${reportHtmlTable(report)}
  <p style="color:#888;font-size:12px;margin-top:24px">Riport készült: ${esc(formatIsoHu(report.generatedAt))}</p></body></html>`;
}

const fileBase = (ev) => `riport_${ev.date}_${ev.name}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
export { fileBase };

export async function emailReport(eventId, recipients = reportRecipients(), now = new Date(), { final = false } = {}) {
  const report = buildReport(eventId, now);
  const ev = report.event;
  const subject = `${final ? 'Végleges riport' : 'Állapotriport'}: ${ev.name} (${ev.date})`;
  await sendMail({
    to: recipients,
    subject,
    text: `${ev.name} – ${summaryLine(report)}\nA részletes táblázat a csatolt Excel-fájlban található.`,
    html: emailLayout({ heading: subject, bodyHtml: reportHtmlTable(report) }),
    attachments: [
      { filename: `${fileBase(ev)}.xlsx`, content: await reportXlsx(report) },
      { filename: `${fileBase(ev)}.csv`, content: reportCsv(report) },
    ],
  });
  return { recipients, summary: report.summary };
}
