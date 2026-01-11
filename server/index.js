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

app.post('/api/auth/signup', (_req, res) => {
  res.status(410).json({ error: 'Legacy auth is verwijderd. Gebruik Firebase Auth.' });
});

app.post('/api/auth/login', (_req, res) => {
  res.status(410).json({ error: 'Legacy auth is verwijderd. Gebruik Firebase Auth.' });
});

app.get('/api/me/profile', (_req, res) => {
  res.status(410).json({ error: 'Legacy profiel endpoint is verwijderd.' });
});

app.put('/api/me/profile', (_req, res) => {
  res.status(410).json({ error: 'Legacy profiel endpoint is verwijderd.' });
});

if (SERVE_CLIENT && fs.existsSync(DIST_PATH)) {
  app.use(express.static(DIST_PATH));

  app.get(/^(?!\/api).*/, (_req, res) => {
    return res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
} else if (SERVE_CLIENT) {
  console.warn('dist/ map niet gevonden, statische bestanden worden niet geserveerd.');
}

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
