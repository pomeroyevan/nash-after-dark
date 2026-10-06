import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { apiClient, assertBudget, assertFreeCredit, normalizePosts, planCollection, runCollection, collectFromPrivateState, writePrivateJson, LOCK_PATH, STATUS_PATH, OUTPUT_PATH, SOURCES } from '../scripts/collect-social-media.mjs';

const ledger = () => ({ version: 1, taskId: 'nash-social-media-2026-10-05', taskBudgetUsd: 0.5, runs: [] });
const account = { plan: { id: 'FREE', isEnabled: true, monthlyBasePriceUsd: 0, monthlyUsageCreditsUsd: 5, maxMonthlyUsageUsd: 5 } };
const usage = { totalUsageCreditsUsdAfterVolumeDiscount: 0.2 };
const plan = planCollection();

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'nash-social-test-'));
  t.after(async () => {
    // Cleanup only the exact test directory created above, never a computed parent.
    assert.equal(resolve(root, '..'), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('nash-social-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(resolve(root, 'private')); await mkdir(resolve(root, 'research'));
  await writeFile(resolve(root, 'research/music-venues.json'), SOURCES.slcnashville.url);
  await writeFile(resolve(root, 'research/camp-rudys.json'), SOURCES.rbqnashville.url);
  return root;
}

test('plans allow only reviewed organizer profiles with capped public-post inputs', () => {
  assert.deepEqual(plan.input, { username: ['slcnashville', 'rbqnashville'], resultsLimit: 10, skipPinnedPosts: true, dataDetailLevel: 'basicData' });
  assert.equal(new URL(plan.runUrl).searchParams.get('maxTotalChargeUsd'), '0.1');
  assert.equal(new URL(plan.runUrl).searchParams.get('timeout'), '180');
  assert.equal(new URL(plan.runUrl).searchParams.get('restartOnError'), 'false');
  assert.throws(() => planCollection(['unknown-person']), /allowlist/);
  assert.throws(() => planCollection(['slcnashville', 'rbqnashville', 'thecobranashville']), /one or two/);
  assert.throws(() => planCollection(['slcnashville', 'thegamecave.net']), /one platform/);
});

test('persisted reservations cap the task and unknown starts prevent duplicate billing', () => {
  const state = ledger();
  state.runs = Array.from({ length: 4 }, () => ({ reservedUsd: 0.11, status: 'SUCCEEDED', usageTotalUsd: 0.01 }));
  assert.throws(() => assertBudget(state, plan), /budget would be exceeded/);
  state.runs = [{ reservedUsd: 0.11, status: 'START_UNCONFIRMED' }];
  assert.throws(() => assertBudget(state, plan), /unfinished/);
  state.runs = [{ reservedUsd: 0.11, status: 'RUNNING' }];
  assert.throws(() => assertBudget(state, plan), /unfinished/);
});

test('only verified included credit on the existing free plan can fund a run', () => {
  assert.equal(assertFreeCredit(account, usage).remainingUsd, 4.8);
  assert.throws(() => assertFreeCredit({ plan: { ...account.plan, id: 'STARTER' } }, usage), /free credit/);
  assert.throws(() => assertFreeCredit(account, { totalUsageCreditsUsdAfterVolumeDiscount: 4.95 }), /free credit/);
  assert.throws(() => assertFreeCredit(account, {}), /free credit/);
  assert.throws(() => assertFreeCredit({ plan: { ...account.plan, maxMonthlyUsageUsd: 50 } }, usage), /free credit/);
});

test('private normalization excludes audience data, unsafe images, unrelated authors and duplicate posts', () => {
  const first = { ownerUsername: 'slcnashville', inputUrl: 'https://www.instagram.com/slcnashville/', url: 'https://www.instagram.com/p/abc123/', timestamp: '2026-10-01T12:00:00Z', caption: 'Synthetic event announcement', displayUrl: 'https://scontent.test.cdninstagram.com/flyer.jpg', images: ['http://127.0.0.1/private', 'https://evil.example/flyer.jpg'], likesCount: 100, latestComments: [{ ownerUsername: 'private-person', text: 'not retained' }] };
  const output = normalizePosts([first, first, { ...first, ownerUsername: 'private-person', inputUrl: '', url: 'https://www.instagram.com/p/other/' }], plan, '2026-10-06T00:00:00Z');
  assert.equal(output.length, 1);
  assert.deepEqual(output[0].mediaUrls, ['https://scontent.test.cdninstagram.com/flyer.jpg']);
  assert.equal(output[0].publishedAt, '2026-10-01T12:00:00.000Z');
  assert.equal(output[0].needsManualReview, true);
  assert.doesNotMatch(JSON.stringify(output), /likesCount|latestComments|private-person|127\.0\.0\.1|evil\.example/);
});

test('a request URL cannot override a contradictory explicit author', () => {
  const inputUrl = SOURCES.slcnashville.url;
  const records = [
    { ownerUsername: 'unrelated-author', inputUrl, url: 'https://www.instagram.com/p/wrong/', caption: 'UNRELATED_AUTHOR_SENTINEL' },
    { ownerUsername: 'rbqnashville', inputUrl, url: 'https://www.instagram.com/p/contradictory/', caption: 'CONTRADICTORY_TARGET_SENTINEL' },
    { user: { name: 'unrelated-author' }, inputUrl, url: 'https://www.instagram.com/p/wrong-user/', caption: 'UNRELATED_USER_SENTINEL' },
    { ownerUsername: ' SLCNashville ', inputUrl, url: 'https://www.instagram.com/p/owned/', caption: 'Owned post' },
    { inputUrl, url: 'https://www.instagram.com/p/no-owner/', caption: 'Ownership absent; needs review' },
  ];
  const output = normalizePosts(records, plan, '2026-10-06T00:00:00Z');
  assert.deepEqual(output.map(post => post.sourceUrl), ['https://www.instagram.com/p/owned/', 'https://www.instagram.com/p/no-owner/']);
  assert.ok(output.every(post => post.profile === 'slcnashville' && post.needsManualReview));
  assert.doesNotMatch(JSON.stringify(output), /SENTINEL|unrelated-author|rbqnashville/);
});

test('unknown timestamps remain unknown rather than becoming event dates', () => {
  const posts = normalizePosts([{ ownerUsername: 'rbqnashville', url: 'https://www.instagram.com/p/example/', caption: 'Friday party' }], plan, '2026-10-06T00:00:00Z');
  assert.equal(posts[0].publishedAt, null);
  assert.ok(!Object.hasOwn(posts[0], 'eventDate'));
});

test('credentials are sent only to the official API and error bodies remain hidden', async () => {
  const calls = [];
  const client = apiClient({ token: 'synthetic-token', fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: false, status: 401, json: async () => ({ token: 'synthetic-token' }) }; } });
  await assert.rejects(client('https://evil.example/v2/run'), /Unexpected API destination/);
  assert.equal(calls.length, 0);
  await assert.rejects(client('users/me'), error => error.message === 'Apify request failed (HTTP 401); response body omitted.');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].url.origin, 'https://api.apify.com');
});

test('reservation is saved before a run starts and lost responses do not retry', async () => {
  const state = ledger(), order = [];
  const request = async (path, options) => {
    if (path === 'users/me') return { data: account };
    if (path === 'users/me/usage/monthly') return { data: usage };
    if (path === `acts/${plan.actor}`) return { data: { id: plan.actorId, username: 'apify', pricingInfos: [{ startedAt: '2026-01-01', pricingModel: 'PAY_PER_EVENT', minimalMaxTotalChargeUsd: 0.005 }] } };
    assert.equal(options.method, 'POST'); order.push('POST'); throw new Error('Simulated lost response');
  };
  await assert.rejects(runCollection({ plan, ledger: state, request, saveLedger: async () => order.push('reserved'), saveOutput: async () => { throw new Error('unexpected output'); } }), /lost response/);
  assert.deepEqual(order, ['reserved', 'POST']);
  assert.equal(state.runs[0].status, 'START_UNCONFIRMED');
  assert.throws(() => assertBudget(state, plan), /unfinished/);
});

test('successful collection stores only normalized review records and observed run metadata', async () => {
  const state = ledger(), snapshots = [], output = [];
  const request = async (path, options) => {
    if (path === 'users/me') return { data: account };
    if (path === 'users/me/usage/monthly') return { data: usage };
    if (path === `acts/${plan.actor}`) return { data: { id: plan.actorId, username: 'apify', pricingInfos: [{ startedAt: '2026-01-01', pricingModel: 'PAY_PER_EVENT' }] } };
    if (options?.method === 'POST') return { data: { id: 'SyntheticRun12345', actId: plan.actorId, status: 'SUCCEEDED', startedAt: '2026-10-06T00:00:00Z', finishedAt: '2026-10-06T00:00:02Z', defaultDatasetId: 'SyntheticData12345', usageTotalUsd: 0.0017, chargedEventCounts: { post: 1 } } };
    assert.match(path, /datasets\/SyntheticData12345\/items.*limit=20/);
    return [{ ownerUsername: 'slcnashville', url: 'https://www.instagram.com/p/test/', caption: 'Synthetic announcement', timestamp: '2026-10-05T18:00:00Z', displayUrl: 'https://cdninstagram.com/flyer.jpg', followers: ['not retained'] }];
  };
  const result = await runCollection({ plan, ledger: state, request, saveLedger: async value => snapshots.push(structuredClone(value)), saveOutput: async value => output.push(value) });
  assert.equal(result.posts, 1);
  assert.equal(result.usageTotalUsd, 0.0017);
  assert.equal(output[0].posts[0].mediaUrls.length, 1);
  assert.doesNotMatch(JSON.stringify(output), /followers|not retained/);
  assert.equal(snapshots[0].runs[0].status, 'START_UNCONFIRMED');
  assert.equal(state.runs[0].retainedPosts, 1);
});

test('the filesystem lock excludes concurrent run and resume before another budget read or request', async t => {
  const root = await workspace(t), initial = ledger();
  initial.runs = Array.from({ length: 3 }, (_, i) => ({ runId: `OldSyntheticRun00${i}`, reservedUsd: 0.11, status: 'SUCCEEDED', usageTotalUsd: 0.1 }));
  await writePrivateJson(STATUS_PATH, initial, { root });
  let started, release, posts = 0;
  const atPost = new Promise(resolve => { started = resolve; });
  const holdPost = new Promise(resolve => { release = resolve; });
  const request = async (path, options) => {
    if (path === 'users/me') return { data: account };
    if (path === 'users/me/usage/monthly') return { data: usage };
    if (path === `acts/${plan.actor}`) return { data: { id: plan.actorId, username: 'apify', pricingInfos: [{ startedAt: '2026-01-01', pricingModel: 'PAY_PER_EVENT' }] } };
    assert.equal(options?.method, 'POST'); posts++; started(); await holdPost;
    return { data: { id: 'SyntheticLockedRun1', actId: plan.actorId, status: 'FAILED', usageTotalUsd: 0.1 } };
  };
  const first = collectFromPrivateState({ plan, root, request });
  await atPost;
  try {
    const reserved = JSON.parse(await readFile(resolve(root, STATUS_PATH), 'utf8'));
    assert.equal(reserved.runs.length, 4);
    assert.equal(reserved.runs.at(-1).status, 'START_UNCONFIRMED');
    const neverRequest = async () => { throw new Error('A competing invocation must stop before any API request'); };
    await assert.rejects(collectFromPrivateState({ plan, root, request: neverRequest }), /lock already exists/);
    await assert.rejects(collectFromPrivateState({ plan, root, resume: 'OldSyntheticRun000', request: neverRequest }), /lock already exists/);
  } finally { release(); await first; }
  assert.equal(posts, 1);
  const saved = JSON.parse(await readFile(resolve(root, STATUS_PATH), 'utf8'));
  assert.equal(saved.runs.length, 4); assert.equal(saved.runs.at(-1).status, 'FAILED');
  await assert.rejects(readFile(resolve(root, LOCK_PATH)), { code: 'ENOENT' });
  // A later invocation reads the completed reservation instead of a stale in-memory copy.
  await assert.rejects(collectFromPrivateState({ plan, root, request }), /budget would be exceeded/);
  assert.equal(posts, 1);
});

test('an old lock is preserved and blocks both starting and resuming without API access', async t => {
  const root = await workspace(t);
  const stale = JSON.stringify({ version: 1, lockId: 'synthetic-stale-lock', pid: 99999999, createdAt: '2001-01-01T00:00:00Z' });
  await writeFile(resolve(root, LOCK_PATH), stale);
  let calls = 0;
  const request = async () => { calls++; throw new Error('No API calls while locked'); };
  await assert.rejects(collectFromPrivateState({ plan, root, request }), /never reset automatically/);
  await assert.rejects(collectFromPrivateState({ plan, root, resume: 'SyntheticRun12345', request }), /never reset automatically/);
  assert.equal(calls, 0); assert.equal(await readFile(resolve(root, LOCK_PATH), 'utf8'), stale);
});

test('a lost POST response releases the process lock but its durable reservation still blocks retries', async t => {
  const root = await workspace(t);
  let posts = 0;
  const request = async (path, options) => {
    if (path === 'users/me') return { data: account };
    if (path === 'users/me/usage/monthly') return { data: usage };
    if (path === `acts/${plan.actor}`) return { data: { id: plan.actorId, username: 'apify', pricingInfos: [{ startedAt: '2026-01-01', pricingModel: 'PAY_PER_EVENT' }] } };
    assert.equal(options?.method, 'POST'); posts++; throw new Error('Synthetic lost POST response');
  };
  await assert.rejects(collectFromPrivateState({ plan, root, request }), /lost POST response/);
  await assert.rejects(readFile(resolve(root, LOCK_PATH)), { code: 'ENOENT' });
  const saved = JSON.parse(await readFile(resolve(root, STATUS_PATH), 'utf8'));
  assert.equal(saved.runs[0].status, 'START_UNCONFIRMED');
  await assert.rejects(collectFromPrivateState({ plan, root, request }), /unfinished/);
  assert.equal(posts, 1);
});

test('private JSON replacement preserves a Windows recovery copy and never truncates before it exists', async t => {
  const root = await workspace(t), old = ledger(), next = { ...ledger(), runs: [{ reservedUsd: 0.11, status: 'START_UNCONFIRMED' }] };
  await writePrivateJson(STATUS_PATH, old, { root });
  let replacements = 0;
  await writePrivateJson(STATUS_PATH, next, { root, platform: 'win32', renameFile: async (pending, target) => {
    replacements++;
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), old);
    assert.deepEqual(JSON.parse(await readFile(pending, 'utf8')), next);
    throw Object.assign(new Error('Synthetic Windows replacement denial'), { code: 'EPERM' });
  } });
  assert.equal(replacements, 1);
  assert.deepEqual(JSON.parse(await readFile(resolve(root, STATUS_PATH), 'utf8')), next);
  const files = await readdir(resolve(root, 'private'));
  const backups = files.filter(file => file.endsWith('.previous'));
  assert.equal(backups.length, 1); assert.ok(!files.some(file => file.endsWith('.pending')));
  assert.deepEqual(JSON.parse(await readFile(resolve(root, 'private', backups[0]), 'utf8')), old);
  await writePrivateJson(OUTPUT_PATH, { posts: [{ caption: 'Synthetic staging only' }] }, { root });
  assert.equal(JSON.parse(await readFile(resolve(root, OUTPUT_PATH), 'utf8')).posts.length, 1);
  await assert.rejects(writePrivateJson('public/leak.json', {}, { root }), /Unexpected private social output path/);
});
