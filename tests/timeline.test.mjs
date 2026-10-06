import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOnDay, peakOverlap, timelineDayBounds, timelineEventInterval } from '../src/timeline.ts';

const event = (id, start, end) => ({ id, title: id, start, end, venueId: 'v', venueName: 'Venue', sourceId: 'source', status: 'confirmed', url: 'https://example.com/event', tags: [], checkedAt: '2026-10-05T12:00:00Z' });

test('day timeline carries verified overnight events into the next Nashville day', () => {
  const overnight = event('overnight', '2026-10-05T23:00:00-05:00', '2026-10-06T02:00:00-05:00');
  const atMidnight = event('midnight', '2026-10-06T00:00:00-05:00', '2026-10-06T01:00:00-05:00');
  const endsAtMidnight = event('ends-at-midnight', '2026-10-05T22:00:00-05:00', '2026-10-06T00:00:00-05:00');
  assert.deepEqual(eventsOnDay([overnight, atMidnight, endsAtMidnight], '2026-10-06').map(x => x.id), ['overnight', 'midnight']);
  assert.deepEqual(eventsOnDay([overnight, atMidnight], '2026-10-05').map(x => x.id), ['overnight']);
});

test('unpublished end time has a bounded display interval without altering source data', () => {
  const source = event('unknown', '2026-10-05T23:30:00-05:00');
  const before = JSON.stringify(source);
  const interval = timelineEventInterval(source);
  assert.equal(interval.hasEnd, false);
  assert.equal(interval.end - interval.start, 60 * 60 * 1000);
  assert.equal(eventsOnDay([source], '2026-10-06').length, 1);
  assert.equal(JSON.stringify(source), before);
  assert.equal(timelineEventInterval(event('bad-end', source.start, '2026-10-05T20:00:00-05:00')).hasEnd, false);
  assert.equal(timelineEventInterval(event('no-offset', source.start, '2026-10-06T01:00:00')).hasEnd, false);
  assert.equal(timelineEventInterval(event('bad-start', 'invalid')), null);
});

test('overlap width counts concurrent events while allowing touching intervals', () => {
  const events = [event('a', '2026-10-05T19:00:00-05:00', '2026-10-05T20:00:00-05:00'), event('b', '2026-10-05T20:00:00-05:00', '2026-10-05T21:00:00-05:00'), event('c', '2026-10-05T19:30:00-05:00', '2026-10-05T20:30:00-05:00')];
  assert.equal(peakOverlap(events, '2026-10-05'), 2);
  assert.equal(peakOverlap(events.slice(0, 2), '2026-10-05'), 1);
  assert.equal(peakOverlap(events, '2026-10-06'), 0);
});

test('Nashville day boundaries handle spring and fall DST independently of device timezone', () => {
  const spring = timelineDayBounds('2026-03-08'), fall = timelineDayBounds('2026-11-01');
  assert.equal(spring.end - spring.start, 23 * 60 * 60 * 1000);
  assert.equal(fall.end - fall.start, 25 * 60 * 60 * 1000);
  assert.equal(spring.changesOffset, true); assert.equal(fall.changesOffset, true);
  assert.equal(new Date(timelineDayBounds('2026-10-05').start).toISOString(), '2026-10-05T05:00:00.000Z');
  assert.equal(timelineDayBounds('2026-02-30'), null);
  assert.equal(timelineDayBounds('not-a-date'), null);
});
