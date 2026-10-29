import { useEffect, useState } from 'react';
import { api, toast } from '../api.js';
import { TopBar } from '../components/ui.jsx';
import CalendarCard from '../components/CalendarCard.jsx';
import { pushSupported, currentSubscription, enablePush, disablePush } from '../push.js';
import { choirNames, isIos, isStandalone } from '../util.js';
import { GUEST_LABEL } from '../../../shared/constants.js';

export default function Profile({ me }) {
  const m = me.member;
  const [pushOn, setPushOn] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentSubscription().then((s) => setPushOn(Boolean(s))).catch(() => setPushOn(false));
  }, []);

  const togglePush = async () => {
    setBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        toast('A telefonos értesítések kikapcsolva.');
      } else {
        await enablePush(me.vapidPublicKey);
        setPushOn(true);
        toast('A telefonos értesítések bekapcsolva! 🎶');
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.hash = '/';
    window.location.reload();
  };

  const iosNeedsInstall = isIos() && !isStandalone();

  return (
    <>
      <TopBar title="Profil" />
      <div className="page">
        <div className="card">
          <h2>{m.name}</h2>
          <p className="muted" style={{ margin: 0 }}>{m.email}</p>
          {m.phone && <p className="muted" style={{ margin: 0 }}>{m.phone}</p>}
          <div className="badges" style={{ marginTop: 10 }}>
            {m.choirs.length > 0 && <span className="badge">{choirNames(m.choirs)}</span>}
            {m.isGuest && <span className="badge">🎻 {GUEST_LABEL}</span>}
            {m.voicePart && <span className="badge">{m.voicePart}</span>}
            {m.isAdmin && <span className="badge t-koncert">Admin</span>}
          </div>
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>Ha az adataid hibásak, szólj a kórusasszisztensnek.</p>
        </div>

        <div className="card">
          <h2>🔔 Értesítések a telefonon</h2>
          <p className="small">Az eseményekről és az emlékeztetőkről e-mailt mindenképp kapsz. Itt kapcsolhatod be, hogy a telefonod is jelezzen.</p>
          {!me.pushAvailable && <div className="notice warn">A telefonos értesítések a szerveren még nincsenek beállítva.</div>}
          {me.pushAvailable && iosNeedsInstall && (
            <div className="notice info">
              iPhone-on az értesítésekhez előbb tedd ki az appot a kezdőképernyőre: koppints a Safari <b>Megosztás</b> gombjára (⬆️), majd <b>„Főképernyőhöz adás”</b>. Ezután onnan nyisd meg az appot, és itt kapcsold be az értesítéseket.
            </div>
          )}
          {me.pushAvailable && !iosNeedsInstall && !pushSupported() && <div className="notice warn">Ez a böngésző nem támogatja az értesítéseket.</div>}
          {me.pushAvailable && pushSupported() && !iosNeedsInstall && (
            <button className={`btn block ${pushOn ? '' : 'primary'}`} disabled={busy || pushOn === null} onClick={togglePush}>
              {pushOn ? 'Értesítések kikapcsolása ezen az eszközön' : 'Értesítések bekapcsolása ezen az eszközön'}
            </button>
          )}
        </div>

        {m.isGuest ? (
          <div className="card">
            <h2>📅 Naptár</h2>
            <p className="small" style={{ marginBottom: 0 }}>Az eseményeket egyenként mentheted a naptáradba: nyisd meg az eseményt, és koppints a <b>„Mentés a naptárba”</b> részben a telefonodnak megfelelő gombra.</p>
          </div>
        ) : <CalendarCard isAdmin={m.isAdmin} />}

        {!isStandalone() && (
          <div className="card">
            <h2>📲 Az app telepítése</h2>
            {isIos()
              ? <p className="small">Safariban: <b>Megosztás</b> (⬆️) → <b>Főképernyőhöz adás</b>.</p>
              : <p className="small">Chrome-ban: a jobb felső <b>⋮</b> menü → <b>Telepítés</b> vagy <b>Hozzáadás a kezdőképernyőhöz</b>.</p>}
          </div>
        )}

        <button className="btn block danger" onClick={logout}>Kijelentkezés</button>
      </div>
    </>
  );
}
