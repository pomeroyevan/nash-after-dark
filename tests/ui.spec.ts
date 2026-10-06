import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Own temporary browser contexts only. No user browser profile or account access.
// Start `npm run dev -- --port 5173` first. The default channel uses installed Edge.
test.use({ baseURL: process.env.UI_BASE_URL || 'http://127.0.0.1:5173', channel: process.env.UI_BROWSER_CHANNEL || 'msedge', headless: true, viewport: { width: 1440, height: 1000 } });
test.setTimeout(60_000);
const key = 'nash-after-dark.personal.v1';
const nashDay = (v: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
const clock = (v: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(v));
async function navigate(page: Page, label: string) { await page.locator('.sidebar:visible, .mobile-tabs:visible').getByText(label, { exact: true }).click(); }
async function openApp(page: Page) { await page.goto('./'); await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible(); await expect(page.locator('.loading-state')).toHaveCount(0); await expect(page.locator('.notice.error')).toHaveCount(0); }
async function noteValue(page: Page) { return page.evaluate(k => localStorage.getItem(k), key); }

test('real public data, combined search/category, candidate and incomplete-source labels', async ({ page, request }) => {
  const catalogResponse = await request.get('data/catalog.json'); expect(catalogResponse.ok()).toBeTruthy();
  const raw = await catalogResponse.json(); const active = raw.entries.filter((e: { inScope?: boolean }) => e.inScope !== false);
  const eventsResponse = await request.get('data/events.json'); expect(eventsResponse.ok()).toBeTruthy();
  const eventData = await eventsResponse.json(); expect(eventData.events.length).toBeGreaterThan(0);
  const browserErrors: string[] = []; page.on('pageerror', e => browserErrors.push(e.message));
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Dancing', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/calendar-desktop.png', fullPage: false });
  await navigate(page, 'Explore');
  await expect(page.locator('.place-card')).toHaveCount(active.length);
  await expect(page.locator('.place-card').filter({ hasText: 'Loveless' })).toHaveCount(0);
  const cobra = active.find((e: { id: string }) => e.id === 'cobra'); expect(cobra).toBeTruthy();
  await page.getByRole('textbox', { name: 'Search places, artists and series' }).fill('Cobra');
  await page.getByRole('button', { name: 'Live music', exact: true }).click();
  await expect(page.locator('.place-card').filter({ has: page.getByRole('heading', { name: cobra.name, exact: true }) })).toBeVisible();
  await page.getByRole('button', { name: 'Dancing', exact: true }).click();
  await expect(page.locator('.place-card').filter({ has: page.getByRole('heading', { name: cobra.name, exact: true }) })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search places, artists and series' }).fill('Inglewood');
  await page.getByRole('button', { name: 'Food & drink', exact: true }).click();
  await expect(page.locator('.place-card').filter({ hasText: 'Inglewood Lounge' })).toBeVisible();
  await page.getByRole('button', { name: 'Live music', exact: true }).click();
  await expect(page.locator('.place-card').filter({ hasText: 'Inglewood Lounge' })).toBeVisible();
  const candidate = active.find((e: { identityStatus: string; officialUrl?: string }) => e.identityStatus === 'candidate' && e.officialUrl);
  expect(candidate).toBeTruthy();
  await page.getByRole('button', { name: 'Everything', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search places, artists and series' }).fill(candidate.name);
  await page.locator('.place-card').filter({ has: page.getByRole('heading', { name: candidate.name, exact: true }) }).click();
  await expect(page.getByText('Candidate · needs confirmation.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Candidate website', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await navigate(page, 'Settings');
  for (const source of eventData.sources.filter((s: { status: string }) => ['manual', 'partial'].includes(s.status)).slice(0, 5)) {
    const row = page.locator('.source-row').filter({ has: page.getByText(source.name, { exact: true }) });
    await expect(row.locator('ion-icon[aria-label="Verification incomplete"]')).toBeVisible();
  }
  expect(browserErrors).toEqual([]);
});

test('month and day selection, real event details, bookmark, and calendar download', async ({ page, request }) => {
  const data = await (await request.get('data/events.json')).json();
  const today = nashDay(new Date());
  const event = data.events.find((e: { start: string }) => nashDay(e.start) >= today);
  expect(event).toBeTruthy();
  await openApp(page);
  await page.getByRole('button', { name: 'Everything', exact: true }).click();
  await page.locator('ion-segment-button').filter({ hasText: 'Month' }).click();
  await expect(page.locator('.month-calendar')).toBeVisible();
  const targetDay = nashDay(event.start);
  const day = page.locator(`[data-day="${targetDay}"]`);
  if (!(await day.count())) await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await day.click(); await expect(day).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'Search events and venues' }).fill(event.title);
  const card = page.locator('.event-card').filter({ hasText: event.title }).first();
  await expect(card).toContainText(clock(event.start));
  await card.locator('.event-main').click();
  await expect(page.locator('.detail-title')).toHaveText(event.title);
  await expect(page.locator('.detail-facts')).toContainText(clock(event.start));
  await expect(page.locator('.detail-facts')).toContainText('Central');
  await page.getByRole('button', { name: 'Save this night', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved night', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Add to calendar', exact: true }).click();
  const download = await downloading;
  const file = await download.path(); expect(file).toBeTruthy();
  const ics = await readFile(file!, 'utf8');
  expect(ics).toContain('BEGIN:VCALENDAR\r\n');
  expect(ics).toContain(`DTSTART:${new Date(event.start).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z')}`);
  expect(ics).toContain('END:VCALENDAR\r\n');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.reload(); await expect(page.locator('.loading-state')).toHaveCount(0);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('.event-card').filter({ hasText: event.title })).toBeVisible();
});

test('synthetic backup preview/merge, edits survive reload and another tab, malformed import preserves notes', async ({ page, context, request }) => {
  const catalog = (await (await request.get('data/catalog.json')).json()).entries;
  const entry = catalog.find((e: { id: string; inScope?: boolean }) => e.id === 'cobra' && e.inScope !== false)
    || catalog.find((e: { inScope?: boolean }) => e.inScope !== false);
  expect(entry).toBeTruthy();
  const recordId = entry.id as string;
  // Synthetic personal data only: portable to a clean checkout, with no private file access.
  const seed = {
    version: 1,
    exportedAt: '2026-10-05T12:00:00Z',
    history: {
      [recordId]: {
        attendance: 'visited', rating: 7, notes: 'Synthetic backup used only for browser testing.',
        liked: 'Synthetic positive note.', disliked: 'Synthetic negative note.',
        favorite: true, watch: true, updatedAt: '2026-10-05T12:00:00Z',
      },
    },
    savedEventIds: [],
  };
  await openApp(page); await navigate(page, 'Settings');
  expect(await noteValue(page)).toBeNull();
  await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(seed)) });
  await expect(page.getByRole('heading', { name: 'Ready to import', exact: true })).toBeVisible();
  expect(await noteValue(page)).toBeNull();
  await page.getByRole('button', { name: 'Merge this backup', exact: true }).click();
  await expect(page.locator('.save-message').filter({ hasText: 'Backup imported' })).toBeVisible();
  expect(JSON.parse((await noteValue(page))!).history[recordId!]).toEqual(seed.history[recordId!]);
  const other = await context.newPage(); await openApp(other); await navigate(other, 'My places');
  await navigate(page, 'Explore');
  await page.getByRole('textbox', { name: 'Search places, artists and series' }).fill(entry.name);
  await page.locator('.place-card').filter({ has: page.getByRole('heading', { name: entry.name, exact: true }) }).click();
  await page.getByLabel('Anything else to remember').fill('Local browser QA note: persistence and cross-tab verification.');
  await page.getByLabel('Your rating / 10').fill('8.5');
  await page.getByRole('button', { name: 'Save my notes', exact: true }).click();
  await expect(page.locator('.save-message')).toContainText('Saved locally.');
  await expect.poll(async () => JSON.parse((await noteValue(other))!).history[recordId!].rating).toBe(8.5);
  await expect(other.locator('.place-card').filter({ has: other.getByRole('heading', { name: entry.name, exact: true }) })).toContainText('8.5');
  await page.reload(); await expect(page.locator('.loading-state')).toHaveCount(0); await navigate(page, 'Explore');
  await page.getByRole('textbox', { name: 'Search places, artists and series' }).fill(entry.name);
  await page.locator('.place-card').filter({ has: page.getByRole('heading', { name: entry.name, exact: true }) }).click();
  await expect(page.getByLabel('Anything else to remember')).toHaveValue('Local browser QA note: persistence and cross-tab verification.');
  await expect(page.getByLabel('Your rating / 10')).toHaveValue('8.5');
  await page.getByRole('button', { name: 'Close details' }).click(); await navigate(page, 'Settings');
  const before = await noteValue(page);
  await page.locator('input[type="file"]').setInputFiles({ name: 'invalid-backup.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"history":{"broken":{"rating":999}},"savedEventIds":[]}') });
  await expect(page.locator('.error-text')).toContainText('Invalid attendance or rating');
  expect(await noteValue(page)).toBe(before);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await downloading; const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.history[recordId!].rating).toBe(8.5);
  await other.close();
});

test('390px phone: stable navigation, no horizontal page overflow, usable detail editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openApp(page);
  await expect(page.locator('.mobile-tabs')).toBeVisible(); await expect(page.locator('.sidebar')).toBeHidden();
  for (const label of ['Calendar', 'Explore', 'My places', 'Settings']) await expect(page.locator('.mobile-tabs').getByRole('button', { name: label, exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/calendar-phone-390.png', fullPage: false });
  const overflow = await page.evaluate(() => {
    const shell = document.querySelector('.main-shell')!;
    const rect = shell.getBoundingClientRect();
    return document.documentElement.scrollWidth > window.innerWidth || rect.right > window.innerWidth + 1 || rect.left < -1;
  });
  expect(overflow).toBe(false);
  await navigate(page, 'Explore');
  await page.getByRole('textbox', { name: 'Search places, artists and series' }).fill('Cobra');
  await page.locator('.place-card').first().click();
  await expect(page.getByRole('button', { name: 'Close details' })).toBeVisible();
  await page.getByLabel('Have you been?').selectOption('visited');
  await page.getByLabel('Your rating / 10').fill('9');
  await page.getByLabel('What you liked').fill('Phone layout verification.');
  await page.getByRole('button', { name: 'Save my notes', exact: true }).click();
  await expect(page.locator('.save-message')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await navigate(page, 'My places'); await expect(page.locator('.place-card')).toContainText('9');
});

test('signup uses the deployed subpath for confirmation without sending email', async ({ page }) => {
  let redirect = '';
  await page.route('**/auth/v1/signup**', async route => {
    redirect = new URL(route.request().url()).searchParams.get('redirect_to') || '';
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ msg: 'Synthetic browser check; signup was not sent.' }) });
  });
  await openApp(page); await navigate(page, 'Settings');
  await page.getByRole('button', { name: 'Create account instead', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('synthetic-browser-check@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-check-not-an-account-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect.poll(() => redirect).toBe(new URL('./', page.url()).href);
});
