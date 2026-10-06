import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBackup, parseBackup, parseSearchInterests, searchInterestStatus } from '../src/model.ts';
import { mergeBackup } from '../src/sync.ts';

const timestamp = '2026-10-05T21:00:00.000Z';
const interest = (overrides = {}) => ({ id: 'draft-nights', name: 'Magic draft nights', kind: 'activity', sourceUrl: 'https://example.com/events', notes: 'Draft and prerelease, Nashville area', enabled: true, createdAt: timestamp, updatedAt: timestamp, ...overrides });
const result = (overrides = {}) => ({ inputUpdatedAt: timestamp, status: 'active', checkedAt: '2026-10-06T14:00:00.000Z', message: 'Official schedule checked.', catalogIds: ['game-cave'], eventIds: ['next-level-games:draft@google.com:2026-10-09T19:00:00'], ...overrides });
const backup = (items) => ({ ...emptyBackup(), searchInterests: Object.fromEntries(items.map(item => [item.id, item])) });

test('legacy v1 backups retain their shape and interests survive a full export/import roundtrip', () => {
  const legacy = emptyBackup();
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(legacy))), legacy);
  assert.equal('searchInterests' in parseBackup(legacy), false);
  const current = backup([interest({ result: result() }), interest({ id: 'greta', name: 'Greta Van Fleet', kind: 'artist', enabled: false })]);
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(current))), current);
});

test('malformed search interests reject the whole backup instead of dropping private data', () => {
  const cases = [
    { name: '' }, { name: ' '.repeat(3) }, { name: 'x'.repeat(201) }, { notes: 'x'.repeat(2001) },
    { name: 'null\0name' }, { notes: 'null\0note' }, { sourceUrl: 'https://example.com/\0' },
    { kind: 'concerts' }, { enabled: 'yes' }, { sourceUrl: 'javascript:alert(1)' },
    { sourceUrl: 'https://account:password@example.com/' }, { sourceUrl: 'not a URL' },
    { createdAt: '2026-10-05' }, { updatedAt: '2026-10-05T12:00:00' },
    { updatedAt: '2026-10-05T21:00:00.1234Z' }, { updatedAt: `2026-10-05T21:00:00.${'1'.repeat(100)}Z` },
    { result: result({ status: 'confirmed' }) }, { result: result({ message: 'x'.repeat(1001) }) },
    { result: result({ message: '' }) }, { result: result({ message: '   ' }) }, { result: result({ message: 'null\0message' }) },
    { result: result({ catalogIds: [false] }) }, { result: result({ eventIds: ['event\nline'] }) },
    { result: result({ inputUpdatedAt: '' }) }, { result: result({ checkedAt: 'nonsense' }) },
    { result: result({ eventIds: Array(101).fill('one') }) },
  ];
  for (const fields of cases) assert.throws(() => parseBackup(backup([interest(fields)])), /invalid search interest/i, JSON.stringify(fields));
  assert.throws(() => parseSearchInterests({ wrong: interest() }), /invalid search interest/i);
  assert.throws(() => parseSearchInterests(JSON.parse('{"__proto__":{"id":"__proto__"}}')), /invalid search interest/i);
  assert.throws(() => parseSearchInterests([]), /invalid search interests/i);
  assert.throws(() => parseSearchInterests(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`item-${i}`, interest({ id: `item-${i}` })]))), /invalid search interests/i);
});

test('edits are pending until their exact input version is checked and pause wins over results', () => {
  assert.equal(searchInterestStatus(interest()), 'pending');
  for (const status of ['active', 'needs_details', 'blocked']) assert.equal(searchInterestStatus(interest({ result: result({ status }) })), status);
  assert.equal(searchInterestStatus(interest({ result: result(), updatedAt: '2026-10-07T01:00:00.000Z' })), 'pending');
  assert.equal(searchInterestStatus(interest({ result: result(), enabled: false })), 'paused');
  assert.equal(searchInterestStatus(interest({ enabled: false })), 'paused');
});

test('merge keeps interests when importing legacy/empty backups and merges new records', () => {
  const existing = backup([interest({ result: result() })]);
  assert.deepEqual(mergeBackup(existing, emptyBackup()).searchInterests, existing.searchInterests);
  assert.deepEqual(mergeBackup(existing, backup([])).searchInterests, existing.searchInterests);
  const merged = mergeBackup(existing, backup([interest({ id: 'greta', name: 'Greta Van Fleet', kind: 'artist' })]));
  assert.equal(merged.searchInterests.greta.name, 'Greta Van Fleet');
  assert.deepEqual(merged.searchInterests['draft-nights'], existing.searchInterests['draft-nights']);
});

test('merge preserves a worker result only for unchanged imported input', () => {
  const existing = backup([interest({ result: result() })]);
  const unchanged = mergeBackup(existing, backup([interest()]));
  assert.deepEqual(unchanged.searchInterests['draft-nights'].result, result());
  const edited = mergeBackup(existing, backup([interest({ name: 'Commander' })]));
  assert.equal(edited.searchInterests['draft-nights'].result, undefined);
  assert.equal(searchInterestStatus(edited.searchInterests['draft-nights']), 'pending');
  const newer = mergeBackup(existing, backup([interest({ updatedAt: '2026-10-07T01:00:00.000Z' })]));
  assert.equal(newer.searchInterests['draft-nights'].result, undefined);
});
