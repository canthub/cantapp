import { useState } from 'react';
import { api, toast } from '../api.js';
import { RESPONSES, THANK_YOU_MESSAGE, ACCOMMODATION_CHOICES } from '../../../shared/constants.js';
import { TopBar, Spinner, TypeBadge, Deadline, RESPONSE_ICONS, useLoad } from '../components/ui.jsx';
import { formatDate, timeRange, dayRange, dayCount, choirNames } from '../util.js';

export default function EventDetail({ id, onChange }) {
  const [data, error] = useLoad(() => api(`/events/${id}`), [id]);
  const [ev, setEv] = useState(null);
  const [busy, setBusy] = useState(false);
  // Szálláskérésnél a „részt veszek”/„talán” válasz csak a szállás-választással együtt menthető.
  const [pending, setPending] = useState(null);
  const event = ev?.id === Number(id) ? ev : data?.event;
  const needsRoom = (s) => Boolean(event?.accommodation) && (s === 'yes' || s === 'maybe');

  const respond = async (status, accommodation) => {
    setBusy(true);
    try {
      const res = await api(`/events/${id}/response`, { method: 'PUT', body: { status, accommodation } });
      setEv(res.event);
      const roomOnly = accommodation !== undefined && !pending && status === event.myResponse;
      setPending(null);
      if (roomOnly) toast(accommodation ? 'Rögzítettük: szállást kérsz. 🛏️' : 'Rögzítettük: nem kérsz szállást.');
      else toast(res.first ? THANK_YOU_MESSAGE : 'Visszajelzésedet módosítottuk.');
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
          {event.accommodation && <span className="badge">🛏️ Szállás kérhető</span>}
          <span className="badge">{choirNames(event.choirs)}</span>
        </div>

        {event.status === 'cancelled' && <div className="notice err"><b>Ez az esemény elmarad.</b></div>}

        <div className="card info">
          <div className="row"><span className="ico">📅</span><div><div className="lbl">Időpont</div>{formatDate(event.date)}{timeRange(event) && <>, <b style={{ whiteSpace: 'nowrap' }}>{timeRange(event)}</b></>}
            {dayCount(event) > 0 && <div className="small muted">Több napos esemény: {dayCount(event)} nap ({dayRange(event)})</div>}</div></div>
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
                <button
                  key={s}
                  className={`${s} ${(pending || event.myResponse) === s ? 'sel' : ''}`}
                  disabled={busy || !event.allowed[s]}
                  onClick={() => {
                    // Ha még nincs szállás-választás, előbb azt kérjük (a válasz csak vele együtt menthető).
                    if (needsRoom(s) && event.myAccommodation === null) setPending(s);
                    else { setPending(null); respond(s); }
                  }}
                >
                  <span className="ico">{RESPONSE_ICONS[s]}</span>{RESPONSES[s]}{(pending || event.myResponse) === s && <span style={{ marginLeft: 'auto' }}>{pending === s ? '…' : '✓'}</span>}
                </button>
              ))}
            </div>
            {needsRoom(pending || event.myResponse) && (
              <fieldset className="room-choice">
                <legend>🛏️ Kérsz szállást? <span className="req">*</span></legend>
                {pending && <p className="notice warn" style={{ margin: '0 0 8px' }}>A visszajelzésed mentéséhez válaszd ki, kérsz-e szállást.</p>}
                {!pending && event.myAccommodation === null && event.isOpen && <p className="notice warn" style={{ margin: '0 0 8px' }}>Még nem jelölted, kérsz-e szállást – kérjük, válassz!</p>}
                {Object.entries(ACCOMMODATION_CHOICES).map(([k, label]) => (
                  <label key={k} className="check">
                    <input
                      type="radio"
                      name="accommodation"
                      checked={!pending && event.myAccommodation === k}
                      disabled={busy || !event.isOpen}
                      onChange={() => respond(pending || event.myResponse, k === 'yes')}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
            {event.accommodation && !event.myResponse && !pending && event.isOpen && <p className="hint" style={{ marginTop: 10 }}>🛏️ Erre az eseményre szállást is kérhetsz – jelölj „Részt veszek” vagy „Talán” választ, és utána válaszd ki, kérsz-e szállást.</p>}
            {!event.isOpen && !event.myResponse && <p className="muted small" style={{ marginTop: 12 }}>Erre az eseményre nem jeleztél vissza.</p>}
          </div>
        )}

        {event.status !== 'cancelled' && event.calendar && (
          <div className="card">
            <h2>📅 Mentés a naptárba</h2>
            <p className="small">Ezt az eseményt elmentheted a telefonod vagy a számítógéped naptárába.</p>
            <div className="btnrow">
              <a className="btn" href={event.calendar.icsUrl} target="_blank" rel="noreferrer">📱 iPhone / Outlook / egyéb naptár</a>
              <a className="btn" href={event.calendar.googleUrl} target="_blank" rel="noreferrer">🗓️ Google Naptár</a>
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>iPhone-on az első gomb után koppints a „Hozzáadás” lehetőségre. Androidon a Google Naptár gombot használd. Ha az esemény később módosul, értesítést kapsz – ilyenkor mentsd el újra (és szükség esetén töröld a régit).</p>
          </div>
        )}
      </div>
    </>
  );
}
