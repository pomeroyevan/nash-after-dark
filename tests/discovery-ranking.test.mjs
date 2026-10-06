import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBackup, emptyPersonal } from '../src/model.ts';
import { emptyMusic } from '../src/music.ts';
import { parsePrice, budgetMatches, scoreEvent, matchesDiscovery, eventAvailability, eventGenres, nashvilleMinutes } from '../src/discovery.ts';

const event = (changes = {}) => ({ id: 'show:1', title: 'A Real Band', venueId: 'venue', venueName: 'The Venue', sourceId: 'source', start: '2026-10-06T20:00:00-05:00', tags: ['music'], status: 'confirmed', checkedAt: '2026-10-05T12:00:00Z', url: 'https://example.com/show', ...changes });
const context = (changes = {}) => ({ personal: emptyBackup(), now: '2026-10-06T12:00:00Z', sources: [{ id: 'source', status: 'ok' }], ...changes });
const interest = (changes = {}) => ({ id: 'i1', name: 'A Real Band', kind: 'artist', enabled: true, notes: '', sourceUrl: '', createdAt: '2026-10-05T12:00:00Z', updatedAt: '2026-10-05T12:00:00Z', ...changes });

test('price parsing preserves honest unknowns, extras and open-ended costs', () => {
  assert.deepEqual(parsePrice(), { kind: 'unknown', label: 'Price not published' });
  assert.equal(parsePrice('Price not published').kind, 'unknown');
  assert.equal(parsePrice('Free show').kind, 'free');
  assert.equal(parsePrice('No entry fee.').max, 0);
  assert.equal(parsePrice('Admission is free').kind, 'free');
  for (const text of ['$10 suggested donation', 'Free with required purchase', 'Free before 8 pm', 'Entry: 5 nonperishable items.', 'Free parking', 'Not free', '$0 entry with required purchase']) {
    const price = parsePrice(text);
    assert.notEqual(price.kind, 'free', text);
    assert.equal(budgetMatches(price, '15'), false, text);
    assert.equal(price.label, text);
  }
  assert.equal(parsePrice('From $10').max, undefined);
  assert.equal(parsePrice('$10+').max, undefined);
});

test('budget caps use the highest listed tier, not the cheapest teaser price', () => {
  assert.deepEqual(parsePrice('$10–20'), { kind: 'paid', min: 10, max: 20, label: '$10–20' });
  assert.equal(budgetMatches(parsePrice('$10 ADV I $20 DOS'), '15'), false);
  assert.equal(budgetMatches(parsePrice('$10.00-$175.00'), '30'), false);
  assert.equal(budgetMatches(parsePrice('$15.00'), '15'), true);
  assert.equal(budgetMatches(parsePrice('$15.01'), '15'), false);
  assert.equal(budgetMatches(parsePrice('$30 plus tax'), '30'), true);
  assert.equal(parsePrice('$30 plus tax').feesIncluded, false);
  assert.equal(budgetMatches(parsePrice('from $10'), 'known'), true);
  assert.equal(budgetMatches(parsePrice('unknown'), 'known'), false);
});

test('explicit tax is added and conflicting source prices are not a range', () => {
  assert.deepEqual(parsePrice('$30 plus $2.92 sales tax.'), { kind: 'paid', min: 32.92, max: 32.92, label: '$30 plus $2.92 sales tax.' });
  assert.equal(budgetMatches(parsePrice('$30 plus $2.92 sales tax.'), '30'), false);
  assert.equal(parsePrice('Venue ticket page: $23. Wizards event listing: $30; verify current price.').max, undefined);
});

test('reviewed source wording keeps admission, promotions and suggested spending distinct', () => {
  assert.deepEqual(parsePrice('$15 ADV I $20 DOS'), { kind: 'paid', min: 15, max: 20, label: '$15 ADV I $20 DOS' });
  assert.deepEqual(parsePrice('Free admission'), { kind: 'free', min: 0, max: 0, label: 'Free admission' });
  const special = parsePrice('Ticket special $35 limited time');
  assert.equal(special.kind, 'paid');
  assert.equal(special.min, 35);
  assert.equal(special.max, undefined);
  // A reviewed separate spend field can accompany a clean admission price without
  // requiring the parser to guess which dollar amount is mandatory.
  assert.equal(parsePrice('No entry fee').kind, 'free');
});

test('explicit free admission is not converted into a charge by optional spending', () => {
  for (const text of ['No entry fee. Venue suggests $10 food/drink spend.', '$0/No entry fee+$10 suggested optional spend']) {
    const price = parsePrice(text);
    assert.deepEqual(price, { kind: 'free', min: 0, max: 0, label: text });
    for (const budget of ['free', '15', '30', 'known']) assert.equal(budgetMatches(price, budget), true);
  }
  for (const text of ['$10 suggested donation', 'No entry fee; $10 required food minimum', 'Free entry; $10 suggested food spend and $20 mandatory drink minimum']) {
    assert.notEqual(parsePrice(text).kind, 'free', text);
  }
});

test('explicit admission is preserved alongside separate required spending or rental', () => {
  for (const [text, expected] of [['$12 advance / $12 door; $10 food or beverage minimum', 12], ['$12 admission;$10 required food/beverage minimum', 12], ['$11 admission + $4 skate rental.', 11]]) {
    const price = parsePrice(text);
    assert.deepEqual(price, { kind: 'paid', min: expected, max: expected, label: text });
    assert.equal(budgetMatches(price, 'known'), true);
    assert.equal(budgetMatches(price, '15'), true);
    assert.equal(budgetMatches(price, 'free'), false);
  }
  assert.equal(parsePrice('$12 advance / $20 door; $10 food minimum').max, 20);
  assert.equal(parsePrice('$12; $10 minimum').max, undefined);
});

test('private saved events, favorites, watch flags and ratings change ranking without mutation', () => {
  const base = context(), snapshot = JSON.stringify(base);
  const baseline = scoreEvent(event(), base);
  const saved = scoreEvent(event(), context({ personal: { ...emptyBackup(), savedEventIds: ['show:1'] } }));
  const favorite = scoreEvent(event(), context({ personal: { ...emptyBackup(), history: { venue: { ...emptyPersonal(), favorite: true, rating: 10 } } } }));
  const dislike = scoreEvent(event(), context({ personal: { ...emptyBackup(), history: { venue: { ...emptyPersonal(), rating: 1 } } } }));
  const watch = scoreEvent(event(), context({ personal: { ...emptyBackup(), history: { venue: { ...emptyPersonal(), watch: true } } } }));
  assert.ok(saved.score > baseline.score);
  assert.ok(favorite.score > baseline.score);
  assert.ok(watch.score > baseline.score);
  assert.ok(dislike.score < baseline.score);
  assert.equal(JSON.stringify(base), snapshot);
  assert.ok(saved.reasons.includes('You saved this event'));
  assert.ok(baseline.reasons.includes('No personal preference signals yet'));
});

test('unknown visits and freeform personal prose do not fabricate preference signals', () => {
  const baseline = scoreEvent(event(), context());
  for (const attendance of ['unknown', 'not_visited', 'visited']) {
    assert.equal(scoreEvent(event(), context({ personal: { ...emptyBackup(), history: { venue: { ...emptyPersonal(), attendance, notes: 'Love jazz', liked: 'Crowd', disliked: 'Old people' } } } })).score, baseline.score);
  }
});

test('enabled interests use fresh exact result IDs and ignore stale or paused results', () => {
  const result = { inputUpdatedAt: '2026-10-05T12:00:00Z', checkedAt: '2026-10-05T12:00:00Z', status: 'active', message: 'Reviewed', catalogIds: [], eventIds: ['show:1'] };
  const rank = item => scoreEvent(event(), context({ personal: { ...emptyBackup(), searchInterests: { i1: item } } }));
  const baseline = scoreEvent(event(), context()).score;
  assert.ok(rank(interest({ name: 'Other alias', result })).score > baseline);
  assert.equal(rank(interest({ name: 'Other alias', result, enabled: false })).score, baseline);
  assert.equal(rank(interest({ name: 'Other alias', result, updatedAt: '2026-10-06T12:00:00Z' })).score, baseline);
  assert.equal(rank(interest({ name: 'Other alias', result: { ...result, status: 'blocked' } })).score, baseline);
});

test('matching duplicate private interests neither multiplies fit nor repeats the reason', () => {
  const first = interest(), second = interest({ id: 'i2', name: 'A real band' });
  const single = scoreEvent(event(), context({ personal: { ...emptyBackup(), searchInterests: { i1: first } } }));
  const doubled = scoreEvent(event(), context({ personal: { ...emptyBackup(), searchInterests: { i1: first, i2: second } } }));
  assert.equal(doubled.fit, single.fit);
  assert.equal(doubled.reasons.filter(reason => reason.startsWith('Matches your search list:')).length, 1);
  assert.equal(doubled.reasons.find(reason => reason.startsWith('Matches your search list:')).includes(', '), false);
});

test('safe identity matching avoids substring and tribute false positives', () => {
  const withInterest = name => context({ personal: { ...emptyBackup(), searchInterests: { i1: interest({ name }) } } });
  assert.equal(scoreEvent(event({ title: 'Air Supply' }), withInterest('Air')).fit, 50);
  assert.equal(scoreEvent(event({ title: 'The Music of A Real Band' }), withInterest('A Real Band')).fit, 50);
  assert.equal(scoreEvent(event({ title: 'A Real Band' }), withInterest('A Real Band')).fit, 68);
  const music = { ...emptyMusic(), events: { 'show:1': { artistIds: ['artist'], genres: ['Rock'] } }, artists: [{ id: 'artist', name: 'A Real Band', genres: ['Rock'] }] };
  assert.equal(scoreEvent(event({ title: 'A Real Band with Support' }), { ...withInterest('A Real Band'), music }).fit, 68);
});

test('ranking modes can favor an expensive favorite or a cheaper neutral event', () => {
  const personal = { ...emptyBackup(), history: { venue: { ...emptyPersonal(), favorite: true, rating: 10 } } };
  const favorite = event({ priceText: '$75' });
  const cheap = event({ venueId: 'other', priceText: 'Free show' });
  assert.ok(scoreEvent(favorite, context({ personal }), 'fit').score > scoreEvent(cheap, context({ personal }), 'fit').score);
  assert.ok(scoreEvent(favorite, context({ personal }), 'value').score < scoreEvent(cheap, context({ personal }), 'value').score);
});

test('source failure, stale checks and provisional schedules visibly reduce confidence', () => {
  const baseline = scoreEvent(event(), context());
  const stale = scoreEvent(event({ checkedAt: '2026-09-01' }), context());
  const failed = scoreEvent(event(), context({ sources: [{ id: 'source', status: 'failed' }] }));
  const unverified = scoreEvent(event({ status: 'needs_verification' }), context());
  for (const result of [stale, failed, unverified]) assert.ok(result.score < baseline.score);
  assert.ok(stale.reasons.some(reason => /two weeks/.test(reason)));
  assert.ok(failed.reasons.some(reason => /failed/.test(reason)));
  assert.ok(unverified.reasons.some(reason => /verification/.test(reason)));
  assert.ok(scoreEvent(event({ checkedAt: '' }), context()).reliability < baseline.reliability);
});

test('sold-out/cancelled listings remain identifiable but are ranked down and filterable', () => {
  const baseline = scoreEvent(event(), context());
  const sold = event({ notes: ['This show is sold out.'] });
  assert.equal(eventAvailability(sold), 'sold_out');
  assert.ok(scoreEvent(sold, context()).score <= baseline.score - 40);
  assert.equal(matchesDiscovery(sold, { availability: 'not_sold_out' }, context()), false);
  assert.equal(matchesDiscovery(sold, { availability: 'any' }, context()), true);
  assert.equal(scoreEvent(event({ availability: 'cancelled' }), context()).score, 0);
  assert.equal(matchesDiscovery(event({ status: 'needs_verification' }), { availability: 'confirmed' }, context()), false);
  assert.equal(eventAvailability(event({ notes: ['Read the cancellation policy before buying.'] })), 'unknown');
  assert.equal(eventAvailability(event({ notes: ['Not sold out; check before travelling.'] })), 'unknown');
  assert.equal(eventAvailability(event({ notes: ['Sold-out status unverified.'] })), 'unknown');
});

test('genre, area, venue, saved and budget filters combine using reviewed facts', () => {
  const music = { ...emptyMusic(), events: { 'show:1': { artistIds: ['artist'], genres: ['Jazz'] } }, artists: [{ id: 'artist', name: 'A Real Band', genres: ['jazz', 'Funk'] }] };
  const ctx = context({ music, entries: [{ id: 'venue', area: 'East Nashville' }], personal: { ...emptyBackup(), savedEventIds: ['show:1'] } });
  assert.deepEqual(eventGenres(event(), music), ['Funk', 'jazz']);
  const filters = { genre: 'Jazz', area: 'East Nashville', venueId: 'venue', budget: '15', savedOnly: true };
  assert.equal(matchesDiscovery(event({ priceText: '$12' }), filters, ctx), true);
  assert.equal(matchesDiscovery(event({ priceText: '$25' }), filters, ctx), false);
  assert.equal(matchesDiscovery(event({ priceText: '$12' }), { ...filters, genre: 'Metal' }, ctx), false);
  assert.equal(matchesDiscovery(event({ priceText: '$12' }), { ...filters, area: 'Downtown' }, ctx), false);
  assert.equal(matchesDiscovery(event({ id: 'other', priceText: '$12' }), { savedOnly: true }, ctx), false);
});

test('time filtering uses Nashville clock including after midnight and DST transitions', () => {
  assert.equal(nashvilleMinutes('2026-10-07T06:30:00Z'), 90);
  assert.equal(matchesDiscovery(event({ start: '2026-10-07T06:30:00Z' }), { time: 'late' }, context()), true);
  assert.equal(matchesDiscovery(event({ start: '2026-10-07T06:30:00Z' }), { time: 'daytime' }, context()), false);
  assert.equal(nashvilleMinutes('2026-11-01T06:30:00Z'), 90);
  assert.equal(nashvilleMinutes('2026-11-01T07:30:00Z'), 90);
  assert.equal(nashvilleMinutes('2026-03-08T07:59:00Z'), 119);
  assert.equal(nashvilleMinutes('2026-03-08T08:00:00Z'), 180);
  assert.equal(matchesDiscovery(event({ start: '2026-10-06T17:00:00-05:00' }), { time: 'evening' }, context()), true);
  assert.equal(matchesDiscovery(event({ start: '2026-10-06T22:00:00-05:00' }), { time: 'late' }, context()), true);
  assert.equal(matchesDiscovery(event({ start: '2026-10-06T16:59:00-05:00' }), { time: 'evening' }, context()), false);
});
