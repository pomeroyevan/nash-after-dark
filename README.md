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

## Plan a day

Calendar opens to a vertical **Day** view in Nashville time. Jump with the date field, previous/next buttons, or **Month** grid. Overlapping events sit side by side; swipe sideways on a busy phone calendar. Dashed one-hour blocks mean the real end is unknown. **Agenda** gives a compact list; **All upcoming** spans dates.

Use **More filters** for budget, genre, venue, area, starting time and listing status. Budgets compare the highest known listed admission; fees or required extras may apply. Unknown prices never count as free. **List order** can prioritize time, recommendation score or the lowest listed price ceiling.

Filter options show matching event counts for the selected day (or the All upcoming range) and current search. Each count includes the other active filters. Zero-match choices disappear. An active selection that no longer matches stays removable, so changing dates cannot trap you in an empty result.

Recommendations combine your private saved events, followed/favorite venues, ratings and enabled search interests with price and source freshness. Switch between **Fit + value**, **Personal fit** and **Value**, and open an event's score to see its reasons. No public popularity or crowd rating is implied. Scores are computed in your browser; this adds no private sync schema.

Reviewed price checks live in `public/data/pricing.json`, with their exact source and check time, fee uncertainty, required spending and optional suggestions kept separate. Newer conflicting official prices take precedence. The Cobra collector preserves door prices, advance/door ranges, free nights and limited promotions.

## Add things to search for

Open **Search list** and add an artist, venue, event series, organizer or activity. An official link and private details help resolve it. Edit or pause items there. Pending research, last-check results and links into the guide/calendar show what has actually been checked.

Sign into the confirmed owner account and finish syncing to send additions to the daily job. Device-only items stay on that device until explicitly merged in Settings. Every daily run reads the current private list, prioritizes additions/edits, and rechecks enabled interests. It researches official sources, adds reviewed public facts and returns a private status. It does not instantly invent dates or guarantee access to blocked sources. See `docs/SEARCH-INTERESTS.md` for the worker contract.

## Photos and artist guides

Open an event for official photos or flyers and **Meet the artists**. **Explore → Artist guides** contains searchable musician profiles with genres, background, listening links, scene connections and documented visual style. Sources and check dates stay attached to the details. Coverage is incomplete; missing research and broken images are visible. Crowd makeup and fan clothing are not guessed.

Selected venue/organizer pages also have **Past flyers & scene photos**. Those archives never create future event dates. Images remain remote references, with attribution and original-source links; social image URLs can expire.

Run `npm run refresh` followed by `npm run refresh:media` for official calendar artwork. Reviewed profiles live in `data/artist-profiles.json`, archived galleries in `data/scene-galleries.json`, and the generated app payload in `public/data/music-details.json`. `node scripts/refresh-media.mjs --profiles-only` relinks reviewed inputs without fetching sources or changing their original check dates. See `docs/SOCIAL-SCRAPING.md` for the separately bounded, private-staging Apify collector.

## Private sync

Supabase Auth handles email/password sessions. PostgreSQL row-level security limits each account to its own history; the save RPC uses revisions to reject stale writes. Account-scoped local drafts preserve unsynced work, and conflicts offer both versions before any replacement. Only the client-safe publishable key is in `public/data/sync-config.json`. Database passwords, service keys, the owner email and seed are never in the public repository.

Run `npm test` for collector/privacy/sync model checks and `npm run test:ui` against the local app for browser flows. `scripts/verify-live-sync.mjs` additionally checks two independent browsers and real Supabase isolation using vault-injected credentials; it creates synthetic accounts and disables them afterward. It never accesses owner history.

## Project rules

Use maintained official tools and established open-source libraries. Make the smallest working change and verify it. Parallel edits must have disjoint ownership. Production data, deployments, deletes, billing, refunds, and secrets require approval. Reload and exercise user-facing flows in a browser before reporting them complete.
