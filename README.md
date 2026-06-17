# The Last Human Network

TLHN is scaffolded as a TypeScript monorepo with a Vite React frontend, an
Express backend, and a shared package for cross-app contracts.

## Structure

- `frontend/` - Vite + React client
- `backend/` - Express API server
- `shared/` - shared TypeScript constants and DTOs

## Commands

Install dependencies:

```bash
npm install
```

Run all dev servers:

```bash
npm run dev
```

Build everything:

```bash
npm run build
```

Start the built Express server:

```bash
HOST=0.0.0.0 PORT=8080 npm start
```
