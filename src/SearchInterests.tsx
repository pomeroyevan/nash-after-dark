import { useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { addOutline, arrowForwardOutline, checkmarkCircleOutline, cloudOfflineOutline, pauseOutline, playOutline, searchOutline } from 'ionicons/icons';
import { parseSearchInterests, searchInterestStatus, type Backup, type Entry, type NightEvent, type SearchInterest, type SearchInterestKind } from './model';

const kinds: { value: SearchInterestKind; label: string }[] = [
  { value: 'anything', label: 'Anything' }, { value: 'artist', label: 'Artist / band' },
  { value: 'venue', label: 'Venue' }, { value: 'event_series', label: 'Event series' },
  { value: 'activity', label: 'Activity' }, { value: 'organizer', label: 'Organizer' },
];
const labels = { pending: 'Pending research', active: 'In daily search', paused: 'Paused', needs_details: 'Needs details', blocked: 'Blocked' };
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
const checkDate = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

interface Props {
  data: Backup;
  signedIn: boolean;
  cloudSynced: boolean;
  disabled: boolean;
  entries: Entry[];
  events: NightEvent[];
  onChange: (edit: (value: Backup) => Backup) => boolean;
  onSettings: () => void;
  onEntry: (id: string) => void;
  onEvent: (id: string) => void;
}

export default function SearchInterests({ data, signedIn, cloudSynced, disabled, entries, events, onChange, onSettings, onEntry, onEvent }: Props) {
  const [editing, setEditing] = useState<SearchInterest | 'new' | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SearchInterestKind>('anything');
  const [sourceUrl, setSourceUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const interests = Object.values(data.searchInterests || {}).sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.createdAt.localeCompare(a.createdAt));
  const filtered = interests.filter(item => `${item.name} ${item.notes}`.toLowerCase().includes(filter.toLowerCase()));
  const startEdit = (item: SearchInterest | 'new') => {
    setEditing(item); setName(item === 'new' ? '' : item.name); setKind(item === 'new' ? 'anything' : item.kind);
    setSourceUrl(item === 'new' ? '' : item.sourceUrl); setNotes(item === 'new' ? '' : item.notes); setError('');
    requestAnimationFrame(() => { formRef.current?.scrollIntoView({ block: 'nearest' }); formRef.current?.querySelector('input')?.focus({ preventScroll: true }); });
  };
  const close = () => { setEditing(null); setError(''); requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true })); };
  const save = (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (!editing || disabled) return;
    const existing = editing === 'new' ? undefined : editing;
    const id = existing?.id || crypto.randomUUID();
    const updatedAt = stamp(existing?.updatedAt);
    try {
      const item = parseSearchInterests({ [id]: { ...existing, id, name: name.trim(), kind, sourceUrl: sourceUrl.trim(), notes: notes.trim(), enabled: existing?.enabled ?? true, createdAt: existing?.createdAt || updatedAt, updatedAt } })[id];
      const saved = onChange(current => {
        if (existing && current.searchInterests?.[id]?.updatedAt !== existing.updatedAt) throw new Error('This item changed while you were editing. Cancel and open it again to use the latest version.');
        if (!existing && Object.keys(current.searchInterests || {}).length >= 500) throw new Error('Your list is full (500 items). Export a backup before reorganizing it.');
        const duplicate = Object.values(current.searchInterests || {}).find(other => other.id !== id && other.name.toLowerCase() === item.name.toLowerCase() && other.kind === item.kind);
        if (duplicate) throw new Error(`That item is already on your list${duplicate.enabled ? '.' : '. Resume it to include it in the search.'}`);
        // A worker may have added a result while this form was open. Preserve it as a previous check.
        const result = current.searchInterests?.[id]?.result;
        return { ...current, searchInterests: { ...current.searchInterests, [id]: { ...item, ...(result ? { result } : {}) } } };
      });
      if (saved) close(); else setError('The item was not saved. Check the sync message above, then try again.');
    } catch (e) { setError((e as Error).message); }
  };
  const toggle = (id: string) => onChange(current => {
    const item = current.searchInterests?.[id];
    if (!item) return current;
    return { ...current, searchInterests: { ...current.searchInterests, [id]: { ...item, enabled: !item.enabled, updatedAt: stamp(item.updatedAt) } } };
  });

  return <div className="search-interests">
    <div className="interest-intro"><div className="section-intro"><h2>What should we look for?</h2><p>Add an artist, venue, recurring night, or anything you want to do around Nashville.</p></div><button ref={addButton} className="interest-add" disabled={disabled} onClick={() => startEdit('new')}><IonIcon icon={addOutline} />Add an interest</button></div>
    <div className={`notice interest-sync ${!signedIn || !cloudSynced ? 'warning' : ''}`}>
      <IonIcon icon={signedIn && cloudSynced ? checkmarkCircleOutline : cloudOfflineOutline} />
      <div><strong>{signedIn ? (cloudSynced ? 'Saved to your private account' : 'Waiting for private sync') : 'Saved on this device only'}</strong><p>{!signedIn ? 'Sign in to your owner account and sync to include these in the daily search. In Settings, review and merge your device-only list after signing in.' : 'Daily search reads the owner account’s synced list at 9 a.m. Nashville time. New and edited items wait for the next successful check.'}</p><button onClick={onSettings}>{signedIn ? 'Check sync settings' : 'Sign in & sync'}</button></div>
    </div>
    <p className="interest-privacy">Your list and notes stay private. Verified public places and events can appear in Explore and Calendar. Checks run when the daily job’s computer is available.</p>
    {editing && <form ref={formRef} className="interest-form" onSubmit={save} aria-label={editing === 'new' ? 'Add a search interest' : 'Edit search interest'}>
      <h3>{editing === 'new' ? 'Add to your search list' : 'Edit interest'}</h3>
      <label>Name<input name="interest-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} required placeholder="e.g. adult night roller skating" autoComplete="off" disabled={disabled} /></label>
      <label>Type<select aria-label="Type" value={kind} onChange={e => setKind(e.target.value as SearchInterestKind)} disabled={disabled}>{kinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Official link <span>(optional)</span><input name="interest-url" type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} maxLength={2048} placeholder="https://…" autoCapitalize="none" autoCorrect="off" disabled={disabled} /></label>
      <label>What to look for <span>(optional, private)</span><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} rows={3} placeholder="Specific nights, formats, location, or details that matter to you" disabled={disabled} /></label>
      {editing !== 'new' && !editing.enabled && <p className="footnote">This interest is paused. Saving edits keeps it paused; resume it when you want daily checks.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="interest-form-actions"><button className="interest-add" type="submit" disabled={disabled}>{editing === 'new' ? 'Save interest' : 'Save changes'}</button><button className="subtle-button" type="button" onClick={close}>Cancel</button></div>
    </form>}
    {!!interests.length && <><div className="interest-list-heading"><h2>Your search list</h2><span>{interests.filter(item => item.enabled).length} enabled · {interests.length} total</span></div><label className="search-box interest-filter"><IonIcon icon={searchOutline} /><input aria-label="Filter your search interests" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find an interest" /></label></>}
    {filtered.length ? <div className="interest-list">{filtered.map(item => {
      const status = searchInterestStatus(item);
      const result = item.result;
      const currentResult = result?.inputUpdatedAt === item.updatedAt;
      const matchedEntries = currentResult ? entries.filter(entry => result?.catalogIds.includes(entry.id)) : [];
      const matchedEvents = currentResult ? events.filter(event => result?.eventIds.includes(event.id)) : [];
      const unavailable = currentResult && result && result.catalogIds.length + result.eventIds.length > matchedEntries.length + matchedEvents.length;
      return <article className={`interest-card ${!item.enabled ? 'is-paused' : ''}`} key={item.id} aria-label={item.name}>
        <div className="interest-card-heading"><div><span className="interest-kind">{kinds.find(kind => kind.value === item.kind)?.label}</span><h3>{item.name}</h3></div><span className={`interest-status status-${status}`}>{labels[status]}</span></div>
        {item.notes && <p className="interest-notes">{item.notes}</p>}
        {item.sourceUrl && <a className="interest-source" href={item.sourceUrl} target="_blank" rel="noreferrer">Source link <IonIcon icon={arrowForwardOutline} /></a>}
        <div className="interest-progress"><p>{status === 'paused' ? 'Excluded from future checks until you resume it.' : status === 'pending' ? 'Waiting for research of this version. Sync it to the owner account for the daily job to pick it up.' : result?.message}</p>{result && <small>{currentResult ? 'Last checked' : 'Previous check'} {checkDate(result.checkedAt)} Central</small>}</div>
        {(matchedEntries.length > 0 || matchedEvents.length > 0) && <div className="interest-results">{matchedEntries.map(entry => <button key={entry.id} onClick={() => onEntry(entry.id)}><span>In the guide<strong>{entry.name}</strong></span><IonIcon icon={arrowForwardOutline} /></button>)}{matchedEvents.map(event => <button key={event.id} onClick={() => onEvent(event.id)}><span>On the calendar<strong>{event.title}</strong></span><IonIcon icon={arrowForwardOutline} /></button>)}</div>}
        {unavailable && <small className="footnote">Some linked listings are outside the current published guide or calendar.</small>}
        <div className="interest-card-actions"><button className="subtle-button" disabled={disabled} onClick={() => startEdit(item)}>Edit<span className="sr-only"> {item.name}</span></button><button className="subtle-button" disabled={disabled} onClick={() => toggle(item.id)}><IonIcon icon={item.enabled ? pauseOutline : playOutline} />{item.enabled ? 'Pause' : 'Resume'}<span className="sr-only"> {item.name}</span></button></div>
      </article>;
    })}</div> : <div className="empty-state interest-empty"><IonIcon icon={searchOutline} /><h3>{interests.length ? 'No matching interests.' : 'Your next idea starts here.'}</h3><p>{interests.length ? 'Try a different word to find an item on your list.' : 'Add something once. After it syncs to your owner account, the daily job will research it, track its sources, and add verified finds to the guide and calendar.'}</p></div>}
  </div>;
}
