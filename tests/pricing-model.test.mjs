import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePricing, withPricing } from '../src/pricing.ts';

test('reviewed prices keep exact provenance and cannot overwrite newer conflicting amounts', () => {
  const detail = { priceText: '$15', sourceUrl: 'https://venue.example.com/show', checkedAt: '2026-10-05T15:00:00Z', feeStatus: 'unknown', spendText: '', caveat: 'Fees unknown' };
  const prices = parsePricing({ events: { show: { ...detail, personalNotes: 'PRIVATE' }, bad: { ...detail, sourceUrl: 'http://localhost' } } });
  assert.deepEqual(prices, { show: detail });
  const event = { id: 'show', priceText: '$20', checkedAt: '2026-10-06T12:00:00Z' };
  assert.equal(withPricing(event, detail), event);
  assert.equal(withPricing({ ...event, priceText: '' }, detail).pricing.checkedAt, detail.checkedAt);
});

test('published pricing contains reviewed fields only and exact current event IDs', () => {
  const data = JSON.parse(readFileSync(new URL('../public/data/pricing.json', import.meta.url), 'utf8'));
  const events = JSON.parse(readFileSync(new URL('../public/data/events.json', import.meta.url), 'utf8')).events;
  assert.deepEqual(Object.keys(data).sort(), ['events', 'version']);
  for (const [id, detail] of Object.entries(data.events)) {
    assert.ok(events.some(event => event.id === id));
    assert.deepEqual(Object.keys(detail).sort(), ['caveat','checkedAt','feeStatus','priceText','sourceUrl','spendText']);
  }
  assert.equal(Object.keys(parsePricing(data)).length, Object.keys(data.events).length);
});
