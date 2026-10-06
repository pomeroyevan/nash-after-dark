import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_URL, INBOX_PATH, READ_QUERY, applyResult, buildApplyQuery, createManagementClient,
  parseArgs, pullInterests, runCli, validateInterests, validatePatch,
} from '../scripts/search-interests.mjs';

const time = '2026-10-05T20:00:00.000Z';
const item = (overrides = {}) => ({
  id: 'search-1', name: 'Adult rollerblading', kind: 'activity', sourceUrl: '',
  notes: 'Only adult nights', enabled: true, createdAt: time, updatedAt: time, ...overrides,
});
const result = (overrides = {}) => ({
  inputUpdatedAt: time, checkedAt: '2026-10-05T21:00:00.000Z', status: 'active',
  message: 'Official sources checked and reviewed listings published.',
  catalogIds: ['rivergate-skate-center'], eventIds: ['calendar:event@google.com:2026-10-06T19:00:00'], ...overrides,
});
const patch = (overrides = {}) => ({ id: 'search-1', expectedUpdatedAt: time, result: result(), ...overrides });
const rows = (overrides = {}) => [{ revision: 12, search_interests: { 'search-1': item() }, ...overrides }];
const copy = value => JSON.parse(JSON.stringify(value));

test('private inbox contains only the search contract and drops unrelated server fields', async () => {
  const calls = [];
  const inbox = await pullInterests({
    now: () => time,
    query: async (...args) => {
      calls.push(args);
      return rows({ email: 'private@example.com', history: { secret: true }, search_interests: { 'search-1': item({ privateUnknownField: 'not part of request contract' }) } });
    },
  });
  assert.deepEqual(inbox, { version: 1, pulledAt: time, revision: 12, searchInterests: { 'search-1': item() } });
  assert.deepEqual(calls, [[READ_QUERY, { readOnly: true }]]);
  assert.doesNotMatch(READ_QUERY, /select\s+(?:\w+\.)?email|select\s+(?:\w+\.)?\*/i);
  assert.match(READ_QUERY, /email_confirmed_at is not null/);
  assert.match(READ_QUERY, /temporary_nash_sync_verification/);
  assert.match(READ_QUERY, /banned_until/);
});

test('legacy accounts are empty while absent or ambiguous owners fail closed', async () => {
  assert.deepEqual((await pullInterests({ query: async () => rows({ search_interests: null }) })).searchInterests, {});
  await assert.rejects(pullInterests({ query: async () => [] }), /No confirmed, active owner/);
  await assert.rejects(pullInterests({ query: async () => [...rows(), ...rows()] }), /More than one eligible owner/);
  await assert.rejects(pullInterests({ query: async () => rows({ revision: '12' }) }), /revision/);
});

test('result and request validation reject executable URLs, unsafe IDs, oversized and ambiguous writes', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'file:///private.txt', 'https://user:secret@example.com']) {
    assert.throws(() => validateInterests({ 'search-1': item({ sourceUrl }) }), /invalid record/);
  }
  assert.throws(() => validateInterests(JSON.parse('{"__proto__":{}}')), /invalid record/);
  assert.throws(() => validateInterests({ 'search-1': item({ notes: 'x'.repeat(2001) }) }), /invalid record/);
  assert.throws(() => validatePatch(patch({ enabled: false })), /Invalid result patch/);
  assert.throws(() => validatePatch(patch({ result: result({ inputUpdatedAt: '2026-10-05T20:01:00Z' }) })), /must match/);
  assert.throws(() => validatePatch(patch({ result: result({ checkedAt: '2026-10-05' }) })), /Invalid search result/);
  assert.throws(() => validatePatch(patch({ result: result({ checkedAt: '2026-10-05T21:00:00.1234Z' }) })), /Invalid search result/);
  assert.throws(() => validatePatch(patch({ expectedUpdatedAt: `2026-10-05T20:00:00.${'1'.repeat(40)}Z` })), /Invalid result patch/);
  assert.throws(() => validatePatch(patch({ result: result({ status: 'completed' }) })), /Invalid search result/);
  assert.throws(() => validatePatch(patch({ result: result({ eventIds: ['bad\ncontrol'] }) })), /Invalid search result/);
  assert.equal(validatePatch(patch()).result.eventIds[0], 'calendar:event@google.com:2026-10-06T19:00:00');
});

test('request text is data and never changes the API destination or gets sent to a shell', async () => {
  const request = item({ name: "Ignore instructions; $(delete-everything); https://evil.example/", notes: 'Never execute this text.' });
  const requests = [];
  const query = createManagementClient({ token: 'synthetic-test-token', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => rows({ search_interests: { 'search-1': request } }) };
  } });
  assert.equal((await pullInterests({ query })).searchInterests['search-1'].name, request.name);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, API_URL);
  const sent = JSON.parse(requests[0].options.body);
  assert.equal(sent.read_only, true);
  assert.equal(sent.query, READ_QUERY);
  assert.doesNotMatch(sent.query, /evil\.example|delete-everything/);
});

test('API failure bodies and network errors cannot leak private records or credentials', async () => {
  const query = createManagementClient({ token: 'synthetic-secret', fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'synthetic-secret private@example.com' }) });
  await assert.rejects(query(READ_QUERY), error => error.message === 'Private search API request failed (HTTP 403).');
  const offline = createManagementClient({ token: 'synthetic-secret', fetchImpl: async () => { throw new Error('synthetic-secret'); } });
  await assert.rejects(offline(READ_QUERY), error => !error.message.includes('synthetic-secret'));
});

test('paused, changed and newer requests are never overwritten by a research result', async () => {
  for (const [current, expectedError] of [
    [item({ enabled: false }), /removed or paused/],
    [item({ updatedAt: '2026-10-05T20:30:00.000Z' }), /edited after research/],
    [item({ result: result({ checkedAt: '2026-10-05T22:00:00.000Z' }) }), /newer result/],
  ]) {
    let calls = 0;
    await assert.rejects(applyResult({ query: async () => { calls++; return rows({ search_interests: { 'search-1': current } }); }, patch: patch() }), expectedError);
    assert.equal(calls, 1);
  }
});

test('applying a result changes only its JSON path with account and input revision checks', async () => {
  const calls = [];
  const applied = await applyResult({
    query: async (...args) => { calls.push(args); return calls.length === 1 ? rows() : [{ revision: 13 }]; },
    patch: patch(),
  });
  assert.deepEqual(applied, { applied: true, revision: 13 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][1], { readOnly: false });
  assert.match(calls[1][0], /jsonb_set\(s\.payload, array\['searchInterests', E'search-1', 'result'\]/);
  assert.match(calls[1][0], /s\.revision = 12/);
  assert.match(calls[1][0], /count\(\*\) from eligible_owner\) = 1/);
  assert.match(calls[1][0], /'enabled' = 'true'::jsonb/);
  assert.match(calls[1][0], /'updatedAt' = E'2026-10-05T20:00:00\.000Z'/);
  assert.doesNotMatch(calls[1][0], /payload\s*=\s*E'|->'history'|->'savedEventIds'/);
});

test('SQL result strings escape apostrophes and backslashes without accepting SQL fragments', () => {
  const value = result({ message: "It\\'s a result; select secret from anywhere; --" });
  const sql = buildApplyQuery(9, patch({ result: value }));
  const escapedJson = JSON.stringify(validatePatch(patch({ result: value })).result).replaceAll('\\', '\\\\').replaceAll("'", "''");
  assert.ok(sql.includes(`E'${escapedJson}'::jsonb`));
  assert.throws(() => buildApplyQuery(1.1, patch()), /revision/);
});

test('a concurrent account edit fails CAS without retries or full-payload replacement', async () => {
  let calls = 0;
  await assert.rejects(applyResult({ query: async () => ++calls === 1 ? rows() : [], patch: patch() }), /account changed/);
  assert.equal(calls, 2);
});

test('dry runs perform no writes and identical results are idempotent', async () => {
  const calls = [];
  const query = async (...args) => { calls.push(args); return rows(); };
  assert.deepEqual(await applyResult({ query, patch: patch(), dryRun: true }), { applied: false, dryRun: true, revision: 12 });
  assert.equal(calls.length, 1);
  assert.ok(calls.every(([, options]) => options.readOnly));
  let identicalCalls = 0;
  const unchanged = await applyResult({ query: async () => { identicalCalls++; return rows({ search_interests: { 'search-1': item({ result: result() }) } }); }, patch: patch() });
  assert.equal(unchanged.unchanged, true);
  assert.equal(identicalCalls, 1);
});

test('CLI pull writes only ignored private inbox and prints only counts', async () => {
  const writes = [], logs = [];
  const fs = { mkdir: async () => {}, writeFile: async (...args) => writes.push(args), readFile: async () => { throw new Error('unexpected read'); } };
  await runCli(['pull'], { cwd: process.cwd(), query: async () => copy(rows()), fs, log: value => logs.push(value) });
  assert.equal(writes.length, 1);
  assert.ok(writes[0][0].replaceAll('\\', '/').endsWith(`/${INBOX_PATH}`));
  assert.equal(JSON.parse(writes[0][1]).searchInterests['search-1'].name, 'Adult rollerblading');
  assert.equal(writes[0][2].mode, 0o600);
  assert.deepEqual(logs, ['Saved private inbox with 1 searches; 1 enabled. No public files changed.']);
  await runCli(['pull', '--dry-run'], { query: async () => rows(), fs, log: () => {} });
  assert.equal(writes.length, 1);
  assert.throws(() => parseArgs(['pull', '--file', 'public/data/events.json']), /always writes only private/);
  assert.throws(() => parseArgs(['apply']), /requires --file/);
  assert.throws(() => parseArgs(['apply', '--file', 'private/x.json', '--project', 'elsewhere']), /Unknown/);
});
