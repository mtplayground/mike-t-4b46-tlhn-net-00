# The Last Human Network

The Last Human Network is a TypeScript monorepo with a Vite React frontend, an
Express backend, shared DTO contracts, and PostgreSQL-backed persistent state.
The app ships as one self-hosted build: Express serves the compiled frontend and
the `/api/*` routes from `0.0.0.0:8080` by default.

## Structure

- `frontend/` - Vite + React client
- `backend/` - Express API server
- `shared/` - shared TypeScript constants and DTOs

The frontend uses Tailwind theme tokens for the TLHN dark/glitch visual system:
Hater red, Lover blue, neon glow utilities, scanlines, grunge noise, terminal
typography, faction chat panels, countdown, and subscription controls.

## Local Development

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Run all dev servers:

```bash
npm run dev
```

The Vite dev server proxies `/api` to the Express server on port `8080`.

## Validation

Run the same checks used before merging:

```bash
npm run build
npm run lint
npm run format:check
npm test
```

`npm test` runs type checks plus backend integration and end-to-end API flow
tests for faction join, message posting, cooldown handling, polling reads,
tallies, and subscription dedupe.

## Production Build

Build everything:

```bash
npm run build
```

Run database migrations:

```bash
DATABASE_URL=postgres://... npm run db:migrate
```

Start the built Express server:

```bash
HOST=0.0.0.0 PORT=8080 npm start
```

Required runtime environment:

- `DATABASE_URL` - PostgreSQL connection string.
- `HOST` - bind address, defaults to `0.0.0.0`.
- `PORT` - bind port, defaults to `8080`.
- `POLLING_INTERVAL_MS` - server log/runtime poll interval metadata, defaults to
  `5000`.
- `COUNTDOWN_DEADLINE_ISO` - countdown deadline metadata, defaults to
  `2029-12-01T07:00:00.000Z`.

Required frontend build-time environment:

- `VITE_POLLING_INTERVAL_MS` - browser polling interval, defaults to `5000`.
- `VITE_COUNTDOWN_DEADLINE_ISO` - browser countdown deadline, defaults to
  `2029-12-01T07:00:00.000Z`.

For zeroclaw/Fly deploys, `/workspace/.env.production` already receives the
managed PostgreSQL `DATABASE_URL`. Do not overwrite it; append only additional
settings when needed.

## Operational Notes

- Persistent state must stay in PostgreSQL. The app does not use SQLite,
  JSON-file persistence, in-memory production storage, or Fly volumes.
- Static assets are served from `frontend/dist` by the Express backend after
  `npm run build`.
- Health checks are available at `/api/health` and include database status.
- API errors return JSON; unexpected request errors are logged by the Express
  error handler before returning a generic `500`.
