import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSession, requireAdmin } from './auth.js';
import { memberRouter } from './routes/member.js';
import { adminRouter } from './routes/admin.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(loadSession);

  // CSRF-védelem: módosító kérést csak a saját oldalunkról fogadunk el.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'cantapp') return res.status(403).json({ error: 'Érvénytelen kérés.' });
    next();
  });

  // Állapotellenőrzés a tárhelynek (pl. Railway healthcheck).
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/admin', requireAdmin, adminRouter);
  app.use('/api', memberRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Nem található.' }));

  if (fs.existsSync(DIST)) {
    app.use(express.static(DIST, {
      setHeaders(res, file) {
        if (file.endsWith('sw.js') || file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Váratlan hiba történt. Kérlek, próbáld újra!' : err.message });
  });

  return app;
}
