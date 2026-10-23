// Import-sablonok (xlsx + csv) előállítása a templates/ mappába: npm run templates
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('templates');
fs.mkdirSync(OUT, { recursive: true });

const templates = {
  tagok_import_sablon: {
    sheet: 'Tagok',
    headers: ['Vezetéknév', 'Keresztnév', 'E-mail', 'Telefon', 'Szólam', 'Irányítószám', 'Lakóhely (település)', 'Cantemus Vegyeskar', 'Pro Musica', 'Admin'],
    widths: [18, 18, 32, 18, 14, 13, 22, 20, 14, 10],
    rows: [
      ['Kovács', 'Anna', 'kovacs.anna@example.com', '+36 30 123 4567', 'Szoprán 1', '4400', 'Nyíregyháza', 'igen', 'nem', 'nem'],
      ['Nagy', 'Péter', 'nagy.peter@example.com', '+36 20 765 4321', 'Basszus 2', '4300', 'Nyírbátor', 'igen', 'igen', 'nem'],
      ['Szabó', 'Eszter', 'szabo.eszter@example.com', '', 'Alt 1', '', '', 'nem', 'igen', 'nem'],
    ],
    help: [
      'Kitöltési útmutató',
      'Egy sor = egy kórustag. A fejléc sort ne módosítsd!',
      'E-mail: kötelező, ez azonosítja a tagot (újraimportáláskor ez alapján frissül).',
      'Cantemus Vegyeskar / Pro Musica: „igen” vagy „nem”. Aki mindkettőnek tagja, mindkettőhöz „igen”-t írj.',
      'Szólam: szabad szöveg, pl. Szoprán 1, Alt 2, Tenor 1, Basszus 2.',
      'Irányítószám és Lakóhely (település): nem kötelező. Ebből számolja az app, ki lakik közel egy esemény helyszínéhez (pontos utcacímet nem kérünk).',
      'Admin: „igen”, ha a tag kezelheti az eseményeket és a tagokat.',
      'A példasorokat töröld ki importálás előtt!',
    ],
  },
  esemenyek_import_sablon: {
    sheet: 'Események',
    headers: ['Esemény neve', 'Dátum', 'Kezdés', 'Befejezés', 'Típus', 'Énekkar', 'Turné', 'Ország', 'Város', 'Cím', 'Épület', 'Visszajelzési határidő', 'Megjegyzés'],
    widths: [28, 12, 9, 10, 10, 20, 8, 12, 14, 26, 24, 22, 30],
    rows: [
      ['Heti próba', '2026-11-03', '18:00', '21:00', 'próba', 'Cantemus', 'nem', 'Magyarország', 'Nyíregyháza', 'Példa utca 1.', 'Iskola, kórusterem', '2026-10-31', ''],
      ['Adventi koncert – főpróba', '2026-12-05', '15:00', '18:00', 'főpróba', 'mindkettő', 'nem', 'Magyarország', 'Nyíregyháza', 'Példa tér 2.', 'Példa hangversenyterem', '2026-11-25', ''],
      ['Adventi koncert', '2026-12-06', '19:00', '', 'koncert', 'mindkettő', 'nem', 'Magyarország', 'Nyíregyháza', 'Példa tér 2.', 'Példa hangversenyterem', '2026-11-25', 'Fellépő ruha: fekete'],
      ['Indulás Bécsbe', '2027-03-12', '07:00', '', 'utazás', 'Pro Musica', 'igen', 'Magyarország', 'Nyíregyháza', 'Példa utca 1.', 'Iskola, parkoló', '2027-02-20', 'Útlevél kötelező!'],
    ],
    help: [
      'Kitöltési útmutató',
      'Egy sor = egy esemény. A fejléc sort ne módosítsd!',
      'Dátum és határidő: ÉÉÉÉ-HH-NN (pl. 2026-11-03). Idő: ÓÓ:PP (pl. 18:00).',
      'Típus: próba, főpróba, koncert vagy utazás.',
      'Énekkar: Cantemus, Pro Musica vagy mindkettő.',
      'Turné: „igen”, ha az esemény koncertturné része.',
      'Visszajelzési határidő: ha üresen hagyod, az import ablakban megadott számú nappal az esemény előtt lesz.',
      'A koncertek automatikusan a legközelebbi (14 napon belüli) főpróbához kapcsolódnak – ez az appban módosítható.',
      'Az importált események piszkozatként jönnek létre: ellenőrzés után az appban kell közzétenni őket.',
      'A példasorokat töröld ki importálás előtt!',
    ],
  },
};

for (const [name, t] of Object.entries(templates)) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.sheet);
  const header = ws.addRow(t.headers);
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A1F2B' } };
  });
  t.rows.forEach((r) => ws.addRow(r));
  t.widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; ws.getColumn(i + 1).numFmt = '@'; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const help = wb.addWorksheet('Útmutató');
  t.help.forEach((line, i) => { help.addRow([line]).font = i === 0 ? { bold: true, size: 14 } : {}; });
  help.getColumn(1).width = 110;
  await wb.xlsx.writeFile(path.join(OUT, `${name}.xlsx`));

  const csvCell = (v) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [t.headers, ...t.rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  fs.writeFileSync(path.join(OUT, `${name}.csv`), `﻿${csv}\r\n`);
  console.log(`✔ templates/${name}.xlsx, templates/${name}.csv`);
}
