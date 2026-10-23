import { useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { CHOIRS } from '../../../shared/constants.js';
import { TopBar, Spinner, Empty, TypeBadge, DateBox, ResponsePill, useLoad } from '../components/ui.jsx';
import { timeRange, todayIso, choirNames } from '../util.js';

export function EventCard({ ev, showChoirs }) {
  const place = [ev.venue, ev.city].filter(Boolean).join(', ');
  return (
    <div className={`card clickable event-card ${!ev.isOpen && ev.status !== 'draft' ? 'muted' : ''}`} onClick={() => navigate(`/esemeny/${ev.id}`)}>
      <DateBox date={ev.date} />
      <div className="body">
        <div className="title">{ev.name}</div>
        <div className="badges">
          <TypeBadge type={ev.type} />
          {ev.isTour && <span className="badge tour">Turné</span>}
          {showChoirs && <span className="badge">{choirNames(ev.choirs)}</span>}
        </div>
        <div className="meta">{[timeRange(ev), place].filter(Boolean).join(' · ')}</div>
        <ResponsePill ev={ev} />
      </div>
    </div>
  );
}

export default function Events({ me }) {
  const [tab, setTab] = useState('upcoming');
  const [choir, setChoir] = useState('all');
  const [data, error, reload] = useLoad(() => api('/events'), []);
  const inBoth = me.member.choirs.length > 1;

  let content;
  if (error) content = <div className="notice err">{error.message} <button className="btn small" onClick={reload}>Újra</button></div>;
  else if (!data) content = <Spinner />;
  else {
    const today = todayIso();
    let events = data.events.filter((e) => (choir === 'all' ? true : e.choirs.includes(choir)));
    const todo = events.filter((e) => e.isOpen && !e.myResponse);
    if (tab === 'upcoming') events = events.filter((e) => e.date >= today);
    else if (tab === 'todo') events = todo;
    else events = events.filter((e) => e.date < today).reverse();
    content = events.length === 0
      ? <Empty icon={tab === 'todo' ? '🎉' : '🎵'}>{tab === 'todo' ? 'Minden eseményre visszajeleztél. Köszönjük!' : 'Nincs megjeleníthető esemény.'}</Empty>
      : events.map((ev) => <EventCard key={ev.id} ev={ev} showChoirs={inBoth} />);
    if (tab !== 'todo' && todo.length > 0) {
      content = (
        <>
          <div className="notice warn" style={{ cursor: 'pointer' }} onClick={() => setTab('todo')}>
            ⏳ <b>{todo.length} eseményre</b> még nem jeleztél vissza. Koppints ide!
          </div>
          {content}
        </>
      );
    }
  }

  return (
    <>
      <TopBar title="Események" />
      <div className="page">
        <div className="tabs">
          <button className={tab === 'upcoming' ? 'active' : ''} onClick={() => setTab('upcoming')}>Közelgő</button>
          <button className={tab === 'todo' ? 'active' : ''} onClick={() => setTab('todo')}>Visszajelzésre vár</button>
          <button className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>Korábbi</button>
        </div>
        {inBoth && (
          <div className="tabs">
            <button className={choir === 'all' ? 'active' : ''} onClick={() => setChoir('all')}>Mindkét kórus</button>
            {me.member.choirs.map((c) => (
              <button key={c} className={choir === c ? 'active' : ''} onClick={() => setChoir(c)}>{CHOIRS[c]}</button>
            ))}
          </div>
        )}
        {content}
      </div>
    </>
  );
}
