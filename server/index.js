import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { artists, projects, inquiries } from './mockData.js';

const app = express();
const port = process.env.PORT || 8080;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

app.use(cors());
app.use(express.json());

app.get('/api/status', (_req, res) => {
  res.json({
    service: 'Artis API',
    status: 'online',
    version: '1.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/artists', (_req, res) => {
  res.json(artists);
});

app.get('/api/artists/:id', (req, res) => {
  const artist = artists.find((entry) => entry.id === req.params.id);
  if (!artist) {
    return res.status(404).json({ error: 'Artist not found' });
  }

  const spotlightProjects = projects.filter((project) => project.artistId === artist.id);
  return res.json({ ...artist, projects: spotlightProjects });
});

app.get('/api/projects', (_req, res) => {
  const enriched = projects.map((project) => ({
    ...project,
    artist: artists.find((artist) => artist.id === project.artistId),
  }));
  res.json(enriched);
});

app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body ?? {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Please include name, email, and message.' });
  }

  const entry = {
    id: `inq-${Date.now()}`,
    name,
    email,
    message,
    createdAt: new Date().toISOString(),
  };

  inquiries.push(entry);
  return res.status(201).json({
    message: 'Your inquiry has been recorded for the Artis team.',
    inquiry: entry,
    queueSize: inquiries.length,
  });
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Artis API listening on port ${port}`);
});
