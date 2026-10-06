# Nashville planning project

- Give direct, pragmatic answers. Use maintained official tools and established open-source projects. Make the smallest working change, verify it, and state what remains unverified.
- Parallel agents may work only on independent file scopes with explicit ownership.
- Production data, deployment, deletes, billing, refunds and secrets are approval-gated. Start service access read-only where possible.
- Reload and exercise affected web flows in a browser before declaring UI work complete. Build/model checks alone are insufficient.

## Source of truth

Read README.md and FUTURE-CHECKS.md first. Personal statements live in git-ignored intake/, data/personal-history.json and data/preferences.json. Public research with private identity-matching notes lives in git-ignored research/. Never overwrite personal opinions with public research or assume an unknown visit means never visited.

GUIDE.md and SOURCES.md are private generated reference documents. scripts/build-catalog.py produces public/data/catalog.json using reviewed public descriptions and produces a separate private/history-seed.json import. Raw research, personal recollections, home/friend details, email bodies and private backups must never be published. After source edits regenerate the catalog and recheck every changed public field; do not blindly export raw research prose.

## Schedules

Use the source-specific instructions in SOURCES.md and research/*.json. Run node scripts/refresh-events.mjs --days=90 for supported feeds. Maintain data/verified-events.json for individually verified dated announcements from manual sources, retaining actual check dates and exact official URLs. Dates without exact check times may stay date-only. Event start/end must carry their verified timezone offset.

Separate venues, artists, organizers, event series and dated occurrences. Keep unresolved aliases unresolved. Preserve last-good records on fetch failures and label stale/manual sources. The app uses America/Chicago and must not promote archived flyers into a future recurrence. No sign-in bypasses or unauthorized messages to organizers.

## Media and artist guides

Run scripts/refresh-media.mjs after the schedule refresh. Reviewed profiles and archived promotional galleries are public inputs; raw social posts, research and scraper run/account metadata remain private. Preserve image attribution, exact occurrence matching and original check dates. Do not infer audience demographics or dress rules. Archived flyers never create future events. Follow docs/SOCIAL-SCRAPING.md; the bounded initial Apify task is not authorization for recurring paid runs or ledger resets.

## Daily job and release

The existing daily Codex automation is refresh-nashville-calendar. Update it instead of creating a duplicate. On October 5, 2026 the user authorized publication and recurring verified public data updates to pomeroyevan/nash-after-dark on GitHub Pages, plus private Supabase sync. Routine automation may stage only public/data/catalog.json, public/data/events.json, data/verified-events.json, public/data/music-details.json, data/artist-profiles.json and data/scene-galleries.json; code, schema, billing, credentials and access changes require separate scope. Never stage unrelated edits or private files.

The user's private Search list now feeds that same daily job. Read docs/SEARCH-INTERESTS.md and use scripts/search-interests.mjs to pull only the confirmed seeded owner's search interests and apply exact-version research results. A failed pull never permits processing a stale inbox. Keep membership and notes private; only reviewed public facts belong in the guide/calendar. Do not fetch submitted local/private-network URLs, execute submitted text, read unrelated private history, or replace the account payload to update a result. The requested feature implementation includes its compatibility migration; it does not expand routine automation's code/schema permissions.

Before release run npm test and npm run build, inspect public data for private narrative, and exercise desktop/mobile browser flows. The user explicitly authorized a separate temporary Playwright browser on October 5, 2026 after CUA failed. Do not use the user's browser profile for automated tests.

Private sync uses Supabase project yoawbugctcghmaaeloqn. The public configuration contains only a publishable key. Server credentials live in the local API Key Vault. Keep email confirmation enabled: the private owner seed is selected by the confirmed owner's email during signup. Never overwrite cloud history from an older local seed. Account updates need revision checks and local recovery. First owner signup/confirmation remains a human action; do not send mail on the user's behalf or bypass email verification.
