import type { Backup, Entry, NightEvent, Source } from './model';
import { ZONE } from './model';
import type { MusicData } from './music';

export interface PriceInfo { kind: 'free' | 'paid' | 'unknown'; min?: number; max?: number; label: string; feesIncluded?: boolean }
export type BudgetFilter = 'any' | 'free' | '15' | '30' | 'known';
export type RankingMode = 'balanced' | 'fit' | 'value';
export interface DiscoveryContext { personal: Backup; entries?: Entry[]; music?: MusicData; sources?: Source[]; now?: Date | string | number }
export interface DiscoveryFilters {
  budget?: BudgetFilter; genre?: string; venueId?: string; area?: string;
  time?: 'any' | 'daytime' | 'evening' | 'late';
  availability?: 'any' | 'not_sold_out' | 'confirmed'; savedOnly?: boolean;
}
export interface EventScore { score: number; fit: number; value: number; reliability: number; reasons: string[]; price: PriceInfo }
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const bounded = (value: number) => Math.round(Math.min(100, Math.max(0, value)));

/** Listed admission only. Unknown checkout fees never become a promised total. */
export function parsePrice(text?: string): PriceInfo {
  const label = text?.trim() || 'Price not published';
  if (!text?.trim()) return { kind: 'unknown', label };
  const lower = text.toLowerCase();
  const conditional = /\b(?:with|before|until|members?|children|kids|under|rsvp|required purchase|not free)\b/.test(lower);
  const feesIncluded = /(?:all[ -]in|(?:includes?|including)\s+(?:all\s+)?(?:tax(?:es)?\s*(?:and|&)\s*)?fees|fees\s+included)/i.test(text) ? true : /(?:plus|\+)\s*(?:\$[\d.]+\s*)?(?:tax|sales tax|fees)|(?:tax|fees)\s+(?:extra|additional|not included)/i.test(text) ? false : undefined;
  const fees = feesIncluded === undefined ? {} : { feesIncluded };
  const amounts = [...text.matchAll(/\$\s*(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)/g)].map(match => Number(match[1].replace(/,/g, '')));
  // An explicit admission clause stays distinct from separately stated spending.
  // Only recognize clear source wording; ambiguous combined charges stay unknown.
  const clauses = text.split(/;|\.(?!\d)|\+/).map(clause => clause.trim()).filter(Boolean);
  const admission = clauses[0], extras = clauses.slice(1);
  const freeClause = /^(?:\$0(?:\.00)?\s*\/\s*)?(?:no (?:entry fee|cover)|free (?:entry|admission)|(?:entry|admission) is free)$/i.test(admission);
  const paidClause = /^\$\s*\d+(?:\.\d{1,2})?\s+(?:admission|entry|cover)$/i.test(admission) || /^\$\s*\d+(?:\.\d{1,2})?\s+(?:advance|adv)\s*[/|i]\s*\$\s*\d+(?:\.\d{1,2})?\s+(?:door|dos)$/i.test(admission);
  const spendClauses = extras.length > 0 && extras.every(clause => /\b(?:food|drink|beverage|spend|rental|donation)\b/i.test(clause) && !/\b(?:conflict|unverified|unknown)\b/i.test(clause));
  const optionalSpend = spendClauses && extras.every(clause => /\b(?:suggest(?:ed|s)?|optional)\b/i.test(clause) && !/\b(?:required|mandatory|minimum)\b/i.test(clause));
  if (freeClause && optionalSpend) return { kind: 'free', min: 0, max: 0, label, ...fees };
  if (paidClause && spendClauses) return { ...parsePrice(admission), label, ...fees };
  // These describe spend guidance or an open-ended charge, not free admission.
  if (/\bsuggest(?:ed|s)?\b|\bdonations?\b|pay what you can|\bminimum\s+(?:spend|purchase)|\b(?:food|drink|beverage|spend)[^.;]{0,35}\bminimum/.test(lower)) {
    return { kind: amounts.length ? 'paid' : 'unknown', label, ...fees };
  }
  if (/\b(?:not published|unverified|not verified|unknown|tba|tbd)\b/.test(lower) && !amounts.length) return { kind: 'unknown', label, ...fees };
  if (!amounts.length) {
    if (/(?:^\s*free\s*(?:[.!;]|$)|\bfree\s+(?:entry|admission|show|event)\b|\b(?:entry|admission|show|event|cover)\s+(?:is\s+)?free\b|\bno\s+(?:entry\s+fee|cover|admission\s+(?:fee|charge))\b)/.test(lower) && !conditional) return { kind: 'free', min: 0, max: 0, label, ...fees };
    return { kind: 'unknown', label, ...fees };
  }
  // A source conflict is not a trustworthy range; admission plus rental/food is not one either.
  if (/\b(?:conflict|verify current price)|(?:\bplus|\+)\s*\$[\d.]+\s*(?:skate\s+)?rental|\bminimum\b[^.;]{0,20}\$|\$[\d.]+[^.;]{0,20}\bminimum\b/.test(lower)) return { kind: 'paid', label, ...fees };
  const explicitTax = text.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*(?:plus|\+)\s*\$\s*(\d+(?:\.\d{1,2})?)\s*(?:sales\s+)?tax\b/i);
  if (explicitTax && amounts.length === 2) {
    const total = Math.round((Number(explicitTax[1]) + Number(explicitTax[2])) * 100) / 100;
    return { kind: total === 0 ? 'free' : 'paid', min: total, max: total, label };
  }
  const min = Math.min(...amounts);
  if (/\b(?:from|starting\s+at|starts?\s+at|at\s+least|limited[ -]time|early[ -]bird|while\s+(?:tickets|supplies)\s+last)\b|\$[\d.]+\s*\+(?!\s*(?:tax|fees))/.test(lower)) return { kind: 'paid', min, label, ...fees };
  // Ranges often omit the second dollar sign: $10–20.
  const ranges = [...text.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)\s*[-–—]\s*\$?\s*(\d+(?:\.\d{1,2})?)/g)].flatMap(match => [Number(match[1]), Number(match[2])]);
  const values = [...amounts, ...ranges];
  if (Math.max(...values) === 0 && conditional) return { kind: 'unknown', label, ...fees };
  return { kind: Math.max(...values) === 0 ? 'free' : 'paid', min: Math.min(...values), max: Math.max(...values), label, ...fees };
}

export function budgetMatches(price: PriceInfo, budget: BudgetFilter = 'any'): boolean {
  if (budget === 'any') return true;
  if (budget === 'free') return price.kind === 'free';
  if (budget === 'known') return price.kind !== 'unknown' && price.min !== undefined;
  return price.max !== undefined && price.max <= Number(budget);
}

export function eventAvailability(event: NightEvent): 'sold_out' | 'cancelled' | 'unknown' {
  const extra = event as NightEvent & { notes?: string[]; availability?: string; ticketStatus?: string };
  const text = [event.title, ...event.tags, event.priceText, extra.availability, extra.ticketStatus, ...(Array.isArray(extra.notes) ? extra.notes : [])].filter(Boolean).join(' ').replace(/_/g, ' ')
    .replace(/\bnot\s+(?:sold[ -]?out|cancelled|canceled)\b/gi, '')
    .replace(/\bsold[ -]?out\s+(?:status\s+)?(?:unknown|unverified|not\s+(?:known|verified|confirmed))\b/gi, '');
  if (/\bcancel(?:led|ed)\b/i.test(text)) return 'cancelled';
  if (/\bsold[ -]?out\b/i.test(text)) return 'sold_out';
  return 'unknown';
}

export function eventGenres(event: NightEvent, music?: MusicData): string[] {
  const info = music?.events[event.id];
  const artistGenres = music?.artists.filter(artist => info?.artistIds.includes(artist.id)).flatMap(artist => artist.genres) || [];
  return [...new Map([...(info?.genres || []), ...artistGenres].map(genre => [normalize(genre), genre])).values()].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function nashvilleMinutes(timestamp: string): number {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return NaN;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Number(parts.find(part => part.type === 'hour')?.value) * 60 + Number(parts.find(part => part.type === 'minute')?.value);
}

export function matchesDiscovery(event: NightEvent, filters: DiscoveryFilters, context: DiscoveryContext): boolean {
  if (!budgetMatches(parsePrice(event.priceText), filters.budget)) return false;
  if (filters.genre && filters.genre !== 'any' && !eventGenres(event, context.music).some(genre => normalize(genre) === normalize(filters.genre!))) return false;
  if (filters.venueId && filters.venueId !== 'any' && event.venueId !== filters.venueId) return false;
  if (filters.area && filters.area !== 'any' && normalize(context.entries?.find(entry => entry.id === event.venueId)?.area || '') !== normalize(filters.area)) return false;
  if (filters.savedOnly && !context.personal.savedEventIds.includes(event.id)) return false;
  if (filters.availability && filters.availability !== 'any' && eventAvailability(event) !== 'unknown') return false;
  if (filters.availability === 'confirmed' && event.status !== 'confirmed') return false;
  if (filters.time && filters.time !== 'any') {
    const minutes = nashvilleMinutes(event.start);
    if (!Number.isFinite(minutes)) return false;
    if (filters.time === 'late' && !(minutes >= 22 * 60 || minutes < 4 * 60)) return false;
    if (filters.time === 'evening' && !(minutes >= 17 * 60 && minutes < 22 * 60)) return false;
    if (filters.time === 'daytime' && !(minutes >= 4 * 60 && minutes < 17 * 60)) return false;
  }
  return true;
}

function matchingInterests(event: NightEvent, context: DiscoveryContext, catalogIds: Set<string>): string[] {
  const info = context.music?.events[event.id];
  const artistNames = context.music?.artists.filter(artist => info?.artistIds.includes(artist.id)).map(artist => normalize(artist.name)) || [];
  const title = normalize(event.title), venue = normalize(event.venueName), tags = event.tags.map(normalize);
  const matches = Object.values(context.personal.searchInterests || {}).filter(interest => {
    if (!interest.enabled) return false;
    const result = interest.result;
    if (result?.inputUpdatedAt === interest.updatedAt && result.status === 'active' && (result.eventIds.includes(event.id) || result.catalogIds.some(id => catalogIds.has(id)))) return true;
    const name = normalize(interest.name);
    if (!name) return false;
    if (interest.kind === 'venue') return name === venue;
    if (interest.kind === 'artist') return artistNames.includes(name) || (!/\btribute\b|\b(?:music|songs) of\b/i.test(event.title) && name === title);
    // Exact identities or tags only. "Air" must never match "Air Supply".
    return name === title || name === venue || artistNames.includes(name) || tags.includes(name);
  }).map(interest => interest.name);
  return [...new Map(matches.map(name => [normalize(name), name])).values()];
}

/** A local, explainable preference estimate, not a popularity rating or ticket guarantee. */
export function scoreEvent(event: NightEvent, context: DiscoveryContext, mode: RankingMode = 'balanced'): EventScore {
  const reasons: string[] = [], price = parsePrice(event.priceText);
  let fit = 50;
  if (context.personal.savedEventIds.includes(event.id)) { fit += 20; reasons.push('You saved this event'); }
  const artistIds = context.music?.events[event.id]?.artistIds || [];
  const artistNames = context.music?.artists.filter(artist => artistIds.includes(artist.id)).map(artist => normalize(artist.name)) || [];
  const matchingEntries = context.entries?.filter(entry => /artist|band|performer|dj/i.test(entry.kind) && artistNames.includes(normalize(entry.name))) || [];
  const catalogIds = new Set([event.venueId, ...artistIds, ...matchingEntries.map(entry => entry.id)]);
  const records = [...catalogIds].map(id => ({ id, history: context.personal.history[id] })).filter(record => !!record.history);
  if (records.some(record => record.history.favorite)) { fit += 20; reasons.push('A favorite venue or artist'); }
  if (records.some(record => record.history.watch)) { fit += 8; reasons.push('A venue or artist you follow'); }
  const ratings = records.flatMap(record => record.history.rating === null ? [] : [record.history.rating]);
  if (ratings.length) {
    const average = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
    fit += (average - 5) * 4;
    reasons.push(`Your linked venue/artist rating: ${Number(average.toFixed(1))}/10`);
  }
  const interests = matchingInterests(event, context, catalogIds);
  if (interests.length) { fit += 18; reasons.push(`Matches your search list: ${interests.slice(0, 2).join(', ')}${interests.length > 2 ? ' and more' : ''}`); }
  if (!reasons.length) reasons.push('No personal preference signals yet');
  fit = bounded(fit);
  const value = price.kind === 'free' ? 100 : price.max === undefined ? 35 : price.max <= 15 ? 85 : price.max <= 30 ? 65 : price.max <= 50 ? 45 : 25;
  reasons.push(price.kind === 'free' ? 'Listed as free' : price.max === undefined ? 'Full listed entry range is unknown' : `Listed entry up to $${price.max}${price.feesIncluded === true ? ' with stated fees included' : '; fees or extras may apply'}`);
  let reliability = event.status === 'confirmed' ? 60 : 35;
  if (event.status !== 'confirmed') reasons.push('Date or schedule still needs verification');
  const source = context.sources?.find(item => item.id === event.sourceId);
  if (source?.status === 'ok') reliability += 15;
  else if (/fail|error|stale|blocked/i.test(source?.status || '')) { reliability -= 25; reasons.push('Source refresh failed or is stale'); }
  else if (source?.status === 'manual') { reliability -= 5; reasons.push('Source requires manual checking'); }
  const now = context.now === undefined ? Date.now() : new Date(context.now).getTime();
  const checked = Date.parse(event.checkedAt), age = (now - checked) / 86400000;
  if (!Number.isFinite(age) || age < -1) { reliability -= 20; reasons.push('Check date is unavailable or invalid'); }
  else if (age <= 2) reliability += 25;
  else if (age <= 7) reliability += 15;
  else if (age <= 14) reliability += 5;
  else { reliability -= 15; reasons.push('Listing was last checked more than two weeks ago'); }
  reliability = bounded(reliability);
  const weights = mode === 'fit' ? [.75, .05, .2] : mode === 'value' ? [.25, .55, .2] : [.55, .2, .25];
  let score = fit * weights[0] + value * weights[1] + reliability * weights[2];
  const availability = eventAvailability(event);
  if (availability === 'sold_out') { score -= 45; reasons.push('Listed as sold out'); }
  if (availability === 'cancelled') { score = 0; reasons.push('Listed as cancelled'); }
  return { score: bounded(score), fit, value, reliability, reasons, price };
}
