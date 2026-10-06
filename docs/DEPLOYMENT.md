# Publication and private sync

The user authorized publication and daily calendar updates on October 5, 2026. Repository: `https://github.com/pomeroyevan/nash-after-dark`. Site: `https://pomeroyevan.github.io/nash-after-dark/`. Confirm the current GitHub Actions result and HTTPS response before reporting a release as live.

## What is public

- App code and public facts about Nashville venues, artists and events.
- `public/data/catalog.json` and `public/data/events.json`, including source verification/access status.
- Reviewed public event snapshots, collector code and general refresh instructions. Raw research and private reference guides are excluded. Review the git file list before the first push.
- `public/data/sync-config.json` contains the Supabase project URL and client-safe publishable key. It must never contain a service key or database password.

## What stays private

- `intake/`, `research/`, `private/`, `GUIDE.md`, `SOURCES.md`, `data/personal-history.json`, `data/preferences.json`, all `.env` files and browser backups.
- Your home area, friend/workplace connections, ratings, visits, freeform notes, search-list membership and search criteria.
- Signed-in history is stored in the account's Supabase row, protected by authentication and row-level security. Device-only history and per-account unsynced recovery remain local.

## Release process

1. Run `npm test`, `npm run build`, and browser checks. Inspect every staged filename and public-data diff. Do not use a forced add or force-push.
2. Push reviewed public files to `pomeroyevan/nash-after-dark` on `main`. Routine daily research may stage only the three public event/catalog JSON files listed in `FUTURE-CHECKS.md`.
3. GitHub Pages uses `.github/workflows/pages.yml`; the workflow tests, builds and uploads only `dist`. Wait for its deployment result.
4. Verify HTTPS, the `/nash-after-dark/` base path, catalog/events/manifest/config, and desktop/mobile browser flows. Run the prepared suite with `UI_BASE_URL=https://pomeroyevan.github.io/nash-after-dark/` when needed.
5. For sync changes, test with two separate browser contexts, server revision conflicts, anonymous denial and account isolation. Use only synthetic accounts. `scripts/verify-live-sync.mjs` reads credentials from environment variables, never project files; it disables test accounts after the check.

## Supabase setup

Project `yoawbugctcghmaaeloqn` is dedicated to this app in the existing free organization. The private-sync, owner-seed and search-interest compatibility migrations have been applied. `public.nash_private_state` is readable only by its authenticated owner; writes use `save_nash_private_state` with owner and revision checks. The compatibility migration preserves search interests when a legacy client omits that field. Client roles cannot directly update rows. Server-private `nash_private.owner_seed` is inaccessible to anonymous/authenticated clients and copies the exact matching owner's seed at signup without overwriting existing state.

Email confirmation must remain enabled. Authentication redirects are configured for the exact Pages subpath and local test origin. The built-in mailer only accepts organization-team emails and is limited; custom SMTP and paid services are not configured. The owner must choose a password and confirm signup. Local `private/SYNC-SETUP.md` contains the approved email and instructions. Existing dictated history is already stored in the private bootstrap table; no manual public import is required.

Server credentials are in the Windows API Key Vault as `NASH_SUPABASE_SERVICE_ROLE_KEY` and `NASH_SUPABASE_DB_PASSWORD`; the management token uses `SUPABASE_ACCESS_TOKEN`. Do not print or commit them. Never rerun schema creation blindly on an existing project, and never replace current cloud state with an old backup.

The daily checker is agent-assisted because several event promoters publish only on social media. The active chat automation is `refresh-nashville-calendar`, at 9:00 a.m. Nashville time. It may publish verified public data updates. Structured public feeds use `node scripts/refresh-events.mjs --days=90`; blocked/manual sources remain visible. The local Codex host must be available. Manual checks do not prove a scheduled wakeup ran; the first scheduled execution is still unverified.

Every run also pulls the confirmed owner's synced search interests using the narrow bridge in `docs/SEARCH-INTERESTS.md`, researches enabled items and applies version-checked private results. This is the only routine private-state exception; the job does not read or change personal history. `scripts/verify-live-sync.mjs` also verifies real worker SQL against a scoped synthetic fixture, legacy-client preservation, paused/edited request protection and phone-to-job-to-phone results. Owner signup and the first scheduled execution must be verified separately.
