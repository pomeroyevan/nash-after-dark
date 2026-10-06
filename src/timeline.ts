import { DateTime } from 'luxon';
import { ZONE, type NightEvent } from './model';

export interface TimelineInterval { start: number; end: number; hasEnd: boolean }
const HOUR = 60 * 60 * 1000;
const absoluteTime = /(?:Z|[+-]\d{2}:\d{2})$/;

/** End fallback is a rendering interval only. It never changes the source event. */
export function timelineEventInterval(event: NightEvent): TimelineInterval | null {
  const start = absoluteTime.test(event.start) ? Date.parse(event.start) : NaN;
  if (!Number.isFinite(start)) return null;
  const end = event.end && absoluteTime.test(event.end) ? Date.parse(event.end) : NaN;
  const hasEnd = Number.isFinite(end) && end > start;
  return { start, end: hasEnd ? end : start + HOUR, hasEnd };
}

export function timelineDayBounds(day: string): { start: number; end: number; changesOffset: boolean } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = DateTime.fromISO(day, { zone: ZONE }).startOf('day');
  if (!start.isValid || start.toISODate() !== day) return null;
  const end = start.plus({ days: 1 });
  return { start: start.toMillis(), end: end.toMillis(), changesOffset: start.offset !== end.offset };
}

export function eventsOnDay(events: NightEvent[], day: string): NightEvent[] {
  const bounds = timelineDayBounds(day);
  if (!bounds) return [];
  return events.filter(event => {
    const interval = timelineEventInterval(event);
    return interval && interval.start < bounds.end && interval.end > bounds.start;
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
}

/** Half-open intervals mean an ending event does not collide with one starting then. */
export function peakOverlap(events: NightEvent[], day: string): number {
  const bounds = timelineDayBounds(day);
  if (!bounds) return 0;
  const edges = eventsOnDay(events, day).flatMap(event => {
    const interval = timelineEventInterval(event)!;
    return [[Math.max(interval.start, bounds.start), 1], [Math.min(interval.end, bounds.end), -1]];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, peak = 0;
  for (const [, delta] of edges) { active += delta; peak = Math.max(peak, active); }
  return peak;
}
