import type { NightEvent } from './model';
import { publicUrl } from './music';

export interface PricingDetails { priceText: string; sourceUrl: string; checkedAt: string; feeStatus: 'unknown' | 'included' | 'extra' | 'tax-extra'; spendText: string; caveat: string }
export function parsePricing(value: unknown): Record<string, PricingDetails> {
  if (!value || typeof value !== 'object' || !('events' in value)) return {};
  const records = (value as { events: unknown }).events;
  if (!records || typeof records !== 'object' || Array.isArray(records)) return {};
  return Object.fromEntries(Object.entries(records).flatMap(([id, raw]) => {
    if (!raw || typeof raw !== 'object' || ['__proto__', 'constructor', 'prototype'].includes(id)) return [];
    const p = raw as Record<string, unknown>;
    if (typeof p.priceText !== 'string' || !p.priceText || !publicUrl(p.sourceUrl) || typeof p.checkedAt !== 'string' || !Number.isFinite(Date.parse(p.checkedAt))) return [];
    const text = (x: unknown) => typeof x === 'string' ? x.slice(0, 1200) : '';
    return [[id, { priceText: text(p.priceText), sourceUrl: publicUrl(p.sourceUrl), checkedAt: p.checkedAt, feeStatus: ['included', 'extra', 'tax-extra'].includes(String(p.feeStatus)) ? p.feeStatus as PricingDetails['feeStatus'] : 'unknown', spendText: text(p.spendText), caveat: text(p.caveat) }]];
  }));
}

/** Never let an older manual price replace a different, newer official feed price. */
export function withPricing(event: NightEvent, detail?: PricingDetails): NightEvent {
  if (!detail) return event;
  if (event.priceText && event.priceText.trim() !== detail.priceText.trim() && Date.parse(event.checkedAt) > Date.parse(detail.checkedAt)) return event;
  return { ...event, priceText: detail.priceText, pricing: detail };
}
