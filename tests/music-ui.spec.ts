import { test, expect, type Page } from '@playwright/test';

test.use({ baseURL: process.env.UI_BASE_URL || 'http://127.0.0.1:5173/', channel: process.env.UI_BROWSER_CHANNEL || 'msedge', headless: true });
test.setTimeout(60_000);
const nav = (page: Page, name: string) => page.locator('.sidebar:visible, .mobile-tabs:visible').getByRole('button', { name, exact: true }).click();
const stamp = '2026-10-05T20:00:00Z';
const source = 'https://example.com/official-event';
const event = { id: 'test-music-event', title: 'Synthetic music night', venueId: 'test-venue', venueName: 'Synthetic venue', sourceId: 'basement-east', start: '2099-10-15T20:00:00-05:00', url: source, status: 'confirmed', tags: ['music'], checkedAt: stamp };
const picture = { url: 'https://example.com/test-photo.png', sourceUrl: source, alt: 'Synthetic artist official promotional photograph', kind: 'artist', checkedAt: stamp };
const artist = { id: 'test-artist', name: 'Synthetic Artist', summary: 'A guitar band with instrumental arrangements.', genres: ['Post-rock'], origin: 'Nashville', sections: [{ title: 'Sound & live show', body: 'Instrumental sets built around contrasting dynamics.', sourceUrls: [source] }, { title: 'Scene & style', body: 'A documented connection to independent rock. No event dress code has been verified.', sourceUrls: [source] }], links: [{ label: 'Official music', url: 'https://example.com/music' }], images: [picture], sources: [{ label: 'Official event', url: source, checkedAt: stamp }], checkedAt: stamp, eventTitles: [event.title] };

async function fixture(page: Page) {
  await page.route('**/data/events.json', route => route.fulfill({ json: { events: [event], sources: [], checkedAt: stamp } }));
  await page.route('**/data/catalog.json', route => route.fulfill({ json: { entries: [{ id: 'test-venue', name: 'Synthetic venue', kind: 'venue', identityStatus: 'identified', tags: ['music'] }] } }));
  await page.route('**/data/music-details.json', route => route.fulfill({ json: { version: 1, checkedAt: stamp, artists: [artist], sources: [], events: { [event.id]: { images: [picture], artistIds: [artist.id], genres: ['Post-rock'], sourceUrl: source, checkedAt: stamp, status: 'ok' } } } }));
  // A local synthetic image response, never scraped media or a user browser profile.
  await page.route(picture.url, route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') }));
}

for (const [device, viewport] of Object.entries({ phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 1000 } })) {
  test(`photos, artist guide and event return flow on ${device}`, async ({ page }) => {
    await page.setViewportSize(viewport); await fixture(page);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('./'); await page.getByRole('button', { name: 'All upcoming', exact: false }).click();
    await expect(page.locator('.event-thumbnail')).toBeVisible();
    await page.locator('.event-main').click();
    await expect(page.getByRole('region', { name: 'Photos and flyers' }).getByRole('img')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View original source' })).toHaveAttribute('href', source);
    await page.getByRole('button', { name: /Synthetic Artist Post-rock/ }).click();
    await expect(page.locator('.detail-title')).toHaveText(artist.name);
    await expect(page.locator('.detail-title')).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Scene & style' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Official music' })).toHaveAttribute('href', 'https://example.com/music');
    await page.getByRole('button', { name: 'Back to event', exact: false }).click();
    await expect(page.locator('.detail-title')).toHaveText(event.title);
    await expect(page.locator('.detail-title')).toBeInViewport();
    await page.getByRole('button', { name: 'Close details' }).click();
    await nav(page, 'Explore'); await page.getByRole('button', { name: 'Artist guides (1)', exact: true }).click();
    await page.getByLabel('Search places, artists and series').fill('post-rock');
    await expect(page.locator('.artist-card')).toHaveCount(1);
    await page.locator('.artist-card').click(); await expect(page.locator('.detail-title')).toHaveText(artist.name);
    await expect(page.getByRole('button', { name: /Synthetic music night/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('blocked images fall back to original source and missing enrichment never blocks calendar', async ({ page }) => {
  await fixture(page);
  await page.route(picture.url, route => route.abort());
  await page.goto('./'); await page.getByRole('button', { name: 'All upcoming', exact: false }).click(); await page.locator('.event-main').click();
  await expect(page.getByRole('region', { name: 'Photos and flyers' })).toContainText('Image unavailable');
  await expect(page.getByRole('link', { name: 'View original source' })).toHaveAttribute('href', source);
  await page.unroute('**/data/music-details.json');
  await page.route('**/data/music-details.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.reload(); await page.getByRole('button', { name: 'All upcoming', exact: false }).click();
  await expect(page.locator('.event-card')).toHaveCount(1);
  await nav(page, 'Explore'); await page.getByRole('button', { name: 'Artist guides (0)' }).click();
  await expect(page.getByRole('alert')).toContainText('Event listings still work');
});

test('a stalled optional media request does not delay the calendar', async ({ page }) => {
  await fixture(page);
  await page.unroute('**/data/music-details.json');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/data/music-details.json', async route => { await pending; await route.fulfill({ status: 503, body: 'Unavailable' }); });
  await page.goto('./', { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: 'All upcoming', exact: false }).click();
  try { await expect(page.locator('.event-card')).toHaveCount(1, { timeout: 5000 }); }
  finally { release(); }
});

test('archived social images open externally without attempting a blocked embed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page);
  await page.unroute('**/data/music-details.json');
  await page.route('**/data/music-details.json', route => route.fulfill({ json: { version: 1, checkedAt: stamp, artists: [], sources: [], events: {}, entries: { 'test-venue': { images: [{ ...picture, sourceOnly: true }], note: 'Archived official posts, not a new event date.' } } } }));
  let requests = 0;
  page.on('request', request => { if (request.url() === picture.url) requests++; });
  await page.goto('./'); await page.getByRole('button', { name: 'All upcoming', exact: false }).click(); await nav(page, 'Explore');
  await page.locator('.place-card').click();
  await expect(page.getByRole('heading', { name: 'Past flyers & scene photos' })).toBeVisible();
  const gallery = page.getByRole('region', { name: 'Past flyers and scene photos' });
  await expect(gallery.getByRole('link', { name: /Open full image/ })).toHaveAttribute('href', picture.url);
  await expect(gallery).toContainText('Open original image');
  await expect(gallery.locator('img')).toHaveCount(0);
  expect(requests).toBe(0);
});
