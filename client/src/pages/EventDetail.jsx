import { useState } from 'react';
import { api, toast } from '../api.js';
import { RESPONSES, THANK_YOU_MESSAGE } from '../../../shared/constants.js';
import { TopBar, Spinner, TypeBadge, Deadline, RESPONSE_ICONS, useLoad } from '../components/ui.jsx';
import { formatDate, timeRange, choirNames } from '../util.js';

export default function EventDetail({ id, onChange }) {
  const [data, error] = useLoad(() => api(`/events/${id}`), [id]);
  const [ev, setEv] = useState(null);
  const [busy, setBusy] = useState(false);
  const event = ev?.id === Number(id) ? ev : data?.event;

  const respond = async (status) => {
    setBusy(true);
    try {
      const res = await api(`/events/${id}/response`, { method: 'PUT', body: { status } });
      setEv(res.event);
      toast(res.first ? THANK_YOU_MESSAGE : 'Visszajelzésedet módosítottuk.');
      if (res.removedConcerts?.length) toast('A kapcsolódó koncertre adott visszajelzésedet töröltük, mert a főpróbára nem jelöltél részvételt.', 'err');
      onChange?.();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <><TopBar title="Esemény" back="/" /><div className="page"><div className="notice err">{error.message}</div></div></>;
  if (!event) return <><TopBar title="Esemény" back="/" /><Spinner /></>;

  return (
    <>
      <TopBar title={event.typeLabel} back="/" />
      <div className="page">
        <h1>{event.name}</h1>
        <div className="badges">
          <TypeBadge type={event.type} />
          {event.isTour && <span className="badge tour">Koncertturné</span>}
          <span className="badge">{choirNames(event.choirs)}</span>
        </div>

        {event.status === 'cancelled' && <div className="notice err"><b>Ez az esemény elmarad.</b></div>}

        <div className="card info">
          <div className="row"><span className="ico">📅</span><div><div className="lbl">Időpont</div>{formatDate(event.date)}{timeRange(event) && <>, <b>{timeRange(event)}</b></>}</div></div>
          <div className="row">
            <span className="ico">📍</span>
            <div style={{ flex: 1 }}>
              <div className="lbl">Helyszín</div>
              {event.venue && <div><b>{event.venue}</b></div>}
              <div>{[event.address, event.city, event.country].filter(Boolean).join(', ') || (!event.venue && '–')}</div>
              {event.mapsUrl && <a className="btn small" style={{ marginTop: 8 }} href={event.mapsUrl} target="_blank" rel="noreferrer">🗺️ Megnyitás Google Térképen</a>}
            </div>
          </div>
          <div className="row"><span className="ico">⏰</span><div><div className="lbl">Visszajelzési határidő</div><Deadline ev={event} /></div></div>
          {event.notes && <div className="row"><span className="ico">📝</span><div><div className="lbl">Megjegyzés</div><div style={{ whiteSpace: 'pre-wrap' }}>{event.notes}</div></div></div>}
        </div>

        {event.dressRehearsal && (
          <div className="notice info">
            🎼 A koncerthez tartozó főpróba: <a href={`#/esemeny/${event.dressRehearsal.id}`}><b>{event.dressRehearsal.name}</b></a> ({formatDate(event.dressRehearsal.date, { weekday: undefined })}{event.dressRehearsal.startTime && ` ${event.dressRehearsal.startTime}`}).
            {' '}A koncertre csak az jelezhet részvételt, aki a főpróbára is jelezte.
            {' '}Főpróbára adott válaszod: <b>{event.dressRehearsal.myResponse ? RESPONSES[event.dressRehearsal.myResponse] : 'még nincs'}</b>
          </div>
        )}

        {event.status !== 'cancelled' && !event.invited && (
          <div className="notice info">Ezt az eseményt látod, de most nem vagy rá meghívva, ezért nem kell visszajelezned.</div>
        )}

        {event.status !== 'cancelled' && event.invited && (
          <div className="card">
            <h2>Részt tudsz venni?</h2>
            {!event.isOpen && <div className="notice warn">A visszajelzési határidő lejárt, az esemény már nem jelölhető.</div>}
            {event.isOpen && event.ruleMessage && !event.allowed.yes && <div className="notice warn">{event.ruleMessage}</div>}
            <div className="rsvp">
              {['yes', 'maybe', 'no'].map((s) => (
                <button key={s} className={`${s} ${event.myResponse === s ? 'sel' : ''}`} disabled={busy || !event.allowed[s]} onClick={() => respond(s)}>
                  <span className="ico">{RESPONSE_ICONS[s]}</span>{RESPONSES[s]}{event.myResponse === s && <span style={{ marginLeft: 'auto' }}>✓</span>}
                </button>
              ))}
            </div>
            {!event.isOpen && !event.myResponse && <p className="muted small" style={{ marginTop: 12 }}>Erre az eseményre nem jeleztél vissza.</p>}
          </div>
        )}
      </div>
    </>
  );
}
