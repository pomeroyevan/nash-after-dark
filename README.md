# Nash After Dark

A Nashville events calendar and personal venue guide for phone and desktop. Mobile-first React with Ionic in iOS mode, public event sources, and private Supabase account sync.

## Start

```powershell
npm install
npm run refresh
npm run dev -- --host 127.0.0.1
```

`npm run build` creates the GitHub Pages-compatible static site. `npm test` checks the event parsers. No deployment or account creation happens from these commands.

The public catalog is already included. Regenerate it with `python scripts/build-catalog.py` only in the original private workspace, where the research and intake files exist. A public checkout does not contain those inputs.

## Data

In the original workspace, read the private reference files `GUIDE.md` for individual records and `SOURCES.md` for source-specific refresh methods. `FUTURE-CHECKS.md` contains future operating instructions. Research is time-stamped; unverified dates and blocked sources stay explicit. Raw research and those reference documents are ignored by Git because matching notes can include personal recollections. The public directory contains separately reviewed descriptions.

Private files in `intake/`, `data/personal-history.json`, `data/preferences.json`, and `private/` are ignored by Git. Sign into the same account on each device for private sync. Guests can still save device-only notes and export/import backups. Guest notes upload only through an explicit merge after sign-in.

The original owner's dictated history is seeded privately on account creation. Read the local `private/SYNC-SETUP.md` for the approved signup email. Email confirmation remains required. The current built-in email service only sends to organization team members and has a low rate limit; custom SMTP is not configured. No owner signup/confirmation is performed by the setup scripts.

The existing daily chat automation checks sources at 9 a.m. Nashville time and may publish verified public calendar updates to `pomeroyevan/nash-after-dark`, as authorized on October 5, 2026. It needs the local Codex host available. See `docs/DEPLOYMENT.md` for release and verification instructions.

## Private sync

Supabase Auth handles email/password sessions. PostgreSQL row-level security limits each account to its own history; the save RPC uses revisions to reject stale writes. Account-scoped local drafts preserve unsynced work, and conflicts offer both versions before any replacement. Only the client-safe publishable key is in `public/data/sync-config.json`. Database passwords, service keys, the owner email and seed are never in the public repository.

Run `npm test` for collector/privacy/sync model checks and `npm run test:ui` against the local app for browser flows. `scripts/verify-live-sync.mjs` additionally checks two independent browsers and real Supabase isolation using vault-injected credentials; it creates synthetic accounts and disables them afterward. It never accesses owner history.

## Project rules

Use maintained official tools and established open-source libraries. Make the smallest working change and verify it. Parallel edits must have disjoint ownership. Production data, deployments, deletes, billing, refunds, and secrets require approval. Reload and exercise user-facing flows in a browser before reporting them complete.
