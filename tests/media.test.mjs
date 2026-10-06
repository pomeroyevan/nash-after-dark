import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichBourbon, extractSourceMedia, linkArtistProfiles, parseArtistProfiles, parseSceneGalleries, refreshMedia, safeMediaUrl } from '../scripts/refresh-media.mjs';

const checkedAt = '2026-10-06T02:00:00Z';
const refresh = options => refreshMedia({ entriesInput: { entries: {} }, catalogInput: null, ...options });
const event = (id, url, title = 'Artist A') => ({ id, url, title, start: '2026-10-10T20:00:00-05:00', sourceId: id.split(':')[0], venueName: 'Official venue' });
const source = (id, url = 'https://venue.example.com/events') => ({ id, url, name: 'Official venue' });

test('media URL validation rejects embedded credentials, local addresses, empty and data placeholders', () => {
  for (const url of ['', 'data:image/svg+xml,placeholder', 'javascript:alert(1)', 'https://name:secret@example.com/image.jpg', 'http://127.0.0.1/image', 'http://10.1.2.3/image', 'http://172.16.0.1/image', 'http://192.168.1.4/image', 'http://[::1]/image', 'http://localhost/image']) assert.equal(safeMediaUrl(url, 'https://venue.example.com/events'), '');
  assert.equal(safeMediaUrl('/poster.jpg', 'https://venue.example.com/events'), 'https://venue.example.com/poster.jpg');
});

test('Cobra extracts official bounded artwork and excludes descriptions/private extras', () => {
  const raw = { id: 42, title: 'Artist A', url: 'https://venue.example.com/events/a', image: { url: 'https://venue.example.com/full.jpg', sizes: { large: { url: 'https://venue.example.com/large.jpg' } } }, description: 'UNPUBLISHED_RAW_LONG_BIO', privateNotes: 'PRIVATE_SENTINEL' };
  const actual = extractSourceMedia(source('cobra'), [{ body: JSON.stringify({ events: [raw] }) }], [event('cobra:42', raw.url)], checkedAt).get('cobra:42');
  assert.equal(actual.images[0].url, 'https://venue.example.com/large.jpg');
  assert.equal(actual.images[0].sourceUrl, raw.url); assert.equal(actual.images[0].checkedAt, checkedAt);
  assert.doesNotMatch(JSON.stringify(actual), /UNPUBLISHED_RAW_LONG_BIO|PRIVATE_SENTINEL/);
});

test('Rudy image uses the official renderer path and exact title plus local event clock', () => {
  const raw = [{ title: 'Artist A', start: '2026-10-10T20:00:00+00:00', image: 'Artist_A.jpg', description: 'A long biography must stay out of automatically published data.' }, { title: 'Artist A', start: '2026-10-11T20:00:00+00:00', image: 'Wrong_date.jpg' }];
  const html = `<script>fullCalendar({events:${JSON.stringify(raw)}})</script>`;
  const actual = extractSourceMedia(source('rudys-jazz-room', 'https://www.rudysjazzroom.com/calendar'), [{ body: html }], [event('rudys-jazz-room:one', 'https://tickets.example.com/a')], checkedAt).get('rudys-jazz-room:one');
  assert.equal(actual.images[0].url, 'https://rudysjazzroom.com/bandimages/Artist_A.jpg');
  assert.equal(actual.images.length, 1); assert.equal(actual.images[0].kind, 'artist');
});

test('Eastside calendar images cover events beyond the shorter list; list supplies explicit genre', () => {
  const one = event('eastside-bowl:1', 'https://tickets.example.com/one'), two = event('eastside-bowl:2', 'https://tickets.example.com/two');
  const html = `<div class="seetickets-calendar-event-container"><img src="https://media.example.com/one.jpg"><div class="seetickets-calendar-event-title"><a href="${one.url}">A</a></div></div><div class="seetickets-calendar-event-container"><img src="https://media.example.com/two.jpg"><div class="seetickets-calendar-event-title"><a href="${two.url}">B</a></div></div><div class="seetickets-list-event-container"><img src="https://media.example.com/one.jpg"><div class="title"><a href="${one.url}">A</a></div><div class="genre">Indie</div></div>`;
  const actual = extractSourceMedia(source('eastside-bowl'), [{ body: html }], [one, two], checkedAt);
  assert.equal(actual.get(one.id).images.length, 1); assert.deepEqual(actual.get(one.id).genres, ['Indie']);
  assert.equal(actual.get(two.id).images[0].url, 'https://media.example.com/two.jpg');
});

test('Eastside shared ticket URLs keep each dated flyer with its own occurrence', () => {
  const one = event('eastside-bowl:1', 'https://tickets.example.com/shared');
  const two = { ...event('eastside-bowl:2', one.url), start: '2026-10-11T20:00:00-05:00' };
  const card = (day, poster) => `<td><span class="date-number">${day}</span><div class="seetickets-calendar-event-container"><img src="https://media.example.com/${poster}.jpg"><div class="seetickets-calendar-event-title"><a href="${one.url}">Artist A</a></div></div></td>`;
  const html = `<div class="seetickets-calendar-year-month-container">October 2026</div><table class="seetickets-calendar"><tr>${card(10, 'one')}${card(11, 'two')}</tr></table><div class="seetickets-list-event-container"><img src="https://media.example.com/list-one.jpg"><p class="date">Sat Oct 10</p><p class="title"><a href="${one.url}">Artist A</a></p></div>`;
  const actual = extractSourceMedia(source('eastside-bowl'), [{ body: html }], [one, two], checkedAt);
  assert.deepEqual(actual.get(one.id).images.map(i => i.url), ['https://media.example.com/one.jpg', 'https://media.example.com/list-one.jpg']);
  assert.deepEqual(actual.get(two.id).images.map(i => i.url), ['https://media.example.com/two.jpg']);
});

test('Five Spot rejects generated SVG data placeholders and venue logos', () => {
  const one = event('five-spot:1', 'https://venue.example.com/shows/1/'), two = event('five-spot:2', 'https://venue.example.com/shows/2/');
  const html = `<div class="event-card"><div class="event-poster-container"><img src="data:image/svg+xml,placeholder"></div><a href="${one.url}">Poster</a></div><div class="event-card"><div class="event-poster-container"><img src="https://venue.example.com/logo.png"></div><a href="${two.url}">Logo</a></div>`;
  const actual = extractSourceMedia(source('five-spot'), [{ body: html }], [one, two], checkedAt);
  assert.equal(actual.get(one.id).images.length, 0); assert.equal(actual.get(two.id).images.length, 0);
});

test('artist matching is exact, preserves a tribute distinction, and strips unreviewed extra fields', () => {
  const profiles = parseArtistProfiles({ artists: [{ id: 'artist-a', name: 'Artist A', summary: 'Reviewed public summary.', genres: ['Jazz'], checkedAt, eventTitles: ['Artist A'], eventIds: ['source:explicit'], sources: [{ url: 'https://artist.example.com/about', label: 'Official artist biography', checkedAt }], history: 'PRIVATE_SENTINEL' }] });
  const matches = linkArtistProfiles([event('source:one', 'https://example.com/one', '  ARTIST A '), event('source:tribute', 'https://example.com/tribute', 'A Tribute to Artist A'), event('source:explicit', 'https://example.com/explicit', 'Festival bill')], profiles);
  assert.deepEqual(matches.get('source:one'), ['artist-a']); assert.deepEqual(matches.get('source:tribute'), []); assert.deepEqual(matches.get('source:explicit'), ['artist-a']);
  assert.doesNotMatch(JSON.stringify(profiles), /PRIVATE_SENTINEL|history/);
  assert.throws(() => parseArtistProfiles({ artists: [{ id: 'bad', name: 'Unsourced', checkedAt }] }), /requires verified public sources/);
});

test('Bourbon deduplicates repeated dates, caches full artist photos and preserves stale photos on failure', async () => {
  const venue = source('bourbon-street', 'https://www.bourbonstreetbluesandboogiebar.com/schedule');
  const artistUrl = 'https://www.bourbonstreetbluesandboogiebar.com/artist/view/artist-a';
  const metadata = new Map([['one', { images: [], artistUrl }], ['two', { images: [], artistUrl }]]);
  let calls = 0;
  const stats = await enrichBourbon(venue, metadata, { events: {} }, checkedAt, async () => { calls++; return '<section class="artistDetail"><h1 class="artist-title">Artist A</h1><img src="/uploaded/artist/A.jpg"></section>'; });
  assert.equal(calls, 1); assert.equal(stats.unique, 1); assert.deepEqual(metadata.get('one').images, metadata.get('two').images);
  const previous = { events: { one: { images: metadata.get('one').images } } };
  const later = new Map([['one', { images: [], artistUrl }]]);
  await enrichBourbon(venue, later, previous, '2026-10-07T02:00:00Z', async () => { throw new Error('must not fetch'); });
  assert.equal(later.get('one').images[0].checkedAt, checkedAt);
  const stale = new Map([['one', { images: [], artistUrl }]]);
  await enrichBourbon(venue, stale, previous, '2026-10-16T02:00:00Z', async () => { throw new Error('network failed'); });
  assert.equal(stale.get('one').images[0].checkedAt, checkedAt); assert.match(stale.get('one').message, /previous official photo retained/);
});

test('failed bulk source keeps original artwork check time and visible failure state', async () => {
  const one = event('cobra:42', 'https://cobranashville.com/event/a');
  const old = { images: [{ url: 'https://cobranashville.com/poster.jpg', sourceUrl: one.url, alt: 'A poster', kind: 'flyer', checkedAt: '2026-10-01T00:00:00Z' }], artistIds: [], genres: [], sourceUrl: one.url, checkedAt: '2026-10-01T00:00:00Z', status: 'ok' };
  const result = await refresh({ now: new Date(checkedAt), calendar: { events: [one], sources: [] }, previous: { events: { [one.id]: old }, sources: [] }, profileInput: { artists: [] }, request: async () => { throw new Error('HTTP 403'); } });
  assert.deepEqual(result.events[one.id].images, old.images); assert.equal(result.events[one.id].checkedAt, old.checkedAt);
  assert.equal(result.events[one.id].status, 'failed'); assert.equal(result.sources[0].status, 'failed');
});

test('a temporarily missing image and absent curated file preserve last-good evidence', async () => {
  const one = event('cobra:42', 'https://cobranashville.com/event/a');
  const media = { url: 'https://cobranashville.com/old.jpg', sourceUrl: one.url, alt: 'Previous artwork', kind: 'artwork', checkedAt: '2026-10-01T00:00:00Z' };
  const artist = { id: 'artist-a', name: 'Artist A', summary: 'Reviewed profile', genres: ['Jazz'], eventTitles: ['Artist A'], checkedAt, sources: [{ url: one.url, label: 'Official', checkedAt }] };
  const payload = { total: 1, total_pages: 1, events: [{ id: 42, title: one.title, start_date: '2026-10-10 20:00:00', end_date: '2026-10-10 22:00:00', timezone: 'America/Chicago', url: one.url }] };
  const result = await refresh({ root: new URL('../.tmp/nonexistent-media-fixture', import.meta.url).pathname, now: new Date(checkedAt), calendar: { events: [one], sources: [] }, previous: { artists: [artist], events: { [one.id]: { images: [media] } }, sources: [] }, request: async () => JSON.stringify(payload) });
  assert.deepEqual(result.events[one.id].images, [media]);
  assert.equal(result.events[one.id].status, 'partial');
  assert.match(result.events[one.id].message, /Previous official/);
  assert.equal(result.artists[0].id, artist.id);
  assert.deepEqual(result.events[one.id].artistIds, [artist.id]);
  assert.deepEqual(result.events[one.id].genres, ['Jazz']);
});

test('unsupported manual sources expose a gap without inventing a venue-logo image', async () => {
  const one = event('manual:one', 'https://venue.example.com/event');
  const result = await refresh({ now: new Date(checkedAt), calendar: { events: [one], sources: [] }, previous: { events: {}, sources: [] }, profileInput: { artists: [] }, request: async () => { throw new Error('must not request unsupported source'); } });
  assert.deepEqual(result.events[one.id].images, []); assert.equal(result.events[one.id].status, 'partial'); assert.match(result.events[one.id].message, /not been verified/);
});

test('same source ID with a changed event date does not silently inherit newly fetched artwork', async () => {
  const one = event('cobra:42', 'https://cobranashville.com/event/a');
  const payload = { total: 1, total_pages: 1, events: [{ id: 42, title: one.title, start_date: '2026-10-11 20:00:00', end_date: '2026-10-11 22:00:00', timezone: 'America/Chicago', url: one.url, image: { url: 'https://cobranashville.com/new-date-poster.jpg' } }] };
  const result = await refresh({ now: new Date(checkedAt), calendar: { events: [one], sources: [] }, previous: { events: {}, sources: [] }, profileInput: { artists: [] }, request: async () => JSON.stringify(payload) });
  assert.deepEqual(result.events[one.id].images, []); assert.equal(result.events[one.id].status, 'partial'); assert.match(result.events[one.id].message, /exact event\/date was not matched/);
});

test('profiles-only refresh makes no source requests and preserves checked source state', async () => {
  const one = event('cobra:42', 'https://cobranashville.com/event/a');
  const priorSource = { id: 'cobra', name: 'Cobra', url: 'https://cobranashville.com/', status: 'ok', checkedAt: '2026-10-01T00:00:00Z', message: 'Artwork checked.' };
  const old = { images: [], artistIds: [], genres: [], sourceUrl: one.url, checkedAt: priorSource.checkedAt, status: 'partial' };
  const result = await refresh({ now: new Date(checkedAt), selected: [], calendar: { events: [one], sources: [] }, previous: { events: { [one.id]: old }, sources: [priorSource] }, profileInput: { artists: [] }, request: async () => { throw new Error('must not request'); } });
  assert.deepEqual(result.sources[0], priorSource); assert.equal(result.events[one.id].checkedAt, old.checkedAt);
});

test('reviewed artwork labels replace photo assumptions without changing original image check dates', async () => {
  const one = event('bourbon-street:42', 'https://venue.example.com/a');
  const oldImage = { url: 'https://venue.example.com/cover.jpg', sourceUrl: 'https://venue.example.com/artist/a', alt: 'Artist photo', kind: 'artist', checkedAt: '2026-10-01T00:00:00Z' };
  const reviewedImage = { ...oldImage, kind: 'artwork', alt: 'Reviewed album cover', checkedAt };
  const result = await refresh({ now: new Date(checkedAt), selected: [], calendar: { events: [one], sources: [] }, previous: { events: { [one.id]: { images: [oldImage], artistIds: [], genres: [], sourceUrl: one.url, checkedAt: oldImage.checkedAt, status: 'ok' } }, sources: [] }, profileInput: { artists: [{ id: 'artist-a', name: 'Artist A', summary: 'Public summary', genres: [], eventIds: [one.id], checkedAt, images: [reviewedImage], sources: [{ url: oldImage.sourceUrl, label: 'Official artist page', checkedAt }] }] }, request: async () => { throw new Error('must not request'); } });
  assert.equal(result.events[one.id].images[0].kind, 'artwork');
  assert.equal(result.events[one.id].images[0].alt, reviewedImage.alt);
  assert.equal(result.events[one.id].images[0].checkedAt, oldImage.checkedAt);
});

test('relinking removes old curated genre claims while preserving overlapping source genres', async () => {
  const one = event('cobra:42', 'https://cobranashville.com/event/a');
  const old = { images: [], artistIds: ['artist-a'], genres: ['Blues', 'Rock'], sourceGenres: ['Blues'], sourceUrl: one.url, checkedAt, status: 'partial' };
  const profile = { id: 'artist-a', name: 'Artist A', summary: 'Reviewed summary.', genres: ['Funk'], checkedAt, eventTitles: ['Artist A'], sources: [{ url: 'https://artist.example.com/about', label: 'Official', checkedAt }] };
  const result = await refresh({ now: new Date(checkedAt), selected: [], calendar: { events: [one], sources: [] }, previous: { events: { [one.id]: old }, artists: [{ ...profile, genres: ['Blues', 'Rock'] }], sources: [] }, profileInput: { artists: [profile] }, request: async () => { throw new Error('must not request'); } });
  assert.deepEqual(result.events[one.id].sourceGenres, ['Blues']); assert.deepEqual(result.events[one.id].genres, ['Blues', 'Funk']);
});

test('archived scene galleries preserve image check dates and never become future event artwork', async () => {
  const one = event('manual:future', 'https://venue.example.com/event', 'Upcoming night');
  const archived = { url: 'https://media.example.com/archived.jpg', sourceUrl: 'https://organizer.example.com/past-edition', alt: 'Archived flyer for a past edition', kind: 'flyer', credit: 'Official organizer', checkedAt: '2026-08-22T18:30:00-05:00', rawCaption: 'RAW_CAPTION_SENTINEL' };
  const gallery = { images: [archived], note: 'Archived August flyer; not a future event announcement.', privateMatchNote: 'PRIVATE_MATCH_SENTINEL' };
  const common = { now: new Date(checkedAt), selected: [], calendar: { events: [one], sources: [] }, profileInput: { artists: [] }, catalogInput: { entries: [{ id: 'known-series' }] }, request: async () => { throw new Error('must not fetch'); } };
  const result = await refresh({ ...common, previous: { events: {}, sources: [] }, entriesInput: { entries: { 'known-series': gallery } } });
  assert.equal(result.entries['known-series'].images[0].checkedAt, archived.checkedAt);
  assert.deepEqual(result.events[one.id].images, []);
  assert.doesNotMatch(JSON.stringify(result), /RAW_CAPTION_SENTINEL|PRIVATE_MATCH_SENTINEL/);
  // Explicit null models a missing manual source; retain the last reviewed gallery unchanged.
  const retained = await refresh({ ...common, previous: result, entriesInput: null });
  assert.deepEqual(retained.entries, result.entries);
  assert.throws(() => parseSceneGalleries({ entries: { unknown: gallery } }, common.catalogInput), /Unknown or invalid/);
});
