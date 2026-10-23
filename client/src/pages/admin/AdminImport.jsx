import { useState } from 'react';
import { api, toast } from '../../api.js';
import { navigate } from '../../router.js';
import { CHOIRS, EVENT_TYPES } from '../../../../shared/constants.js';
import { TopBar } from '../../components/ui.jsx';
import { AdminNav } from './AdminEvents.jsx';
import { todayIso } from '../../util.js';

function ChoirPicker({ value, onChange }) {
  const toggle = (c) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return Object.entries(CHOIRS).map(([k, v]) => (
    <label key={k} className="check"><input type="checkbox" checked={value.includes(k)} onChange={() => toggle(k)} />{v}</label>
  ));
}

function Result({ result }) {
  if (!result) return null;
  return (
    <div className={`notice ${result.errors.length ? 'warn' : 'ok'}`}>
      ✔ Létrehozva: <b>{result.created}</b> esemény (piszkozatként)
      {result.updated ? <> · Frissítve: <b>{result.updated}</b></> : null}
      {result.skipped ? <> · Kihagyva, mert már létezik: <b>{result.skipped}</b></> : null}
      {result.notified ? <div style={{ marginTop: 6 }}>A módosult, már közzétett eseményekről {result.notified} értesítés ment ki a tagoknak.</div> : null}
      {result.updatedItems?.length > 0 && <><div style={{ marginTop: 6 }}>A naptárban módosult események:</div><ul className="result-list">{result.updatedItems.map((e) => <li key={e}>{e}</li>)}</ul></>}
      {result.skippedItems?.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary>Kihagyott sorok ({result.skippedItems.length})</summary>
          <ul className="result-list">{result.skippedItems.map((e) => <li key={e}>{e}</li>)}</ul>
        </details>
      )}
      {result.errors.length > 0 && <><div style={{ marginTop: 6 }}>Hibás sorok (ezek kimaradtak):</div><ul className="result-list">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul></>}
      {result.created > 0 && <div style={{ marginTop: 8 }}><button className="btn small" onClick={() => navigate('/admin')}>Piszkozatok ellenőrzése és közzététele →</button></div>}
    </div>
  );
}

export default function AdminImport() {
  // Táblázat
  const [file, setFile] = useState(null);
  const [tableChoirs, setTableChoirs] = useState([]);
  const [tableDays, setTableDays] = useState(7);
  const [tableResult, setTableResult] = useState(null);
  // Naptár
  const [icsMode, setIcsMode] = useState('url');
  const [icsUrl, setIcsUrl] = useState('');
  const [icsFile, setIcsFile] = useState(null);
  const [icsChoirs, setIcsChoirs] = useState([]);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState('');
  const [icsDays, setIcsDays] = useState(7);
  const [defaultType, setDefaultType] = useState('proba');
  const [icsResult, setIcsResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const importTable = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('choirs', tableChoirs.join(','));
      form.append('deadlineDaysBefore', String(tableDays));
      setTableResult(await api('/admin/import/events', { method: 'POST', form }));
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const importCalendar = async (e) => {
    e.preventDefault();
    if (icsChoirs.length === 0) return toast('Válaszd ki az énekkart!', 'err');
    setBusy(true);
    try {
      const form = new FormData();
      if (icsMode === 'file') form.append('file', icsFile);
      else form.append('url', icsUrl);
      form.append('choirs', icsChoirs.join(','));
      form.append('from', from);
      if (to) form.append('to', to);
      form.append('deadlineDaysBefore', String(icsDays));
      form.append('defaultType', defaultType);
      setIcsResult(await api('/admin/import/ics', { method: 'POST', form }));
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar title="Admin" />
      <div className="page">
        <AdminNav active="/admin/import" />

        <div className="card">
          <h2>📊 Események importálása táblázatból</h2>
          <p className="small">Töltsd le a sablont, töltsd ki (egy sor = egy esemény), majd töltsd fel. Az események <b>piszkozatként</b> jönnek létre, így közzététel előtt még ellenőrizheted őket. Ha egy esemény (ugyanaz a név, nap, kezdés és kórus) már létezik, a sor kimarad – így ugyanaz a táblázat kétszer feltöltve sem okoz duplikációt.</p>
          <div className="btnrow">
            <a className="btn small" href="/api/admin/templates/esemenyek-xlsx">⬇️ Sablon (Excel)</a>
            <a className="btn small" href="/api/admin/templates/esemenyek-csv">⬇️ Sablon (CSV)</a>
          </div>
          <form onSubmit={importTable}>
            <label className="field"><span>Kitöltött táblázat (.xlsx vagy .csv)</span><input type="file" accept=".xlsx,.csv" required onChange={(e) => setFile(e.target.files[0])} /></label>
            <p className="hint" style={{ marginBottom: 6 }}>Énekkar, ha a táblázatban nincs kitöltve:</p>
            <ChoirPicker value={tableChoirs} onChange={setTableChoirs} />
            <label className="field"><span>Határidő, ha nincs megadva: ennyi nappal az esemény előtt</span><input type="number" min={0} max={90} value={tableDays} onChange={(e) => setTableDays(e.target.value)} /></label>
            <button className="btn primary block" disabled={busy || !file}>Importálás</button>
          </form>
          <Result result={tableResult} />
        </div>

        <div className="card">
          <h2>📆 Importálás Google Naptárból</h2>
          <div className="tabs">
            <button className={icsMode === 'url' ? 'active' : ''} onClick={() => setIcsMode('url')}>Naptár címe (iCal)</button>
            <button className={icsMode === 'file' ? 'active' : ''} onClick={() => setIcsMode('file')}>.ics fájl</button>
          </div>
          {icsMode === 'url' ? (
            <details className="small" style={{ marginBottom: 12 }}>
              <summary>Hol találom a naptár címét?</summary>
              <ol className="result-list">
                <li>Számítógépen nyisd meg a Google Naptárat.</li>
                <li>Bal oldalt a naptár neve melletti <b>⋮</b> → <b>Beállítások és megosztás</b>.</li>
                <li>Görgess le a <b>„Naptár integrálása”</b> részhez, és másold ki a <b>„Titkos cím iCal formátumban”</b> mezőt.</li>
              </ol>
            </details>
          ) : (
            <details className="small" style={{ marginBottom: 12 }}>
              <summary>Hogyan exportálok .ics fájlt?</summary>
              <ol className="result-list">
                <li>Google Naptár → naptár neve melletti <b>⋮</b> → <b>Beállítások és megosztás</b>.</li>
                <li><b>Naptár exportálása</b> – egy .zip fájl töltődik le, abban van az .ics fájl.</li>
              </ol>
            </details>
          )}
          <form onSubmit={importCalendar}>
            {icsMode === 'url'
              ? <label className="field"><span>Titkos cím iCal formátumban</span><input type="url" required value={icsUrl} onChange={(e) => setIcsUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" /></label>
              : <label className="field"><span>.ics fájl</span><input type="file" accept=".ics,text/calendar" required onChange={(e) => setIcsFile(e.target.files[0])} /></label>}
            <p className="hint" style={{ marginBottom: 6 }}>Melyik énekkar eseményei ezek? *</p>
            <ChoirPicker value={icsChoirs} onChange={setIcsChoirs} />
            <div className="grid2">
              <label className="field"><span>Ettől</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="field"><span>Eddig (üres: 1 év)</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
            <div className="grid2">
              <label className="field"><span>Típus, ha a névből nem derül ki</span>
                <select value={defaultType} onChange={(e) => setDefaultType(e.target.value)}>{Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="field"><span>Határidő: nappal előtte</span><input type="number" min={0} max={90} value={icsDays} onChange={(e) => setIcsDays(e.target.value)} /></label>
            </div>
            <p className="hint">Az esemény típusát a névből ismerjük fel („főpróba”, „próba”, „koncert”, „utazás”). Az ismétlődő események (pl. heti próba) alkalmanként külön eseményként jönnek létre. Az import többször is futtatható: a már beimportált eseményeket nem duplikálja, a naptárban azóta áthelyezett vagy módosított eseményeket pedig frissíti (a közzétett eseményeknél a tagok értesítést kapnak).</p>
            <button className="btn primary block" disabled={busy}>Importálás</button>
          </form>
          <Result result={icsResult} />
        </div>
      </div>
    </>
  );
}
