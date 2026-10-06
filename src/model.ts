export interface Entry { id: string; name: string; kind: string; description: string; area: string; address: string; officialUrl: string; tags: string[]; identityStatus: string; sourceCheckedAt: string; relatedIds: string[] }
export interface NightEvent { id: string; title: string; venueId: string; venueName: string; start: string; end?: string; url: string; ticketUrl?: string; priceText?: string; tags: string[]; status: 'confirmed' | 'needs_verification'; sourceId: string; checkedAt: string }
export interface Source { id?: string; name?: string; status?: string; checkedAt?: string; url?: string; message?: string; [key: string]: unknown }
export interface Personal { attendance: 'visited' | 'not_visited' | 'unknown'; rating: number | null; notes: string; liked: string; disliked: string; favorite: boolean; watch: boolean; updatedAt: string }
export type SearchInterestKind = 'anything' | 'artist' | 'venue' | 'event_series' | 'activity' | 'organizer';
export interface SearchInterestResult { inputUpdatedAt: string; status: 'active' | 'needs_details' | 'blocked'; checkedAt: string; message: string; catalogIds: string[]; eventIds: string[] }
export interface SearchInterest { id: string; name: string; kind: SearchInterestKind; sourceUrl: string; notes: string; enabled: boolean; createdAt: string; updatedAt: string; result?: SearchInterestResult }
export interface Backup { version: 1; exportedAt: string; history: Record<string, Personal>; savedEventIds: string[]; searchInterests?: Record<string, SearchInterest> }
export const ZONE = 'America/Chicago';
export const STORE = 'nash-after-dark.personal.v1';
export const emptyPersonal = (): Personal => ({ attendance: 'unknown', rating: null, notes: '', liked: '', disliked: '', favorite: false, watch: false, updatedAt: '' });
export const emptyBackup = (): Backup => ({ version: 1, exportedAt: '', history: {}, savedEventIds: [] });
export function safeUrl(value: unknown): string { try { const u = new URL(String(value)); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
const string = (v: unknown) => typeof v === 'string' ? v : '';
const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const reservedKey = (value: string) => ['__proto__', 'constructor', 'prototype'].includes(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !value.includes('\0');
const timestamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const resultIds = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(id => boundedText(id, 160) && id.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(id));
export function parseSearchInterests(value: unknown): Record<string, SearchInterest> {
  if (!record(value) || Object.keys(value).length > 500) throw new Error('The backup contains invalid search interests. Nothing was imported.');
  const interests: Record<string, SearchInterest> = {};
  for (const [id, raw] of Object.entries(value)) {
    const invalid = () => new Error(`Invalid search interest ${id}. Nothing was imported.`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/.test(id) || reservedKey(id) || !record(raw) || raw.id !== id) throw invalid();
    if (!boundedText(raw.name, 200) || !raw.name.trim() || !['anything', 'artist', 'venue', 'event_series', 'activity', 'organizer'].includes(String(raw.kind)) || !boundedText(raw.notes, 2000) || !boundedText(raw.sourceUrl, 2048) || typeof raw.enabled !== 'boolean' || !timestamp(raw.createdAt) || !timestamp(raw.updatedAt)) throw invalid();
    if (raw.sourceUrl) {
      try { const url = new URL(raw.sourceUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid(); }
      catch { throw invalid(); }
    }
    let result: SearchInterestResult | undefined;
    if (raw.result !== undefined) {
      const r = raw.result;
      if (!record(r) || !timestamp(r.inputUpdatedAt) || !timestamp(r.checkedAt) || !['active', 'needs_details', 'blocked'].includes(String(r.status)) || !boundedText(r.message, 1000) || !r.message.trim() || !resultIds(r.catalogIds) || !resultIds(r.eventIds)) throw invalid();
      result = { inputUpdatedAt: r.inputUpdatedAt, status: r.status as SearchInterestResult['status'], checkedAt: r.checkedAt, message: r.message, catalogIds: [...r.catalogIds], eventIds: [...r.eventIds] };
    }
    interests[id] = { id, name: raw.name, kind: raw.kind as SearchInterestKind, sourceUrl: raw.sourceUrl, notes: raw.notes, enabled: raw.enabled, createdAt: raw.createdAt, updatedAt: raw.updatedAt, ...(result ? { result } : {}) };
  }
  return interests;
}
export function searchInterestStatus(interest: SearchInterest): 'paused' | 'pending' | SearchInterestResult['status'] {
  if (!interest.enabled) return 'paused';
  return interest.result?.inputUpdatedAt === interest.updatedAt ? interest.result.status : 'pending';
}
export function parseCatalog(value: unknown): Entry[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { entries?: unknown }).entries)) throw new Error('The place guide could not be read.');
  return (value as { entries: Record<string, unknown>[] }).entries.filter(x => x && x.inScope !== false && typeof x.id === 'string' && typeof x.name === 'string').map(x => ({ id: string(x.id), name: string(x.name), kind: string(x.kind), description: string(x.description), area: string(x.area), address: string(x.address), officialUrl: safeUrl(x.officialUrl), tags: strings(x.tags), identityStatus: string(x.identityStatus), sourceCheckedAt: string(x.sourceCheckedAt), relatedIds: strings(x.relatedIds) }));
}
export function parseEvents(value: unknown): { events: NightEvent[]; sources: Source[]; checkedAt: string } {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { events?: unknown }).events)) throw new Error('The event calendar could not be read.');
  const data = value as { events: Record<string, unknown>[]; sources?: Source[]; checkedAt?: string };
  const events = data.events.filter(x => x && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.start === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(x.start) && !isNaN(Date.parse(x.start))).map(x => ({ id: string(x.id), title: string(x.title), venueId: string(x.venueId), venueName: string(x.venueName), start: string(x.start), end: typeof x.end === 'string' && !isNaN(Date.parse(x.end)) ? x.end : undefined, url: safeUrl(x.url), ticketUrl: safeUrl(x.ticketUrl), priceText: string(x.priceText), tags: strings(x.tags), status: x.status === 'confirmed' ? 'confirmed' as const : 'needs_verification' as const, sourceId: string(x.sourceId), checkedAt: string(x.checkedAt) }));
  const sources = Array.isArray(data.sources) ? data.sources.filter(x => x && typeof x === 'object').map(x => ({ id: string(x.id), name: string(x.name), status: string(x.status), checkedAt: string(x.checkedAt) || string(x.lastAttemptAt) || string(x.lastSuccessAt), url: safeUrl(x.url), message: string(x.message) })) : [];
  return { events: [...new Map(events.map(x => [x.id, x])).values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), sources, checkedAt: string(data.checkedAt) };
}
export function parseBackup(value: unknown): Backup {
  if (!value || typeof value !== 'object') throw new Error('Choose a Nash After Dark JSON backup.');
  const b = value as Record<string, unknown>;
  if (b.version !== 1 || !b.history || typeof b.history !== 'object' || Array.isArray(b.history) || !Array.isArray(b.savedEventIds)) throw new Error('This is not a supported Nash After Dark backup.');
  const history: Record<string, Personal> = {};
  for (const [id, raw] of Object.entries(b.history)) {
    if (!id || ['__proto__', 'constructor', 'prototype'].includes(id) || !raw || typeof raw !== 'object') throw new Error('The backup contains an invalid place record.');
    const r = raw as Record<string, unknown>;
    if (!['visited', 'not_visited', 'unknown'].includes(String(r.attendance)) || !(r.rating === null || (typeof r.rating === 'number' && Number.isFinite(r.rating) && r.rating >= 0 && r.rating <= 10))) throw new Error(`Invalid attendance or rating for ${id}. Nothing was imported.`);
    if (['notes', 'liked', 'disliked', 'updatedAt'].some(k => typeof r[k] !== 'string') || typeof r.favorite !== 'boolean' || typeof r.watch !== 'boolean') throw new Error(`Invalid personal notes for ${id}. Nothing was imported.`);
    history[id] = { attendance: r.attendance as Personal['attendance'], rating: r.rating as number | null, notes: string(r.notes), liked: string(r.liked), disliked: string(r.disliked), favorite: r.favorite, watch: r.watch, updatedAt: string(r.updatedAt) };
  }
  if (b.savedEventIds.some(x => typeof x !== 'string')) throw new Error('The backup contains invalid saved events.');
  return { version: 1, exportedAt: string(b.exportedAt), history, savedEventIds: [...new Set(b.savedEventIds as string[])], ...(b.searchInterests === undefined ? {} : { searchInterests: parseSearchInterests(b.searchInterests) }) };
}
export function readPersonal(): Backup { const raw = localStorage.getItem(STORE); return raw ? parseBackup(JSON.parse(raw)) : emptyBackup(); }
export function dayKey(value: string | Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
export function dateLabel(key: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }): string { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${key.slice(0, 10)}T12:00:00Z`)); }
export function localTime(value: string): string { return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
export function addDays(key: string, n: number): string { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function kindLabel(kind: string): string { if (/circuit|event_source/i.test(kind)) return 'Event source'; if (/series|recurring/i.test(kind)) return 'Event series'; if (/artist|dj|band|performer/i.test(kind)) return 'Artist'; if (/restaurant|food/i.test(kind)) return 'Food & drink'; if (/event/i.test(kind)) return 'Event'; return 'Venue'; }
export function category(tags: string[], text = ''): string { const all = `${tags.join(' ')} ${text}`.toLowerCase(); if (/danc|goth|darkwave|rave|dj|disco|club night/.test(all)) return 'dancing'; if (/jazz|music|concert|live|punk|band/.test(all)) return 'music'; if (/food|restaurant|taco|bbq|dining|breakfast/.test(all)) return 'food'; return 'other'; }
function isMtg(tags: string[], text: string): boolean {
  const all = `${tags.join(' ')} ${text}`.toLowerCase().replace(/[_-]/g, ' ');
  if (/\b(?:mtg|c?edh|rcq|magic\s*:?\s*the gathering|regional championship qualifier)\b/.test(all)) return true;
  if (tags.some(tag => /^(?:commander|c?edh|rcq)$/i.test(tag.trim()))) return true;
  // Drafts, prereleases, and tournaments also exist outside Magic.
  return /\bmagic\b/.test(all) && /\b(?:draft|pre\s?release|commander|tournament)\b/.test(all);
}
export function matchesFilter(tags: string[], text: string, filter: string): boolean {
  const all = `${tags.join(' ')} ${text}`.toLowerCase();
  if (filter === 'all' || filter === 'saved') return true;
  if (filter === 'dancing') return /danc|goth|dark[ -]?wave|rave|\bdj\b|disco|club[ _-]?night/.test(all);
  if (filter === 'music') return /jazz|music|concert|live|punk|band/.test(all);
  if (filter === 'mtg') return isMtg(tags, text);
  if (filter === 'food') return /food|restaurant|taco|bbq|dining|breakfast/.test(all);
  return false;
}
export function download(name: string, content: string, type: string): void { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
const icsEscape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const utc = (value: string | Date) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
function fold(line: string): string { let out = '', current = ''; for (const ch of line) { if (new TextEncoder().encode(current + ch).length > 74) { out += `${current}\r\n`; current = ' '; } current += ch; } return out + current; }
export function eventIcs(event: NightEvent): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nash After Dark//Nashville Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${icsEscape(event.id)}@nash-after-dark.local`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(event.start)}`];
  if (event.end && Date.parse(event.end) > Date.parse(event.start)) lines.push(`DTEND:${utc(event.end)}`);
  lines.push(`SUMMARY:${icsEscape(event.title)}`, `LOCATION:${icsEscape(event.venueName)}`, `DESCRIPTION:${icsEscape([event.priceText, event.status === 'confirmed' ? 'Listed by the source. Recheck before heading out.' : 'Needs verification. Check the official source before attending.', event.url].filter(Boolean).join('\n'))}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR'); return lines.map(fold).join('\r\n') + '\r\n';
}
