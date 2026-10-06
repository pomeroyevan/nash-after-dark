import { type DiscoveryFilters, type RankingMode, type EventScore } from './discovery';
import type { CalendarFacets } from './facets';
import './calendar.css';

const fields = [
  { key: 'budget', label: 'Budget', empty: 'any' },
  { key: 'genre', label: 'Genre', empty: '' },
  { key: 'venueId', label: 'Venue', empty: '' },
  { key: 'area', label: 'Area', empty: '' },
  { key: 'time', label: 'Starts', empty: 'any' },
  { key: 'availability', label: 'Listing status', empty: 'any' },
] as const;

const labels: Record<string, string> = { free: 'Free admission', '15': 'Entry up to $15', '30': 'Entry up to $30', known: 'Published price', daytime: 'Daytime', evening: 'Evening', late: 'Late', not_sold_out: 'Hide sold out', confirmed: 'Confirmed dates' };
const selectedLabel = (key: string, value: string) => labels[value] || (key === 'venueId' ? 'Selected venue' : value);

export function CalendarFilters({ filters, onChange, facets, mode, onMode, sort, onSort }: {
  filters: DiscoveryFilters; onChange: (next: DiscoveryFilters) => void; facets: CalendarFacets;
  mode: RankingMode; onMode: (mode: RankingMode) => void; sort: string; onSort: (sort: string) => void;
}) {
  const active = fields.filter(field => filters[field.key] && filters[field.key] !== field.empty);
  const available = fields.filter(field => facets[field.key].some(option => option.value !== field.empty && option.count > 0));
  const change = (key: keyof DiscoveryFilters, value: string) => onChange({ ...filters, [key]: value });
  return <div className="discovery-controls">
    <div className="ranking-controls"><label>List order<select aria-label="List order" value={sort} onChange={e => onSort(e.target.value)}><option value="time">Start time</option><option value="rank">Recommended</option><option value="price">Lowest listed ceiling</option></select></label><label>Rank by<select aria-label="Rank by" value={mode} onChange={e => onMode(e.target.value as RankingMode)}><option value="balanced">Fit + value</option><option value="fit">Personal fit</option><option value="value">Value</option></select></label></div>
    {active.length > 0 && <div className="active-filters" aria-label="Active filters">{active.map(field => {
      const value = String(filters[field.key]);
      const option = facets[field.key].find(option => option.value === value);
      const label = option?.label || selectedLabel(field.key, value);
      return <button key={field.key} className="active-filter" aria-label={`Remove ${field.label.toLowerCase()} filter`} onClick={() => change(field.key, field.empty)}>{label}<span className="filter-count">{option?.count || 0}</span><span aria-hidden="true">×</span></button>;
    })}<button className="text-button clear-filters" onClick={() => onChange({})}>Reset extra filters</button></div>}
    {available.length > 0 && <details className="advanced-filters"><summary>More filters{active.length ? ` · ${active.length} active` : ''}</summary><div className="filter-fields">
      {available.map(field => {
        const options = facets[field.key], value = filters[field.key] || field.empty;
        return <label key={field.key}>{field.label}<select aria-label={field.label} value={value} onChange={e => change(field.key, e.target.value)}>
          {!options.some(option => option.value === value) && <option value={value} hidden disabled>{selectedLabel(field.key, value)} · no matches</option>}
          {options.map(option => <option key={option.value} value={option.value}>{option.label} ({option.count})</option>)}
        </select></label>;
      })}
    </div><p className="filter-note">Counts include your other filters. Prices are admission only; fees and required spending may apply.</p></details>}
  </div>;
}

export function RankDetails({ rank }: { rank: EventScore }) {
  return <details className="rank-details"><summary><span className="rank-score">{rank.score}<small>/100</small></span><span>Recommendation score<small>Show reasons</small></span></summary><p>Your saved interests, venue ratings, admission price and source freshness determine this score.</p><ul>{rank.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><p>Save an event or rate a venue in My places to improve your recommendations. Preferences stay private.</p></details>;
}
