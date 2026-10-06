// Explicit integration check against this app's configured Supabase project.
// Creates two synthetic accounts, then disables them; never reads owner history.
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { applyResult, createManagementClient, pullInterests } from './search-interests.mjs';

const config = JSON.parse(await readFile('public/data/sync-config.json', 'utf8'));
const serviceKey = process.env.NASH_SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error('Inject NASH_SUPABASE_SERVICE_ROLE_KEY from the local vault.');
const baseURL = (process.env.UI_BASE_URL || 'http://127.0.0.1:5173/').replace(/\/?$/, '/');
const admin = createClient(config.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const publicClient = () => createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = [];
const managementToken = process.env.SUPABASE_ACCESS_TOKEN;
let browser;
const nav = async (page, label) => page.locator('.sidebar:visible, .mobile-tabs:visible').getByText(label, { exact: true }).click();
const ready = page => expect(page.locator('.sync-settings').getByText('Private sync up to date', { exact: true })).toBeVisible({ timeout: 30_000 });
async function signIn(page, account) {
  await page.goto(baseURL);
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await nav(page, 'Settings');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await ready(page);
}
async function openCobra(page) {
  await nav(page, 'Explore');
  await page.getByRole('textbox', { name: 'Search places, artists and series' }).fill('Cobra');
  await page.locator('.place-card').filter({ has: page.getByRole('heading', { name: 'Cobra Nashville', exact: true }) }).click();
  await expect(page.getByLabel('Anything else to remember')).toBeVisible();
}
try {
  for (let i = 0; i < 2; i++) {
    const account = { email: `nash-sync-qa-${randomUUID()}@example.com`, password: randomBytes(30).toString('base64url') };
    if (i === 0 && managementToken) {
      const synthetic = { version: 1, exportedAt: new Date().toISOString(), history: { cobra: { attendance: 'visited', rating: 7, notes: 'Synthetic signup seed verification', liked: '', disliked: '', favorite: false, watch: false, updatedAt: new Date().toISOString() } }, savedEventIds: [] };
      const ref = new URL(config.url).hostname.split('.')[0];
      const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST', headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `insert into nash_private.owner_seed(email,payload) values ('${account.email}','${JSON.stringify(synthetic).replace(/'/g, "''")}'::jsonb);` })
      });
      if (!response.ok) throw new Error(`Synthetic signup seed setup failed (${response.status}).`);
    }
    const { data, error } = await admin.auth.admin.createUser({ ...account, email_confirm: true, user_metadata: { purpose: 'temporary_nash_sync_verification' } });
    if (error) throw new Error(error.message);
    accounts.push({ ...account, id: data.user.id });
  }
  browser = await chromium.launch({ channel: process.env.UI_BROWSER_CHANNEL || 'msedge', headless: true });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const a = await phone.newPage(); const b = await desktop.newPage();
  const noteA = `Synthetic phone sync verification ${randomUUID()}`;
  await signIn(a, accounts[0]);
  await openCobra(a);
  if (managementToken) {
    await expect(a.getByLabel('Anything else to remember')).toHaveValue('Synthetic signup seed verification');
    console.log('PASS: server-private matching signup seed loaded through authenticated session.');
  }
  await a.getByLabel('Have you been?').selectOption('visited');
  await a.getByLabel('Your rating / 10').fill('9');
  await a.getByLabel('Anything else to remember').fill(noteA);
  await a.getByRole('button', { name: 'Save my notes', exact: true }).click();
  await a.getByRole('button', { name: 'Close details' }).click();
  await nav(a, 'Settings'); await ready(a);
  await signIn(b, accounts[0]); await openCobra(b);
  await expect(b.getByLabel('Anything else to remember')).toHaveValue(noteA);
  await expect(b.getByLabel('Your rating / 10')).toHaveValue('9');
  const noteB = `Synthetic desktop update ${randomUUID()}`;
  await b.getByLabel('Anything else to remember').fill(noteB);
  await b.getByRole('button', { name: 'Save my notes', exact: true }).click();
  await b.getByRole('button', { name: 'Close details' }).click();
  await nav(b, 'Settings'); await ready(b);
  await a.reload(); await nav(a, 'Settings'); await ready(a); await openCobra(a);
  await expect(a.getByLabel('Anything else to remember')).toHaveValue(noteB);
  console.log('PASS: phone write, independent desktop read/write, phone reload and session persistence.');

  // A second signed-in account cannot read or write the first account's row.
  const first = publicClient(); const second = publicClient(); const anonymous = publicClient();
  for (const [client, account] of [[first, accounts[0]], [second, accounts[1]]]) {
    const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
    if (error) throw new Error(error.message);
  }
  const { data: hidden, error: readError } = await second.from('nash_private_state').select('payload').eq('user_id', accounts[0].id);
  if (readError || hidden.length !== 0) throw new Error('Account isolation read failed.');
  const empty = { version: 1, exportedAt: '', history: {}, savedEventIds: [] };
  const { error: wrongOwner } = await second.rpc('save_nash_private_state', { p_owner: accounts[0].id, p_expected_revision: 0, p_payload: empty });
  if (!wrongOwner) throw new Error('Cross-account write unexpectedly allowed.');
  const { error: anonymousRead } = await anonymous.from('nash_private_state').select('payload');
  if (!anonymousRead) throw new Error('Anonymous private table read unexpectedly allowed.');
  const { data: row, error: rowError } = await first.from('nash_private_state').select('revision,payload').single();
  if (rowError) throw new Error(rowError.message);
  const { error: directWrite } = await first.from('nash_private_state').update({ payload: empty }).eq('user_id', accounts[0].id);
  if (!directWrite) throw new Error('Direct update bypasses revision checking.');
  const args = { p_owner: accounts[0].id, p_expected_revision: row.revision, p_payload: row.payload };
  const successful = await first.rpc('save_nash_private_state', args);
  const stale = await first.rpc('save_nash_private_state', args);
  if (successful.error || !successful.data?.[0]?.applied || stale.error || stale.data?.[0]?.applied !== false) throw new Error('Compare-and-swap failed.');
  console.log('PASS: anonymous rejection, account isolation, direct-write rejection, stale revision rejected.');

  if (managementToken) {
    // Exercise the actual worker SQL with its owner selection restricted to this
    // synthetic fixture. It cannot read or change the real owner's row.
    const manage = createManagementClient({ token: managementToken });
    const fixtureQuery = (query, options) => {
      if (!query.includes("where u.email_confirmed_at is not null") || !query.includes("<> 'temporary_nash_sync_verification'")) throw new Error('Worker fixture scope cannot be applied.');
      return manage(query.replace('where u.email_confirmed_at is not null', `where s.user_id = '${accounts[0].id}'::uuid and u.email_confirmed_at is not null`)
        .replace("<> 'temporary_nash_sync_verification'", "= 'temporary_nash_sync_verification'"), options);
    };
    const stamp = new Date().toISOString();
    const interest = { id: 'synthetic-search', name: 'Synthetic event search', kind: 'activity', sourceUrl: 'https://example.com/events', notes: 'Synthetic private preference', enabled: true, createdAt: stamp, updatedAt: stamp };
    let current = await first.from('nash_private_state').select('revision,payload').single();
    const saved = await first.rpc('save_nash_private_state', { p_owner: accounts[0].id, p_expected_revision: current.data.revision, p_payload: { ...current.data.payload, searchInterests: { [interest.id]: interest } } });
    if (saved.error || !saved.data?.[0]?.applied) throw new Error('Search interest save failed.');
    const inbox = await pullInterests({ query: fixtureQuery });
    if (Object.keys(inbox).some(key => !['version', 'pulledAt', 'revision', 'searchInterests'].includes(key)) || inbox.searchInterests[interest.id]?.notes !== interest.notes) throw new Error('Private inbox projection failed.');
    const patch = { id: interest.id, expectedUpdatedAt: stamp, result: { inputUpdatedAt: stamp, status: 'active', checkedAt: new Date().toISOString(), message: 'Synthetic research completed.', catalogIds: ['cobra'], eventIds: [] } };
    await applyResult({ query: fixtureQuery, patch });
    current = await first.from('nash_private_state').select('revision,payload').single();
    if (current.data.payload.history.cobra.notes !== noteB || current.data.payload.searchInterests[interest.id]?.result?.status !== 'active') throw new Error('Worker changed unrelated history or lost its result.');
    const legacy = { ...current.data.payload }; delete legacy.searchInterests;
    const oldClient = await first.rpc('save_nash_private_state', { p_owner: accounts[0].id, p_expected_revision: current.data.revision, p_payload: legacy });
    if (oldClient.error || !oldClient.data?.[0]?.applied || oldClient.data[0].payload.searchInterests[interest.id]?.result?.status !== 'active') throw new Error('Legacy client erased the search list.');
    const malformed = await first.rpc('save_nash_private_state', { p_owner: accounts[0].id, p_expected_revision: oldClient.data[0].revision, p_payload: { ...legacy, searchInterests: [] } });
    if (!malformed.error) throw new Error('Malformed search list accepted by RPC.');
    const pausedPayload = structuredClone(oldClient.data[0].payload);
    pausedPayload.searchInterests[interest.id].enabled = false;
    const paused = await first.rpc('save_nash_private_state', { p_owner: accounts[0].id, p_expected_revision: oldClient.data[0].revision, p_payload: pausedPayload });
    if (paused.error || !paused.data?.[0]?.applied) throw new Error('Synthetic pause failed.');
    let blockedPause = false;
    try { await applyResult({ query: fixtureQuery, patch }); } catch (error) { blockedPause = /paused/.test(error.message); }
    if (!blockedPause) throw new Error('Worker updated a paused request.');
    const editedPayload = structuredClone(paused.data[0].payload);
    editedPayload.searchInterests[interest.id].enabled = true;
    editedPayload.searchInterests[interest.id].updatedAt = new Date(Date.parse(stamp) + 1).toISOString();
    editedPayload.searchInterests[interest.id].notes = 'Newer synthetic instruction';
    const edited = await first.rpc('save_nash_private_state', { p_owner: accounts[0].id, p_expected_revision: paused.data[0].revision, p_payload: editedPayload });
    if (edited.error || !edited.data?.[0]?.applied) throw new Error('Synthetic edit failed.');
    let blockedEdit = false;
    try { await applyResult({ query: fixtureQuery, patch }); } catch (error) { blockedEdit = /edited/.test(error.message); }
    if (!blockedEdit) throw new Error('Worker overwrote an edited request.');
    console.log('PASS: real private inbox projection, worker result preserving history, legacy save preservation, malformed list rejection, paused/edited input protection.');

    await a.reload(); await nav(a, 'Settings'); await ready(a);
    await nav(a, 'Search list');
    await a.getByRole('button', { name: 'Add an interest', exact: true }).click();
    await a.getByLabel('Name', { exact: true }).fill('Synthetic phone interest');
    await a.getByLabel('Type', { exact: true }).selectOption('artist');
    await a.getByLabel('What to look for (optional, private)', { exact: true }).fill('Synthetic phone criteria');
    await a.getByRole('button', { name: 'Save interest', exact: true }).click();
    await expect(a.getByRole('article', { name: 'Synthetic phone interest', exact: true })).toBeVisible();
    await nav(a, 'Settings'); await ready(a);
    await b.reload(); await nav(b, 'Settings'); await ready(b); await nav(b, 'Search list');
    const cardB = b.getByRole('article', { name: 'Synthetic phone interest', exact: true });
    await expect(cardB).toBeVisible();
    await expect(cardB.getByText('Pending research', { exact: true })).toBeVisible();
    const phoneInbox = await pullInterests({ query: fixtureQuery });
    const phoneInterest = Object.values(phoneInbox.searchInterests).find(item => item.name === 'Synthetic phone interest');
    if (!phoneInterest || phoneInterest.notes !== 'Synthetic phone criteria') throw new Error('Phone interest did not reach the job inbox.');
    await applyResult({ query: fixtureQuery, patch: { id: phoneInterest.id, expectedUpdatedAt: phoneInterest.updatedAt, result: { inputUpdatedAt: phoneInterest.updatedAt, status: 'active', checkedAt: new Date().toISOString(), message: 'Synthetic phone research completed.', catalogIds: ['cobra'], eventIds: [] } } });
    await a.reload(); await nav(a, 'Settings'); await ready(a); await nav(a, 'Search list');
    const cardA = a.getByRole('article', { name: 'Synthetic phone interest', exact: true });
    await expect(cardA.getByText('In daily search', { exact: true })).toBeVisible();
    await expect(cardA.getByText('Synthetic phone research completed.', { exact: true })).toBeVisible();
    await cardA.getByRole('button', { name: /In the guide.*Cobra Nashville/ }).click();
    await expect(a.getByLabel('Anything else to remember')).toHaveValue(noteB);
    await a.getByRole('button', { name: 'Close details' }).click();
    await nav(a, 'Settings');
    console.log('PASS: phone interest creation, second-device sync, job pickup, result returned to phone, linked guide preserving history.');
  }

  if (!managementToken) await a.getByRole('button', { name: 'Close details' }).click();
  await nav(a, 'Settings');
  await a.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(a.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await nav(a, 'My places');
  await expect(a.locator('.place-card')).toHaveCount(0);
  console.log('PASS: signing out does not expose account notes as device-only history.');
  await mkdir('test-results', { recursive: true });
  await a.screenshot({ path: 'test-results/live-sync-phone.png', fullPage: true });
} finally {
  if (browser) await browser.close();
  const results = [];
  for (const account of accounts) {
    const { error } = await admin.auth.admin.updateUserById(account.id, { ban_duration: '876000h' });
    results.push({ id: account.id, disabled: !error });
  }
  await mkdir('private', { recursive: true });
  await writeFile('private/sync-verification-accounts.json', JSON.stringify({ checkedAt: new Date().toISOString(), accounts: results }, null, 2));
  if (results.some(result => !result.disabled)) throw new Error('A synthetic QA account could not be disabled. Check private verification record.');
  console.log(`Disabled ${results.length} synthetic test accounts; no owner account or data was accessed.`);
}
