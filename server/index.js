import fs from 'fs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import posts from './data/posts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const DIST_PATH = path.resolve(__dirname, '../dist');
const SERVE_CLIENT = process.env.SERVE_CLIENT !== 'false';

const app = express();

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/posts', (_req, res) => {
  res.status(200).json({ posts });
});

if (SERVE_CLIENT && fs.existsSync(DIST_PATH)) {
  app.use(express.static(DIST_PATH));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
} else if (SERVE_CLIENT) {
  /* eslint-disable no-console */
  console.warn('dist/ map niet gevonden, statische bestanden worden niet geserveerd.');
  /* eslint-enable no-console */
}

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.status(404).send('Not found');
});

app.listen(PORT, () => {
  /* eslint-disable no-console */
  console.log(`Server listening on http://localhost:${PORT}`);
  /* eslint-enable no-console */
});
