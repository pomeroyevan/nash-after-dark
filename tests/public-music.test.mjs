import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicUrl } from '../src/music.ts';

const read = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const music = read('public/data/music-details.json');
const profiles = read('data/artist-profiles.json');
const scenes = read('data/scene-galleries.json');
const keys = (value, allowed) => { for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `Unreviewed media field: ${key}`); };
const date = value => assert.ok(typeof value === 'string' && Number.isFinite(Date.parse(value)), `Missing media check date: ${value}`);
const url = value => assert.ok(publicUrl(value), `Unsafe or missing public URL: ${value}`);
const images = value => value.forEach(image => {
  keys(image, ['url', 'sourceUrl', 'alt', 'kind', 'credit', 'checkedAt', 'sourceOnly']);
  url(image.url); url(image.sourceUrl); date(image.checkedAt);
  assert.ok(image.alt); assert.ok(['flyer', 'artist', 'artwork'].includes(image.kind));
});

test('public music data contains only reviewed fields and attributed media', () => {
  keys(music, ['version', 'checkedAt', 'events', 'entries', 'artists', 'sources']);
  keys(profiles, ['artists']); keys(scenes, ['entries']);
  for (const artist of [...music.artists, ...profiles.artists]) {
    keys(artist, ['id', 'name', 'summary', 'genres', 'origin', 'sections', 'links', 'images', 'sources', 'checkedAt', 'eventTitles', 'eventIds']);
    assert.ok(artist.name && artist.summary); date(artist.checkedAt); images(artist.images);
    assert.ok(artist.sources.length);
    for (const source of artist.sources) { keys(source, ['url', 'label', 'checkedAt']); url(source.url); date(source.checkedAt); }
    for (const section of artist.sections) {
      keys(section, ['title', 'body', 'sourceUrls']); assert.ok(section.sourceUrls.length);
      section.sourceUrls.forEach(value => { url(value); assert.ok(artist.sources.some(source => source.url === value), `Unlisted section source for ${artist.id}`); });
    }
    for (const link of artist.links) { keys(link, ['label', 'url']); url(link.url); }
  }
  for (const event of Object.values(music.events)) {
    keys(event, ['images', 'artistIds', 'genres', 'sourceGenres', 'sourceUrl', 'checkedAt', 'status', 'message']);
    images(event.images); url(event.sourceUrl); date(event.checkedAt);
    assert.ok(['ok', 'partial', 'failed'].includes(event.status));
  }
  for (const source of music.sources) { keys(source, ['id', 'name', 'url', 'status', 'checkedAt', 'message']); url(source.url); date(source.checkedAt); }
  for (const gallery of [...Object.values(music.entries), ...Object.values(scenes.entries)]) {
    keys(gallery, ['images', 'note']); images(gallery.images); assert.match(gallery.note, /archived|past/i);
  }
});

test('media links known events and artists, keeping archived galleries separate', () => {
  const eventIds = new Set(read('public/data/events.json').events.map(event => event.id));
  const entryIds = new Set(read('public/data/catalog.json').entries.map(entry => entry.id));
  const artistIds = new Set(music.artists.map(artist => artist.id));
  assert.equal(artistIds.size, music.artists.length);
  const archiveUrls = new Set(Object.values(music.entries).flatMap(gallery => gallery.images.map(image => image.url)));
  for (const [id, event] of Object.entries(music.events)) {
    assert.ok(eventIds.has(id), `Unknown enriched event ${id}`);
    event.artistIds.forEach(artist => assert.ok(artistIds.has(artist), `Unknown linked artist ${artist}`));
    event.images.forEach(image => assert.ok(!archiveUrls.has(image.url), `Archived flyer attached to occurrence ${id}`));
  }
  Object.keys(music.entries).forEach(id => assert.ok(entryIds.has(id), `Unknown gallery ${id}`));
});
