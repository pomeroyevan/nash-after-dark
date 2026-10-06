# Basement East schedule audit

Checked October 5, 2026 Central (October 6 UTC).

The published calendar missed Greta Van Fleet because The Basement East was a manual-only source with no automatic collector. Its source record explicitly reported no tested adapter, and the calendar contained only one manually imported Emo Night occurrence. A directory entry was not schedule coverage.

The official `/calendar/` response contains a JavaScript calendar shell plus ten changing **Just Announced** items. That sidebar is not a complete schedule. The official [chronological Basement East list](https://www.thebasementnashville.com/basement-east-events/) has accessible server-rendered cards and pagination. This should have been checked when the calendar shell was incomplete.

Two real Greta Van Fleet performances are upcoming in the official venue list:

| Show date | Show / doors, Central | Official detail | Venue ticket status |
|---|---|---|---|
| October 10, 2026 | 8:30 p.m. / 7 p.m. CDT | [October 10](https://www.thebasementnashville.com/tm-event/greta-van-fleet-2/) | SOLD OUT |
| October 17, 2026 | 8:30 p.m. / 7 p.m. CDT | [October 17](https://www.thebasementnashville.com/tm-event/greta-van-fleet-3/) | SOLD OUT |

The October 3 residency date is historical. These are billed as the actual band, not a tribute. Both remaining shows are all ages. The venue detail pages group residency dates, so URL suffixes alone cannot identify a performance. TicketWeb IDs 14329134 and 14329144 distinguish the future occurrences. Ticket links were not accessible through the research fetch tool, so the venue's sold-out title is retained and current ticket price is omitted.

## Collector correction

`scripts/refresh-events.mjs` now uses the existing Cheerio dependency to parse the official chronological list. It:

- Follows every public Next page and validates page numbers, same-origin paths and a 50-page bound.
- Limits venue identity to The Basement East, excluding The Basement and Beast Pub.
- Reads explicit year/date, show time, doors, ticket URL, age restriction and sold-out wording.
- Uses TicketWeb IDs for stable occurrence identity and checks CDT/CST against America/Chicago, including the November time change.
- Filters the requested horizon only after every page is fetched; an out-of-window card cannot hide later cards.
- Rejects missing cards, unexpected grouped clocks, changed pagination, repeated pages and inconsistent event identity.
- Preserves last-good records and original check times if any page fails.
- Prefers a fresh live listing over a manual duplicate only when venue, exact start and an official event/ticket URL match. Reviewed activity tags are combined; old title, time, price and ticket status cannot overwrite the live record. Different dates or venues remain separate.

The live validation fetched all four pages: 67 dated cards, 53 within the requested 90-day horizon, including both Greta Van Fleet shows. Five focused tests cover real failure modes, pagination, horizon filtering, stable IDs, sold-out inclusion, timezone validation and manual/live deduplication.

The pre-correction public snapshot had 54 source records: 3 fully fetched, 10 partial, 36 manual and 5 covered by another source. Those records include artists, series and restaurants as well as venues. Only seven sources had automatic adapters; four of those adapters reported partial coverage. No failed source was recorded, which did not mean the source inventory was fully checked. The Basement East adapter is the eighth; two independent MTG adapters are being integrated in the same release. These counts describe the audited snapshot, not a guarantee about future runs.

## Visibility finding

Before this correction, the app defaulted to the Dancing filter. Even a collected rock concert could remain hidden, and untagged artist titles such as Greta Van Fleet did not match the music heuristic. Basement East records now receive an explicit music tag; the application filter/default changes are verified separately.

## Remaining limits

The collector covers published venue cards, not unannounced shows or ticket inventory. Recheck the official detail page before attending. A 90-day calendar excludes farther-ahead concerts; artist discovery needs a separate longer-horizon check and explicit disclosure of that boundary. An artist preference list must be sourced from an actual authorized Spotify export/account read before claiming coverage of that list.
