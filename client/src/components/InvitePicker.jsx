import { useMemo, useState } from 'react';
import { compareVoices } from '../../../shared/constants.js';

const NO_VOICE = 'Szólam nincs megadva';

const formatKm = (km) => (km < 1 ? '<1 km' : `~${Math.round(km)} km`);

// Meghívottak kijelölése szólamonként csoportosítva (S, A, T, B sorrendben), szólamonkénti „mind” jelölővel.
// Ha ismert a tagok távolsága a helyszíntől, a szólamon belül a közelebb lakók kerülnek előre.
export default function InvitePicker({ members, value, onChange, distances = null }) {
  const [q, setQ] = useState('');
  const selected = useMemo(() => new Set(value), [value]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const m of members) {
      const v = m.voicePart || NO_VOICE;
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(m);
    }
    const dist = (m) => distances?.[m.id] ?? Infinity;
    for (const list of map.values()) list.sort((a, b) => dist(a) - dist(b) || a.name.localeCompare(b.name, 'hu'));
    return [...map.entries()].sort(([a], [b]) => (a === NO_VOICE) - (b === NO_VOICE) || compareVoices(a, b));
  }, [members, distances]);

  const needle = q.trim().toLowerCase();
  const set = (ids, on) => {
    const n = new Set(selected);
    for (const id of ids) (on ? n.add(id) : n.delete(id));
    onChange([...n]);
  };
  const summary = groups
    .map(([v, list]) => [v, list.filter((m) => selected.has(m.id)).length])
    .filter(([, n]) => n > 0)
    .map(([v, n]) => `${v}: ${n}`)
    .join(' · ');
  const total = members.filter((m) => selected.has(m.id)).length;

  return (
    <div className="invite-picker">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <b>{total} / {members.length} kijelölve</b>
        <span className="btnrow" style={{ margin: 0 }}>
          <button type="button" className="btn small" onClick={() => set(members.map((m) => m.id), true)}>Mind</button>
          <button type="button" className="btn small" onClick={() => onChange([])}>Egyik sem</button>
        </span>
      </div>
      {summary && <p className="hint" style={{ marginTop: 0 }}>{summary}</p>}
      <input type="text" placeholder="🔍 Keresés név szerint" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
      {groups.map(([voice, list]) => {
        const visible = needle ? list.filter((m) => m.name.toLowerCase().includes(needle)) : list;
        if (visible.length === 0) return null;
        const count = list.filter((m) => selected.has(m.id)).length;
        const all = count === list.length;
        return (
          <div key={voice} className="voice-group">
            <label className="check voice-head">
              <input
                type="checkbox"
                checked={all}
                ref={(el) => { if (el) el.indeterminate = count > 0 && !all; }}
                onChange={() => set(list.map((m) => m.id), !all)}
              />
              <b>{voice}</b>
              <span className="muted small" style={{ marginLeft: 'auto' }}>{count} / {list.length}</span>
            </label>
            {visible.map((m) => (
              <label key={m.id} className="check voice-member">
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => set([m.id], !selected.has(m.id))} />
                {m.name}
                {distances && <span className="muted small" style={{ marginLeft: 'auto' }}>{m.id in distances ? formatKm(distances[m.id]) : '–'}</span>}
              </label>
            ))}
          </div>
        );
      })}
      {members.length === 0 && <p className="hint">Előbb válaszd ki az énekkart.</p>}
    </div>
  );
}
