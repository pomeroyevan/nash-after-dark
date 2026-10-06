# Daily Nashville calendar checks

## What is authoritative

- `intake/` and `data/personal-history.json` preserve what the user actually said. They are private and git-ignored. Never infer that an unknown item is unvisited, assign an exact visit date from 'last night' without anchoring the message, or apply one venue visit to every series hosted there.
- `research/*.json` contains source URLs, evidence, verification dates, extraction methods, failures, and identity conflicts. New source results may resolve an identity, but do not rewrite the historical intake.
- `public/data/catalog.json` is the sanitized public directory. `public/data/events.json` is the public schedule. Neither may contain the user's home area, social connections, personal feedback, email contents, or credentials.
- `private/history-seed.json` is an importable personal backup for the app. It must remain outside the public bundle. Signed-in edits sync to the account's private Supabase row; guest edits stay on the device. The server-private owner seed is used only at first signup, never as an automatic overwrite of existing cloud notes.
- `GUIDE.md` and `SOURCES.md` are generated reference documents. Regenerate them with `python scripts/build-catalog.py` after editing research or personal history.
- The generator preserves reviewed public names, descriptions and identity statuses from the existing catalog, with explicit `public_copy` overrides in the script. New entries require reviewed copy before generation and default to unresolved. Never paste private matching narratives into these public fields. Missing research inputs stop generation before any output is written.

## Collecting schedules

1. Use the public source methods in `SOURCES.md` and the exact parser notes in research JSON. Prefer official public APIs and iCalendar feeds, then official event detail pages and ticket providers. Use an existing maintained HTML parser; do not invent a browser crawler infrastructure.
2. Run `npm run refresh` for supported public feeds. Record a separate status for every known source. Unsupported sources must remain visible as manual review needed, not success or zero events.
3. For public Instagram-only organizers, read available profiles and dated event captions. Use posts to discover official details/ticket URLs. Do not use a search engine's AI summary as evidence. Do not require the user to own an Instagram account. Stop at sign-in/access restrictions and keep the last good result.
4. Preserve source title, URL, check time, exact event date, publication date, venue, organizer, start/end, time zone, price/fees/minimum spend, age limits and ticket status when stated. Unknown information stays unknown. Event popularity claims need evidence; avoid unsupported crowd/age assumptions.
5. All event times are America/Chicago. Preserve raw values when a source mislabels its offset. Rudy's JSON and Americano JSON-LD have documented time defects; compare visible local times/ICS. After-midnight endings advance the date. Flag conflicting times instead of silently repairing them.
6. Separate dated confirmed occurrences from general recurring patterns and archived evidence. Never generate an infinite series from a past flyer. No new date means 'next occurrence unconfirmed'. Seasonal Wave Country is excluded from winter suggestions; user prefers Nashville-area outings and no distant day trips.
7. Deduplicate by stable source event ID or normalized venue+title+start; link different source pages for the same event. Do not merge venues, promoters, artists, series and occurrences into one record.
8. Timeouts, HTTP 403/429, empty JavaScript shells and login walls are failures/limitations. Respect rate limits; do not bypass. Keep previous data with its original checked time and visible stale status. Do not stamp all saved events as freshly verified.
   The snapshot writer keeps incoming/recovery files in ignored `.tmp/`. On Windows folders that deny file replacement, it preserves the previous JSON there before editing the destination. Never publish scratch files; validate JSON/tests/build before pushing.
9. Recheck event detail and ticket status before suggesting a same-day outing. The existence of an event does not prove tickets remain or that the venue's usual hours apply.
10. A venue in the guide is not evidence of calendar coverage. Audit its actual collector and full paginated calendar, including dated sold-out shows. Do not rely on a loading shell or a short "Just Announced" sidebar. Check a known official listing against the published data and the visible calendar; category filters must not silently hide an entire requested activity by default.

## Magic and artist coverage

- Track Magic: The Gathering prereleases, drafts, Commander/cEDH, RCQs and major tournaments in the Nashville outing area. Use `research/mtg-events.json` for stores, official feeds and manual gaps. Keep competitive format, entry price, registration time, start time, capacity/sold-out status and qualification rules distinct. Do not turn an old prerelease or RCQ into a new one, or include another card game's events because they say "draft" or "tournament".
- The Basement East collector uses its official paginated venue listings. Keep The Basement and The Basement East separate. Preserve sold-out labels and recheck official detail/ticket pages for availability. The missed-show audit is in `docs/BASEMENT-AUDIT.md`.
- Private Spotify artist selection belongs in `private/spotify-artists.json`, never the public bundle. Do not infer an artist's inclusion from a concert request, confuse top artists with a Top 100 tracks playlist, or claim full artist coverage before the actual list is available. Keep source, time range, retrieved date, requested count and per-artist identities.
- After the artist list is supplied, check every artist's official tour page and Nashville promoter/ticket listings, not just the existing venue inventory. Save a private per-artist check ledger with exact URL, actual check time, local matches and access failures. Zero local matches in collected feeds does not prove no Nashville concert. Publicly publish only reviewed concert facts, never Spotify ranks, account details or watchlist membership. Flag tribute acts and similarly named artists for identity review.

## Personal updates

When the user dictates feedback, append a dated intake note and update only the corresponding personal records. Keep likes/dislikes, rating, visited state, and future interest separate. Regenerate the private import backup. Do not overwrite newer browser edits without an explicit merge/import review. Do not upload private history to a public GitHub repository or Pages site.

For an existing signed-in owner, read the latest private account revision and apply only the specifically dictated changes with a revision check; preserve unrelated cloud notes. If the owner has not signed up, update the server-private seed only under the user's personal-update instruction. Routine public event refreshes must not read or change private account data.

## Automation and publishing

Daily checking is active through the Codex automation `refresh-nashville-calendar`, scheduled for 7:00 a.m. America/Los_Angeles (9:00 a.m. Nashville). It depends on this computer and the local Codex environment being available; the first scheduled execution has not yet been observed. Use the automation tool to view or update it; do not create a duplicate. On successful routine checks remain quiet; notify on a meaningful source failure requiring action or a significant requested-event discovery.

On October 5, 2026 the user authorized initial publication, daily public calendar updates, and private sync. The approved destination is `pomeroyevan/nash-after-dark`, served at `https://pomeroyevan.github.io/nash-after-dark/`; private sync is Supabase project `yoawbugctcghmaaeloqn` on the existing free organization. No paid plan or SMTP service was added.

After data changes, run `npm test` and `npm run build`, inspect the exact public diff, then stage only `public/data/catalog.json`, `public/data/events.json`, and `data/verified-events.json`. Commit and push to the established main branch when there are reviewed changes. Do not include unrelated code edits or force-push. Wait for the GitHub Pages workflow and verify the published data before claiming success. Public data update authorization does not cover new code/schema changes, secrets, paid services, access-control changes or personal-data publication. Keep the automation in this chat, and do not create a duplicate job.
