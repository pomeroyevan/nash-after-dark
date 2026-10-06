/** Public event artwork only. No accounts, browser cookies, image downloads, or generated substitute art. */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { ADAPTERS, extractJSONArray, fetchPublic, makeWindow, runAdapter } from './refresh-events.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MEDIA_SOURCES = ['cobra', 'rudys-jazz-room', 'five-spot', 'eastside-bowl', 'americano-lounge', 'bourbon-street', 'basement-east', 'game-point'];
const plain = value => load(String(value ?? '')).text().replace(/\s+/g, ' ').trim();
const capped = (value, limit = 1000) => plain(value).slice(0, limit);
const normalized = value => plain(value).normalize('NFKC').toLocaleLowerCase('en-US');
const validDate = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));

export function safeMediaUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) return '';
  try {
    const url = new URL(value, base), host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host.includes('.') || /^(?:localhost|127\.|0\.|10\.|169\.254\.|192\.168\.)/.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || /\.(?:localhost|local|internal|test|invalid)$/.test(host) || host.includes(':')) return '';
    return url.href;
  } catch { return ''; }
}
function image(value, sourceUrl, title, kind, checkedAt, credit, sourceOnly) {
  const url = safeMediaUrl(value, sourceUrl), source = safeMediaUrl(sourceUrl);
  // Never promote venue logos or transparent/generated placeholders into event photography.
  if (!url || !source || /(?:placeholder|spacer|transparent|default[-_]image|\/logos?\/|\/[^/]*logo[^/]*\.(?:png|jpe?g|webp|svg))(?:[?#]|$)/i.test(url)) return null;
  return { url, sourceUrl: source, alt: capped(title, 250), kind, ...(credit ? { credit: capped(credit, 160) } : {}), checkedAt, ...(sourceOnly === true ? { sourceOnly: true } : {}) };
}
const imageList = list => [...new Map(list.filter(Boolean).map(item => [item.url, item])).values()].slice(0, 8);
const genres = list => [...new Set(list.filter(x => typeof x === 'string').map(x => capped(x, 80)).filter(Boolean))].slice(0, 15);

/** Metadata joins only to exact IDs or exact official URLs from the date-validated calendar parser. */
export function extractSourceMedia(source, bodies, parsedEvents, checkedAt) {
  const result = new Map(), byId = new Map(parsedEvents.map(event => [event.id, event]));
  const add = (event, images, genreNames = []) => {
    if (!event) return;
    const old = result.get(event.id);
    result.set(event.id, { images: imageList([...(old?.images || []), ...images]), genres: genres([...(old?.genres || []), ...genreNames]), sourceUrl: event.url, checkedAt });
  };
  const matchingUrl = value => parsedEvents.filter(event => event.url === safeMediaUrl(value, source.url));
  for (const { body } of bodies) {
    if (source.id === 'cobra' || source.id === 'game-point') {
      const payload = JSON.parse(body);
      for (const raw of payload.events) {
        const event = byId.get(source.id + ':' + raw.id);
        const selected = raw.image?.sizes?.large?.url || raw.image?.sizes?.medium_large?.url || raw.image?.url;
        add(event, [image(selected, raw.url, `${plain(raw.title)} — official event artwork`, 'artwork', checkedAt)]);
      }
      continue;
    }
    if (source.id === 'bourbon-street') {
      for (const raw of JSON.parse(body)) {
        const event = byId.get(source.id + ':' + raw.event_id);
        // The schedule has only 30px thumbnails. Resolve the full image on the deduplicated artist page.
        if (event) result.set(event.id, { images: [], genres: [], sourceUrl: event.url, checkedAt, artistUrl: safeMediaUrl(raw.artist_url, source.url) });
      }
      continue;
    }
    const $ = load(body);
    if (source.id === 'rudys-jazz-room') {
      let raw;
      $('script').each((_, el) => { const script = $(el).text(); if (!/fullCalendar/.test(script)) return; const match = /\bevents\s*:\s*(\[)/.exec(script); if (match) raw = extractJSONArray(script, match.index + match[0].length - 1); });
      if (!Array.isArray(raw)) throw new Error('Rudy calendar artwork array missing');
      for (const item of raw) {
        const event = parsedEvents.find(event => event.title === plain(item.title) && event.start.slice(0, 19) === item.start?.slice(0, 19));
        // This exact prefix is the public calendar's own image renderer, not a guessed file path.
        const url = typeof item.image === 'string' && /^[\w .()@+-]+\.(?:jpe?g|png|webp|gif)$/i.test(item.image) ? 'https://rudysjazzroom.com/bandimages/' + item.image : '';
        add(event, [image(url, source.url, `${plain(item.title)} — venue artist photo`, 'artist', checkedAt)]);
      }
    } else if (source.id === 'five-spot') {
      $('.event-card').each((_, node) => {
        const el = $(node), url = el.find('a[href*="/shows/"]').first().attr('href');
        for (const event of matchingUrl(url)) add(event, [image(el.find('.event-poster-container img').first().attr('src'), event.url, `${event.title} — official event poster`, 'flyer', checkedAt)]);
      });
    } else if (source.id === 'eastside-bowl') {
      $('.seetickets-calendar-event-container, .seetickets-list-event-container').each((_, node) => {
        const el = $(node), url = el.find('.seetickets-calendar-event-title a, .title a').first().attr('href');
        const genre = plain(el.find('.genre').text());
        const candidates = matchingUrl(url), months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const heading = el.closest('table.seetickets-calendar').prev('.seetickets-calendar-year-month-container').text().match(/([A-Za-z]+)\s+(20\d{2})/);
        const day = el.closest('td').find('.date-number').first().text().trim();
        const shortDate = el.find('.date').text().match(/\b([A-Za-z]{3})\s+(\d{1,2})\b/);
        const date = heading && day ? `${heading[2]}-${String(months.indexOf(heading[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0')}-${day.padStart(2, '0')}` : '';
        const matched = date ? candidates.filter(event => event.start.slice(0, 10) === date) : shortDate ? candidates.filter(event => Number(event.start.slice(5, 7)) === months.indexOf(shortDate[1].toLowerCase()) + 1 && Number(event.start.slice(8, 10)) === Number(shortDate[2])) : candidates.length === 1 ? candidates : [];
        for (const event of matched) add(event, [image(el.find('img').first().attr('src'), event.url, `${event.title} — official event artwork`, 'artwork', checkedAt)], genre ? [genre] : []);
      });
    } else if (source.id === 'basement-east') {
      $('.tw-plugin-upcoming-event-list .tw-section').each((_, node) => {
        const el = $(node), url = el.find('.tw-name a').first().attr('href');
        for (const event of matchingUrl(url)) add(event, [image(el.find('.tw-image img').first().attr('src'), event.url, `${event.title} — official event artwork`, 'artwork', checkedAt)]);
      });
    } else if (source.id === 'americano-lounge') {
      $('.mec-event-article').each((_, node) => {
        const el = $(node), url = el.find('.mec-event-title a').first().attr('href');
        // Recurrence plugins may reuse older artwork. Do not label it a newly dated flyer.
        for (const event of matchingUrl(url)) add(event, [image(el.find('.mec-event-image img').first().attr('src'), event.url, `${event.title} — venue series artwork; check the event date separately`, 'artwork', checkedAt)]);
      });
    }
  }
  return result;
}

export function parseArtistProfiles(input) {
  if (!input || !Array.isArray(input.artists)) throw new Error('Artist profiles must contain an artists array');
  const ids = new Set();
  return input.artists.map(raw => {
    if (!raw || typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9:_-]{0,159}$/i.test(raw.id) || ids.has(raw.id) || !raw.name || !validDate(raw.checkedAt)) throw new Error('Invalid or duplicate artist profile identity/check time');
    ids.add(raw.id);
    const sources = (raw.sources || []).map(source => ({ url: safeMediaUrl(source.url), label: capped(source.label, 160), checkedAt: source.checkedAt })).filter(source => source.url && validDate(source.checkedAt));
    if (!sources.length) throw new Error('Artist profile requires verified public sources: ' + raw.id);
    const result = { id: raw.id, name: capped(raw.name, 200), summary: capped(raw.summary, 1800), genres: genres(raw.genres || []),
      sections: (raw.sections || []).slice(0, 12).map(section => ({ title: capped(section.title, 100), body: capped(section.body, 2200), sourceUrls: (section.sourceUrls || []).map(url => safeMediaUrl(url)).filter(Boolean).slice(0, 12) })).filter(section => section.title && section.body && section.sourceUrls.length),
      links: (raw.links || []).slice(0, 15).map(link => ({ label: capped(link.label, 100), url: safeMediaUrl(link.url) })).filter(link => link.label && link.url),
      images: imageList((raw.images || []).map(item => image(item.url, item.sourceUrl, item.alt || raw.name, ['flyer', 'artist', 'artwork'].includes(item.kind) ? item.kind : 'artist', validDate(item.checkedAt) ? item.checkedAt : raw.checkedAt, item.credit, item.sourceOnly))),
      sources, checkedAt: raw.checkedAt, eventTitles: (raw.eventTitles || []).filter(item => typeof item === 'string').map(item => capped(item, 500)).slice(0, 200) };
    if (raw.origin) result.origin = capped(raw.origin, 160);
    if (Array.isArray(raw.eventIds)) result.eventIds = raw.eventIds.filter(id => typeof id === 'string' && id.length <= 300).slice(0, 500);
    return result;
  });
}

export function linkArtistProfiles(events, profiles) {
  const matches = new Map();
  for (const event of events) matches.set(event.id, profiles.filter(profile => profile.eventIds?.includes(event.id) || profile.eventTitles.some(title => normalized(title) === normalized(event.title))).map(profile => profile.id));
  return matches;
}

/** Reviewed archived/scene images belong to catalog entries, never to future dated occurrences. */
export function parseSceneGalleries(input, catalogInput) {
  if (!input || !input.entries || typeof input.entries !== 'object' || Array.isArray(input.entries)) throw new Error('Scene galleries must contain an entries object');
  if (catalogInput != null && !Array.isArray(catalogInput.entries)) throw new Error('Catalog IDs could not be validated for scene galleries');
  const known = catalogInput ? new Set(catalogInput.entries.map(entry => entry.id)) : null, entries = {};
  for (const [id, raw] of Object.entries(input.entries)) {
    if (!/^[a-z0-9][a-z0-9:_-]{0,159}$/i.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || known && !known.has(id)) throw new Error('Unknown or invalid scene-gallery catalog ID: ' + id);
    if (!raw || !Array.isArray(raw.images) || raw.images.length > 20 || typeof raw.note !== 'string') throw new Error('Invalid scene gallery: ' + id);
    const images = raw.images.map(item => {
      if (!item || !validDate(item.checkedAt) || !['flyer', 'artist', 'artwork'].includes(item.kind)) throw new Error('Scene image requires its original verified check time and media kind: ' + id);
      const media = image(item.url, item.sourceUrl, item.alt, item.kind, item.checkedAt, item.credit, item.sourceOnly);
      if (!media) throw new Error('Scene image requires a safe public image and source URL: ' + id);
      return media;
    });
    entries[id] = { images: imageList(images), note: capped(raw.note, 1500) };
  }
  return entries;
}

export async function enrichBourbon(source, metadata, previous, checkedAt, request = fetchPublic) {
  const unique = [...new Set([...metadata.values()].map(item => item.artistUrl).filter(Boolean))];
  const cached = new Map(), lastGood = new Map();
  for (const record of Object.values(previous.events || {})) for (const media of record.images || []) {
    if (unique.includes(media.sourceUrl) && safeMediaUrl(media.url) && validDate(media.checkedAt) && Date.parse(media.checkedAt) <= Date.parse(checkedAt)) {
      lastGood.set(media.sourceUrl, media);
      if (Date.parse(checkedAt) - Date.parse(media.checkedAt) < 7 * 86400000) cached.set(media.sourceUrl, media);
    }
  }
  let requested = 0, failed = 0;
  // Sequential bounded requests avoid bursts against a small venue's site.
  for (const url of unique) {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(source.url).origin || !/^\/artist\/view\/[a-z0-9-]+\/?$/i.test(parsed.pathname) || parsed.search || parsed.hash) { failed++; continue; }
    if (cached.has(url)) continue;
    if (requested++ >= 40) { failed++; continue; }
    try {
      const $ = load(await request(url)), container = $('.artistDetail'), title = plain(container.find('.artist-title').text());
      const media = image(container.find('img[src*="/uploaded/artist/"]').first().attr('src'), url, `${title || 'Artist'} — official artist-page image`, 'artwork', checkedAt);
      if (!media) { failed++; continue; }
      cached.set(url, media);
    } catch { failed++; }
  }
  for (const item of metadata.values()) {
    const photo = cached.get(item.artistUrl), old = lastGood.get(item.artistUrl);
    if (photo) item.images = [photo];
    else if (old) { item.images = [old]; item.message = 'Artist page unavailable; previous official photo retained with its original check time.'; }
    delete item.artistUrl;
  }
  return { requested: Math.min(requested, 40), failed, unique: unique.length };
}

async function readJson(filename, fallback) { try { return JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }

export async function refreshMedia({ root = ROOT, now = new Date(), selected, calendar, previous, profileInput, entriesInput, catalogInput, request = fetchPublic, onProgress = () => {} } = {}) {
  calendar ??= await readJson(path.join(root, 'public/data/events.json'), null);
  if (!calendar || !Array.isArray(calendar.events) || !calendar.events.length) throw new Error('A nonempty validated public calendar is required');
  previous ??= await readJson(path.join(root, 'public/data/music-details.json'), { events: {}, sources: [] });
  profileInput ??= await readJson(path.join(root, 'data/artist-profiles.json'), { artists: previous.artists || [] });
  if (entriesInput === undefined) entriesInput = await readJson(path.join(root, 'data/scene-galleries.json'), null);
  if (catalogInput === undefined) catalogInput = await readJson(path.join(root, 'public/data/catalog.json'), null);
  // Losing a manual input file is not an instruction to erase previously reviewed galleries.
  const entries = parseSceneGalleries(entriesInput || { entries: previous.entries || {} }, catalogInput);
  const artists = parseArtistProfiles(profileInput), artistMatches = linkArtistProfiles(calendar.events, artists), checkedAt = now.toISOString(), window = makeWindow(now, 90);
  const result = { version: 1, checkedAt, events: {}, artists, entries, sources: [] };
  const eventSources = [...new Set(calendar.events.map(event => event.sourceId))];
  for (const id of eventSources) {
    const events = calendar.events.filter(event => event.sourceId === id), adapter = ADAPTERS.find(source => source.id === id), info = (calendar.sources || []).find(source => source.id === id), oldSource = (previous.sources || []).find(source => source.id === id);
    const source = { id, name: info?.name || adapter?.name || events[0].venueName || id, url: info?.url || adapter?.url || events[0].url };
    const base = event => ({ images: [], artistIds: artistMatches.get(event.id) || [], genres: [], sourceGenres: [], sourceUrl: event.url, checkedAt, status: 'partial', message: 'Official event artwork has not been verified for this source.' });
    if (!MEDIA_SOURCES.includes(id) || selected && !selected.includes(id)) {
      for (const event of events) result.events[event.id] = { ...(previous.events?.[event.id] || base(event)), artistIds: artistMatches.get(event.id) || [] };
      result.sources.push(oldSource && selected && !selected.includes(id) ? { ...oldSource } : { ...source, status: 'partial', checkedAt: oldSource?.checkedAt || checkedAt, message: !MEDIA_SOURCES.includes(id) ? 'Manual artwork review needed; no image is inferred from the venue logo.' : 'Not requested in this run; previous artwork retained.' });
      continue;
    }
    onProgress('Checking artwork: ' + source.name);
    try {
      const bodies = [], recordingRequest = async (url, options) => { const body = await request(url, options); bodies.push({ url, body }); return body; };
      const parsed = await runAdapter(adapter, checkedAt, window, recordingRequest);
      const metadata = extractSourceMedia(adapter, bodies, parsed.events, checkedAt);
      let bourbon;
      if (id === 'bourbon-street') bourbon = await enrichBourbon(adapter, metadata, previous, checkedAt, request);
      let covered = 0;
      for (const event of events) {
        const item = metadata.get(event.id), parsedEvent = parsed.events.find(candidate => candidate.id === event.id);
        if (!item || parsedEvent?.start !== event.start) {
          result.events[event.id] = { ...(previous.events?.[event.id] || base(event)), artistIds: artistMatches.get(event.id) || [], status: 'partial', message: 'This exact event/date was not matched in the current official calendar; previous artwork, if any, is retained with its original check time.' };
          continue;
        }
        if (!item.images.length && previous.events?.[event.id]?.images?.length) {
          item.images = previous.events[event.id].images;
          item.message = 'Current listing has no usable artwork. Previous official images are retained with their original check dates.';
        }
        covered += item.images.length > 0 ? 1 : 0;
        result.events[event.id] = { images: item.images, artistIds: artistMatches.get(event.id) || [], genres: item.genres, sourceGenres: item.genres, sourceUrl: item.sourceUrl, checkedAt: item.checkedAt, status: item.images.length && !item.message ? 'ok' : 'partial', ...(item.message ? { message: item.message } : item.images.length ? {} : { message: 'The official listing was checked but no usable event artwork was supplied.' }) };
      }
      const missing = events.length - covered;
      result.sources.push({ ...source, status: missing || bourbon?.failed ? 'partial' : 'ok', checkedAt, message: `${covered} of ${events.length} exact event/date records have official artwork.${bourbon ? ` ${bourbon.unique} distinct artist pages; ${bourbon.requested} fetched, ${bourbon.failed} unavailable; cached artist photos retain their original check dates.` : ''}${missing ? ' Other records remain explicit artwork gaps.' : ''}` });
    } catch (error) {
      for (const event of events) result.events[event.id] = { ...(previous.events?.[event.id] || base(event)), artistIds: artistMatches.get(event.id) || [], status: 'failed', message: 'Artwork refresh failed. Any prior official media is retained with its original check time.' };
      result.sources.push({ ...source, status: 'failed', checkedAt, message: capped(error.message, 400) + '; last-good media retained.' });
    }
  }
  // Artist genre claims come only from the reviewed profile, never from clothing or an inferred crowd.
  const profileById = new Map(artists.map(artist => [artist.id, artist]));
  const previousProfiles = new Map((previous.artists || []).map(artist => [artist.id, artist]));
  for (const [eventId, item] of Object.entries(result.events)) {
    // Old snapshots predate sourceGenres. New snapshots retain it explicitly so later
    // profile changes can remove old claims without dropping overlapping source genres.
    if (!Array.isArray(item.sourceGenres)) {
      const priorArtistGenres = new Set((previous.events?.[eventId]?.artistIds || []).flatMap(id => previousProfiles.get(id)?.genres || []).map(normalized));
      item.sourceGenres = genres((item.genres || []).filter(genre => !priorArtistGenres.has(normalized(genre))));
    }
    item.genres = genres([...item.sourceGenres, ...item.artistIds.flatMap(id => profileById.get(id)?.genres || [])]);
    // Reviewed visual labels distinguish portraits from album covers or artist logos.
    // Reclassification does not pretend the remote URL was checked again today.
    const reviewed = item.artistIds.flatMap(id => profileById.get(id)?.images || []);
    item.images = item.images.map(media => {
      const match = reviewed.find(image => image.url === media.url);
      return match ? { ...media, kind: match.kind, alt: match.alt, ...(match.credit ? { credit: match.credit } : {}) } : media;
    });
  }
  return result;
}

async function saveMedia(result, root) {
  const output = path.join(root, 'public/data/music-details.json'), scratch = path.join(root, '.tmp');
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(scratch, { recursive: true });
  const serialized = JSON.stringify(result, null, 2) + '\n', temporary = path.join(scratch, 'music-details.' + process.pid + '.json');
  await writeFile(temporary, serialized, 'utf8');
  try { await rename(temporary, output); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
    const old = await readFile(output, 'utf8'); JSON.parse(old);
    await writeFile(path.join(scratch, 'music-details.previous.' + Date.now() + '.json'), old, 'utf8');
    await writeFile(output, serialized, 'utf8'); JSON.parse(await readFile(output, 'utf8'));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--dry-run', '--profiles-only'].includes(arg) && !arg.startsWith('--sources='))) throw new Error('Options: --sources=id,id --profiles-only --dry-run');
  if (args.includes('--profiles-only') && args.some(arg => arg.startsWith('--sources='))) throw new Error('Use either --profiles-only or --sources, not both');
  const selected = args.includes('--profiles-only') ? [] : args.find(arg => arg.startsWith('--sources='))?.slice(10).split(',').filter(Boolean);
  if (selected?.some(id => !MEDIA_SOURCES.includes(id))) throw new Error('Unknown supported media source');
  const result = await refreshMedia({ selected, onProgress: line => console.error(line) });
  if (!args.includes('--dry-run')) await saveMedia(result, ROOT);
  console.log(JSON.stringify({ mode: args.includes('--profiles-only') ? 'Profiles and reviewed scene galleries relinked; media sources were not checked.' : 'Official media refresh', events: Object.keys(result.events).length, withImages: Object.values(result.events).filter(event => event.images.length).length, artists: result.artists.length, sceneGalleries: Object.keys(result.entries).length, sources: result.sources, written: !args.includes('--dry-run') }, null, 2));
  if (result.sources.some(source => source.status === 'failed')) process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
