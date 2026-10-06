import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicData, publicUrl } from '../src/music.ts';

test('media rejects executable/private URLs and preserves public source attribution', () => {
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,hi', 'https://u:p@example.com/img', 'http://127.0.0.1/a', 'http://10.0.0.1/a', 'http://192.168.1.1/a', 'http://[::1]/a', 'http://localhost/a', 'http://router.local/a']) assert.equal(publicUrl(url), '');
  const media = { url: 'https://example.com/image.jpg', sourceUrl: 'https://example.com/event', alt: 'Original flyer', kind: 'flyer', checkedAt: '2026-10-05T12:00:00Z' };
  const result = parseMusicData({ version: 1, events: { e: { images: [media, { ...media, url: 'javascript:bad' }], artistIds: ['a'], genres: ['Jazz'], status: 'ok' } }, artists: [], sources: [] });
  assert.equal(result.events.e.images.length, 1);
  assert.equal(result.events.e.images[0].sourceUrl, media.sourceUrl);
  assert.throws(() => parseMusicData({ events: [] }), /could not be read/);
});
