import { useEffect } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { TopBar, Spinner, Empty, useLoad } from '../components/ui.jsx';
import { formatShortIso } from '../util.js';

const ICONS = { announce: '📣', weekly: '⏰', daily: '⏰', manual: '⏰', missed: '😔', thanks: '🙂', change: '✏️', cancel: '🚫', rule: '⚠️' };

export default function Notifications({ onRead }) {
  const [data, error] = useLoad(() => api('/notifications'), []);

  useEffect(() => {
    if (data?.notifications.some((n) => !n.readAt)) {
      api('/notifications/read-all', { method: 'POST' }).then(onRead).catch(() => {});
    }
  }, [data, onRead]);

  return (
    <>
      <TopBar title="Értesítések" />
      <div className="page">
        {error && <div className="notice err">{error.message}</div>}
        {!data && !error && <Spinner />}
        {data && data.notifications.length === 0 && <Empty icon="🔔">Még nincs értesítésed.</Empty>}
        {data && data.notifications.length > 0 && (
          <div className="card">
            {data.notifications.map((n) => (
              <div key={n.id} className={`notif ${n.readAt ? '' : 'unread'}`} onClick={() => n.eventId && navigate(`/esemeny/${n.eventId}`)}>
                <div style={{ fontSize: 22 }}>{ICONS[n.kind] || '🔔'}</div>
                <div style={{ flex: 1 }}>
                  <div className="t">{n.title}</div>
                  <div className="small">{n.body}</div>
                  <div className="when">{formatShortIso(n.createdAt)}</div>
                </div>
                {!n.readAt && <span className="unread-dot" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
