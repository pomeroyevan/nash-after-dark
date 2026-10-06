import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { emptyBackup, parseBackup, STORE, type Backup } from './model';

export type Phase = 'local' | 'loading' | 'synced' | 'saving' | 'pending' | 'error' | 'conflict';
export interface CloudRecord { revision: number; data: Backup }
export interface SyncTransport {
  load(owner: string): Promise<CloudRecord>;
  save(owner: string, revision: number, data: Backup): Promise<CloudRecord & { applied: boolean }>;
}
export interface Recovery { owner: string; revision: number; data: Backup; dirty: boolean }
export interface ArchivedDraft { key: string; createdAt: string; data: Backup }
export interface SyncState {
  data: Backup; owner: string | null; revision: number; phase: Phase; message: string;
  dirty: boolean; ready: boolean; conflict: CloudRecord | null; archives: ArchivedDraft[];
}
export const RECOVERY_PREFIX = 'nash-after-dark.account.v1.';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const sameData = (a: Backup, b: Backup) => JSON.stringify([Object.entries(a.history).sort(), [...a.savedEventIds].sort(), Object.entries(a.searchInterests || {}).sort()]) === JSON.stringify([Object.entries(b.history).sort(), [...b.savedEventIds].sort(), Object.entries(b.searchInterests || {}).sort()]);
export function mergeBackup(current: Backup, incoming: Backup): Backup {
  const searchInterests = { ...current.searchInterests };
  for (const [id, interest] of Object.entries(incoming.searchInterests || {})) {
    const previous = searchInterests[id];
    // An older backup may lack the worker's result for the same unchanged input.
    const unchanged = previous && (['id', 'name', 'kind', 'sourceUrl', 'notes', 'enabled', 'createdAt', 'updatedAt'] as const).every(key => previous[key] === interest[key]);
    const result = interest.result || (unchanged ? previous.result : undefined);
    searchInterests[id] = { ...interest, ...(result ? { result } : {}) };
  }
  return parseBackup({ ...current, history: { ...current.history, ...incoming.history }, savedEventIds: [...new Set([...current.savedEventIds, ...incoming.savedEventIds])], ...(current.searchInterests !== undefined || incoming.searchInterests !== undefined ? { searchInterests } : {}) });
}
function cloudRecord(value: { revision: unknown; payload: unknown }): CloudRecord {
  const revision = Number(value.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid cloud revision. Your local draft is preserved.');
  return { revision, data: parseBackup(value.payload) };
}
export async function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 20_000);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); init?.signal?.removeEventListener('abort', abort); }
}
export function parseSyncConfig(value: unknown): { url: string; publishableKey: string } {
  const config = value as { url?: unknown; publishableKey?: unknown };
  if (!config || typeof config.url !== 'string' || typeof config.publishableKey !== 'string') throw new Error('Private sync configuration is invalid.');
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Private sync needs a secure project URL.');
  let publicKey = config.publishableKey.startsWith('sb_publishable_');
  if (!publicKey) {
    try { publicKey = JSON.parse(atob(config.publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch { /* not an anon JWT */ }
  }
  if (!publicKey) throw new Error('Only a Supabase publishable key or legacy anon key belongs in this public configuration.');
  return { url: url.origin, publishableKey: config.publishableKey };
}
export function makeSyncClient(config: { url: string; publishableKey: string }): SupabaseClient {
  return createClient(config.url, config.publishableKey, { global: { fetch: timedFetch }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
}
export function supabaseTransport(client: SupabaseClient): SyncTransport {
  return {
    async load(owner) {
      const { data, error } = await client.from('nash_private_state').select('revision,payload').eq('user_id', owner).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? cloudRecord(data) : { revision: 0, data: emptyBackup() };
    },
    async save(owner, revision, payload) {
      const { data, error } = await client.rpc('save_nash_private_state', { p_owner: owner, p_expected_revision: revision, p_payload: payload });
      if (error) throw new Error(error.message);
      if (!Array.isArray(data) || data.length !== 1 || typeof data[0].applied !== 'boolean') throw new Error('Cloud save response was incomplete. Retry to check whether it saved.');
      return { ...cloudRecord(data[0]), applied: data[0].applied };
    }
  };
}

/** One queue for loads/saves. Recovery belongs to an account AND this browser tab. */
export class SyncEngine {
  private state: SyncState = { data: emptyBackup(), owner: null, revision: 0, phase: 'local', message: '', dirty: false, ready: true, conflict: null, archives: [] };
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private edits = 0;
  private transport: SyncTransport | null = null;
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>, private tabId: string) { this.reloadGuest(); }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(patch: Partial<SyncState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private recoveryKey(owner: string) { return `${RECOVERY_PREFIX}${owner}.${this.tabId}`; }
  private writeRecovery(data: Backup, dirty: boolean, revision = this.state.revision) {
    if (!this.state.owner) throw new Error('No account selected.');
    this.storage.setItem(this.recoveryKey(this.state.owner), JSON.stringify({ owner: this.state.owner, revision, data, dirty } satisfies Recovery));
  }
  private readRecovery(owner: string): Recovery | null {
    const raw = this.storage.getItem(this.recoveryKey(owner));
    if (!raw) return null;
    const record = JSON.parse(raw) as Recovery;
    if (record.owner !== owner || !Number.isSafeInteger(record.revision) || record.revision < 0 || typeof record.dirty !== 'boolean') throw new Error('This account’s local recovery record is invalid. It has not been overwritten.');
    return { ...record, data: parseBackup(record.data) };
  }
  private getArchives(owner: string): ArchivedDraft[] {
    const records: ArchivedDraft[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(`${RECOVERY_PREFIX}${owner}.archive.`)) {
        const record = JSON.parse(this.storage.getItem(key) || '{}');
        records.push({ key, createdAt: record.createdAt, data: parseBackup(record.data) });
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  private archiveDraft() {
    const createdAt = new Date().toISOString();
    const key = `${RECOVERY_PREFIX}${this.state.owner}.archive.${createdAt}.${this.tabId}.${crypto.randomUUID()}`;
    this.storage.setItem(key, JSON.stringify({ createdAt, data: this.state.data }));
    this.emit({ archives: this.getArchives(this.state.owner!) });
  }
  private enqueue(work: () => Promise<void>) { this.queue = this.queue.then(work).catch(error => this.emit({ phase: 'error', message: errorText(error) })); }
  async whenIdle() { let current; do { current = this.queue; await current; } while (current !== this.queue); }
  reloadGuest() {
    if (this.state.owner) return;
    try { const raw = this.storage.getItem(STORE); this.emit({ data: raw ? parseBackup(JSON.parse(raw)) : emptyBackup(), phase: 'local', message: '' }); }
    catch { this.emit({ phase: 'error', message: 'Device notes could not be read. Existing storage has not been changed.' }); }
  }
  deviceBackup() { const raw = this.storage.getItem(STORE); return raw ? parseBackup(JSON.parse(raw)) : emptyBackup(); }
  connect(owner: string | null, transport: SyncTransport | null) {
    if (owner === this.state.owner && (owner === null || this.transport === transport)) return;
    this.generation++; this.transport = transport; this.edits++;
    this.emit({ owner, data: emptyBackup(), revision: 0, dirty: false, ready: !owner, conflict: null, archives: [], phase: owner ? 'loading' : 'local', message: '' });
    if (!owner) { this.reloadGuest(); return; }
    try {
      const recovery = this.readRecovery(owner);
      this.emit({ archives: this.getArchives(owner), ...(recovery ? { data: recovery.data, revision: recovery.revision, dirty: recovery.dirty } : {}) });
    } catch (error) { this.emit({ phase: 'error', message: errorText(error) }); return; }
    this.refresh();
  }
  mutate(fn: (value: Backup) => Backup): boolean {
    if (this.state.owner && !this.state.ready) { this.emit({ message: 'Load this account’s cloud data before editing. Retry in Settings.' }); return false; }
    try {
      const current = this.state.owner ? this.state.data : this.deviceBackup();
      const data = parseBackup({ ...fn(current), exportedAt: new Date().toISOString() });
      if (this.state.owner) this.writeRecovery(data, true);
      else this.storage.setItem(STORE, JSON.stringify(data));
      this.edits++;
      this.emit({ data, dirty: !!this.state.owner, phase: this.state.owner ? (this.state.conflict ? 'conflict' : 'pending') : 'local', message: '' });
      if (this.state.owner && !this.state.conflict) this.flush();
      return true;
    } catch (error) { this.emit({ message: `Could not save a local recovery copy: ${errorText(error)}. Your previous data is preserved.` }); return false; }
  }
  private acceptCloud(remote: CloudRecord) {
    this.writeRecovery(remote.data, false, remote.revision);
    this.emit({ ...remote, ready: true, dirty: false, conflict: null, phase: 'synced', message: '' });
  }
  refresh = () => {
    const generation = this.generation, owner = this.state.owner, transport = this.transport;
    if (!owner || !transport) return;
    this.enqueue(async () => {
      if (generation !== this.generation) return;
      try {
        const remote = await transport.load(owner);
        if (generation !== this.generation) return;
        if (this.state.dirty && !sameData(this.state.data, remote.data)) {
          if (remote.revision !== this.state.revision) this.emit({ ready: true, phase: 'conflict', conflict: remote, message: 'Cloud data changed on another device. Your draft is preserved. Choose a version below.' });
          else { this.emit({ ready: true, phase: 'pending', conflict: null, message: '' }); this.flush(); }
        } else this.acceptCloud(remote);
      } catch (error) { if (generation === this.generation) this.emit({ phase: this.state.conflict ? 'conflict' : 'error', message: `Sync unavailable: ${errorText(error)}. Any local draft is preserved.` }); }
    });
  };
  private flush() {
    const generation = this.generation, owner = this.state.owner, transport = this.transport;
    if (!owner || !transport) return;
    this.enqueue(async () => {
      if (generation !== this.generation || !this.state.dirty || this.state.conflict || !this.state.ready) return;
      const data = this.state.data, revision = this.state.revision, edits = this.edits;
      this.emit({ phase: 'saving', message: '' });
      try {
        const result = await transport.save(owner, revision, data);
        if (generation !== this.generation) return;
        if (!result.applied) {
          if (sameData(this.state.data, result.data)) this.acceptCloud(result);
          else this.emit({ phase: 'conflict', conflict: result, message: 'Cloud data changed before your save. Nothing was overwritten. Choose a version below.' });
          return;
        }
        if (edits === this.edits) this.acceptCloud(result);
        else {
          this.writeRecovery(this.state.data, true, result.revision);
          this.emit({ revision: result.revision, phase: 'pending' }); this.flush();
        }
      } catch (error) { if (generation === this.generation) this.emit({ phase: 'error', message: `Save not confirmed: ${errorText(error)}. Your draft is saved on this device. Retry checks the cloud before writing.` }); }
    });
  }
  useCloud = () => {
    if (!this.state.conflict) return;
    try { this.archiveDraft(); this.acceptCloud(this.state.conflict); }
    catch (error) { this.emit({ message: `Could not preserve your draft: ${errorText(error)}. No version was replaced.` }); }
  };
  keepDraft = () => {
    if (!this.state.conflict) return;
    try {
      // The cloud version stays downloadable before the explicit replacement.
      const createdAt = new Date().toISOString(), remote = this.state.conflict;
      this.storage.setItem(`${RECOVERY_PREFIX}${this.state.owner}.archive.${createdAt}.cloud-${this.tabId}.${crypto.randomUUID()}`, JSON.stringify({ createdAt, data: remote.data }));
      this.writeRecovery(this.state.data, true, remote.revision);
      this.emit({ revision: remote.revision, conflict: null, phase: 'pending', message: '', archives: this.getArchives(this.state.owner!) }); this.flush();
    } catch (error) { this.emit({ message: `Could not preserve both versions: ${errorText(error)}. No version was replaced.` }); }
  };
}
