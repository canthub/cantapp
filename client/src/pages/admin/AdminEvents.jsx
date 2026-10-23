import { useState } from 'react';
import { api, toast } from '../../api.js';
import { navigate } from '../../router.js';
import { CHOIRS } from '../../../../shared/constants.js';
import { TopBar, Spinner, Empty, TypeBadge, DateBox, ProgressBar, useLoad } from '../../components/ui.jsx';
import { timeRange, todayIso, choirNames, formatShortIso } from '../../util.js';

const FILTERS = {
  open: { label: 'Folyamatban', test: (e) => e.status === 'published' && e.isOpen },
  draft: { label: 'Piszkozat', test: (e) => e.status === 'draft' },
  closed: { label: 'Lezárt', test: (e) => e.status === 'published' && !e.isOpen },
  cancelled: { label: 'Elmarad', test: (e) => e.status === 'cancelled' },
  all: { label: 'Összes', test: () => true },
};

export function StatusBadge({ ev }) {
  if (ev.status === 'draft') return <span className="badge draft">Piszkozat</span>;
  if (ev.status === 'cancelled') return <span className="badge cancelled">Elmarad</span>;
  if (ev.isOpen) return <span className="badge open">Visszajelzés folyamatban</span>;
  return <span className="badge closed">Lezárva{ev.reportSentAt ? ' · riport elküldve' : ''}</span>;
}

export function AdminNav({ active }) {
  const items = [['/admin', 'Események'], ['/admin/tagok', 'Tagok'], ['/admin/import', 'Import'], ['/admin/beallitasok', 'Beállítások']];
  return (
    <div className="tabs">
      {items.map(([href, label]) => (
        <button key={href} className={active === href ? 'active' : ''} onClick={() => navigate(href)}>{label}</button>
      ))}
    </div>
  );
}

export default function AdminEvents() {
  const [filter, setFilter] = useState('open');
  const [choir, setChoir] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [data, error, reload] = useLoad(() => api('/admin/events'), []);

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const publishSelected = async () => {
    if (!confirm(`${selected.size} esemény közzététele? Az érintett tagok azonnal értesítést kapnak.`)) return;
    try {
      const res = await api('/admin/events/publish-bulk', { method: 'POST', body: { ids: [...selected] } });
      toast(`${res.published} esemény közzétéve, ${res.announced} értesítés kiküldve.`);
      setSelected(new Set());
      reload();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  let list = null;
  if (data) {
    let events = data.events.filter(FILTERS[filter].test).filter((e) => choir === 'all' || e.choirs.includes(choir));
    const today = todayIso();
    if (filter === 'closed' || filter === 'all') events = [...events].sort((a, b) => (a.date >= today) - (b.date >= today) || (a.date < today ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
    list = events.length === 0 ? <Empty icon="📭">Nincs ilyen esemény.</Empty> : events.map((ev) => (
      <div key={ev.id} className="card clickable event-card" onClick={() => navigate(`/admin/esemeny/${ev.id}`)}>
        {ev.status === 'draft' && <input type="checkbox" className="sel-check" checked={selected.has(ev.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(ev.id)} aria-label="Kijelölés" />}
        <DateBox date={ev.date} />
        <div className="body">
          <div className="title">{ev.name}</div>
          <div className="badges">
            <TypeBadge type={ev.type} />
            {ev.isTour && <span className="badge tour">Turné</span>}
            <span className="badge">{choirNames(ev.choirs)}</span>
            <StatusBadge ev={ev} />
          </div>
          <div className="meta">{[timeRange(ev), ev.city].filter(Boolean).join(' · ')} · határidő: {formatShortIso(ev.deadlineAt)}</div>
          {ev.status !== 'draft' && <ProgressBar stats={ev.stats} />}
          {ev.status === 'draft' && <div className="meta small">{ev.stats.total} érintett tag</div>}
        </div>
      </div>
    ));
  }

  return (
    <>
      <TopBar title="Admin" />
      <div className="page">
        <AdminNav active="/admin" />
        <div className="fab-row">
          <button className="btn primary" onClick={() => navigate('/admin/esemeny/uj')}>＋ Új esemény</button>
          <button className="btn" onClick={() => navigate('/admin/import')}>⬆️ Importálás</button>
          {selected.size > 0 && <button className="btn primary" onClick={publishSelected}>📣 Kijelöltek közzététele ({selected.size})</button>}
        </div>
        <div className="tabs">
          {Object.entries(FILTERS).map(([k, f]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => { setFilter(k); setSelected(new Set()); }}>
              {f.label}{data ? ` (${data.events.filter(f.test).length})` : ''}
            </button>
          ))}
        </div>
        <div className="tabs">
          <button className={choir === 'all' ? 'active' : ''} onClick={() => setChoir('all')}>Mindkét kórus</button>
          {Object.entries(CHOIRS).map(([k, v]) => <button key={k} className={choir === k ? 'active' : ''} onClick={() => setChoir(k)}>{v}</button>)}
        </div>
        {filter === 'draft' && data?.events.some(FILTERS.draft.test) && (
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className="hint">Jelöld ki a közzéteendő piszkozatokat.</span>
            <button className="btn small" onClick={() => setSelected(new Set(data.events.filter(FILTERS.draft.test).filter((e) => choir === 'all' || e.choirs.includes(choir)).map((e) => e.id)))}>Mind kijelölése</button>
          </div>
        )}
        {error && <div className="notice err">{error.message}</div>}
        {!data && !error ? <Spinner /> : list}
      </div>
    </>
  );
}
