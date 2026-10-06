import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine, mergeBackup, parseSyncConfig, RECOVERY_PREFIX, type CloudRecord, type SyncTransport } from '../src/sync.ts';
import { emptyBackup, emptyPersonal, searchInterestStatus, STORE, type Backup, type SearchInterest } from '../src/model.ts';

class MemoryStorage {
  values = new Map<string, string>(); fail = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] || null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('quota'); this.values.set(key, value); }
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const note = (value: string) => (data: Backup): Backup => ({ ...data, history: { ...data.history, cobra: { ...emptyPersonal(), notes: value } } });
function server(seed: Record<string, CloudRecord> = {}) {
  const records = new Map(Object.entries(copy(seed)));
  const saves: { owner: string; revision: number; data: Backup }[] = [];
  const transport: SyncTransport = {
    async load(owner) { return copy(records.get(owner) || { revision: 0, data: emptyBackup() }); },
    async save(owner, revision, data) {
      saves.push({ owner, revision, data: copy(data) });
      const current = records.get(owner) || { revision: 0, data: emptyBackup() };
      if (current.revision !== revision) return { ...copy(current), applied: false };
      const next = { revision: revision + 1, data: copy(data) }; records.set(owner, next);
      return { ...copy(next), applied: true };
    }
  };
  return { records, saves, transport };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('sign-in is cloud authoritative and never uploads guest or another account data', async () => {
  const storage = new MemoryStorage(); const guest = note('guest note')(emptyBackup()); storage.setItem(STORE, JSON.stringify(guest));
  const remote = server({ alice: { revision: 4, data: note('Alice private')(emptyBackup()) }, bob: { revision: 2, data: note('Bob private')(emptyBackup()) } });
  const engine = new SyncEngine(storage, 'tab-a');
  assert.equal(engine.getSnapshot().data.history.cobra.notes, 'guest note');
  engine.connect('alice', remote.transport); await engine.whenIdle();
  assert.equal(engine.getSnapshot().data.history.cobra.notes, 'Alice private'); assert.equal(remote.saves.length, 0);
  engine.connect('bob', remote.transport); await engine.whenIdle();
  assert.equal(engine.getSnapshot().data.history.cobra.notes, 'Bob private'); assert.equal(remote.saves.length, 0);
  engine.connect(null, null); assert.equal(engine.getSnapshot().data.history.cobra.notes, 'guest note');
  assert.deepEqual(JSON.parse(storage.getItem(STORE)!), guest);
});

test('loads and saves are serialized and edits during an in-flight save are not lost', async () => {
  const remote = server(); const started = deferred(), release = deferred(); let active = 0, maxActive = 0, first = true;
  const transport: SyncTransport = {
    async load(owner) { active++; maxActive = Math.max(maxActive, active); const result = await remote.transport.load(owner); active--; return result; },
    async save(owner, revision, data) { active++; maxActive = Math.max(maxActive, active); if (first) { first = false; started.resolve(); await release.promise; } const result = await remote.transport.save(owner, revision, data); active--; return result; }
  };
  const engine = new SyncEngine(new MemoryStorage(), 'tab'); engine.connect('alice', transport); await engine.whenIdle();
  assert.equal(engine.mutate(note('first')), true); await started.promise;
  assert.equal(engine.mutate(current => ({ ...note('latest')(current), savedEventIds: ['unknown-expired-event'] })), true);
  engine.refresh(); release.resolve(); await engine.whenIdle();
  assert.equal(maxActive, 1); assert.equal(remote.records.get('alice')!.data.history.cobra.notes, 'latest');
  assert.deepEqual(remote.records.get('alice')!.data.savedEventIds, ['unknown-expired-event']);
  assert.equal(engine.getSnapshot().phase, 'synced'); assert.equal(engine.getSnapshot().dirty, false);
  assert.deepEqual(remote.saves.map(save => save.revision), [0, 1]);
});

test('two-device CAS conflict preserves both versions and explicit use-cloud archives the draft', async () => {
  const remote = server(); const first = new SyncEngine(new MemoryStorage(), 'a'), second = new SyncEngine(new MemoryStorage(), 'b');
  first.connect('alice', remote.transport); second.connect('alice', remote.transport); await Promise.all([first.whenIdle(), second.whenIdle()]);
  first.mutate(note('cloud winner')); await first.whenIdle(); second.mutate(note('local draft')); await second.whenIdle();
  assert.equal(second.getSnapshot().phase, 'conflict'); assert.equal(second.getSnapshot().data.history.cobra.notes, 'local draft');
  assert.equal(second.getSnapshot().conflict!.data.history.cobra.notes, 'cloud winner');
  assert.equal(remote.records.get('alice')!.data.history.cobra.notes, 'cloud winner');
  second.useCloud(); assert.equal(second.getSnapshot().data.history.cobra.notes, 'cloud winner');
  assert.equal(second.getSnapshot().archives[0].data.history.cobra.notes, 'local draft');
  assert.equal(second.getSnapshot().phase, 'synced');
});

test('explicit keep-draft retries against the cloud revision and preserves previous cloud data', async () => {
  const remote = server(); const engine = new SyncEngine(new MemoryStorage(), 'a'); engine.connect('alice', remote.transport); await engine.whenIdle();
  remote.records.set('alice', { revision: 1, data: note('other device')(emptyBackup()) });
  engine.mutate(note('my chosen version')); await engine.whenIdle(); engine.keepDraft(); await engine.whenIdle();
  assert.equal(remote.records.get('alice')!.revision, 2);
  assert.equal(remote.records.get('alice')!.data.history.cobra.notes, 'my chosen version');
  assert.equal(engine.getSnapshot().archives[0].data.history.cobra.notes, 'other device');
});

test('lost save response retries by reading cloud, without silently writing twice', async () => {
  const storage = new MemoryStorage(), remote = server();
  const transport = { ...remote.transport, async save(owner: string, revision: number, data: Backup) { await remote.transport.save(owner, revision, data); throw new Error('response lost'); } };
  const engine = new SyncEngine(storage, 'tab'); engine.connect('alice', transport); await engine.whenIdle();
  engine.mutate(note('already committed')); await engine.whenIdle();
  assert.equal(engine.getSnapshot().phase, 'error'); assert.equal(engine.getSnapshot().dirty, true);
  engine.refresh(); await engine.whenIdle();
  assert.equal(engine.getSnapshot().phase, 'synced'); assert.equal(remote.saves.length, 1);
  assert.equal(engine.getSnapshot().data.history.cobra.notes, 'already committed');
});

test('reload restores owned unsynced draft; another login never sees or uploads it', async () => {
  const storage = new MemoryStorage(), remote = server();
  const offline = { ...remote.transport, async save() { throw new Error('offline'); } };
  const engine = new SyncEngine(storage, 'same-tab'); engine.connect('alice', offline); await engine.whenIdle();
  engine.mutate(note('recover after reload')); await engine.whenIdle();
  const reload = new SyncEngine(storage, 'same-tab'); reload.connect('bob', remote.transport); await reload.whenIdle();
  assert.deepEqual(reload.getSnapshot().data.history, {}); assert.equal(remote.saves.length, 0);
  reload.connect('alice', remote.transport); await reload.whenIdle();
  assert.equal(remote.records.get('alice')!.data.history.cobra.notes, 'recover after reload');
  assert.equal(remote.saves[0].owner, 'alice'); assert.equal(reload.getSnapshot().phase, 'synced');
});

test('different tabs keep separate unsynced recovery keys', async () => {
  const storage = new MemoryStorage(), remote = server(); const offline = { ...remote.transport, async save() { throw new Error('offline'); } };
  const a = new SyncEngine(storage, 'a'), b = new SyncEngine(storage, 'b');
  a.connect('alice', offline); b.connect('alice', offline); await Promise.all([a.whenIdle(), b.whenIdle()]);
  a.mutate(note('A draft')); b.mutate(note('B draft')); await Promise.all([a.whenIdle(), b.whenIdle()]);
  assert.equal(JSON.parse(storage.getItem(`${RECOVERY_PREFIX}alice.a`)!).data.history.cobra.notes, 'A draft');
  assert.equal(JSON.parse(storage.getItem(`${RECOVERY_PREFIX}alice.b`)!).data.history.cobra.notes, 'B draft');
});

test('account switch ignores an old delayed response and sends no previous-account data', async () => {
  const remote = server({ alice: { revision: 1, data: note('Alice only')(emptyBackup()) } });
  const started = deferred(), release = deferred();
  const transport = { ...remote.transport, async load(owner: string) { if (owner === 'alice') { started.resolve(); await release.promise; } return remote.transport.load(owner); } };
  const engine = new SyncEngine(new MemoryStorage(), 'tab'); engine.connect('alice', transport); await started.promise;
  engine.connect('bob', transport); release.resolve(); await engine.whenIdle();
  assert.equal(engine.getSnapshot().owner, 'bob'); assert.deepEqual(engine.getSnapshot().data.history, {}); assert.equal(remote.saves.length, 0);
});

test('quota failure refuses mutation before network write and leaves previous data intact', async () => {
  const storage = new MemoryStorage(), remote = server(); const engine = new SyncEngine(storage, 'tab');
  engine.connect('alice', remote.transport); await engine.whenIdle(); storage.fail = true;
  assert.equal(engine.mutate(note('cannot store')), false); await engine.whenIdle();
  assert.equal(remote.saves.length, 0); assert.deepEqual(engine.getSnapshot().data.history, {}); assert.match(engine.getSnapshot().message, /recovery copy/);
});

test('failed initial cloud load blocks edits and never adopts guest notes as account data', async () => {
  const storage = new MemoryStorage(); storage.setItem(STORE, JSON.stringify(note('guest')(emptyBackup())));
  const remote = server(); const engine = new SyncEngine(storage, 'tab');
  engine.connect('alice', { ...remote.transport, async load() { throw new Error('offline'); } }); await engine.whenIdle();
  assert.equal(engine.getSnapshot().ready, false); assert.equal(engine.mutate(note('blocked')), false);
  assert.deepEqual(engine.getSnapshot().data.history, {}); assert.equal(remote.saves.length, 0);
});

test('explicit import retains unknown saved IDs and unrelated notes', () => {
  const existing = { ...note('cloud')(emptyBackup()), savedEventIds: ['expired-event'] };
  const imported = { ...emptyBackup(), history: { rudys: { ...emptyPersonal(), notes: 'Jazz' } }, savedEventIds: ['future-event'] };
  const result = mergeBackup(existing, imported);
  assert.equal(result.history.cobra.notes, 'cloud'); assert.equal(result.history.rudys.notes, 'Jazz');
  assert.deepEqual(result.savedEventIds, ['expired-event', 'future-event']);
});

test('public config rejects secret/service keys and insecure endpoints', () => {
  assert.deepEqual(parseSyncConfig({ url: 'https://project.supabase.co/', publishableKey: 'sb_publishable_example' }), { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_example' });
  assert.throws(() => parseSyncConfig({ url: 'https://project.supabase.co', publishableKey: 'sb_secret_bad' }), /publishable/);
  assert.throws(() => parseSyncConfig({ url: 'http://project.supabase.co', publishableKey: 'sb_publishable_test' }), /secure/);
  const key = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  assert.throws(() => parseSyncConfig({ url: 'https://project.supabase.co', publishableKey: key }), /publishable/);
});

const interest = (overrides: Partial<SearchInterest> = {}): SearchInterest => ({ id: 'draft-nights', name: 'Magic draft nights', kind: 'activity', sourceUrl: '', notes: '', enabled: true, createdAt: '2026-10-05T21:00:00.000Z', updatedAt: '2026-10-05T21:00:00.000Z', ...overrides });
const setInterest = (value: SearchInterest) => (data: Backup): Backup => ({ ...data, searchInterests: { ...data.searchInterests, [value.id]: value } });

test('interest-only offline edits recover and upload instead of comparing equal to a legacy cloud record', async () => {
  const storage = new MemoryStorage(), remote = server();
  const engine = new SyncEngine(storage, 'same-tab');
  engine.connect('alice', { ...remote.transport, async save() { throw new Error('offline'); } }); await engine.whenIdle();
  engine.mutate(setInterest(interest())); await engine.whenIdle();
  assert.equal(engine.getSnapshot().dirty, true);
  const restored = new SyncEngine(storage, 'same-tab'); restored.connect('alice', remote.transport); await restored.whenIdle();
  assert.deepEqual(remote.records.get('alice')!.data.searchInterests?.['draft-nights'], interest());
  assert.equal(restored.getSnapshot().phase, 'synced');
  assert.equal(remote.saves.length, 1);
});

test('a worker result arriving during an input edit cannot silently overwrite either version', async () => {
  const original = interest();
  const seed = setInterest(original)(emptyBackup());
  const storage = new MemoryStorage(), remote = server({ alice: { revision: 1, data: seed } });
  const engine = new SyncEngine(storage, 'phone'); engine.connect('alice', remote.transport); await engine.whenIdle();
  const checked = interest({ result: { inputUpdatedAt: original.updatedAt, status: 'active', checkedAt: '2026-10-06T14:00:00.000Z', message: 'Draft found.', catalogIds: ['game-cave'], eventIds: ['draft:2026-10-09'] } });
  remote.records.set('alice', { revision: 2, data: setInterest(checked)(seed) });
  const edited = interest({ name: 'Commander', updatedAt: '2026-10-06T14:01:00.000Z' });
  engine.mutate(setInterest(edited)); await engine.whenIdle();
  assert.equal(engine.getSnapshot().phase, 'conflict');
  assert.deepEqual(engine.getSnapshot().data.searchInterests?.['draft-nights'], edited);
  assert.deepEqual(engine.getSnapshot().conflict!.data.searchInterests?.['draft-nights'], checked);
  assert.deepEqual(remote.records.get('alice')!.data.searchInterests?.['draft-nights'], checked);
  engine.keepDraft(); await engine.whenIdle();
  assert.equal(searchInterestStatus(remote.records.get('alice')!.data.searchInterests!['draft-nights']), 'pending');
  assert.deepEqual(engine.getSnapshot().archives[0].data.searchInterests?.['draft-nights'], checked);
});

test('worker-result-only changes count as differences during conflict refresh and are archived on use-cloud', async () => {
  const original = interest();
  const seed = setInterest(original)(emptyBackup());
  const remote = server({ alice: { revision: 1, data: seed } });
  const engine = new SyncEngine(new MemoryStorage(), 'phone');
  engine.connect('alice', { ...remote.transport, async save() { throw new Error('offline'); } }); await engine.whenIdle();
  const checked = interest({ result: { inputUpdatedAt: original.updatedAt, status: 'blocked', checkedAt: '2026-10-06T14:00:00.000Z', message: 'Source unavailable.', catalogIds: [], eventIds: [] } });
  engine.mutate(setInterest(checked)); await engine.whenIdle();
  remote.records.set('alice', { revision: 2, data: seed });
  engine.refresh(); await engine.whenIdle();
  assert.equal(engine.getSnapshot().phase, 'conflict');
  assert.deepEqual(engine.getSnapshot().data.searchInterests?.['draft-nights'], checked);
  engine.useCloud();
  assert.deepEqual(engine.getSnapshot().archives[0].data.searchInterests?.['draft-nights'], checked);
  assert.deepEqual(engine.getSnapshot().data.searchInterests?.['draft-nights'], original);
});
