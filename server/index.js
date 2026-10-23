import { config, emailEnabled, pushEnabled } from './config.js';
import { openDb } from './db.js';
import { ensureAdmins } from './models.js';
import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';
import { setAppUrl } from './services/notify.js';

openDb(config.dbPath);
ensureAdmins(config.adminEmails);
setAppUrl(config.appUrl);

createApp().listen(config.port, () => {
  console.log(`Cantemus Kórus app fut: ${config.appUrl} (port ${config.port})`);
  if (!emailEnabled()) console.warn('⚠️  Nincs SMTP beállítva – az e-mailek csak a konzolra kerülnek.');
  if (!pushEnabled()) console.warn('⚠️  Nincs VAPID kulcs – a push értesítések ki vannak kapcsolva (npm run vapid).');
  if (config.adminEmails.length === 0) console.warn('⚠️  Nincs ADMIN_EMAILS beállítva – senki sem tud adminként belépni.');
});

startScheduler();
