import { useState } from 'react';
import { api, toast } from '../../api.js';
import { navigate } from '../../router.js';
import { CHOIRS, EVENT_TYPES, DEFAULT_DEADLINE_DAYS } from '../../../../shared/constants.js';
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
    <div className={`notice ${result.errors.length || result.warnings?.length ? 'warn' : 'ok'}`}>
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
      {result.warnings?.length > 0 && <><div style={{ marginTop: 6 }}>⚠️ Lejárt határidő – ezeket csak a határidő módosítása után lehet közzétenni:</div><ul className="result-list">{result.warnings.map((e) => <li key={e}>{e}</li>)}</ul></>}
      {result.errors.length > 0 && <><div style={{ marginTop: 6 }}>Hibás sorok (ezek kimaradtak):</div><ul className="result-list">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul></>}
      {result.created > 0 && <div style={{ marginTop: 8 }}><button className="btn small" onClick={() => navigate('/admin')}>Piszkozatok ellenőrzése és közzététele →</button></div>}
    </div>
  );
}

// A naptárból azóta törölt (vagy ott lemondott) események: az admin dönti el, mi legyen velük.
function MissingPanel({ result }) {
  const [selected, setSelected] = useState(() => new Set(result.missing.map((m) => m.id)));
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!result.canDetectMissing) {
    return <div className="notice info">Ebben a naptárfájlban nincs naptárnév, ezért a naptárból törölt eseményeket nem tudjuk felismerni. Használd inkább a naptár címét (iCal).</div>;
  }
  if (result.missing.length === 0) return null;
  if (done) {
    return (
      <div className="notice ok">
        Lemondva: <b>{done.cancelled}</b> · Törölve (piszkozat): <b>{done.deleted}</b> · Megtartva: <b>{done.kept}</b>
        {done.notified > 0 && <div style={{ marginTop: 6 }}>{done.notified} tag kapott értesítést a lemondásról.</div>}
      </div>
    );
  }
  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const publishedSelected = result.missing.filter((m) => selected.has(m.id) && m.status === 'published').length;
  const resolve = async () => {
    if (publishedSelected && !confirm(`${publishedSelected} közzétett esemény lemondása? Az érintett tagok értesítést kapnak róla.`)) return;
    setBusy(true);
    try {
      setDone(await api('/admin/import/ics/resolve', {
        method: 'POST',
        body: { cancel: [...selected], keep: result.missing.filter((m) => !selected.has(m.id)).map((m) => m.id) },
      }));
    } catch (err) {
      toast(err.message, 'err');
      setBusy(false);
    }
  };
  return (
    <div className="notice warn">
      <b>{result.missing.length} esemény már nincs benne a naptárban</b> (törölték vagy lemondták). Mi legyen velük?
      <div style={{ margin: '10px 0' }}>
        {result.missing.map((m) => (
          <label key={m.id} className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
            <span>
              <b>{m.name}</b> – {m.date}{m.startTime && ` ${m.startTime}`}
              <span className="small"> · {m.status === 'draft' ? 'piszkozat → törlés' : `közzétett → lemondás${m.responded ? `, ${m.responded} tag már visszajelzett` : ''}`}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="small">A kijelölt piszkozatokat töröljük, a kijelölt közzétett eseményeket lemondjuk (a tagok értesítést kapnak). A ki nem jelölteket megtartjuk, és leválasztjuk a naptárról.</p>
      <button className="btn primary" disabled={busy} onClick={resolve}>Végrehajtás</button>
      <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>Ha most nem döntesz, a következő importnál újra megjelennek.</p>
    </div>
  );
}

export default function AdminImport() {
  // Táblázat
  const [file, setFile] = useState(null);
  const [tableChoirs, setTableChoirs] = useState([]);
  const [tableDays, setTableDays] = useState(DEFAULT_DEADLINE_DAYS);
  const [tableResult, setTableResult] = useState(null);
  // Naptár
  const [icsMode, setIcsMode] = useState('url');
  const [icsUrl, setIcsUrl] = useState('');
  const [icsFile, setIcsFile] = useState(null);
  const [icsChoirs, setIcsChoirs] = useState([]);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState('');
  const [icsDays, setIcsDays] = useState(DEFAULT_DEADLINE_DAYS);
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
      setIcsResult({ ...(await api('/admin/import/ics', { method: 'POST', form })), runId: Date.now() });
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
          <p className="small">Töltsd le a sablont, töltsd ki (egy sor = egy esemény), majd töltsd fel. Az események <b>piszkozatként</b> jönnek létre, így közzététel előtt még ellenőrizheted őket. Ha egy esemény (ugyanaz a név, nap, kezdés és kórus) már létezik, a sor kimarad – így ugyanaz a táblázat kétszer feltöltve sem okoz duplikációt. Ha egy koncertnél a <b>„Van főpróbája”</b> oszlopba „igen” kerül, a főpróbát is létrehozzuk (alapból a koncert előtti napon, ugyanabban az időpontban, 2 órásat), és a koncerthez kapcsoljuk.</p>
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
            <p className="hint">Az esemény típusát a névből ismerjük fel („főpróba”, „próba”, „koncert”, „utazás”). Az ismétlődő események (pl. heti próba) alkalmanként külön eseményként jönnek létre. Az import többször is futtatható: a már beimportált eseményeket nem duplikálja, a naptárban azóta áthelyezett vagy módosított eseményeket frissíti (a közzétett eseményeknél a tagok értesítést kapnak), a naptárból törölteket pedig felajánlja lemondásra.</p>
            <button className="btn primary block" disabled={busy}>Importálás</button>
          </form>
          <Result result={icsResult} />
          {icsResult && <MissingPanel key={icsResult.runId} result={icsResult} />}
        </div>
      </div>
    </>
  );
}
