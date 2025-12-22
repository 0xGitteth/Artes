# Artis
Artis is a social platform tailored for photographers, models, and other visual artists to share work, collaborate, and connect.

## Backend API

The project now includes a lightweight Express backend that exposes simple JSON endpoints for artists, projects, and contact messages.

- Start the API locally: `npm run server`
- Development mode with hot-reload for the frontend: `npm run dev`

The API listens on `PORT` (default `8080`) and also serves the built Vite frontend when the `dist/` directory is present.

## Deployment (Sliplane)
The project includes a multi-stage Dockerfile optimized for Sliplane. It builds the Vite app and serves the static bundle using `serve`.

1. Build the production image:
   ```bash
   docker build -t artis:latest .
   ```
2. Run the container locally to verify:
   ```bash
   docker run --rm -p 8080:8080 artis:latest
   ```
3. Configure Sliplane to deploy the built image. The container listens on port `8080` by default; set the `PORT` environment variable in Sliplane to change it if needed.
