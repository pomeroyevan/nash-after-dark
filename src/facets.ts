import { budgetMatches, eventAvailability, eventGenres, matchesDiscovery, nashvilleMinutes, parsePrice, type BudgetFilter, type DiscoveryContext, type DiscoveryFilters } from './discovery';
import { matchesFilter, type NightEvent } from './model';

export interface FacetOption { value: string; label: string; count: number }
export interface CalendarFacets {
  categories: FacetOption[];
  budget: FacetOption[];
  genre: FacetOption[];
  venueId: FacetOption[];
  area: FacetOption[];
  time: FacetOption[];
  availability: FacetOption[];
}
type Choice = Pick<FacetOption, 'value' | 'label'>;
type FacetKey = Exclude<keyof CalendarFacets, 'categories'>;

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const categories: Choice[] = [
  { value: 'all', label: 'Everything' }, { value: 'dancing', label: 'Dancing' },
  { value: 'music', label: 'Live music' }, { value: 'mtg', label: 'MTG' },
  { value: 'food', label: 'Food & drink' }, { value: 'saved', label: 'Saved' },
];

function distinctLabels(values: string[]): Choice[] {
  const choices = new Map<string, Choice>();
  for (const value of values) {
    const label = value.trim().replace(/\s+/g, ' '), key = normalize(label);
    if (key && !choices.has(key)) choices.set(key, { value: label, label });
  }
  return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Events must already be scoped to the selected date/range and search text.
 * Each count is the result of selecting that option while retaining other facets.
 * Keep reset choices even at zero so an empty combination is always recoverable.
 */
export function buildCalendarFacets(events: NightEvent[], context: DiscoveryContext, category: string, filters: DiscoveryFilters): CalendarFacets {
  const saved = new Set(context.personal.savedEventIds);
  const categoryMatches = (event: NightEvent, value: string) => matchesFilter(event.tags, event.title, value) && (value !== 'saved' || saved.has(event.id));
  const countCategories = categories.map(option => ({ ...option, count: events.filter(event => categoryMatches(event, option.value) && matchesDiscovery(event, filters, context)).length })).filter(option => option.value === 'all' || option.count > 0);
  const inCategory = events.filter(event => categoryMatches(event, category));
  const entries = new Map(context.entries?.map(entry => [entry.id, entry]) || []);
  const venues = [...new Map(events.filter(event => event.venueId).map(event => [event.venueId, { value: event.venueId, label: event.venueName || entries.get(event.venueId)?.name || 'Venue to verify' }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  // Count memberships once per matching event rather than reevaluating every
  // artist and price for every option in a large All upcoming range.
  const countFacet = (key: FacetKey, choices: Choice[], memberships: (event: NightEvent) => string[]): FacetOption[] => {
    const otherFilters = { ...filters };
    delete otherFilters[key];
    const matching = inCategory.filter(event => matchesDiscovery(event, otherFilters, context));
    const counts = new Map<string, number>();
    for (const event of matching) for (const value of new Set(memberships(event))) counts.set(value, (counts.get(value) || 0) + 1);
    const normalizedFacet = key === 'genre' || key === 'area', selected = filters[key];
    return choices.map((option, index) => {
      const count = index === 0 ? matching.length : counts.get(normalizedFacet ? normalize(option.value) : option.value) || 0;
      // Source spelling can change between days. Keep a matching selected value
      // stable for the native select, while displaying this scope's source label.
      const value = index > 0 && count > 0 && normalizedFacet && selected && selected !== 'any' && normalize(selected) === normalize(option.value) ? selected : option.value;
      return { ...option, value, count };
    }).filter((option, index) => index === 0 || option.count > 0);
  };

  return {
    categories: countCategories,
    budget: countFacet('budget', [
      { value: 'any', label: 'Any price' }, { value: 'free', label: 'Free admission' },
      { value: '15', label: 'Listed entry up to $15' }, { value: '30', label: 'Listed entry up to $30' },
      { value: 'known', label: 'Published admission price' },
    ], event => { const price = parsePrice(event.priceText); return (['free', '15', '30', 'known'] as BudgetFilter[]).filter(value => budgetMatches(price, value)); }),
    genre: countFacet('genre', [{ value: '', label: 'All genres' }, ...distinctLabels(events.flatMap(event => eventGenres(event, context.music)))], event => eventGenres(event, context.music).map(normalize)),
    venueId: countFacet('venueId', [{ value: '', label: 'All venues' }, ...venues], event => [event.venueId]),
    area: countFacet('area', [{ value: '', label: 'All areas' }, ...distinctLabels(events.map(event => entries.get(event.venueId)?.area || ''))], event => [normalize(entries.get(event.venueId)?.area || '')]),
    time: countFacet('time', [
      { value: 'any', label: 'Any time' }, { value: 'daytime', label: 'Daytime · 4am–5pm' },
      { value: 'evening', label: 'Evening · 5–10pm' }, { value: 'late', label: 'Late · 10pm–4am' },
    ], event => { const minutes = nashvilleMinutes(event.start); return !Number.isFinite(minutes) ? [] : [minutes >= 22 * 60 || minutes < 4 * 60 ? 'late' : minutes >= 17 * 60 ? 'evening' : 'daytime']; }),
    availability: countFacet('availability', [
      { value: 'any', label: 'All listings' }, { value: 'not_sold_out', label: 'Hide sold out / cancelled' },
      { value: 'confirmed', label: 'Confirmed dates only' },
    ], event => eventAvailability(event) !== 'unknown' ? [] : ['not_sold_out', ...(event.status === 'confirmed' ? ['confirmed'] : [])]),
  };
}
