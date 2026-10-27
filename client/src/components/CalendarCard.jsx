import { useEffect, useState } from 'react';
import { api, toast } from '../api.js';
import { isIos, isStandalone } from '../util.js';

// Személyes naptár-feliratkozás: a tag minden eseménye megjelenik a saját naptárában, és magától frissül.
export default function CalendarCard({ isAdmin }) {
  const [links, setLinks] = useState(null);
  // iPhone-on a kezdőképernyőről indított appból a webcal:// link gyakran nem indul el.
  const iosApp = isIos() && isStandalone();

  useEffect(() => {
    api('/calendar-link').then(setLinks).catch(() => setLinks(null));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(links.url);
      toast('Naptárlink kimásolva.');
    } catch {
      window.prompt('Másold ki a naptárlinket:', links.url);
    }
  };

  const reset = async () => {
    if (!confirm('Új naptárlinket kérsz? A régi link azonnal megszűnik, ezért a naptáradban újra fel kell iratkoznod.')) return;
    try {
      setLinks(await api('/calendar-link/reset', { method: 'POST' }));
      toast('Új naptárlink elkészült. Iratkozz fel rá újra!');
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  return (
    <div className="card">
      <h2>📆 Események a saját naptáradban</h2>
      <p className="small">
        Iratkozz fel egyszer, és minden eseményed magától megjelenik a telefonod naptárában. A módosítások és a lemondások is frissülnek.
        A cím elején a válaszod látszik: ✅ részt veszek · ❓ talán · ❌ nem · ⏳ még nem jeleztem vissza.
      </p>
      {!links ? <p className="hint">Betöltés…</p> : (
        <>
          {links.eventCount > 0 && <div className="notice ok">📌 A naptáradba jelenleg <b>{links.eventCount} esemény</b> kerül.</div>}
          {links.eventCount === 0 && !links.hasChoir && (
            <div className="notice warn">
              Még egyik kórushoz sem vagy hozzárendelve, ezért a naptárad üres lenne.
              {isAdmin ? <> Állítsd be: <b>Admin → Tagok →</b> a saját neved → pipáld be a kórus(oka)t.</> : ' Szólj a kórusasszisztensnek!'}
            </div>
          )}
          {links.eventCount === 0 && links.hasChoir && (
            <div className="notice info">Jelenleg nincs olyan közzétett esemény, amelyre meg vagy hívva. A feliratkozás ettől még működik: az új események magától megjelennek.</div>
          )}
          {iosApp && (
            <div className="notice info">
              <b>iPhone-on az appból a feliratkozás gomb nem mindig indul el.</b> Ha nem történik semmi:
              <ol className="result-list">
                <li>Koppints a <b>Link másolása</b> gombra.</li>
                <li>Nyisd meg a <b>Beállítások → Naptár → Fiókok → Fiók hozzáadása → Egyéb → Feliratkozott naptár hozzáadása</b> menüt.</li>
                <li>Illeszd be a linket, majd <b>Tovább → Mentés</b>.</li>
              </ol>
            </div>
          )}
          <div className="btnrow">
            <a className={`btn ${isIos() ? 'primary' : ''}`} href={links.webcalUrl}>🍎 iPhone / Mac naptár</a>
            <a className={`btn ${isIos() ? '' : 'primary'}`} href={links.googleUrl} target="_blank" rel="noreferrer">📅 Google Naptár</a>
            <button className="btn" onClick={copy}>🔗 Link másolása</button>
          </div>
          <details className="small">
            <summary>Segítség</summary>
            <ul className="result-list">
              <li><b>iPhone:</b> koppints az „iPhone / Mac naptár” gombra, majd a <b>Feliratkozás</b> gombra.</li>
              <li><b>Android / Google Naptár:</b> a Google Naptár telefonos appja nem tud feliratkozást hozzáadni. A „Google Naptár” gomb a böngészőben nyitja meg a naptárat, ott kattints a <b>Hozzáadás</b> gombra. Ezt számítógépen is megteheted, utána a telefonodon is megjelenik.</li>
              <li><b>Outlook és más naptár:</b> másold ki a linket, és add hozzá „Naptár hozzáadása internetről” / „Feliratkozás” néven.</li>
              <li>A naptárak a változásokat nem azonnal, hanem óránként–naponta töltik le. A pontos, friss állapot mindig az appban látszik.</li>
              <li>A link személyes, ne oszd meg másokkal!</li>
            </ul>
          </details>
          <button className="btn small" style={{ marginTop: 10 }} onClick={reset}>Új link kérése (a régi megszűnik)</button>
        </>
      )}
    </div>
  );
}
