import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: process.env.UI_BASE_URL || 'http://127.0.0.1:5173/', channel: process.env.UI_BROWSER_CHANNEL || 'msedge', headless: true, timezoneId: 'Asia/Tokyo' });
test.setTimeout(90_000);
const stamp = new Date().toISOString();
const day = '2099-10-15';
const makeEvent = (id: string, title: string, venue: string, start: string, end?: string, priceText = '') => ({ id, title, venueId: venue, venueName: venue === 'favorite-hall' ? 'Favorite Hall' : 'Other Hall', start, end, priceText, sourceId: 'synthetic-calendar', checkedAt: stamp, status: 'confirmed', tags: ['music'], url: `https://example.com/${id}` });
const events = [
  makeEvent('cheap-jazz', 'Synthetic affordable jazz', 'favorite-hall', `${day}T18:00:00-05:00`, `${day}T20:00:00-05:00`, '$10 + fees'),
  makeEvent('costly-rock', 'Synthetic expensive rock', 'other-hall', `${day}T18:30:00-05:00`, `${day}T21:00:00-05:00`, '$40'),
  makeEvent('unknown-end', 'Synthetic open-ended concert', 'other-hall', `${day}T19:00:00-05:00`),
  makeEvent('carryover', 'Synthetic midnight carryover', 'other-hall', '2099-10-14T23:00:00-05:00', `${day}T01:00:00-05:00`, 'Free admission'),
  makeEvent('matinee', 'Synthetic midday show', 'other-hall', `${day}T12:00:00-05:00`, `${day}T12:45:00-05:00`, '$20'),
  makeEvent('sold-out', 'Synthetic sold out show', 'favorite-hall', `${day}T20:30:00-05:00`, `${day}T23:00:00-05:00`, '$20'),
];

async function fixture(page: Page) {
  await page.route('**/data/events.json', route => route.fulfill({ json: { events, checkedAt: stamp, sources: [{ id: 'synthetic-calendar', status: 'ok', checkedAt: stamp }] } }));
  await page.route('**/data/catalog.json', route => route.fulfill({ json: { entries: [{ id: 'favorite-hall', name: 'Favorite Hall', kind: 'venue', area: 'East Nashville', tags: ['music'], identityStatus: 'identified' }, { id: 'other-hall', name: 'Other Hall', kind: 'venue', area: 'Downtown', tags: ['music'], identityStatus: 'identified' }] } }));
  await page.route('**/data/pricing.json', route => route.fulfill({ json: { version: 1, events: {} } }));
  await page.route('**/data/music-details.json', route => route.fulfill({ json: { version: 1, checkedAt: stamp, artists: [], sources: [], events: Object.fromEntries(events.map(event => [event.id, { genres: [event.id === 'cheap-jazz' ? 'Jazz' : 'Rock'], images: [], artistIds: [], status: 'ok', checkedAt: stamp, sourceUrl: event.url }])) } }));
  await page.addInitScript(({ stamp }) => localStorage.setItem('nash-after-dark.personal.v1', JSON.stringify({ version: 1, exportedAt: stamp, savedEventIds: ['cheap-jazz'], history: { 'favorite-hall': { attendance: 'visited', rating: 9, notes: '', liked: '', disliked: '', favorite: true, watch: false, updatedAt: stamp } } })), { stamp });
}

for (const [device, viewport] of Object.entries({ phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 1000 } })) {
  test(`filter choices and counts follow the day and recover from empty selections on ${device}`, async ({ page }) => {
    await page.setViewportSize(viewport); await fixture(page); await page.goto('./');
    await page.getByLabel('Jump to date').fill(day);
    const categories = page.getByLabel('Event categories', { exact: true });
    await expect(categories.getByRole('button', { name: 'Everything', exact: true })).toContainText('6');
    await expect(categories.getByRole('button', { name: 'Live music', exact: true })).toContainText('6');
    await expect(categories.getByRole('button', { name: 'Saved', exact: true })).toContainText('1');
    await expect(categories.getByRole('button', { name: 'MTG', exact: true })).toHaveCount(0);
    await expect(categories.getByRole('button', { name: 'Food & drink', exact: true })).toHaveCount(0);
    await page.locator('.advanced-filters summary').click();
    await expect(page.getByLabel('Budget', { exact: true }).locator('option[value="free"]')).toHaveText('Free admission (1)');
    await expect(page.getByLabel('Genre', { exact: true }).locator('option[value="Jazz"]')).toHaveText('Jazz (1)');
    await expect(page.getByLabel('Genre', { exact: true }).locator('option[value="Rock"]')).toHaveText('Rock (5)');
    await page.getByLabel('Budget', { exact: true }).selectOption('15');
    await expect(categories.getByRole('button', { name: 'Everything', exact: true })).toContainText('2');
    await expect(page.getByLabel('Genre', { exact: true }).locator('option[value="Rock"]')).toHaveText('Rock (1)');
    await page.getByLabel('Genre', { exact: true }).selectOption('Jazz');
    await expect(page.getByLabel('Venue', { exact: true }).locator('option[value="other-hall"]')).toHaveCount(0);
    await expect(page.getByLabel('Venue', { exact: true }).locator('option[value="favorite-hall"]')).toHaveText('Favorite Hall (1)');
    await expect(page.getByLabel('Starts', { exact: true }).locator('option[value="late"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Previous day', exact: true }).click();
    await expect(page.locator('.timeline-empty')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove genre filter', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove genre filter', exact: true }).click();
    await expect(page.locator('.fc-timegrid-event')).toHaveCount(1);
    await expect(categories.getByRole('button', { name: 'Everything', exact: true })).toContainText('1');
    await expect(page.getByLabel('Genre', { exact: true }).locator('option[value="Jazz"]')).toHaveCount(0);
    await page.getByLabel('Jump to date').fill('2099-11-04');
    await expect(page.getByLabel('Event categories', { exact: true })).toHaveCount(0);
    await expect(page.locator('.advanced-filters')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reset extra filters' }).click();
    await page.getByLabel('Jump to date').fill(day);
    await expect(categories.getByRole('button', { name: 'Everything', exact: true })).toContainText('6');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/facets-${device}.png` });
  });
  test(`hourly overlap, date jumps, ranking and budget/genre filters on ${device}`, async ({ page }) => {
    await page.setViewportSize(viewport); await fixture(page);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('./'); await page.getByLabel('Jump to date').fill(day);
    const timeline = page.locator('.timeline-horizontal-scroll');
    await expect(page.locator('.fc-timegrid-event')).toHaveCount(6);
    // Chicago clock must stay at noon even when the device is in Tokyo.
    await expect.poll(() => timeline.evaluate(el => Math.round(el.scrollTop))).toBeGreaterThan(1400);
    await expect.poll(() => timeline.evaluate(el => Math.round(el.scrollTop))).toBeLessThan(1450);
    const cheap = page.locator('[data-event-id="cheap-jazz"]');
    const costly = page.locator('[data-event-id="costly-rock"]');
    const unknown = page.locator('[data-event-id="unknown-end"]');
    await expect(cheap).toContainText('6:00 PM – 8:00 PM');
    await expect(unknown).toContainText('end unknown'); await expect(unknown).toContainText('1h display only');
    await expect(page.locator('[data-event-id="carryover"]')).toContainText('From Oct 14');
    await timeline.evaluate(el => { el.scrollTop = 2050; });
    const [a, b, c] = await Promise.all([cheap.boundingBox(), costly.boundingBox(), unknown.boundingBox()]);
    expect(a!.width).toBeGreaterThan(140); expect(b!.width).toBeGreaterThan(140);
    expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + 3);
    expect(a!.height / c!.height).toBeGreaterThan(1.9); expect(a!.height / c!.height).toBeLessThan(2.1);
    const hour = page.locator('.fc-timegrid-slot-label').first();
    const beforeX = await hour.evaluate(el => el.getBoundingClientRect().x);
    await timeline.evaluate(el => { el.scrollLeft = 260; });
    expect(Math.abs((await hour.evaluate(el => el.getBoundingClientRect().x)) - beforeX)).toBeLessThan(2);
    await cheap.click(); await expect(page.locator('.detail-title')).toHaveText('Synthetic affordable jazz');
    await page.locator('.rank-details summary').click();
    await expect(page.locator('.rank-details')).toContainText('A favorite venue or artist');
    await expect(page.locator('.rank-details')).toContainText('9/10');
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.locator('.advanced-filters summary').click();
    await page.getByLabel('Budget', { exact: true }).selectOption('15');
    await expect(page.locator('.fc-timegrid-event')).toHaveCount(2);
    await page.getByLabel('Genre', { exact: true }).selectOption('Jazz');
    await expect(page.locator('.fc-timegrid-event')).toHaveCount(1);
    await expect(cheap).toBeAttached();
    await page.getByRole('button', { name: 'Reset extra filters' }).click();
    await page.getByLabel('Listing status', { exact: true }).selectOption('not_sold_out');
    await expect(page.locator('.fc-timegrid-event')).toHaveCount(5);
    await page.getByRole('button', { name: 'Reset extra filters' }).click();
    await page.getByRole('button', { name: 'Previous day', exact: true }).click();
    await expect(page.getByLabel('Jump to date')).toHaveValue('2099-10-14');
    await expect(page.locator('.fc-timegrid-event')).toHaveCount(1);
    await page.getByRole('button', { name: 'Next day', exact: true }).click();
    await expect(page.getByLabel('Jump to date')).toHaveValue(day);
    await page.locator('ion-segment-button').filter({ hasText: /^Month$/ }).click();
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
    await page.locator('[data-day="2099-11-04"]').click();
    await expect(page.getByLabel('Jump to date')).toHaveValue('2099-11-04');
    await expect(page.locator('.timeline-empty')).toContainText('No events match');
    await page.getByLabel('Jump to date').fill(day);
    await page.locator('ion-segment-button').filter({ hasText: /^Agenda$/ }).click();
    await page.getByLabel('Rank by', { exact: true }).selectOption('fit');
    await page.getByLabel('List order', { exact: true }).selectOption('rank');
    await expect(page.locator('.event-card').first()).toContainText('Synthetic affordable jazz');
    await page.getByLabel('List order', { exact: true }).selectOption('time');
    await expect(page.locator('.event-card').first()).toContainText('Synthetic midday show');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.main-shell')!.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
