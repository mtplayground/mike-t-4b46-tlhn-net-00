# The Last Human Network

The Last Human Network (TLHN) is a self-hosted web app about the fictional Human
Collapse and the split between AI Haters and AI Lovers. It ships as a Vite React
SPA served by a Rust Axum backend, with shared TypeScript DTO contracts and
PostgreSQL-backed state in a monorepo.

## Current Product

- App shell header includes a responsive upper-left `TLHN` wordmark using the
  terminal font, red Hater color, and glow treatment. Mobile shell/header/nav
  spacing is tightened and desktop spacing returns at `sm:` breakpoints.
- Landing page with a dark glitch/grunge background, red neon `TLHN` logo,
  `THE LAST HUMAN NETWORK` subtitle, terminal-style Human Collapse story, and
  `>_ ENTER THE NETWORK` navigation. On phones, the logo, story spacing, and
  story typography scale down so the hero fits without excess vertical chrome.
- Site favicon served from `/favicon.svg`: a dark rounded TLHN tile with a red
  neon mark that matches the product brand.
- `/network` SPA route with a single-column full-width layout. Desktop/tablet
  order is compact large countdown band, live tally cards, unified feed,
  composer, Identity/Faction/Transmission utility line, subscription row, and
  site footer. On phones, the unified feed is raised above live tallies so users
  reach messages sooner. The network page no longer includes a separate TLHN
  header/action box above the content.
- Required faction-selection modal on first network entry. Joining assigns a
  generated `prefix_xxxxx` display name, increments faction tallies, sets
  HttpOnly faction/name cookies through the API, and stores the identity in
  browser localStorage for the session experience.
- Unified scrollable faction feed polls `/api/messages` without a faction
  filter, renders both factions in one time-ordered list without extra feed
  headings, colors display names by faction, and uses red broken-fist and blue
  circuit-heart faction logos instead of generic avatars. Individual messages do
  not repeat the `AI Haters` / `AI Lovers` faction label as visible text. The
  feed is visually tight: the chat panel has reduced left padding and each
  message card has no inner padding.
- Chat feed initially loads the latest 25 messages, renders oldest-to-newest so
  the newest message sits at the bottom, supports scroll-up infinite history
  loading via `before_id` while preserving scroll position, and formats relative
  timestamps as minutes, hours/minutes, or days/hours.
- Message composer posts as the selected faction/name and enforces a
  30-second cooldown strictly in the client UI after successful posts. The
  server separately applies a transient frequency limiter of at most two
  messages per client per second; its `429` response shows a brief "slow down"
  notice without starting the 30-second cooldown.
- Compact live faction tally cards poll `/api/factions/counts`; they render AI
  Haters in red with `HUMANS FIGHTING BACK`, AI Lovers in blue with `EMBRACING
  THE FUTURE`, and neon numerals. Phone layouts reduce tally padding,
  min-height, label size, and count size while restoring larger cards at `sm:`+.
- The Identity / Faction / Transmission utility line appears as three columns on
  medium and larger screens, stacks vertically on small screens, and uses tight
  top spacing to stay visually connected to the surrounding network sections.
- Flip-style countdown targets `2029-12-01T07:00:00.000Z`, representing
  2029-12-01 00:00:00 PDT (UTC-07), and is configurable by environment. Phone
  layouts use shorter boxes and smaller labels/numerals; larger countdown
  treatment returns at `sm:`+.
- Full-width neon `KEEP YOUR HUMANITY UPDATES` subscription row sits near the
  bottom just above the footer without side triangle/zig-zag accents, posts to
  `/api/subscriptions`, validates client-side, and shows success, duplicate, and
  error states.
- Bottom footer shows `© 2025 TLHN. All rights reserved.`, Manifesto/Privacy/
  Terms/Contact links, an X link, and a Discord logo link.

## Architecture

- Monorepo packages:
  - `frontend/`: Vite React SPA and Tailwind TLHN visual system.
  - `backend/`: Rust Axum API server, static frontend host, SQL migrations, and
    Rust integration tests.
  - `shared/`: cross-package constants, Zod schemas, DTO types, and product
    names.
- Root JavaScript workspaces are `frontend` and `shared`; the backend is built
  with Cargo from `backend/Cargo.toml`.
- `npm run build` builds shared types, the Rust backend, and the frontend.
  `npm start` runs the Rust backend binary.
- Rust Axum serves API routes under `/api/*`, serves `frontend/dist`, and falls
  back non-API paths to `index.html` for SPA routing. Static asset resolution
  supports both repo-local execution and the Sprite runtime layout at
  `/opt/app/frontend/dist`.
- Middleware includes mirrored-origin credentialed CORS, compression, request
  tracing, static serving, and security headers.
- Runtime server defaults to `HOST=0.0.0.0` and `PORT=8080`; production start
  uses the release Rust binary at `target/release/tlhn-backend`.
- Persistent state is PostgreSQL only via `sqlx`; SQLite, JSON-file persistence,
  in-memory production storage, and Fly volumes are not part of this project.
- Database-backed features include messages, faction counts, and subscriptions.
- `/api/health` reports API, product, and PostgreSQL health and returns `503`
  when the database check fails.
- Startup logging emits an INFO-only deployment separator so verifier log tails
  clearly reflect the current Rust service rather than stale historical process
  output.

## API Surface

- `GET /api/health`
- `GET /api/factions/counts`
- `POST /api/factions/:faction/join`
- `GET /api/messages?faction=ai_haters|ai_lovers&limit=25&before_id=123`
  - `faction` is optional; omitted means the combined feed.
  - Returns `{ messages, has_more }` newest-first.
  - `limit` defaults to 25 and is capped at 50.
  - `before_id` pages older messages using the message id cursor.
- `POST /api/messages`
  - Accepts at most two messages per client key in a sliding one-second window.
  - The third immediate post returns `429`, `Retry-After: 1`, and
    `retry_after_ms` / `retry_after_seconds` metadata with
    `Message post rate limit active`.
- `POST /api/subscriptions`

## Conventions

- Product names come from `shared/src/index.ts`: `The Last Human Network` and
  `TLHN`.
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

`npm test` runs TypeScript type checks plus Rust integration tests. The Rust
integration tests start a local PostgreSQL 16 instance, apply the checked-in SQL
migrations, and cover health, faction join idempotency, message validation,
pagination, server frequency limiting, client cooldown contracts,
subscription dedupe, SPA fallback, and an end-to-end API flow.
