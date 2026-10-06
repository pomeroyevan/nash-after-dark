export interface MediaImage { url: string; sourceUrl: string; alt: string; kind: 'flyer' | 'artist' | 'artwork'; credit?: string; checkedAt: string; sourceOnly?: boolean }
export interface ArtistProfile {
  id: string; name: string; summary: string; genres: string[]; origin?: string;
  sections: { title: string; body: string; sourceUrls: string[] }[];
  links: { label: string; url: string }[]; images: MediaImage[];
  sources: { url: string; label: string; checkedAt: string }[];
  checkedAt: string; eventTitles: string[]; eventIds?: string[];
}
export interface MusicEventInfo { images: MediaImage[]; artistIds: string[]; genres: string[]; sourceUrl: string; checkedAt: string; status: 'ok' | 'partial' | 'failed'; message?: string }
export interface MusicData { version: 1; checkedAt: string; events: Record<string, MusicEventInfo>; entries: Record<string, { images: MediaImage[]; note: string }>; artists: ArtistProfile[]; sources: { id: string; name: string; url: string; status: string; checkedAt: string; message: string }[] }
export const emptyMusic = (): MusicData => ({ version: 1, checkedAt: '', events: {}, entries: {}, artists: [], sources: [] });
const text = (value: unknown, limit = 3000): string => typeof value === 'string' ? value.slice(0, limit) : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown) => list(value).filter((item): item is string => typeof item === 'string').slice(0, 300);
export function publicUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const u = new URL(value), host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) || /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || host.includes(':')) return '';
    return u.href;
  } catch { return ''; }
}
function images(value: unknown): MediaImage[] {
  return list(value).slice(0, 12).map(record).flatMap(item => {
    const url = publicUrl(item.url), sourceUrl = publicUrl(item.sourceUrl);
    if (!url || !sourceUrl || !['flyer', 'artist', 'artwork'].includes(String(item.kind))) return [];
    return [{ url, sourceUrl, alt: text(item.alt, 350) || 'Official event artwork', kind: item.kind as MediaImage['kind'], credit: text(item.credit, 300), checkedAt: text(item.checkedAt, 40), ...(item.sourceOnly === true ? { sourceOnly: true } : {}) }];
  });
}
export function parseMusicData(value: unknown): MusicData {
  const data = record(value);
  if (data.version !== 1 || !Array.isArray(data.artists) || !data.events || typeof data.events !== 'object' || Array.isArray(data.events)) throw new Error('Photos and artist profiles could not be read.');
  const artists = data.artists.map(record).filter(a => typeof a.id === 'string' && typeof a.name === 'string').map(a => ({
    id: text(a.id, 160), name: text(a.name, 200), summary: text(a.summary), genres: strings(a.genres), origin: text(a.origin, 200),
    sections: list(a.sections).slice(0, 12).map(record).map(s => ({ title: text(s.title, 200), body: text(s.body), sourceUrls: strings(s.sourceUrls).map(publicUrl).filter(Boolean) })),
    links: list(a.links).map(record).map(l => ({ label: text(l.label, 200), url: publicUrl(l.url) })).filter(l => l.url),
    images: images(a.images), sources: list(a.sources).map(record).map(s => ({ url: publicUrl(s.url), label: text(s.label, 200), checkedAt: text(s.checkedAt, 40) })).filter(s => s.url),
    checkedAt: text(a.checkedAt, 40), eventTitles: strings(a.eventTitles), eventIds: strings(a.eventIds),
  }));
  const events = Object.fromEntries(Object.entries(record(data.events)).filter(([id]) => !['__proto__', 'constructor', 'prototype'].includes(id)).map(([id, value]) => {
    const item = record(value);
    return [id, { images: images(item.images), artistIds: strings(item.artistIds), genres: strings(item.genres), sourceUrl: publicUrl(item.sourceUrl), checkedAt: text(item.checkedAt, 40), status: ['ok', 'partial', 'failed'].includes(String(item.status)) ? item.status as MusicEventInfo['status'] : 'partial', message: text(item.message) }];
  }));
  const sources = list(data.sources).map(record).map(s => ({ id: text(s.id), name: text(s.name), url: publicUrl(s.url), status: text(s.status), checkedAt: text(s.checkedAt, 40), message: text(s.message) }));
  const entries = Object.fromEntries(Object.entries(record(data.entries)).filter(([id]) => !['__proto__', 'constructor', 'prototype'].includes(id)).map(([id, value]) => { const item = record(value); return [id, { images: images(item.images), note: text(item.note, 1200) }]; }));
  return { version: 1, checkedAt: text(data.checkedAt, 40), artists, events, entries, sources };
}
