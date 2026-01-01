# Artes

Een Vite + React applicatie met een eenvoudige Node/Express-backend.

## Ontwikkeling

1. Installeer afhankelijkheden: `npm install`.
2. Start de backend: `npm start` (standaard op poort 5000).
3. Start de frontend in een tweede terminal: `npm run dev` (Vite proxy't `/api` automatisch naar poort 5000).
4. Open http://localhost:5173 in je browser.

### Beschikbare API-routes
- `GET /api/health` – eenvoudige health-check met uptime en timestamp.
- `GET /api/posts` – levert demo-posts uit de lokale datastore.

## Productie

1. Build de frontend: `npm run build` (output in `dist/`).
2. Start de server: `npm start` (serveert API-routes en statische assets).

## Docker

Een multi-stage Dockerfile is beschikbaar:

```bash
# bouwen
npm ci
npm run build
# of via Docker
DOCKER_BUILDKIT=1 docker build -t artes .
# draaien
docker run -p 5000:5000 artes
```

De container serveert de backend op poort 5000 en levert tegelijkertijd de gecompileerde frontend-bestanden vanuit `dist/`.
