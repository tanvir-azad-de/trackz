# trackz

Personal finance PWA: EUR-only, offline-first, with Google Drive sync.

- `trackz-app/` is the app (Vite + Preact + TypeScript).
- `api/` and `lib/` are the Vercel functions for the Drive OAuth exchange
  (see `api/README.md`).
- `docs/renovation_version_1.txt` is the project history and current status.

## Run locally

```sh
cd trackz-app
npm install
npm run dev     # do not connect Drive from here; see AGENTS.md
npm test
```

The repo root has its own `npm install` for the API typecheck
(`npm run typecheck:api`).
