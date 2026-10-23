import { useEffect, useState } from 'react';
import { api, toast } from '../../api.js';
import { navigate } from '../../router.js';
import { CHOIRS, EVENT_TYPES } from '../../../../shared/constants.js';
import { TopBar, Spinner } from '../../components/ui.jsx';
import { formatDate } from '../../util.js';

const EMPTY = {
  name: '', type: 'proba', date: '', startTime: '', endTime: '', country: 'Magyarország', city: '', address: '', venue: '',
  isTour: false, deadlineDate: '', deadlineTime: '23:59', dressRehearsalId: '', notes: '', choirs: [],
};

function minusDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function AdminEventForm({ id }) {
  const isNew = !id;
  const [form, setForm] = useState(isNew ? EMPTY : null);
  const [original, setOriginal] = useState(null);
  const [events, setEvents] = useState([]);
  const [notifyChange, setNotifyChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deadlineTouched, setDeadlineTouched] = useState(!isNew);
  const [drTouched, setDrTouched] = useState(!isNew);

  useEffect(() => {
    api('/admin/events').then((d) => setEvents(d.events)).catch(() => {});
    if (!isNew) {
      api(`/admin/events/${id}`).then(({ event: e }) => {
        const f = {
          name: e.name, type: e.type, date: e.date, startTime: e.startTime, endTime: e.endTime, country: e.country, city: e.city,
          address: e.address, venue: e.venue, isTour: e.isTour, deadlineDate: e.deadlineDate, deadlineTime: e.deadlineTime,
          dressRehearsalId: e.dressRehearsalId || '', notes: e.notes, choirs: e.choirs,
        };
        setForm(f);
        setOriginal(e);
      }).catch((err) => setError(err.message));
    }
  }, [id, isNew]);

  // Új eseménynél a határidőt automatikusan 7 nappal az esemény elé állítjuk (amíg kézzel nem módosítják).
  useEffect(() => {
    if (form?.date && !deadlineTouched) setForm((f) => ({ ...f, deadlineDate: minusDays(f.date, 7) }));
  }, [form?.date, deadlineTouched]);

  // Koncertnél a legközelebbi főpróba ajánlása.
  useEffect(() => {
    if (!form || form.type !== 'koncert' || !form.date || form.choirs.length === 0 || drTouched) return;
    api('/admin/events/suggest-dress-rehearsal', { method: 'POST', body: { ...form, id } })
      .then((r) => setForm((f) => ({ ...f, dressRehearsalId: r.id || '' })))
      .catch(() => {});
  }, [form?.type, form?.date, form?.startTime, form?.choirs?.join(), drTouched, id]);

  if (!form) return <><TopBar title="Esemény szerkesztése" back /><div className="page">{error ? <div className="notice err">{error}</div> : <Spinner />}</div></>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggleChoir = (c) => setForm((f) => ({ ...f, choirs: f.choirs.includes(c) ? f.choirs.filter((x) => x !== c) : [...f.choirs, c] }));
  const dressRehearsals = events.filter((e) => e.type === 'foproba' && e.status !== 'cancelled' && String(e.id) !== String(id));
  const isPublished = original?.status === 'published';
  const importantChanged = original && ['date', 'startTime', 'endTime', 'country', 'city', 'address', 'venue'].some((k) => original[k] !== form[k]);

  const save = async (publish) => {
    setBusy(true);
    setError('');
    try {
      const body = { ...form, dressRehearsalId: form.dressRehearsalId || null };
      if (isNew) {
        const res = await api('/admin/events', { method: 'POST', body: { ...body, publish } });
        toast(publish ? 'Esemény közzétéve, az értesítések kimentek.' : 'Esemény elmentve piszkozatként.');
        navigate(`/admin/esemeny/${res.event.id}`);
      } else {
        const res = await api(`/admin/events/${id}`, { method: 'PUT', body: { ...body, notifyChange } });
        toast(res.notified ? `Mentve. ${res.notified} tag kapott értesítést a változásról.` : 'Mentve.');
        navigate(`/admin/esemeny/${id}`);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar title={isNew ? 'Új esemény' : 'Esemény szerkesztése'} back />
      <div className="page">
        <form className="card" onSubmit={(e) => { e.preventDefault(); save(false); }}>
          <label className="field"><span>Esemény neve *</span><input type="text" required value={form.name} onChange={set('name')} placeholder="pl. Adventi koncert" /></label>
          <div className="grid2">
            <label className="field"><span>Típus *</span>
              <select value={form.type} onChange={set('type')}>
                {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field"><span>Dátum *</span><input type="date" required value={form.date} onChange={set('date')} /></label>
          </div>
          <div className="grid2">
            <label className="field"><span>Kezdés</span><input type="time" value={form.startTime} onChange={set('startTime')} /></label>
            <label className="field"><span>Befejezés</span><input type="time" value={form.endTime} onChange={set('endTime')} /></label>
          </div>

          <div className="field">
            <span className="hint" style={{ fontWeight: 600 }}>Melyik énekkar? *</span>
            {Object.entries(CHOIRS).map(([k, v]) => (
              <label key={k} className="check"><input type="checkbox" checked={form.choirs.includes(k)} onChange={() => toggleChoir(k)} />{v}</label>
            ))}
          </div>
          <label className="check" style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--border)' }}><input type="checkbox" checked={form.isTour} onChange={set('isTour')} />Koncertturné része</label>

          <h3 style={{ marginTop: 8 }}>Helyszín</h3>
          <label className="field"><span>Épület neve</span><input type="text" value={form.venue} onChange={set('venue')} placeholder="pl. Művelődési Központ, nagyterem" /></label>
          <label className="field"><span>Cím</span><input type="text" value={form.address} onChange={set('address')} placeholder="utca, házszám" /></label>
          <div className="grid2">
            <label className="field"><span>Város</span><input type="text" value={form.city} onChange={set('city')} /></label>
            <label className="field"><span>Ország</span><input type="text" value={form.country} onChange={set('country')} /></label>
          </div>

          <h3 style={{ marginTop: 8 }}>Visszajelzés</h3>
          <div className="grid2">
            <label className="field"><span>Határidő (nap) *</span><input type="date" required value={form.deadlineDate} onChange={(e) => { setDeadlineTouched(true); set('deadlineDate')(e); }} /></label>
            <label className="field"><span>Határidő (óra)</span><input type="time" value={form.deadlineTime} onChange={set('deadlineTime')} /></label>
          </div>
          {form.date && form.deadlineDate > form.date && <div className="notice warn">A határidő az esemény utánra esik – biztosan jó így?</div>}

          {form.type === 'koncert' && (
            <label className="field"><span>Kapcsolódó főpróba</span>
              <select value={form.dressRehearsalId} onChange={(e) => { setDrTouched(true); set('dressRehearsalId')(e); }}>
                <option value="">– nincs (bárki jelölhet) –</option>
                {dressRehearsals.map((e) => <option key={e.id} value={e.id}>{e.name} – {formatDate(e.date, { weekday: undefined })}</option>)}
              </select>
              <span className="hint">A koncertre csak az jelölhet részvételt, aki erre a főpróbára is jelölt.</span>
            </label>
          )}

          <label className="field"><span>Megjegyzés (a tagok is látják)</span><textarea value={form.notes} onChange={set('notes')} placeholder="pl. fellépő ruha, gyülekező időpontja" /></label>

          {!isNew && isPublished && importantChanged && (
            <label className="check"><input type="checkbox" checked={notifyChange} onChange={(e) => setNotifyChange(e.target.checked)} />Értesítés küldése a tagoknak a változásról</label>
          )}

          {error && <div className="notice err">{error}</div>}
          <div className="btnrow">
            {isNew ? (
              <>
                <button type="button" className="btn primary" disabled={busy} onClick={() => save(true)}>📣 Mentés és közzététel</button>
                <button type="submit" className="btn" disabled={busy}>Mentés piszkozatként</button>
              </>
            ) : (
              <button type="submit" className="btn primary" disabled={busy}>Mentés</button>
            )}
          </div>
          {isNew && <p className="hint">Közzétételkor az érintett kórus(ok) tagjai azonnal értesítést kapnak (app + e-mail).</p>}
        </form>
      </div>
    </>
  );
}
