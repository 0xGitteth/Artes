# Artes App (Vite + Firebase)

Productieklare React/Vite-app met Tailwind, Firebase Auth en Firestore. De app ondersteunt registratie/login, profielbeheer, posts met likes/comments en gevoelige-content voorkeuren.

## Vereisten
- Node 20
- Firebase project met Firestore en Authentication (email/wachtwoord)
- Vite environment variabelen:
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_STORAGE_BUCKET`
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `VITE_FIREBASE_APP_ID`

## Ontwikkelen
```bash
npm install
npm run dev
```
Open http://localhost:5173. De backend luistert op `process.env.PORT` (standaard 5000) via `npm start`.

## Build & testen
```bash
npm run build
npm start # serveert dist + API op ${PORT:-5000}
```

## Firestore security rules
De benodigde regels staan in `firestore.rules`.
Deploy ze met de Firebase CLI:
```bash
firebase init firestore # indien nog niet gedaan
firebase deploy --only firestore:rules
```

## Docker/Sliplane
De app draait in één container met Node/Express.

```bash
docker build -t artes-app .
docker run -p 5000:5000 \
  -e PORT=5000 \
  -e VITE_FIREBASE_API_KEY=... \
  -e VITE_FIREBASE_AUTH_DOMAIN=... \
  -e VITE_FIREBASE_PROJECT_ID=... \
  -e VITE_FIREBASE_STORAGE_BUCKET=... \
  -e VITE_FIREBASE_MESSAGING_SENDER_ID=... \
  -e VITE_FIREBASE_APP_ID=... \
  artes-app
```

### Sliplane deploy stappen
1. Maak een nieuw Firebase project en haal de webconfig op.
2. Zet bovenstaande Vite-variabelen als Secrets/Env vars in Sliplane.
3. Build stap: `npm ci && npm run build`.
4. Run stap: `npm ci --omit=dev && node server/index.js` (container luistert op `$PORT`).
5. Optioneel: deploy Firestore rules met de Firebase CLI voordat je live gaat.

