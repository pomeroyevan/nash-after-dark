// Explicit integration check against this app's configured Supabase project.
// Creates two synthetic accounts, then disables them; never reads owner history.
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';

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

  await a.getByRole('button', { name: 'Close details' }).click(); await nav(a, 'Settings');
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
