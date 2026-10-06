import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
const calendar = JSON.parse(readFileSync(new URL('../public/data/events.json', import.meta.url), 'utf8'));
const forbidden = new Set(['history', 'personal', 'attendance', 'rating', 'liked', 'disliked', 'sentiment', 'raw_labels', 'base_neighborhoods', 'personal_history']);
function checkKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!forbidden.has(key), `Private field leaked into public output: ${key}`);
    checkKeys(child);
  }
}

test('public output excludes private feedback fields and unreviewed research narrative', () => {
  checkKeys(catalog); checkKeys(calendar);
  const allowed = new Set(['id', 'name', 'kind', 'description', 'area', 'address', 'officialUrl', 'tags', 'identityStatus', 'sourceCheckedAt', 'relatedIds', 'scheduleSources', 'inScope', 'scopeNote']);
  for (const entry of catalog.entries) {
    for (const key of Object.keys(entry)) assert.ok(allowed.has(key), `Unreviewed public field: ${key}`);
    assert.ok(['identified', 'candidate', 'unresolved'].includes(entry.identityStatus));
  }
});

test('every listed event links to a known venue and source with an explicit time offset', () => {
  const venues = new Set(catalog.entries.map(entry => entry.id));
  const sources = new Set(calendar.sources.map(source => source.id));
  assert.equal(venues.size, catalog.entries.length, 'Duplicate catalog identity');
  assert.equal(sources.size, calendar.sources.length, 'Duplicate calendar source');
  assert.equal(new Set(calendar.events.map(event => event.id)).size, calendar.events.length, 'Duplicate event identity');
  for (const event of calendar.events) {
    assert.ok(venues.has(event.venueId), `Unknown venue: ${event.venueId}`);
    assert.ok(sources.has(event.sourceId), `Unknown source: ${event.sourceId}`);
    assert.match(event.start, /(?:Z|[+-]\d{2}:\d{2})$/);
    assert.ok(Number.isFinite(Date.parse(event.start)));
    assert.ok(['confirmed', 'needs_verification'].includes(event.status));
  }
});

test('private workspace artifacts cannot appear at production paths', () => {
  for (const path of ['private', 'intake', 'research', 'GUIDE.md', 'SOURCES.md', 'data/personal-history.json', 'data/preferences.json']) {
    assert.equal(existsSync(new URL('../public/' + path, import.meta.url)), false, `Private public path: ${path}`);
    assert.equal(existsSync(new URL('../dist/' + path, import.meta.url)), false, `Private build path: ${path}`);
  }
});
