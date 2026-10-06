// Bounded public-organizer post collection. Output is private review material.
import { readFile, writeFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const API = 'https://api.apify.com/v2/';
export const STATUS_PATH = 'private/social-scraper-status.json';
export const OUTPUT_PATH = 'research/social-media-latest.json';
export const LOCK_PATH = 'private/social-scraper.lock';
export const TASK_BUDGET_USD = 0.50;
export const RUN_CAP_USD = 0.10;
const RESERVE_USD = 0.11; // Reserve a small margin for reading/storing the result.
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);
export const SOURCES = {
  slcnashville: { platform: 'instagram', url: 'https://www.instagram.com/slcnashville/', entryIds: ['cobra-slc'], evidence: 'research/music-venues.json' },
  rbqnashville: { platform: 'instagram', url: 'https://www.instagram.com/rbqnashville/', entryIds: ['rosemary-beauty-queen'], evidence: 'research/camp-rudys.json' },
  thecobranashville: { platform: 'instagram', url: 'https://www.instagram.com/thecobranashville/', entryIds: ['cobra'], evidence: 'research/music-venues.json' },
  'thegamecave.net': { platform: 'facebook', url: 'https://www.facebook.com/thegamecave.net', entryIds: ['game-cave'], evidence: 'research/mtg-events.json', accessUnverified: true },
};
export const ACTORS = {
  instagram: { name: 'apify~instagram-post-scraper', id: 'nH2AHrwxeTRJoN5hX', build: '0.0.614', memory: 1024 },
  facebook: { name: 'apify~facebook-posts-scraper', id: 'KoJrdxJCTtpon81KY', build: '0.0.398', memory: 4096 },
};
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9]{10,30}$/.test(value);
const cleanText = (value, max = 6000) => typeof value === 'string' ? value.replaceAll('\0', '').slice(0, max) : '';
const fail = message => { throw new Error(message); };

export function planCollection(profiles = ['slcnashville', 'rbqnashville']) {
  if (!Array.isArray(profiles) || !profiles.length || profiles.length > 2 || new Set(profiles).size !== profiles.length || profiles.some(key => !Object.hasOwn(SOURCES, key))) fail('Choose one or two reviewed organizer profiles from the source allowlist.');
  const platform = SOURCES[profiles[0]].platform;
  if (profiles.some(key => SOURCES[key].platform !== platform)) fail('Use one platform per bounded run.');
  const actor = ACTORS[platform];
  const input = platform === 'instagram'
    ? { username: profiles, resultsLimit: 10, skipPinnedPosts: true, dataDetailLevel: 'basicData' }
    : { startUrls: profiles.map(key => ({ url: SOURCES[key].url })), resultsLimit: 10, captionText: false };
  const runUrl = new URL(`acts/${actor.name}/runs`, API);
  for (const [key, value] of Object.entries({ build: actor.build, timeout: 180, memory: actor.memory, maxTotalChargeUsd: RUN_CAP_USD, waitForFinish: 30, restartOnError: false })) runUrl.searchParams.set(key, String(value));
  return { platform, actor: actor.name, actorId: actor.id, build: actor.build, profiles, input, maxTotalChargeUsd: RUN_CAP_USD, reservedUsd: RESERVE_USD, runUrl: runUrl.href };
}

export function assertBudget(ledger, plan) {
  if (ledger.version !== 1 || ledger.taskId !== 'nash-social-media-2026-10-05' || ledger.taskBudgetUsd !== TASK_BUDGET_USD || !Array.isArray(ledger.runs)) fail('Private social budget ledger is invalid; review it before running.');
  if (ledger.runs.some(run => !Number.isFinite(run.reservedUsd) || run.reservedUsd < 0.10)) fail('Private social budget reservations are invalid.');
  if (ledger.runs.some(run => !TERMINAL.has(run.status))) fail('A previous run is unfinished or its start was not confirmed. Resume/reconcile it; do not launch another.');
  const reserved = ledger.runs.reduce((sum, run) => sum + run.reservedUsd, 0);
  if (reserved + plan.reservedUsd > TASK_BUDGET_USD + 1e-9) fail('The approved $0.50 task budget would be exceeded. No run started.');
}

export function assertFreeCredit(account, usage, reservation = RESERVE_USD) {
  const plan = account?.plan, spent = usage?.totalUsageCreditsUsdAfterVolumeDiscount;
  if (plan?.id !== 'FREE' || plan?.isEnabled !== true || plan.monthlyBasePriceUsd !== 0 || !Number.isFinite(plan.monthlyUsageCreditsUsd) || !Number.isFinite(plan.maxMonthlyUsageUsd) || plan.maxMonthlyUsageUsd > plan.monthlyUsageCreditsUsd || !Number.isFinite(spent) || spent < 0 || plan.monthlyUsageCreditsUsd - spent < reservation) fail('Verified included free credit is unavailable. No run started and no billing changed.');
  return { tier: 'FREE', monthlyCreditsUsd: plan.monthlyUsageCreditsUsd, spentUsd: spent, remainingUsd: plan.monthlyUsageCreditsUsd - spent, checkedAt: new Date().toISOString() };
}

export function apiClient({ token = process.env.APIFY_TOKEN, fetchImpl = fetch } = {}) {
  if (typeof token !== 'string' || !token.trim()) fail('Inject APIFY_TOKEN from the existing API Key Vault.');
  return async (path, { method = 'GET', body } = {}) => {
    const endpoint = new URL(path, API);
    if (endpoint.origin !== new URL(API).origin || !endpoint.pathname.startsWith('/v2/')) fail('Unexpected API destination.');
    let response;
    try { response = await fetchImpl(endpoint, { method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45_000) }); }
    catch { fail('Apify request failed or timed out; no automatic run retry was attempted. Check the private ledger.'); }
    if (!response.ok) fail(`Apify request failed (HTTP ${response.status}); response body omitted.`);
    try { return await response.json(); } catch { fail('Apify returned unreadable JSON.'); }
  };
}

function webUrl(value, hosts) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
    return url.href;
  } catch { return ''; }
}
const imageUrl = value => webUrl(value, ['cdninstagram.com', 'fbcdn.net', 'scontent.cdninstagram.com']);
const postUrl = value => webUrl(value, ['instagram.com', 'facebook.com']);
export function normalizePosts(items, plan, checkedAt) {
  if (!Array.isArray(items)) fail('Actor dataset is not an array.');
  const posts = [], seen = new Set(), counts = {};
  for (const item of items) {
    if (!item || typeof item !== 'object' || item.error) continue;
    const owner = cleanText(item.ownerUsername || item.user?.name, 100).trim().toLowerCase();
    const inputUrl = cleanText(item.inputUrl || item.facebookUrl, 2048);
    const ownerProfile = owner && plan.profiles.find(key => key.toLowerCase() === owner);
    const inputProfile = plan.profiles.find(key => inputUrl.replace(/\/$/, '') === SOURCES[key].url.replace(/\/$/, '') || inputUrl.toLowerCase() === key.toLowerCase());
    // A request target is not evidence that an explicitly different account authored a post.
    if (owner && (!ownerProfile || inputProfile && ownerProfile !== inputProfile)) continue;
    const profile = ownerProfile || inputProfile;
    if (!profile || (counts[profile] || 0) >= 10) continue;
    const sourceUrl = postUrl(item.url || item.postUrl || item.topLevelUrl);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    const published = item.timestamp || item.time || item.date;
    const publishedAt = typeof published === 'number' && published > 0 ? new Date(published * 1000).toISOString() : typeof published === 'string' && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null;
    const media = [...new Set([
      imageUrl(item.displayUrl), ...(Array.isArray(item.images) ? item.images.map(imageUrl) : []),
      ...(Array.isArray(item.childPosts) ? item.childPosts.map(child => imageUrl(child.displayUrl)) : []),
      ...(Array.isArray(item.media) ? item.media.flatMap(media => [imageUrl(media.photo_image?.uri), imageUrl(media.thumbnail)]) : []),
    ].filter(Boolean))].slice(0, 12);
    posts.push({ platform: plan.platform, profile, profileUrl: SOURCES[profile].url, relatedEntryIds: SOURCES[profile].entryIds, sourceUrl, publishedAt, checkedAt, caption: cleanText(item.caption || item.text), mediaUrls: media, needsManualReview: true });
    seen.add(sourceUrl); counts[profile] = (counts[profile] || 0) + 1;
  }
  return posts;
}

export async function runCollection({ plan, ledger, request, saveLedger, saveOutput, existingOutput = { version: 1, posts: [], runs: [] }, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  assertBudget(ledger, plan);
  if (plan.profiles.some(key => SOURCES[key].accessUnverified)) fail('Public access for this reviewed source remains unverified. No run started.');
  const account = (await request('users/me')).data;
  const usage = (await request('users/me/usage/monthly')).data;
  const balance = assertFreeCredit(account, usage);
  const actor = (await request(`acts/${plan.actor}`)).data;
  const price = actor?.pricingInfos?.filter(price => Date.parse(price.startedAt) <= Date.now()).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  if (actor?.id !== plan.actorId || actor?.username !== 'apify' || price?.pricingModel !== 'PAY_PER_EVENT' || (price.minimalMaxTotalChargeUsd || 0) > plan.maxTotalChargeUsd) fail('Actor identity or capped pay-per-event pricing changed. No run started.');
  const record = { localId: randomUUID(), actor: plan.actor, actorId: plan.actorId, build: plan.build, platform: plan.platform, profiles: plan.profiles, status: 'START_UNCONFIRMED', requestedAt: new Date().toISOString(), maxTotalChargeUsd: plan.maxTotalChargeUsd, reservedUsd: plan.reservedUsd, balanceBefore: balance };
  ledger.runs.push(record);
  await saveLedger(ledger); // The reservation survives an unknown POST outcome.
  const started = (await request(plan.runUrl, { method: 'POST', body: plan.input })).data;
  if (!safeId(started?.id) || started.actId !== plan.actorId) fail('Run creation response could not be verified. Reconcile private ledger; do not retry.');
  Object.assign(record, { runId: started.id, status: started.status, startedAt: started.startedAt });
  await saveLedger(ledger);
  return await finishCollection({ record, plan, ledger, request, saveLedger, saveOutput, existingOutput, sleep, initialRun: started });
}

async function finishCollection({ record, plan, ledger, request, saveLedger, saveOutput, existingOutput, sleep, initialRun }) {
  let run = initialRun;
  for (let attempt = 0; !TERMINAL.has(run.status) && attempt < 50; attempt++) { await sleep(4000); run = (await request(`actor-runs/${record.runId}`)).data; }
  if (run?.id !== record.runId || run.actId !== plan.actorId) fail('Run identity mismatch; private result was not imported.');
  Object.assign(record, { status: run.status, finishedAt: run.finishedAt || null, usageTotalUsd: Number.isFinite(run.usageTotalUsd) ? run.usageTotalUsd : null, chargedEventCounts: run.chargedEventCounts || {} });
  await saveLedger(ledger);
  if (!TERMINAL.has(run.status)) fail('Run remains active. Resume the recorded run; do not start another.');
  if (run.status !== 'SUCCEEDED') return { runId: record.runId, status: run.status, posts: 0, usageTotalUsd: record.usageTotalUsd };
  if (!safeId(run.defaultDatasetId)) fail('Completed run did not return a valid dataset ID.');
  const raw = await request(`datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=${plan.profiles.length * 10}`);
  const checkedAt = new Date().toISOString();
  const posts = normalizePosts(raw, plan, checkedAt);
  const byUrl = new Map((existingOutput.posts || []).map(post => [post.sourceUrl, post]));
  for (const post of posts) byUrl.set(post.sourceUrl, post);
  const summary = { runId: record.runId, status: run.status, profiles: plan.profiles, posts: posts.length, checkedAt, usageTotalUsd: record.usageTotalUsd };
  await saveOutput({ version: 1, checkedAt, warning: 'Private untrusted staging only. Review identity, image and exact event date before public use. Post time is not event time.', posts: [...byUrl.values()], runs: [...(existingOutput.runs || []).filter(item => item.runId !== record.runId), summary] });
  Object.assign(record, { retainedPosts: posts.length, retainedMedia: posts.reduce((sum, post) => sum + post.mediaUrls.length, 0), checkedAt });
  await saveLedger(ledger);
  return summary;
}

async function readJson(path, fallback, root = ROOT) { try { return JSON.parse(await readFile(resolve(root, path), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('A private social staging file is unreadable; it has not been replaced.'); } }

/** Hold one lock across reading, reserving, remote work and persistence, including resume. */
export async function withCollectionLock(operation, { root = ROOT } = {}) {
  const lockPath = resolve(root, LOCK_PATH), lockId = randomUUID();
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    await writeFile(lockPath, JSON.stringify({ version: 1, lockId, pid: process.pid, createdAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') fail('The private social collector lock already exists. Do not start or resume another run. Verify the process and reconcile its ledger before manually removing a stale lock; locks are never reset automatically.');
    throw error;
  }
  try { return await operation(); }
  finally {
    // Never remove a replacement lock or guess that another process has stopped.
    let current;
    try { current = JSON.parse(await readFile(lockPath, 'utf8')); } catch { fail('The private social collector lock could not be verified; inspect it before another run.'); }
    if (current.lockId !== lockId) fail('The private social collector lock changed; it was not removed.');
    await unlink(lockPath);
  }
}

async function durableWrite(filename, text, flag = 'w') {
  const handle = await open(filename, flag, 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
}

/** Called under the collector lock. Recovery files always stay in ignored private/. */
export async function writePrivateJson(filename, value, { root = ROOT, renameFile = rename, platform = process.platform } = {}) {
  if (![STATUS_PATH, OUTPUT_PATH].includes(filename)) fail('Unexpected private social output path.');
  const target = resolve(root, filename), scratch = resolve(root, 'private');
  await mkdir(dirname(target), { recursive: true }); await mkdir(scratch, { recursive: true });
  const stem = `${basename(filename)}.${process.pid}.${randomUUID()}`;
  const temporary = resolve(scratch, stem + '.pending');
  const serialized = JSON.stringify(value, null, 2) + '\n';
  await durableWrite(temporary, serialized, 'wx');
  try { await renameFile(temporary, target); }
  catch (error) {
    if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
    // Some Windows folders deny replacement. Preserve valid old evidence before an
    // in-place write; interruption leaves a recoverable backup and an unreadable
    // target fails closed on the next run. Never remove the target before writing.
    const previous = await readFile(target, 'utf8'); JSON.parse(previous);
    await durableWrite(resolve(scratch, stem + '.previous'), previous, 'wx');
    await durableWrite(target, serialized);
    if (await readFile(target, 'utf8') !== serialized) fail('Private social output verification failed; recovery files were retained.');
    await unlink(temporary);
  }
}

export async function collectFromPrivateState({ plan = planCollection(), resume, root = ROOT, request, sleep } = {}) {
  return await withCollectionLock(async () => {
    // No ledger read or API request occurs before exclusive acquisition.
    const ledger = await readJson(STATUS_PATH, { version: 1, taskId: 'nash-social-media-2026-10-05', taskBudgetUsd: TASK_BUDGET_USD, runs: [] }, root);
    const existingOutput = await readJson(OUTPUT_PATH, { version: 1, posts: [], runs: [] }, root);
    request ??= apiClient();
    const options = { plan, ledger, request, existingOutput, ...(sleep ? { sleep } : {}), saveLedger: value => writePrivateJson(STATUS_PATH, value, { root }), saveOutput: value => writePrivateJson(OUTPUT_PATH, value, { root }) };
    if (resume) {
      const record = ledger.runs.find(run => run.runId === resume);
      if (!record || !safeId(resume)) fail('Resume only a run already recorded in the private ledger.');
      plan = planCollection(record.profiles);
      return await finishCollection({ ...options, plan, record, initialRun: (await request(`actor-runs/${resume}`)).data, sleep: sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))) });
    }
    for (const profile of plan.profiles) if (!(await readFile(resolve(root, SOURCES[profile].evidence), 'utf8')).includes(SOURCES[profile].url)) fail('An allowlisted source no longer appears in its reviewed research.');
    return await runCollection(options);
  }, { root });
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--run' && arg !== '--plan' && !arg.startsWith('--profiles=') && !arg.startsWith('--resume='))) fail('Use --plan or --run with --profiles=name,name; --resume=recordedRunId retrieves an existing run.');
  const profiles = args.find(arg => arg.startsWith('--profiles='))?.split('=')[1].split(',');
  const plan = planCollection(profiles);
  if (!args.includes('--run') && !args.some(arg => arg.startsWith('--resume='))) { console.log(JSON.stringify({ mode: 'plan-only-no-requests', ...plan, taskBudgetUsd: TASK_BUDGET_USD }, null, 2)); return; }
  const resume = args.find(arg => arg.startsWith('--resume='))?.split('=')[1];
  const result = await collectFromPrivateState({ plan, resume });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
