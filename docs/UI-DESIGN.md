# Nash After Dark UI

## Direction

A responsive, dark calendar for Nashville nights, using the official Ionic React components in iOS mode. This is a web app inspired by familiar iOS navigation, not an Apple native app or an official Apple design system implementation. The taste-skill marketing-page workflow was inspected and excluded because this is a multi-view product interface.

System fonts, large page titles, restrained coral actions, grouped surfaces, agenda-first browsing, and a month view keep event discovery practical. Small category colors distinguish dancing, live music, food and other events; they do not imply personal ratings or verification confidence. Empty states do not fabricate events.

### Mobile-first Cupertino refinement

The mobile styling uses neutral iOS-like dark grouped backgrounds (`#0b0b0d`, `#1c1c1e`, `#2c2c2e`), readable system typography, and a restrained coral action color. Event names stay at 17px on phones; venue and price metadata are 14px and 12px. Every search and form input is at least 16px to avoid iOS focus zoom. Primary actions, category filters, date controls, bookmark controls, and tab destinations have approximately 44px or larger hit areas. The seven-column date grid uses the available screen width and is about 44px wide per date at a 390px viewport.

Safe-area insets protect the content, bottom tab bar, and sheet fields from notches and the home indicator. Detail sheets use Ionic headers, a clearly visible Done action, 24px top corners, and independent scrolling. Reduced transparency and increased contrast preferences have CSS fallbacks. The phone layout is the design priority while the desktop sidebar and wider layout remain available. These styles are a web approximation of familiar Cupertino patterns, not native SwiftUI.

`index.html` includes iOS home-screen metadata and the relative `manifest.webmanifest` link. The manifest uses relative start, scope, and icon URLs so a GitHub Pages project subpath works. Icons include 192px and 512px PNGs, a safe-zone maskable 512px PNG, and a 180px Apple touch icon. It requests standalone display when saved to the home screen. There is no service worker or offline-cache claim: opening and refreshing still requires a connection. Home-screen behavior on an actual iPhone remains unverified until device/browser checks are possible.

## Official references checked 2026-10-05

- [Ionic React overview](https://ionicframework.com/docs/react/overview): maintained React components for web and mobile. `@ionic/react` supplies the app shell, iOS segments, modal, toolbar, buttons, spinner and toast. Ionicons provides the icon family.
- [Ionic config](https://ionicframework.com/docs/developing/config): `setupIonicReact({ mode: 'ios' })` runs before the first Ionic component renders.
- [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars): four persistent labeled destinations; navigation only, no export or save action hidden in a tab.
- [Apple sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars): a wider navigation sidebar on desktop, with compact bottom tabs on phones.
- [Apple Calendar views](https://support.apple.com/guide/iphone/change-how-you-view-events-iphfd1054569/ios): upcoming list and month views, date selection, and a Today action.

Direct HTTP to Ionic documentation returned 403, and Apple HIG returned a JavaScript shell. Official indexed documentation excerpts were reviewed through web search. No claim that a blocked page was fully read. React/Ionic package compatibility was checked with the official npm registry before installation.

## Behavior and accessibility

- All schedule dates, grouped days, and displayed times use `America/Chicago`, regardless of browser location. Calendar date arithmetic uses UTC noon to avoid viewer DST offsets.
- Agenda is the default. Selecting a day filters to that day; All upcoming clears the selection. Month navigation changes the visible grid; arrow keys move focus across dates.
- Calendar, Explore, My places and Settings remain available on mobile and desktop. Semantic native buttons, visible focus rings and labels supplement Ionic accessibility. Reduced-motion and reduced-transparency preferences have CSS fallbacks.
- Venue/artist/series entries remain separate from dated events. Event detail links to its venue. Related catalog IDs provide explicit venue/series connections.
- Events link to public source and ticket pages. Add to calendar downloads RFC 5545-style ICS with UTC timestamps, escaped text and folded lines. Missing end times are left missing rather than fabricated.
- Known facts, source status, and personal opinion are separate. Blank attendance is unknown, blank rating is unrated. Ratings are explicitly out of 10.

## Personal data contract

Only public catalog and event JSON are bundled. No home address, friend name or seeded personal history is in the frontend. Data is fetched using Vite's base path so project GitHub Pages paths work.

Browser storage key: `nash-after-dark.personal.v1`.

```json
{
  "version": 1,
  "exportedAt": "ISO timestamp",
  "history": {
    "catalog-id": {
      "attendance": "visited | not_visited | unknown",
      "rating": null,
      "notes": "",
      "liked": "",
      "disliked": "",
      "favorite": false,
      "watch": false,
      "updatedAt": "ISO timestamp or empty"
    }
  },
  "savedEventIds": []
}
```

Each write rereads the latest browser state to preserve unrelated edits from another tab. The storage event updates other open tabs. A same-entry form conflict shows a Load latest action before the user chooses whether to save their current edits. Save and storage errors are surfaced, not treated as successful persistence.

Backup import validates the full file and shows a merge preview before writing. Imported records replace matching IDs; unrelated records and saved-event IDs are retained. Export includes all personal records, even entries no longer in the public catalog. Storage remains device-local. Cross-device cloud sync, authentication and notifications are not claimed or implemented.

## Verification scope

TypeScript/build and live browser flow checks are required before handoff. Phone sizing can be checked with an actual browser viewport; local desktop rendering alone does not verify iPhone Safari or installation behavior.

The current production build passes. Model checks cover Nashville dates, malformed backups, safe URLs, multi-category filtering, scoped catalog inclusion, and calendar-file encoding. `tests/ui.spec.ts` defines four browser flows against the actual local app and public datasets, plus synthetic backup preview/import, note persistence/cross-tab behavior, malformed-import preservation, backup export, ICS download, and a 390px phone layout. The backup fixture is generated in memory using a real public catalog ID and entirely fictional test notes; no private file or real personal history is accessed, so the test works in a clean checkout. Test discovery (`npx playwright test tests/ui.spec.ts --list`) passes.

The user authorized Playwright after CUA failed. All five browser flows pass in fresh Edge contexts: real data/filtering, calendar/detail/ICS/save, synthetic backup/reload/cross-tab preservation, a 390px phone layout, and intercepted signup redirects (no email sent). Live Supabase checks also passed using separate phone and desktop browser contexts, including server-private signup seeding, two-way persistence, anonymous denial, cross-account denial and stale-write rejection. Synthetic test accounts were disabled afterward. This does not claim physical iPhone Safari testing or successful delivery of the owner's confirmation email.

Run `npm run test:ui` with the local app on port 5173, or set `UI_BASE_URL` to the published URL with its trailing slash. Tests use a fresh headless Edge context, never the user's browser profile; `UI_BROWSER_CHANNEL=chrome` can select installed Chrome. Screenshots stay under gitignored `test-results/`.
