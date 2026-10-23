import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { useRoute, match } from './router.js';
import { Spinner, Toasts } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Events from './pages/Events.jsx';
import EventDetail from './pages/EventDetail.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import AdminEvents from './pages/admin/AdminEvents.jsx';
import AdminEventDetail from './pages/admin/AdminEventDetail.jsx';
import AdminEventForm from './pages/admin/AdminEventForm.jsx';
import AdminMembers from './pages/admin/AdminMembers.jsx';
import AdminImport from './pages/admin/AdminImport.jsx';
import AdminSettings from './pages/admin/AdminSettings.jsx';

function BottomNav({ route, me }) {
  const item = (href, ico, label, active, badge) => (
    <a href={`#${href}`} className={active ? 'active' : ''}>
      <span className="ico">{ico}</span>
      {label}
      {badge > 0 && <span className="navbadge">{badge > 99 ? '99+' : badge}</span>}
    </a>
  );
  return (
    <nav className="bottomnav">
      {item('/', '📅', 'Események', route === '/' || route.startsWith('/esemeny'))}
      {item('/ertesitesek', '🔔', 'Értesítések', route === '/ertesitesek', me.unread)}
      {item('/profil', '👤', 'Profil', route === '/profil')}
      {me.member.isAdmin && item('/admin', '🛠️', 'Admin', route.startsWith('/admin'))}
    </nav>
  );
}

export default function App() {
  const route = useRoute();
  const [me, setMe] = useState(undefined);

  const refreshMe = useCallback(() => api('/me').then(setMe).catch((e) => {
    if (e.status === 401) setMe(null);
    else setMe((m) => m ?? null);
  }), []);

  useEffect(() => {
    refreshMe();
    const onFocus = () => document.visibilityState === 'visible' && refreshMe();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [refreshMe]);

  if (me === undefined) return <Spinner />;
  if (me === null) return <><Login onLoggedIn={refreshMe} /><Toasts /></>;

  const isAdmin = me.member.isAdmin;
  let page;
  let p;
  if (route === '/') page = <Events me={me} />;
  else if ((p = match('/esemeny/:id', route))) page = <EventDetail id={p.id} onChange={refreshMe} />;
  else if (route === '/ertesitesek') page = <Notifications onRead={refreshMe} />;
  else if (route === '/profil') page = <Profile me={me} />;
  else if (isAdmin && route === '/admin') page = <AdminEvents />;
  else if (isAdmin && route === '/admin/esemeny/uj') page = <AdminEventForm />;
  else if (isAdmin && (p = match('/admin/esemeny/:id/szerkesztes', route))) page = <AdminEventForm id={p.id} />;
  else if (isAdmin && (p = match('/admin/esemeny/:id', route))) page = <AdminEventDetail id={p.id} />;
  else if (isAdmin && route === '/admin/tagok') page = <AdminMembers me={me} />;
  else if (isAdmin && route === '/admin/import') page = <AdminImport />;
  else if (isAdmin && route === '/admin/beallitasok') page = <AdminSettings />;
  else page = <Events me={me} />;

  return (
    <div className="app">
      {page}
      <BottomNav route={route} me={me} />
      <Toasts />
    </div>
  );
}
