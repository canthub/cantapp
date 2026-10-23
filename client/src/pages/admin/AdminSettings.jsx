import { useEffect, useState } from 'react';
import { api, toast } from '../../api.js';
import { TopBar, Spinner } from '../../components/ui.jsx';
import { AdminNav } from './AdminEvents.jsx';

export default function AdminSettings() {
  const [recipients, setRecipients] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/admin/settings').then((s) => setRecipients(s.reportRecipients.join('\n'))).catch((e) => toast(e.message, 'err'));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('/admin/settings', { method: 'PUT', body: { reportRecipients: recipients.split(/[\s,;]+/).filter(Boolean) } });
      setRecipients(res.reportRecipients.join('\n'));
      toast('Beállítások elmentve.');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const test = async (kind) => {
    try {
      const res = await api(`/admin/test/${kind}`, { method: 'POST' });
      if (kind === 'email') toast(res.logged ? 'Nincs e-mail-küldés beállítva – a levél csak a szerver naplójába került.' : 'Teszt e-mail elküldve a saját címedre.');
      else toast(res.sent ? 'Teszt értesítés elküldve.' : 'Nincs push feliratkozásod – előbb kapcsold be a Profil oldalon.', res.sent ? 'ok' : 'err');
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  return (
    <>
      <TopBar title="Admin" />
      <div className="page">
        <AdminNav active="/admin/beallitasok" />
        <div className="card">
          <h2>📧 Riport címzettjei</h2>
          <p className="small">Minden esemény végleges riportja a visszajelzési határidőt követő napon reggel automatikusan ezekre a címekre megy ki.</p>
          {recipients === null ? <Spinner /> : (
            <form onSubmit={save}>
              <label className="field"><span>Címzettek (soronként egy)</span><textarea rows={6} value={recipients} onChange={(e) => setRecipients(e.target.value)} /></label>
              <button className="btn primary" disabled={busy}>Mentés</button>
            </form>
          )}
        </div>
        <div className="card">
          <h2>🧪 Kipróbálás</h2>
          <div className="btnrow">
            <button className="btn" onClick={() => test('email')}>Teszt e-mail magamnak</button>
            <button className="btn" onClick={() => test('push')}>Teszt push értesítés magamnak</button>
          </div>
        </div>
        <div className="card">
          <h2>💾 Adatmentés</h2>
          <p className="small">A teljes adatbázis (tagok, események, visszajelzések) letöltése egyetlen fájlban. Érdemes havonta egyszer letölteni és biztonságos helyen (pl. Google Drive) tárolni.</p>
          <a className="btn" href="/api/admin/backup">⬇️ Teljes adatmentés letöltése</a>
        </div>
        <div className="card">
          <h2>ℹ️ Automatikus működés</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Közzétételkor az érintett kórus tagjai azonnal értesítést kapnak (app, push, e-mail).</li>
            <li>Aki nem jelzett vissza: hetente egy emlékeztető, a határidő előtti utolsó héten naponta (reggel 9-től).</li>
            <li>Visszajelzéskor: „Köszönjük, hogy visszajeleztél nekünk! 🙂”.</li>
            <li>A határidő után az esemény lezárul (látható, de nem jelölhető), a vissza nem jelzők üzenetet kapnak.</li>
            <li>A határidőt követő napon reggel 8-kor a riport kimegy a fenti címekre.</li>
            <li>Koncertre csak az jelölhet részvételt, aki a kapcsolódó főpróbára is jelölt.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
