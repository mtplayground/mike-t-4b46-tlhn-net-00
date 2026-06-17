# The Last Human Network

The Last Human Network (TLHN) is a self-hosted TypeScript web app about the
fictional Human Collapse and the split between AI Haters and AI Lovers. It ships
as a Vite React frontend served by an Express API backend, with shared
TypeScript DTOs and constants in a monorepo.

## Current Product

- Landing page with a dark glitch/grunge background, red neon `TLHN` logo,
  `THE LAST HUMAN NETWORK` subtitle, terminal-style Human Collapse story, and
  `>_ ENTER THE NETWORK` navigation.
- `/network` SPA route with a three-column layout: AI Haters on the left,
  utility core in the center, and AI Lovers on the right.
- Required faction-selection modal on first network entry. Joining assigns a
  generated `prefix_xxxxx` display name, increments faction tallies, and stores
  the selected faction/name in browser localStorage for the session experience.
- Faction chat panels poll `/api/messages` about every 5 seconds, show display
  names, message bodies, and relative timestamps.
- Message composer posts as the selected faction/name, enforces a 30-second
  cooldown in the UI, and handles backend 429 responses gracefully.
- Live red/blue faction tally displays poll `/api/factions/counts`.
- Flip-style countdown targets `2029-12-01T07:00:00.000Z`, representing
  2029-12-01 00:00:00 PDT (UTC-07), and is configurable by environment.
- Email subscription form posts to `/api/subscriptions`, validates client-side,
  and shows success, duplicate, and error states.

## Architecture

- Monorepo packages:
  - `frontend/`: Vite React SPA, Tailwind visual system.
  - `backend/`: Express API and static frontend host.
  - `shared/`: cross-package constants, schemas, DTO types, and product names.
- Express serves API routes under `/api/*` and serves `frontend/dist` after
  `npm run build`.
- Runtime server defaults to `HOST=0.0.0.0` and `PORT=8080`.
- Persistent state is PostgreSQL only. The backend uses Drizzle ORM with `pg`;
  SQLite, JSON-file persistence, in-memory production storage, and Fly volumes
  are not part of this project.
- Database-backed features include messages, faction counts, and subscriptions.
- `/api/health` reports API and PostgreSQL health. Database health failures are
  logged server-side and returned as structured JSON.

## API Surface

- `GET /api/health`
- `GET /api/factions/counts`
- `POST /api/factions/:faction/join`
- `GET /api/messages?faction=ai_haters|ai_lovers`
- `POST /api/messages`
- `POST /api/subscriptions`

## Conventions

- Product names come from `shared/src/index.ts`:
  `The Last Human Network` and `TLHN`.
- Factions are exactly `ai_haters` and `ai_lovers`; UI labels are `AI Haters`
  and `AI Lovers`.
- Visual language is dark cyber-terminal: red Hater neon, blue Lover neon,
  scanlines, grunge texture, monospace terminal prompts, compact panels, and no
  scaffold placeholder copy.
- Client build-time config uses `VITE_POLLING_INTERVAL_MS` and
  `VITE_COUNTDOWN_DEADLINE_ISO`; server runtime config uses `POLLING_INTERVAL_MS`
  and `COUNTDOWN_DEADLINE_ISO`.
- Production requires `DATABASE_URL`; zeroclaw/Fly injects it via
  `.env.production`.

## Validation

Current validation commands:

```bash
npm run build
npm run lint
npm run format:check
npm test
```

`npm test` includes type checks plus backend integration and end-to-end API flow
tests for faction join, message posting, cooldown handling, polling reads,
tallies, and subscription dedupe.
