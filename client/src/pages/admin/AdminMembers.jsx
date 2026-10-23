import { useState } from 'react';
import { api, toast } from '../../api.js';
import { CHOIRS } from '../../../../shared/constants.js';
import { TopBar, Spinner, Empty, Modal, useLoad } from '../../components/ui.jsx';
import { choirNames } from '../../util.js';
import { AdminNav } from './AdminEvents.jsx';

const EMPTY = { lastName: '', firstName: '', email: '', phone: '', voicePart: '', choirs: [], isAdmin: false, active: true };

function MemberModal({ member, me, onClose }) {
  const [form, setForm] = useState(member || EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggleChoir = (c) => setForm((f) => ({ ...f, choirs: f.choirs.includes(c) ? f.choirs.filter((x) => x !== c) : [...f.choirs, c] }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (member) await api(`/admin/members/${member.id}`, { method: 'PUT', body: form });
      else await api('/admin/members', { method: 'POST', body: form });
      toast('Tag elmentve.');
      onClose(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const setActive = async (active) => {
    try {
      await api(`/admin/members/${member.id}/active`, { method: 'POST', body: { active } });
      toast(active ? 'Tag újra aktív.' : 'Tag inaktiválva – nem kap több értesítést.');
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={member ? 'Tag szerkesztése' : 'Új tag'} onClose={() => onClose(false)}>
      <form onSubmit={save}>
        <div className="grid2">
          <label className="field"><span>Vezetéknév</span><input type="text" value={form.lastName} onChange={set('lastName')} /></label>
          <label className="field"><span>Keresztnév</span><input type="text" value={form.firstName} onChange={set('firstName')} /></label>
        </div>
        <label className="field"><span>E-mail *</span><input type="email" required value={form.email} onChange={set('email')} /></label>
        <div className="grid2">
          <label className="field"><span>Telefon</span><input type="tel" value={form.phone} onChange={set('phone')} /></label>
          <label className="field"><span>Szólam</span><input type="text" value={form.voicePart} onChange={set('voicePart')} placeholder="pl. Szoprán 1" /></label>
        </div>
        {Object.entries(CHOIRS).map(([k, v]) => (
          <label key={k} className="check"><input type="checkbox" checked={form.choirs.includes(k)} onChange={() => toggleChoir(k)} />{v}</label>
        ))}
        <label className="check"><input type="checkbox" checked={form.isAdmin} disabled={member?.id === me.member.id} onChange={set('isAdmin')} />Admin (eseményeket és tagokat kezelhet)</label>
        {error && <div className="notice err">{error}</div>}
        <button className="btn primary block" disabled={busy}>Mentés</button>
        {member && member.id !== me.member.id && (
          member.active
            ? <button type="button" className="btn danger block" style={{ marginTop: 8 }} onClick={() => setActive(false)}>Inaktiválás (kilépett a kórusból)</button>
            : <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={() => setActive(true)}>Újraaktiválás</button>
        )}
      </form>
    </Modal>
  );
}

function ImportModal({ onClose }) {
  const [file, setFile] = useState(null);
  const [deactivate, setDeactivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('deactivateMissing', String(deactivate));
      setResult(await api('/admin/import/members', { method: 'POST', form }));
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Tagok importálása" onClose={() => onClose(Boolean(result))}>
      <p className="small">1. Töltsd le a sablont, töltsd ki (egy sor = egy tag), majd töltsd fel. A tagot az e-mail-címe azonosítja: a már meglévő tagok adatai frissülnek, nem jönnek létre újra. Ha egy e-mail-cím a táblázatban kétszer szerepel, a második sor kimarad.</p>
      <div className="btnrow">
        <a className="btn small" href="/api/admin/templates/tagok-xlsx">⬇️ Sablon (Excel)</a>
        <a className="btn small" href="/api/admin/templates/tagok-csv">⬇️ Sablon (CSV)</a>
      </div>
      <form onSubmit={submit}>
        <label className="field"><span>2. Kitöltött táblázat (.xlsx vagy .csv)</span><input type="file" accept=".xlsx,.csv" required onChange={(e) => setFile(e.target.files[0])} /></label>
        <label className="check"><input type="checkbox" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} />A táblázatban nem szereplő tagok inaktiválása</label>
        <button className="btn primary block" disabled={busy || !file}>{busy ? 'Importálás…' : 'Importálás'}</button>
      </form>
      {result && (
        <div className={`notice ${result.errors.length ? 'warn' : 'ok'}`}>
          ✔ Új: <b>{result.created}</b> · Frissítve: <b>{result.updated}</b>{result.deactivated ? <> · Inaktivált: <b>{result.deactivated}</b></> : null}
          {result.errors.length > 0 && <><div style={{ marginTop: 6 }}>Hibás sorok (ezek kimaradtak):</div><ul className="result-list">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul></>}
        </div>
      )}
    </Modal>
  );
}

export default function AdminMembers({ me }) {
  const [data, error, reload] = useLoad(() => api('/admin/members'), []);
  const [q, setQ] = useState('');
  const [choir, setChoir] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);

  let list = null;
  if (data) {
    const needle = q.trim().toLowerCase();
    const members = data.members
      .filter((m) => showInactive || m.active)
      .filter((m) => choir === 'all' || m.choirs.includes(choir))
      .filter((m) => !needle || `${m.name} ${m.email} ${m.voicePart}`.toLowerCase().includes(needle));
    list = members.length === 0 ? <Empty icon="👥">Nincs találat.</Empty> : (
      <div className="card">
        <p className="small muted" style={{ marginBottom: 4 }}>{members.length} tag</p>
        {members.map((m) => (
          <div key={m.id} className="member-row" onClick={() => setEditing(m)} style={m.active ? undefined : { opacity: 0.5 }}>
            <div className="avatar">{(m.lastName[0] || '') + (m.firstName[0] || '')}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><b>{m.name}</b>{m.isAdmin && <span className="badge t-koncert" style={{ marginLeft: 6 }}>Admin</span>}{!m.active && <span className="badge draft" style={{ marginLeft: 6 }}>Inaktív</span>}</div>
              <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{[m.voicePart, choirNames(m.choirs)].filter(Boolean).join(' · ')}</div>
              <div className="small muted">{m.email}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <TopBar title="Admin" />
      <div className="page">
        <AdminNav active="/admin/tagok" />
        <div className="fab-row">
          <button className="btn primary" onClick={() => setEditing('new')}>＋ Új tag</button>
          <button className="btn" onClick={() => setImporting(true)}>⬆️ Importálás táblázatból</button>
        </div>
        <label className="field"><input type="text" placeholder="🔍 Keresés név, e-mail, szólam szerint" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="tabs">
          <button className={choir === 'all' ? 'active' : ''} onClick={() => setChoir('all')}>Mindenki</button>
          {Object.entries(CHOIRS).map(([k, v]) => <button key={k} className={choir === k ? 'active' : ''} onClick={() => setChoir(k)}>{v}</button>)}
        </div>
        <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Inaktív tagok mutatása</label>
        {error && <div className="notice err">{error.message}</div>}
        {!data && !error ? <Spinner /> : list}
      </div>
      {editing && <MemberModal me={me} member={editing === 'new' ? null : editing} onClose={(changed) => { setEditing(null); if (changed) reload(); }} />}
      {importing && <ImportModal onClose={(changed) => { setImporting(false); if (changed) reload(); }} />}
    </>
  );
}
