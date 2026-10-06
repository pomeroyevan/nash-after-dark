import type { Entry, NightEvent } from './model';
import type { MusicData } from './music';
import { eventGenres, type DiscoveryFilters, type RankingMode, type EventScore } from './discovery';
import './calendar.css';

export function CalendarFilters({ filters, onChange, events, entries, music, mode, onMode, sort, onSort }: {
  filters: DiscoveryFilters; onChange: (next: DiscoveryFilters) => void; events: NightEvent[]; entries: Entry[]; music: MusicData;
  mode: RankingMode; onMode: (mode: RankingMode) => void; sort: string; onSort: (sort: string) => void;
}) {
  const genres = [...new Set(events.flatMap(event => eventGenres(event, music)))].sort();
  const venues = [...new Map(events.map(event => [event.venueId, event.venueName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const areas = [...new Set(entries.filter(entry => venues.some(([id]) => id === entry.id)).map(entry => entry.area).filter(Boolean))].sort();
  const count = Object.values(filters).filter(value => value && value !== 'any').length;
  const change = (key: keyof DiscoveryFilters, value: string) => onChange({ ...filters, [key]: value });
  return <div className="discovery-controls">
    <div className="ranking-controls"><label>List order<select aria-label="List order" value={sort} onChange={e => onSort(e.target.value)}><option value="time">Start time</option><option value="rank">Recommended</option><option value="price">Lowest listed ceiling</option></select></label><label>Rank by<select aria-label="Rank by" value={mode} onChange={e => onMode(e.target.value as RankingMode)}><option value="balanced">Fit + value</option><option value="fit">Personal fit</option><option value="value">Value</option></select></label></div>
    <details className="advanced-filters"><summary>More filters{count ? ` · ${count} active` : ''}</summary><div className="filter-fields">
      <label>Budget<select aria-label="Budget" value={filters.budget || 'any'} onChange={e => change('budget', e.target.value)}><option value="any">Any price</option><option value="free">Free admission</option><option value="15">Listed entry up to $15</option><option value="30">Listed entry up to $30</option><option value="known">Published admission price</option></select></label>
      <label>Genre<select aria-label="Genre" value={filters.genre || ''} onChange={e => change('genre', e.target.value)}><option value="">All genres</option>{genres.map(genre => <option key={genre}>{genre}</option>)}</select></label>
      <label>Venue<select aria-label="Venue" value={filters.venueId || ''} onChange={e => change('venueId', e.target.value)}><option value="">All venues</option>{venues.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Area<select aria-label="Area" value={filters.area || ''} onChange={e => change('area', e.target.value)}><option value="">All areas</option>{areas.map(area => <option key={area}>{area}</option>)}</select></label>
      <label>Starts<select aria-label="Starts" value={filters.time || 'any'} onChange={e => change('time', e.target.value)}><option value="any">Any time</option><option value="daytime">Daytime · 4am–5pm</option><option value="evening">Evening · 5–10pm</option><option value="late">Late · 10pm–4am</option></select></label>
      <label>Listing status<select aria-label="Listing status" value={filters.availability || 'any'} onChange={e => change('availability', e.target.value)}><option value="any">All listings</option><option value="not_sold_out">Hide sold out / cancelled</option><option value="confirmed">Confirmed dates only</option></select></label>
    </div><p className="filter-note">Budgets use listed admission; fees and required extras may apply. Unknown prices never count as free. “Hide sold out” does not guarantee tickets remain.</p>{count > 0 && <button className="text-button" onClick={() => onChange({})}>Reset extra filters</button>}</details>
  </div>;
}

export function RankDetails({ rank }: { rank: EventScore }) {
  return <details className="rank-details"><summary><span className="rank-score">{rank.score}<small>/100</small></span><span>Recommendation score<small>Why this ranks here</small></span></summary><p>Based on your saved interests, venue ratings, listed price and source freshness. This is a planning aid, not a public review score.</p><ul>{rank.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p>Your private preferences stay in your account or on this device. Rate a venue in My places or save a night to influence future recommendations.</p></details>;
}
