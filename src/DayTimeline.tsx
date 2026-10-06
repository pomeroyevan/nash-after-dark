import { useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import luxonPlugin from '@fullcalendar/luxon3';
import type { EventContentArg } from '@fullcalendar/core';
import { DateTime } from 'luxon';
import { category, dateLabel, ZONE, type NightEvent } from './model';
import { eventsOnDay, peakOverlap, timelineDayBounds, timelineEventInterval } from './timeline';
import './timeline.css';

export interface DayTimelineProps {
  day: string;
  events: NightEvent[];
  onOpen: (id: string) => void;
  ranks?: Record<string, { score: number; reasons: string[] }>;
}

export function DayTimeline({ day, events, onOpen, ranks }: DayTimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => eventsOnDay(events, day), [events, day]);
  const bounds = timelineDayBounds(day);
  const overlap = peakOverlap(visible, day);
  const minWidth = Math.max(320, 58 + overlap * 175);
  const hasUnknownEnd = visible.some(event => !timelineEventInterval(event)?.hasEnd);
  const time = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', ...(bounds?.changesOffset ? { timeZoneName: 'short' as const } : {}) }).format(new Date(value));
  const durationLabel = (event: NightEvent) => {
    const interval = timelineEventInterval(event)!;
    const crossesMidnight = DateTime.fromMillis(interval.start, { zone: ZONE }).toISODate() !== DateTime.fromMillis(interval.end, { zone: ZONE }).toISODate();
    const endDay = DateTime.fromMillis(interval.end, { zone: ZONE }).toISODate()!;
    return interval.hasEnd ? `${time(event.start)} – ${time(event.end!)}${crossesMidnight ? ` (${dateLabel(endDay, { month: 'short', day: 'numeric' })})` : ''}` : `${time(event.start)} · end unknown`;
  };
  const items = visible.map(event => {
    const interval = timelineEventInterval(event)!;
    return {
      id: event.id, title: event.title, start: event.start,
      // FullCalendar needs an interval for layout. This synthetic end stays here.
      end: new Date(interval.end).toISOString(),
      classNames: [`timeline-category-${category(event.tags, event.title)}`, ...(!interval.hasEnd ? ['timeline-provisional'] : [])],
      extendedProps: { sourceEvent: event, hasEnd: interval.hasEnd, durationLabel: durationLabel(event), continued: !!bounds && interval.start < bounds.start, startDateLabel: dateLabel(DateTime.fromMillis(interval.start, { zone: ZONE }).toISODate()!, { month: 'short', day: 'numeric' }), score: ranks?.[event.id]?.score },
    };
  });
  const renderEvent = ({ event }: EventContentArg) => {
    const props = event.extendedProps;
    const source = props.sourceEvent as NightEvent;
    return <div className="timeline-event-copy">
      <span className="timeline-event-time">{props.continued && <span className="timeline-continued">From {props.startDateLabel} · </span>}{props.durationLabel}</span>
      <strong className="timeline-event-title">{event.title}</strong>
      <span className="timeline-event-venue">{source.venueName}</span>
      <span className="timeline-event-price">{source.priceText || 'Price not confirmed'}</span>
      {!props.hasEnd && <span className="timeline-event-unknown">1h display only</span>}
      {typeof props.score === 'number' && <span className="timeline-event-rank">Rank {props.score}/100</span>}
    </div>;
  };
  if (!bounds) return <p role="alert">Choose a valid date to view the timeline.</p>;

  return <section className="day-timeline" aria-label={`${dateLabel(day)} hourly calendar`}>
    <div className="timeline-help">
      <span>Nashville time · overlapping events sit side by side</span>
      {overlap > 1 && <span className="timeline-swipe">Swipe sideways to compare {overlap} overlapping events.</span>}
      {hasUnknownEnd && <span className="timeline-end-note"><i aria-hidden="true" /> Dashed blocks: end unknown · 1h display only</span>}
      {bounds.changesOffset && <span>Daylight-saving change today. Event times include CST or CDT.</span>}
    </div>
    {!visible.length && <p className="timeline-empty" role="status">No events match this day and these filters.</p>}
    <div ref={scroller} className="timeline-horizontal-scroll" tabIndex={0} aria-label="Hourly schedule. Scroll vertically for hours and horizontally for overlapping events.">
      <div className="timeline-calendar" style={{ minWidth }}>
        <FullCalendar
          key={day}
          plugins={[timeGridPlugin, luxonPlugin]}
          initialView="timeGridDay"
          initialDate={day}
          timeZone={ZONE}
          headerToolbar={false}
          dayHeaders={false}
          allDaySlot={false}
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          slotDuration="00:30:00"
          slotLabelInterval="01:00:00"
          slotLabelFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          scrollTime="12:00:00"
          scrollTimeReset
          nowIndicator
          height="auto"
          datesSet={() => requestAnimationFrame(() => {
            const container = scroller.current;
            const noon = container?.querySelector<HTMLElement>('[data-time="12:00:00"]');
            if (container && noon) {
              container.scrollTop += noon.getBoundingClientRect().top - container.getBoundingClientRect().top - 1;
              container.scrollLeft = 0;
            }
          })}
          expandRows={false}
          editable={false}
          selectable={false}
          eventStartEditable={false}
          eventDurationEditable={false}
          eventMinHeight={22}
          eventShortHeight={54}
          slotEventOverlap={false}
          eventOrder="start,-duration,title"
          events={items}
          eventContent={renderEvent}
          eventClick={({ event }) => onOpen(event.id)}
          eventDidMount={({ el, event }) => {
            const props = event.extendedProps, source = props.sourceEvent as NightEvent;
            const label = `${source.title}, ${source.venueName}, ${props.durationLabel}${props.continued ? `, continues from ${props.startDateLabel}` : ''}. ${source.priceText || 'Price not confirmed'}.${!props.hasEnd ? ' One-hour display block only; actual end is unknown.' : ''}`;
            el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label', label); el.setAttribute('title', label); el.setAttribute('data-event-id', event.id);
            el.addEventListener('keydown', keyboard => {
              if (keyboard.key === 'Enter' || keyboard.key === ' ') { keyboard.preventDefault(); onOpen(event.id); }
            });
          }}
        />
      </div>
    </div>
  </section>;
}
