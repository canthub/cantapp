import { useState } from 'react';
import { api, toast } from '../../api.js';
import { navigate } from '../../router.js';
import { RESPONSES, RESPONSE_REPORT_LABELS } from '../../../../shared/constants.js';
import { TopBar, Spinner, TypeBadge, Modal, Deadline, useLoad } from '../../components/ui.jsx';
import { formatDate, timeRange, placeText, choirNames, formatShortIso } from '../../util.js';
import { StatusBadge } from './AdminEvents.jsx';

function RemindModal({ ev, summary, onClose }) {
  const [target, setTarget] = useState('pending');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await api(`/admin/events/${ev.id}/remind`, { method: 'POST', body: { target, message: message.trim() || undefined } });
      toast(`Emlékeztető elküldve ${res.sent} tagnak.`);
      onClose(true);
    } catch (err) {
      toast(err.message, 'err');
      setBusy(false);
    }
  };
  return (
    <Modal title="Emlékeztető küldése" onClose={() => onClose(false)}>
      <label className="check"><input type="radio" name="t" checked={target === 'pending'} onChange={() => setTarget('pending')} />Csak akik még nem jeleztek vissza ({summary.none} fő)</label>
      <label className="check"><input type="radio" name="t" checked={target === 'all'} onChange={() => setTarget('all')} />Minden érintett tagnak ({summary.total} fő)</label>
      <label className="field"><span>Saját üzenet (nem kötelező)</span><textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ha üresen hagyod, az alapértelmezett emlékeztető szöveg megy ki." /></label>
      <p className="hint">Az emlékeztető az appban, push értesítésként és e-mailben is megérkezik.</p>
      <button className="btn primary block" disabled={busy} onClick={send}>📨 Küldés most</button>
    </Modal>
  );
}

function SendReportModal({ ev, recipients, onClose }) {
  const [text, setText] = useState(recipients.join('\n'));
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const list = text.split(/[\s,;]+/).filter(Boolean);
      const res = await api(`/admin/events/${ev.id}/send-report`, { method: 'POST', body: { recipients: list } });
      toast(`Riport elküldve: ${res.recipients.length} címzett.`);
      onClose();
    } catch (err) {
      toast(err.message, 'err');
      setBusy(false);
    }
  };
  return (
    <Modal title="Aktuális állapot küldése e-mailben" onClose={onClose}>
      <label className="field"><span>Címzettek (soronként egy)</span><textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <p className="hint">A levélben táblázat és csatolt Excel/CSV fájl lesz az aktuális visszajelzésekkel.</p>
      <button className="btn primary block" disabled={busy} onClick={send}>📧 Küldés</button>
    </Modal>
  );
}

export default function AdminEventDetail({ id }) {
  const [data, error, reload] = useLoad(() => api(`/admin/events/${id}`), [id]);
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState('all');

  const action = async (path, confirmText, okText) => {
    if (confirmText && !confirm(confirmText)) return;
    try {
      const res = await api(`/admin/events/${id}/${path}`, { method: 'POST' });
      toast(typeof okText === 'function' ? okText(res) : okText);
      reload();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  const remove = async () => {
    if (!confirm('Biztosan törlöd az eseményt és az összes visszajelzést? Ez nem vonható vissza.')) return;
    try {
      await api(`/admin/events/${id}`, { method: 'DELETE' });
      toast('Esemény törölve.');
      navigate('/admin');
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  const setStatus = async (memberId, status) => {
    try {
      await api(`/admin/events/${id}/responses/${memberId}`, { method: 'PUT', body: { status: status || null } });
      toast('Visszajelzés rögzítve.');
      reload();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  if (error) return <><TopBar title="Esemény" back="/admin" /><div className="page"><div className="notice err">{error.message}</div></div></>;
  if (!data) return <><TopBar title="Esemény" back="/admin" /><Spinner /></>;

  const { event: ev, summary, rows, byVoice, concerts, recipients } = data;
  const visibleRows = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const pct = (n) => (summary.total ? Math.round((n / summary.total) * 100) : 0);

  return (
    <>
      <TopBar title="Esemény követése" back="/admin" />
      <div className="page">
        <h1>{ev.name}</h1>
        <div className="badges">
          <TypeBadge type={ev.type} />
          {ev.isTour && <span className="badge tour">Turné</span>}
          <span className="badge">{choirNames(ev.choirs)}</span>
          <StatusBadge ev={ev} />
        </div>

        <div className="card info">
          <div className="row"><span className="ico">📅</span><div>{ev.endDate
            ? <>{formatDate(ev.date)}{ev.startTime && <>, <b>{ev.startTime}</b></>} – {formatDate(ev.endDate)}{ev.endTime && <>, <b>{ev.endTime}</b></>}</>
            : <>{formatDate(ev.date)}{timeRange(ev) && <>, <b>{timeRange(ev)}</b></>}</>}</div></div>
          <div className="row"><span className="ico">📍</span><div>{placeText(ev) || '–'}{ev.mapsUrl && <> · <a href={ev.mapsUrl} target="_blank" rel="noreferrer">Térkép</a></>}</div></div>
          <div className="row"><span className="ico">⏰</span><div>Határidő: <Deadline ev={ev} /></div></div>
          {ev.accommodation && <div className="row"><span className="ico">🛏️</span><div>Szálláskérés engedélyezve – <b>{summary.accommodation} tag kér szállást</b></div></div>}
          <div className="row"><span className="ico">👥</span><div>Meghívottak: {ev.inviteMode === 'selected' ? <b>csak kijelölt tagok ({summary.total} fő)</b> : 'a kórus(ok) minden tagja'}</div></div>
          {ev.dressRehearsalId && <div className="row"><span className="ico">🎼</span><div>Kapcsolódó főpróba: <a href={`#/admin/esemeny/${ev.dressRehearsalId}`}>megnyitás</a></div></div>}
          {concerts.length > 0 && <div className="row"><span className="ico">🎤</span><div>Ehhez a főpróbához tartozó koncert: {concerts.map((c) => <a key={c.id} href={`#/admin/esemeny/${c.id}`} style={{ marginRight: 8 }}>{c.name}</a>)}</div></div>}
          {ev.notes && <div className="row"><span className="ico">📝</span><div style={{ whiteSpace: 'pre-wrap' }}>{ev.notes}</div></div>}
          {ev.reportSentAt && <div className="row"><span className="ico">📧</span><div>Végleges riport elküldve: {formatShortIso(ev.reportSentAt)}</div></div>}
        </div>

        <div className="card">
          <div className="stats">
            <div className="yes"><div className="n">{summary.yes}</div><div className="l">Részt vesz</div></div>
            <div className="maybe"><div className="n">{summary.maybe}</div><div className="l">Talán</div></div>
            <div className="no"><div className="n">{summary.no}</div><div className="l">Nem</div></div>
            <div className="none"><div className="n">{summary.none}</div><div className="l">Nem jelzett</div></div>
          </div>
          <div className="progress" style={{ marginTop: 12 }}>
            <span className="yes" style={{ width: `${pct(summary.yes)}%` }} />
            <span className="maybe" style={{ width: `${pct(summary.maybe)}%` }} />
            <span className="no" style={{ width: `${pct(summary.no)}%` }} />
          </div>
          <p className="small muted" style={{ margin: 0 }}>{summary.total - summary.none} / {summary.total} tag jelzett vissza ({pct(summary.total - summary.none)}%)</p>
        </div>

        <div className="btnrow">
          {ev.status === 'draft' && <button className="btn primary" onClick={() => action('publish', 'Közzéteszed? Az érintett tagok azonnal értesítést kapnak.', (r) => `Közzétéve, ${r.announced} értesítés kiküldve.`)}>📣 Közzététel</button>}
          {ev.status === 'published' && <button className="btn primary" onClick={() => setModal('remind')}>⏰ Emlékeztető küldése</button>}
          <button className="btn" onClick={() => navigate(`/admin/esemeny/${ev.id}/szerkesztes`)}>✏️ Szerkesztés</button>
        </div>
        <div className="btnrow">
          <a className="btn small" href={`/api/admin/events/${ev.id}/export.xlsx`}>⬇️ Excel</a>
          <a className="btn small" href={`/api/admin/events/${ev.id}/export.csv`}>⬇️ CSV</a>
          <a className="btn small" href={`/api/admin/events/${ev.id}/print`} target="_blank" rel="noreferrer">🖨️ Nyomtatás</a>
          <button className="btn small" onClick={() => setModal('report')}>📧 Küldés e-mailben</button>
        </div>

        <div className="section-title"><h2>Visszajelzések</h2></div>
        <div className="tabs">
          {['all', 'yes', 'maybe', 'no', 'none'].map((s) => (
            <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
              {s === 'all' ? `Mind (${summary.total})` : `${RESPONSE_REPORT_LABELS[s]} (${summary[s]})`}
            </button>
          ))}
        </div>
        <div className="card">
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Név</th><th>Szólam</th><th>Visszajelzés</th>{ev.accommodation && <th>Szállás</th>}<th>Mikor</th><th>Emlékeztető</th></tr></thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.memberId}>
                    <td><b>{r.name}</b><div className="small muted">{r.choirs}</div></td>
                    <td>{r.voicePart}</td>
                    <td>
                      <select value={r.status === 'none' ? '' : r.status} onChange={(e) => setStatus(r.memberId, e.target.value)} aria-label={`${r.name} visszajelzése`}>
                        <option value="">– nincs –</option>
                        {Object.entries(RESPONSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      {r.setByAdmin && <div className="small muted">admin rögzítette</div>}
                    </td>
                    {ev.accommodation && <td>{r.accommodation ? '🛏️ kér' : ''}</td>}
                    <td className="small">{r.respondedAt ? formatShortIso(r.respondedAt) : ''}</td>
                    <td className="small">{r.reminders ? `${r.reminders.count}× · ${formatShortIso(r.reminders.last)}` : '–'}</td>
                  </tr>
                ))}
                {visibleRows.length === 0 && <tr><td colSpan={ev.accommodation ? 6 : 5} className="muted">Nincs ilyen tag.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {Object.keys(byVoice).length > 1 && (
          <>
            <div className="section-title"><h2>Szólamonként</h2></div>
            <div className="card table-wrap">
              <table className="list">
                <thead><tr><th>Szólam</th><th>Igen</th><th>Talán</th><th>Nem</th><th>Nem jelzett</th></tr></thead>
                <tbody>{Object.entries(byVoice).map(([v, c]) => <tr key={v}><td>{v}</td><td>{c.yes}</td><td>{c.maybe}</td><td>{c.no}</td><td>{c.none}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}

        <div className="section-title"><h2>Egyéb műveletek</h2></div>
        <div className="btnrow">
          {ev.status === 'published' && <button className="btn" onClick={() => action('unpublish', 'Visszaállítod piszkozatba? A tagok nem fogják látni.', 'Visszaállítva piszkozatba.')}>↩️ Vissza piszkozatba</button>}
          {ev.status !== 'cancelled' && <button className="btn danger" onClick={() => action('cancel', 'Az esemény elmarad? A tagok értesítést kapnak róla.', (r) => `Esemény lemondva${r.notified ? `, ${r.notified} tag értesítve` : ''}.`)}>🚫 Esemény lemondása</button>}
          <button className="btn danger" onClick={remove}>🗑️ Törlés</button>
        </div>
      </div>
      {modal === 'remind' && <RemindModal ev={ev} summary={summary} onClose={(sent) => { setModal(null); if (sent) reload(); }} />}
      {modal === 'report' && <SendReportModal ev={ev} recipients={recipients} onClose={() => setModal(null)} />}
    </>
  );
}
