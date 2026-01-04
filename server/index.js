import fs from 'fs';
import crypto from 'crypto';
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

const USERS_PATH = path.join(__dirname, 'data', 'users.json');

const readUsers = () => {
  if (!fs.existsSync(USERS_PATH)) {
    return { users: [], profiles: {} };
  }
  return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
};

const writeUsers = (data) => {
  fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2));
};

const findUserByToken = (token) => {
  if (!token) return null;
  const data = readUsers();
  const user = data.users.find((u) => u.token === token);
  return user || null;
};

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

app.post('/api/auth/signup', (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email en wachtwoord zijn verplicht.' });
  }
  const data = readUsers();
  const existing = data.users.find((u) => u.email === email);
  if (existing) {
    return res.status(409).json({ error: 'Er bestaat al een account met dit e-mailadres.' });
  }
  const uid = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const user = { uid, email, password, displayName: displayName || email.split('@')[0], token };
  data.users.push(user);
  writeUsers(data);
  return res.status(201).json({ user: { uid, email, displayName: user.displayName }, token });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const data = readUsers();
  const user = data.users.find((u) => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Ongeldige inloggegevens.' });
  }
  if (!user.token) {
    user.token = crypto.randomBytes(32).toString('hex');
    writeUsers(data);
  }
  return res.status(200).json({ user: { uid: user.uid, email: user.email, displayName: user.displayName }, token: user.token });
});

app.get('/api/me/profile', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = findUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Niet geautoriseerd' });
  const data = readUsers();
  return res.status(200).json({ profile: data.profiles[user.uid] || null });
});

app.put('/api/me/profile', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = findUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Niet geautoriseerd' });
  const data = readUsers();
  const payload = req.body || {};
  data.profiles[user.uid] = { ...payload, uid: user.uid };
  writeUsers(data);
  return res.status(200).json({ profile: data.profiles[user.uid] });
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
