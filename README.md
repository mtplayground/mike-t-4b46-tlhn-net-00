# The Last Human Network

The Last Human Network is a monorepo with a Vite React frontend, a Rust Axum
backend, shared TypeScript DTO contracts, and PostgreSQL-backed persistent
state. The app ships as one self-hosted build: the Rust backend serves the
compiled frontend and `/api/*` routes from `0.0.0.0:8080` by default.

## Structure

- `frontend/` - Vite + React client
- `backend/` - Rust Axum API server and PostgreSQL migrations
- `shared/` - shared TypeScript constants and DTOs

The frontend uses Tailwind theme tokens for the TLHN dark/glitch visual system:
Hater red, Lover blue, neon glow utilities, scanlines, grunge noise, terminal
typography, unified faction feed, countdown, tallies, and subscription controls.

## Local Development

Install JavaScript dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Run the shared TypeScript watcher, Rust API server, and Vite frontend:

```bash
npm run dev
```

The Vite dev server proxies `/api` to the Rust server on port `8080`.

## Validation

Run the same checks used before merging:

```bash
npm run build
npm run lint
npm run format:check
npm test
```

`npm test` runs TypeScript type checks plus the Rust test suite. Rust integration
tests start a local PostgreSQL 16 instance, apply the checked-in SQL migrations,
and cover health, faction join idempotency, message validation, pagination,
cooldown handling, subscription dedupe, SPA fallback, and an end-to-end API flow.

## Production Build

Build everything:

```bash
npm run build
```

Run database migrations:

```bash
DATABASE_URL=postgres://... npm run db:migrate
```

Start the built Rust server:

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
- `MCTAI_EMAIL_URL` and `MCTAI_EMAIL_APP_TOKEN` - optional platform email
  service endpoint and credential for server-side welcome emails. If either is
  absent, email sending is a no-op that logs.
- `NEWSLETTER_FROM_EMAIL` - optional reply-to address for newsletter/welcome
  email messages.
- `RESEND_API_KEY` - legacy compatibility config only; the app does not call
  Resend directly in production.

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
- Static assets are served from `frontend/dist` by the Rust backend after
  `npm run build`.
- Health checks are available at `/api/health` and include database status.
- API errors return JSON; database failures are logged by the Rust route handlers
  before returning generic server errors.
- Welcome-email delivery is routed through the platform email service from the
  Rust backend and degrades to a logged no-op when email env vars are absent.
