import { createContext, useContext, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { arrowForwardOutline, imageOutline, musicalNotesOutline } from 'ionicons/icons';
import { dateLabel, dayKey, localTime, type NightEvent } from './model';
import { emptyMusic, type ArtistProfile, type MediaImage, type MusicData } from './music';
import './music.css';

export const MusicContext = createContext<MusicData>(emptyMusic());
const checked = (value: string) => Number.isFinite(Date.parse(value)) ? dateLabel(value.includes('T') ? dayKey(value) : value, { month: 'short', day: 'numeric', year: 'numeric' }) : 'not recorded';
const imageLabel = (kind: MediaImage['kind']) => kind === 'artist' ? 'Artist photo' : kind === 'flyer' ? 'Event flyer' : 'Promotional artwork';

export function RemoteImage({ image, className = '', eager = false }: { image: MediaImage; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (image.sourceOnly) return <span className={`media-unavailable source-only-image ${className}`}><IonIcon icon={imageOutline} /><strong>Open original {image.kind === 'flyer' ? 'flyer' : 'image'} ↗</strong><small>This source allows viewing in its own tab.</small></span>;
  if (failed) return <span className={`media-unavailable ${className}`}><IonIcon icon={imageOutline} /><small>Image unavailable</small></span>;
  return <img className={className} src={image.url} alt={image.alt} loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
export function EventThumbnail({ eventId, fallbackIcon = musicalNotesOutline }: { eventId: string; fallbackIcon?: string }) {
  const music = useContext(MusicContext), image = music.events[eventId]?.images[0];
  return image ? <RemoteImage key={image.url} image={image} className="event-thumbnail" /> : <span className="event-icon"><IonIcon icon={fallbackIcon} /></span>;
}
export function ImageGallery({ images, label = 'Photos and flyers' }: { images: MediaImage[]; label?: string }) {
  if (!images.length) return null;
  return <section className="media-gallery" aria-label={label}>{images.map(image => <figure key={image.url}>
    <a href={image.url} target="_blank" rel="noreferrer" aria-label={`Open full image: ${image.alt}`}><RemoteImage key={image.url} image={image} className={`detail-image media-${image.kind}`} eager /></a>
    <figcaption><strong>{imageLabel(image.kind)}</strong><span>{image.alt}</span><a href={image.sourceUrl} target="_blank" rel="noreferrer">{image.credit || 'View original source'} ↗</a><small>Checked {checked(image.checkedAt)}</small></figcaption>
  </figure>)}</section>;
}
export function EventMusicDetails({ event, onArtist }: { event: NightEvent; onArtist: (id: string) => void }) {
  const music = useContext(MusicContext), info = music.events[event.id];
  const artists = music.artists.filter(a => info?.artistIds.includes(a.id));
  const genres = [...new Set([...(info?.genres || []), ...artists.flatMap(a => a.genres)])];
  const isMusic = /music|jazz|blues|funk|rock|punk|dance|goth|live|concert/i.test(event.tags.join(' ')) || ['cobra', 'basement-east', 'rudys-jazz-room', 'eastside-bowl', 'five-spot', 'bourbon-street', 'americano-lounge'].includes(event.sourceId);
  return <>
    {info?.images.length ? <ImageGallery images={info.images} /> : isMusic && <p className="media-gap">No verified photo or flyer is available for this listing yet. <a href={event.url} target="_blank" rel="noreferrer">Check the official event ↗</a></p>}
    {genres.length > 0 && <div className="tag-list music-genres" aria-label="Music genres">{genres.map(genre => <span key={genre}>{genre}</span>)}</div>}
    {artists.length > 0 ? <section className="event-artists"><h3>Meet the artists</h3><p className="muted">Their sound, live show, scene, and visual style.</p>{artists.map(artist => <button className="artist-link" key={artist.id} onClick={() => onArtist(artist.id)}>{artist.images[0] && <RemoteImage image={artist.images[0]} className="artist-avatar" />}<span><strong>{artist.name}</strong><small>{artist.genres.join(' · ')}</small></span><IonIcon icon={arrowForwardOutline} /></button>)}</section> : isMusic && <p className="media-gap">Artist background and scene details haven’t been researched for this listing yet.</p>}
    {info && info.status !== 'ok' && <p className="media-gap">{info.message || 'The latest image check is incomplete. Previous source images may be shown; check the original source for changes.'}</p>}
  </>;
}
export function EntryGallery({ entryId }: { entryId: string }) {
  const music = useContext(MusicContext), gallery = music.entries[entryId];
  if (!gallery?.images.length) return null;
  return <section className="entry-scene-gallery"><h3>Past flyers & scene photos</h3><p className="media-gap">{gallery.note}</p><ImageGallery images={gallery.images} label="Past flyers and scene photos" /></section>;
}
export function ArtistDirectory({ search, events, onArtist, error }: { search: string; events: NightEvent[]; onArtist: (id: string) => void; error: string }) {
  const music = useContext(MusicContext);
  const artists = music.artists.filter(a => `${a.name} ${a.summary} ${a.genres.join(' ')} ${a.origin || ''} ${a.sections.map(s => s.body).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="artist-directory" aria-label="Artist profiles"><div className="section-intro"><h2>Know who’s on stage.</h2><p>Photos, sound, live-show context, scene connections, and sourced visual style. Coverage grows as each artist is researched.</p></div>
    {error && <p role="alert" className="media-gap">{error}</p>}
    <p className="result-count">{artists.length} researched {artists.length === 1 ? 'artist' : 'artists'} · Details checked individually</p>
    <div className="artist-grid">{artists.map(artist => {
      const count = events.filter(event => music.events[event.id]?.artistIds.includes(artist.id)).length;
      return <button className="artist-card" key={artist.id} onClick={() => onArtist(artist.id)}>{artist.images[0] ? <RemoteImage image={artist.images[0]} className="artist-cover" /> : <div className="artist-cover media-unavailable"><IonIcon icon={musicalNotesOutline} /></div>}<span className="artist-card-copy"><small>{artist.genres.slice(0, 3).join(' / ')}</small><strong>{artist.name}</strong><span>{artist.summary}</span><em>{count ? `${count} upcoming ${count === 1 ? 'listing' : 'listings'} · ` : ''}Artist guide ↗</em></span></button>;
    })}</div>{!artists.length && <p className="muted">No researched profiles match this search yet.</p>}
  </section>;
}
export function ArtistDetail({ artist, events, onEvent, onBack }: { artist: ArtistProfile; events: NightEvent[]; onEvent: (id: string) => void; onBack?: () => void }) {
  const music = useContext(MusicContext), gigs = events.filter(e => music.events[e.id]?.artistIds.includes(artist.id));
  return <div className="artist-detail">{onBack && <button className="text-button" onClick={onBack}>← Back to event</button>}<p className="eyebrow">ARTIST GUIDE{artist.origin ? ` · ${artist.origin}` : ''}</p><h2 className="detail-title">{artist.name}</h2><div className="tag-list">{artist.genres.map(genre => <span key={genre}>{genre}</span>)}</div><p className="artist-summary">{artist.summary}</p><ImageGallery images={artist.images} label={`${artist.name} photos`} />
    {artist.sections.map(section => <section className="artist-section" key={section.title}><h3>{section.title}</h3><p>{section.body}</p><div className="artist-citations">{section.sourceUrls.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer">{artist.sources.find(s => s.url === url)?.label || `Source ${i + 1}`} ↗</a>)}</div></section>)}
    <p className="media-gap">Scene and style describe the artist’s documented work and presentation. They do not establish who will attend or what fans must wear. Event dress rules apply only when the organizer states them.</p>
    {!!artist.links.length && <section className="artist-section"><h3>Listen & explore</h3><div className="artist-listen">{artist.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a>)}</div></section>}
    {!!gigs.length && <section className="related-section"><h3>Upcoming here</h3>{gigs.map(event => <button className="related-row" key={event.id} onClick={() => onEvent(event.id)}><span>{event.title}<small>{dateLabel(dayKey(event.start), { month: 'short', day: 'numeric' })} · {localTime(event.start)} · {event.venueName}</small></span><IonIcon icon={arrowForwardOutline} /></button>)}</section>}
    <details className="artist-sources"><summary>Research sources · checked {checked(artist.checkedAt)}</summary>{artist.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<small>Checked {checked(source.checkedAt)}</small></a>)}</details>
  </div>;
}
