import { useEffect, useState } from 'react';
import { EVENT_TYPES, RESPONSES } from '../../../shared/constants.js';
import { dateParts, formatDateTimeIso, relativeDeadline } from '../util.js';

export function Spinner() {
  return <div className="spinner" aria-label="Betöltés…" />;
}

export function Empty({ icon = '🎵', children }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      {children}
    </div>
  );
}

export function TopBar({ title, back, right }) {
  return (
    <header className="topbar">
      {back && <button className="back" onClick={() => (typeof back === 'string' ? (window.location.hash = back) : window.history.back())} aria-label="Vissza">‹</button>}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function TypeBadge({ type }) {
  return <span className={`badge t-${type}`}>{EVENT_TYPES[type] || type}</span>;
}

export function DateBox({ date }) {
  const p = dateParts(date);
  return (
    <div className="datebox">
      <div className="m">{p.month}</div>
      <div className="d">{p.day}</div>
      <div className="w">{p.weekday}</div>
    </div>
  );
}

const RESPONSE_ICONS = { yes: '✅', maybe: '🤔', no: '❌' };
export { RESPONSE_ICONS };

export function ResponsePill({ ev }) {
  if (ev.status === 'cancelled') return <span className="pill no">Elmarad</span>;
  if (ev.myResponse) return <span className={`pill ${ev.myResponse}`}>{RESPONSE_ICONS[ev.myResponse]} {RESPONSES[ev.myResponse]}</span>;
  if (ev.isOpen) return <span className="pill todo">⏳ Jelezz vissza! ({relativeDeadline(ev.deadlineAt)})</span>;
  return <span className="pill none">Nem jeleztél vissza</span>;
}

export function ProgressBar({ stats }) {
  const total = stats.total || 1;
  const w = (n) => `${(n / total) * 100}%`;
  return (
    <>
      <div className="progress" aria-hidden="true">
        <span className="yes" style={{ width: w(stats.yes) }} />
        <span className="maybe" style={{ width: w(stats.maybe) }} />
        <span className="no" style={{ width: w(stats.no) }} />
      </div>
      <div className="legend">
        <span><i className="dot yes" />Igen <b>{stats.yes}</b></span>
        <span><i className="dot maybe" />Talán <b>{stats.maybe}</b></span>
        <span><i className="dot no" />Nem <b>{stats.no}</b></span>
        <span><i className="dot none" />Nem jelzett <b>{stats.none}</b></span>
      </div>
    </>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn small" onClick={onClose} aria-label="Bezárás">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let id = 0;
    const onToast = (e) => {
      const item = { id: ++id, ...e.detail };
      setItems((xs) => [...xs, item]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== item.id)), item.type === 'err' ? 6000 : 3500);
    };
    window.addEventListener('app-toast', onToast);
    return () => window.removeEventListener('app-toast', onToast);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
    </div>
  );
}

export function Deadline({ ev }) {
  return <>{formatDateTimeIso(ev.deadlineAt)}{ev.isOpen && <span className="muted"> ({relativeDeadline(ev.deadlineAt)})</span>}</>;
}

// Adatbetöltő hook: [data, error, reload]
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    fn().then((data) => alive && setState({ data, error: null }), (error) => alive && setState({ data: null, error }));
    return () => { alive = false; };
  }, [...deps, n]);
  return [state.data, state.error, () => setN((x) => x + 1)];
}
