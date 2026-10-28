import 'dotenv/config';
import { DEFAULT_DEADLINE_DAYS } from '../shared/constants.js';

const list = (value, fallback = []) =>
  value ? value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean) : fallback;

export const DEFAULT_REPORT_RECIPIENTS = [
  'korusasszisztens@cantemus.hu',
  'foldesi.ildiko@cantemus.hu',
  'szabo.soma@cantemus.hu',
  'support@cantemus.hu',
];

export const config = {
  port: Number(process.env.PORT || 3000),
  // Ha nincs megadva, a tárhely által adott nyilvános címet használjuk (Render: RENDER_EXTERNAL_URL).
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, ''),
  dbPath: process.env.DB_PATH || './data/cantapp.db',
  isProd: process.env.NODE_ENV === 'production',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  emailFrom: process.env.EMAIL_FROM || 'Cantemus Kórus <noreply@cantemus.hu>',
  // HTTPS-es levelezőszolgáltatás (megbízhatóbb tömeges küldés, és ott is működik, ahol az SMTP tiltva van):
  // EMAIL_PROVIDER=brevo vagy resend, EMAIL_API_KEY=… Ha meg van adva, az SMTP helyett ezt használjuk.
  emailApi: {
    provider: (process.env.EMAIL_PROVIDER || '').toLowerCase(),
    apiKey: process.env.EMAIL_API_KEY || '',
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:support@cantemus.hu',
  },
  adminEmails: list(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  reportRecipients: list(process.env.REPORT_RECIPIENTS, DEFAULT_REPORT_RECIPIENTS),
  // Budapesti idő szerint ennyi órától mennek ki az automatikus emlékeztetők.
  reminderHour: Number(process.env.REMINDER_HOUR || 9),
  // A határidő utáni napon ennyi órakor megy ki a riport.
  reportHour: Number(process.env.REPORT_HOUR || 8),
  // Ha egy eseménynél nincs megadva határidő, ennyi nappal az esemény előtt lesz.
  defaultDeadlineDays: Number(process.env.DEFAULT_DEADLINE_DAYS || DEFAULT_DEADLINE_DAYS),
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 5 * 60 * 1000),
  // Címből koordináta (OpenStreetMap Nominatim). GEOCODING=off kikapcsolja.
  geocoding: {
    enabled: process.env.GEOCODING !== 'off' && process.env.NODE_ENV !== 'test',
    url: process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search',
    contact: process.env.GEOCODER_CONTACT || 'support@cantemus.hu',
  },
};

export const emailApiEnabled = () => ['brevo', 'resend'].includes(config.emailApi.provider) && Boolean(config.emailApi.apiKey);
export const emailEnabled = () => emailApiEnabled() || Boolean(config.smtp.host);
export const pushEnabled = () => Boolean(config.vapid.publicKey && config.vapid.privateKey);
