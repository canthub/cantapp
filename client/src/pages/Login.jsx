import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLoggedIn }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem('lastEmail') || ''; } catch { return ''; }
  });
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const requestCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/request-code', { method: 'POST', body: { email } });
      try { localStorage.setItem('lastEmail', email); } catch { /* nem baj */ }
      setDevCode(res.devCode || null);
      setStep('code');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/verify', { method: 'POST', body: { email, code } });
      onLoggedIn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <img className="logo" src="/icons/icon-192.png" alt="" />
      <h1>Cantemus Kórus</h1>
      <p className="sub">Cantemus Vegyeskar · Pro Musica</p>
      <div className="card">
        {step === 'email' ? (
          <form onSubmit={requestCode}>
            <label className="field">
              <span>E-mail-címed</span>
              <input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nev@example.com" />
            </label>
            {error && <div className="notice err">{error}</div>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Küldés…' : 'Belépési kód kérése'}</button>
            <p className="hint" style={{ marginTop: 12 }}>A megadott címre egy 6 jegyű kódot küldünk. Jelszó nem kell.</p>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p>Elküldtük a belépési kódot ide: <b>{email}</b></p>
            {devCode && <div className="notice info">Fejlesztői mód (nincs e-mail-küldés beállítva) – a kód: <b>{devCode}</b></div>}
            <label className="field">
              <span>Belépési kód</span>
              <input className="code-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </label>
            {error && <div className="notice err">{error}</div>}
            <button className="btn primary block" disabled={busy || code.length !== 6}>{busy ? 'Belépés…' : 'Belépés'}</button>
            <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={() => { setStep('email'); setCode(''); setError(''); }}>Másik e-mail-cím / új kód</button>
          </form>
        )}
      </div>
    </div>
  );
}
