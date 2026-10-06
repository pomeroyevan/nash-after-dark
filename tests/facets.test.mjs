import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarFacets } from '../src/facets.ts';
import { emptyBackup, matchesFilter } from '../src/model.ts';
import { emptyMusic } from '../src/music.ts';
import { matchesDiscovery } from '../src/discovery.ts';

const event = (id, changes = {}) => ({ id, title: `Concert ${id}`, venueId: 'east', venueName: 'East Venue', sourceId: 'source', start: '2026-10-06T20:00:00-05:00', tags: ['music'], status: 'confirmed', checkedAt: '2026-10-05T12:00:00Z', url: 'https://example.com/show', ...changes });
const fixture = () => {
  const events = [
    event('jazz', { priceText: '$10' }),
    event('rock', { venueId: 'west', venueName: 'West Venue', priceText: '$25' }),
    event('dance', { title: 'DJ night', tags: ['dancing'], priceText: 'Free admission', start: '2026-10-06T23:00:00-05:00' }),
    event('draft', { title: 'Magic: The Gathering Draft', tags: ['mtg'], venueId: 'games', venueName: 'Games Store', priceText: '$30', start: '2026-10-06T13:00:00-05:00' }),
    event('sold', { title: 'Sold out concert', priceText: '$15', ticketStatus: 'sold_out' }),
    event('unknown', { title: 'Jazz concert', venueId: 'west', venueName: 'West Venue', status: 'needs_verification' }),
  ];
  const context = {
    personal: { ...emptyBackup(), savedEventIds: ['jazz', 'draft', 'missing-event'] },
    entries: [{ id: 'east', name: 'East Venue', area: 'East Nashville' }, { id: 'west', name: 'West Venue', area: 'West Nashville' }, { id: 'games', name: 'Games Store', area: 'East Nashville' }, { id: 'outside', name: 'Tomorrow Venue', area: 'Outside current day' }],
    music: { ...emptyMusic(), events: { jazz: { artistIds: [], genres: ['Jazz'] }, rock: { artistIds: [], genres: ['Rock'] }, unknown: { artistIds: [], genres: ['jazz'] } } },
  };
  return { events, context };
};
const counts = options => Object.fromEntries(options.map(option => [option.value, option.count]));

test('facets use the supplied day/search scope and never the full catalog inventory', () => {
  const { events, context } = fixture();
  const facets = buildCalendarFacets(events.slice(0, 1), context, 'all', {});
  assert.deepEqual(counts(facets.categories), { all: 1, music: 1, saved: 1 });
  assert.deepEqual(counts(facets.venueId), { '': 1, east: 1 });
  assert.deepEqual(counts(facets.area), { '': 1, 'East Nashville': 1 });
  assert.deepEqual(counts(facets.time), { any: 1, evening: 1 });
  assert.equal(facets.genre.some(option => option.value === 'Rock'), false);
  assert.equal(facets.venueId.some(option => option.value === 'outside'), false);
});

test('each facet ignores only itself and retains all other active filters', () => {
  const { events, context } = fixture();
  const facets = buildCalendarFacets(events, context, 'music', { budget: '15', venueId: 'east', availability: 'not_sold_out' });
  assert.deepEqual(counts(facets.budget), { any: 1, '15': 1, '30': 1, known: 1 });
  assert.deepEqual(counts(facets.venueId), { '': 1, east: 1 });
  assert.deepEqual(counts(facets.availability), { any: 2, not_sold_out: 1, confirmed: 1 });
  assert.deepEqual(counts(facets.genre), { '': 1, Jazz: 1 });
  // Category counts ignore the current music selection, preserving the price,
  // venue and ticket-status restrictions, so the free dance remains available.
  assert.deepEqual(counts(facets.categories), { all: 2, dancing: 1, music: 1, saved: 1 });
});

test('an active selected option can disappear at zero while each reset retains its own result count', () => {
  const { events, context } = fixture();
  const facets = buildCalendarFacets(events, context, 'all', { genre: 'Rock', budget: 'free' });
  assert.deepEqual(counts(facets.categories), { all: 0 });
  assert.deepEqual(counts(facets.genre), { '': 1 });
  assert.deepEqual(counts(facets.budget), { any: 1, '30': 1, known: 1 });
  assert.deepEqual(counts(facets.venueId), { '': 0 });
  assert.deepEqual(counts(facets.area), { '': 0 });
  assert.deepEqual(counts(facets.time), { any: 0 });
  assert.deepEqual(counts(facets.availability), { any: 0 });
});

test('saved category and savedOnly respect exact private event IDs', () => {
  const { events, context } = fixture();
  const saved = buildCalendarFacets(events, context, 'saved', {});
  assert.deepEqual(counts(saved.venueId), { '': 2, east: 1, games: 1 });
  assert.deepEqual(counts(saved.time), { any: 2, daytime: 1, evening: 1 });
  assert.equal(counts(saved.categories).all, 6);
  assert.equal(counts(saved.categories).saved, 2);
  const privateOnly = buildCalendarFacets(events, context, 'all', { savedOnly: true });
  assert.deepEqual(counts(privateOnly.categories), { all: 2, music: 1, mtg: 1, saved: 2 });
});

test('duplicate artist genres and case or punctuation aliases produce one choice and one count per event', () => {
  const { events, context } = fixture();
  context.music.events.jazz = { artistIds: ['one', 'two'], genres: ['Jazz', 'Soul & R&B'] };
  context.music.artists = [{ id: 'one', genres: ['JAZZ', 'Soul and R and B'] }, { id: 'two', genres: ['jazz', 'Soul & R&B'] }];
  const facets = buildCalendarFacets(events, context, 'all', {});
  const jazzChoices = facets.genre.filter(option => option.value.toLowerCase() === 'jazz');
  assert.equal(jazzChoices.length, 1);
  assert.equal(jazzChoices[0].count, 2);
  const soulChoices = facets.genre.filter(option => option.value.startsWith('Soul'));
  assert.equal(soulChoices.length, 1);
  assert.equal(soulChoices[0].count, 1);
  assert.equal(facets.genre[0].count, 6);
});

test('empty nights retain only zero-count reset choices and leave inputs unchanged', () => {
  const { events, context } = fixture();
  const filters = { budget: 'free', venueId: 'east' };
  const original = JSON.stringify({ events, context, filters });
  const facets = buildCalendarFacets([], context, 'all', filters);
  for (const options of Object.values(facets)) {
    assert.equal(options.length, 1);
    assert.equal(options[0].count, 0);
  }
  buildCalendarFacets(events, context, 'music', filters);
  assert.equal(JSON.stringify({ events, context, filters }), original);
});

test('changing days preserves selected genre and area values despite equivalent source spellings', () => {
  const { events, context } = fixture();
  const filters = { genre: 'Jazz', area: 'East Nashville' };
  const firstDay = buildCalendarFacets(events.slice(0, 1), context, 'all', filters);
  assert.deepEqual(firstDay.genre[1], { value: 'Jazz', label: 'Jazz', count: 1 });
  context.music.events.jazz.genres = ['jazz'];
  context.entries[0].area = 'EAST NASHVILLE';
  const nextDay = buildCalendarFacets(events.slice(0, 1), context, 'all', filters);
  assert.deepEqual(nextDay.genre[1], { value: 'Jazz', label: 'jazz', count: 1 });
  assert.deepEqual(nextDay.area[1], { value: 'East Nashville', label: 'EAST NASHVILLE', count: 1 });
  assert.equal(matchesDiscovery(events[0], filters, context), true);
});

test('optimized memberships stay equivalent to calendar predicates for combined selections', () => {
  const { events, context } = fixture();
  events.push(event('cancelled', { title: 'Cancelled concert', priceText: '$10', start: '2026-10-07T01:00:00-05:00' }));
  const filterSets = [
    {}, { budget: '15', venueId: 'east', availability: 'not_sold_out' },
    { genre: 'JAZZ', area: 'east nashville' }, { time: 'late', budget: 'free' },
    { savedOnly: true, availability: 'confirmed', budget: '30' }, { venueId: 'west', budget: 'known', time: 'evening' },
  ];
  const categoryMatches = (item, category) => matchesFilter(item.tags, item.title, category) && (category !== 'saved' || context.personal.savedEventIds.includes(item.id));
  const initial = buildCalendarFacets(events, context, 'all', {});
  for (const category of ['all', 'music', 'dancing', 'mtg', 'saved']) for (const filters of filterSets) {
    const facets = buildCalendarFacets(events, context, category, filters);
    for (const [key, options] of Object.entries(facets)) {
      for (const option of options) {
        const expected = events.filter(item => key === 'categories'
          ? categoryMatches(item, option.value) && matchesDiscovery(item, filters, context)
          : categoryMatches(item, category) && matchesDiscovery(item, { ...filters, [key]: option.value }, context)).length;
        assert.equal(option.count, expected, `${category} ${key} ${option.value} ${JSON.stringify(filters)}`);
      }
      // A positive alternative must remain available even when the current
      // selection empties the result. Check missing alternatives as well.
      for (const option of initial[key]) {
        const expected = events.filter(item => key === 'categories'
          ? categoryMatches(item, option.value) && matchesDiscovery(item, filters, context)
          : categoryMatches(item, category) && matchesDiscovery(item, { ...filters, [key]: option.value }, context)).length;
        if (expected) assert.ok(options.some(candidate => candidate.label === option.label), `${key} lost ${option.label}`);
      }
    }
  }
});
