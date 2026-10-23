import { useEffect, useState } from 'react';
import { api, toast } from '../../api.js';
import { navigate } from '../../router.js';
import { CHOIRS, EVENT_TYPES, UNINVITED_MESSAGE } from '../../../../shared/constants.js';
import { TopBar, Spinner } from '../../components/ui.jsx';
import InvitePicker from '../../components/InvitePicker.jsx';
import { formatDate } from '../../util.js';

const EMPTY = {
  name: '', type: 'proba', date: '', startTime: '', endTime: '', country: 'Magyarország', city: '', address: '', venue: '',
  isTour: false, deadlineDate: '', deadlineTime: '23:59', dressRehearsalId: '', notes: '', choirs: [], inviteMode: 'all', invitees: [],
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
  const [members, setMembers] = useState([]);
  const [invitedBefore, setInvitedBefore] = useState([]);
  const [copyFrom, setCopyFrom] = useState('');
  const [geo, setGeo] = useState(null);
  const [notifyChange, setNotifyChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deadlineTouched, setDeadlineTouched] = useState(!isNew);
  const [drTouched, setDrTouched] = useState(!isNew);

  useEffect(() => {
    api('/admin/events').then((d) => setEvents(d.events)).catch(() => {});
    api('/admin/members').then((d) => setMembers(d.members.filter((m) => m.active))).catch(() => {});
    if (!isNew) {
      api(`/admin/events/${id}`).then(({ event: e, rows }) => {
        const f = {
          name: e.name, type: e.type, date: e.date, startTime: e.startTime, endTime: e.endTime, country: e.country, city: e.city,
          address: e.address, venue: e.venue, isTour: e.isTour, deadlineDate: e.deadlineDate, deadlineTime: e.deadlineTime,
          dressRehearsalId: e.dressRehearsalId || '', notes: e.notes, choirs: e.choirs,
          inviteMode: e.inviteMode, invitees: e.invitees || [],
        };
        setInvitedBefore(rows.map((r) => r.memberId));
        setForm(f);
        setOriginal(e);
      }).catch((err) => setError(err.message));
    }
  }, [id, isNew]);

  // Új eseménynél a határidőt automatikusan 7 nappal az esemény elé állítjuk (amíg kézzel nem módosítják).
  useEffect(() => {
    if (form?.date && !deadlineTouched) setForm((f) => ({ ...f, deadlineDate: minusDays(f.date, 7) }));
  }, [form?.date, deadlineTouched]);

  // Meghívottak kijelölésekor a tagok távolsága a helyszíntől (a gépelés után kis késleltetéssel).
  useEffect(() => {
    if (!form || form.inviteMode !== 'selected') return undefined;
    const t = setTimeout(() => {
      api('/admin/geo/distances', { method: 'POST', body: { address: form.address, city: form.city, country: form.country } })
        .then(setGeo)
        .catch(() => setGeo(null));
    }, 700);
    return () => clearTimeout(t);
  }, [form?.inviteMode, form?.address, form?.city, form?.country]);

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
  // A kiválasztott kórus(ok) aktív tagjai – közülük lehet meghívottakat kijelölni.
  const choirMembers = members.filter((m) => m.choirs.some((c) => form.choirs.includes(c)));
  const invitedNow = form.inviteMode === 'all' ? choirMembers.map((m) => m.id) : form.invitees.filter((mid) => choirMembers.some((m) => m.id === mid));
  const removedNames = isPublished ? members.filter((m) => invitedBefore.includes(m.id) && !invitedNow.includes(m.id)).map((m) => m.name) : [];
  const copyCandidates = events.filter((e) => String(e.id) !== String(id) && e.choirs.some((c) => form.choirs.includes(c)));

  const copyInvitees = async (eventId) => {
    setCopyFrom(eventId);
    if (!eventId) return;
    try {
      const { rows } = await api(`/admin/events/${eventId}`);
      const ids = rows.map((r) => r.memberId).filter((mid) => choirMembers.some((m) => m.id === mid));
      setForm((f) => ({ ...f, inviteMode: 'selected', invitees: ids }));
      toast(`${ids.length} meghívott átmásolva.`);
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  const save = async (publish) => {
    setBusy(true);
    setError('');
    try {
      const body = { ...form, dressRehearsalId: form.dressRehearsalId || null, invitees: form.inviteMode === 'selected' ? invitedNow : [] };
      if (removedNames.length && !confirm(`${removedNames.length} tag kikerül a meghívottak közül, és ezt az üzenetet kapja:\n\n„${UNINVITED_MESSAGE}”\n\nFolytatod?`)) {
        setBusy(false);
        return;
      }
      if (isNew) {
        const res = await api('/admin/events', { method: 'POST', body: { ...body, publish } });
        toast(publish ? 'Esemény közzétéve, az értesítések kimentek.' : 'Esemény elmentve piszkozatként.');
        navigate(`/admin/esemeny/${res.event.id}`);
      } else {
        const res = await api(`/admin/events/${id}`, { method: 'PUT', body: { ...body, notifyChange } });
        const parts = ['Mentve.'];
        if (res.notified) parts.push(`${res.notified} tag kapott értesítést a változásról.`);
        if (res.uninvited) parts.push(`${res.uninvited} tag kikerült a meghívottak közül (üzenetet kaptak).`);
        if (res.announced) parts.push(`${res.announced} új meghívott kapott értesítést.`);
        toast(parts.join(' '));
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

          <h3 style={{ marginTop: 8 }}>Meghívottak</h3>
          <label className="check"><input type="radio" name="inviteMode" checked={form.inviteMode === 'all'} onChange={() => setForm((f) => ({ ...f, inviteMode: 'all' }))} />A kiválasztott kórus(ok) minden tagja ({choirMembers.length} fő)</label>
          <label className="check"><input type="radio" name="inviteMode" checked={form.inviteMode === 'selected'} onChange={() => setForm((f) => ({ ...f, inviteMode: 'selected' }))} />Csak a kijelölt tagok</label>
          {form.inviteMode === 'selected' && (
            <div className="field">
              <p className="hint">Az eseményt a kórus minden tagja látja, de értesítést és emlékeztetőt csak a kijelöltek kapnak, és csak ők jelezhetnek vissza.</p>
              {copyCandidates.length > 0 && (
                <label className="field"><span>Meghívottak átmásolása másik eseményről</span>
                  <select value={copyFrom} onChange={(e) => copyInvitees(e.target.value)}>
                    <option value="">– válassz eseményt –</option>
                    {copyCandidates.map((e) => <option key={e.id} value={e.id}>{e.name} – {formatDate(e.date, { weekday: undefined })}</option>)}
                  </select>
                </label>
              )}
              {geo?.located && <p className="hint">A szólamokon belül elöl azok, akik a helyszínhez legközelebb laknak (légvonalban).{geo.withoutLocation > 0 && ` ${geo.withoutLocation} tagnál nincs megadva lakóhely – ők a szólam végén vannak.`}</p>}
              {geo && !geo.located && (form.address || form.city) && <p className="hint">A helyszínt nem találtuk a térképen, ezért név szerint rendezünk. Ellenőrizd a címet és a várost!</p>}
              {!form.address && !form.city && <p className="hint">Add meg a helyszín címét vagy városát, és a közel lakók kerülnek előre.</p>}
              <InvitePicker members={choirMembers} value={invitedNow} distances={geo?.located ? geo.distances : null} onChange={(ids) => setForm((f) => ({ ...f, invitees: ids }))} />
            </div>
          )}
          {removedNames.length > 0 && (
            <div className="notice warn">
              <b>{removedNames.length} tag kikerül a meghívottak közül:</b> {removedNames.join(', ')}. Mentéskor ezt az üzenetet kapják: „{UNINVITED_MESSAGE}”, és a visszajelzésük törlődik.
            </div>
          )}

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
              <span className="hint">A koncertre csak az jelölhet részvételt, aki erre a főpróbára is jelölt (ha a főpróbára meg volt hívva).</span>
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
          {isNew && <p className="hint">Közzétételkor a meghívottak azonnal értesítést kapnak (app + e-mail).</p>}
        </form>
      </div>
    </>
  );
}
