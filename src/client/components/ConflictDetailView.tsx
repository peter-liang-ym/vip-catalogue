/**
 * Conflict_Detail rendering for the Team_Detail_View
 * (Requirements 15.4, 15.5, 15.6, 11.11).
 *
 * The calendar half of Requirement 9.1: for a team whose Conflict_State is
 * `conflicting`, which of the visitor's Busy_Blocks the meeting lands on, each
 * with its weekday, its start and end clock times, and the calendar event
 * summaries that produced it. Everything shown is text, so the conflict and its
 * cause reach assistive technology the same way they reach a sighted visitor
 * (Requirement 11.11); nothing here depends on color.
 *
 * The component is presentational and derives nothing. `conflictDetail` decides
 * *which* blocks and summaries a team has — and reports none for a team that is
 * not conflicting, which is what makes "no schedule loaded, no Conflict_Detail"
 * (Requirement 15.7) the same code path as "loaded and clear". The caps are
 * applied again here against the shared constants rather than restated, because
 * Requirement 15.5 bounds what the Team_Detail_View *displays*, and this is the
 * component that displays it.
 */

import {
  MAX_CONFLICT_DETAIL_BLOCKS,
  MAX_CONFLICT_DETAIL_SUMMARIES,
  MINUTES_PER_DAY,
  type ConflictDetail,
} from '../../shared/types';

/**
 * The section heading. It states the Conflict_State in words (Requirements 15.4,
 * 11.11) and names whose calendar the blocks came from, since the section only
 * ever renders for a conflicting team.
 */
export const CONFLICT_DETAIL_HEADING =
  'Conflicting events in your loaded calendar';

/** Requirement 15.6: an empty event summary is stated, not left blank. */
export const UNTITLED_EVENT_TEXT = 'Calendar event with no title';

/** Joins a block's two clock times. Spelled out rather than dashed so it reads aloud. */
export const TIME_RANGE_SEPARATOR = ' to ';

/**
 * A minute of day as an Atlanta wall-clock time, e.g. `9:05 AM`.
 *
 * `1440` is a block's end-of-day bound and reads as `12:00 AM`, the midnight it
 * denotes; the modulo is what carries it there rather than to a 24th hour.
 */
export function formatClock(minute: number): string {
  const hour24 = Math.floor((minute % MINUTES_PER_DAY) / 60);
  const minutes = minute % 60;
  const meridiem = hour24 < 12 ? 'AM' : 'PM';

  return `${hour24 % 12 || 12}:${String(minutes).padStart(2, '0')} ${meridiem}`;
}

export interface ConflictDetailViewProps {
  /** From `conflictDetail`; no blocks whenever there is nothing to report. */
  readonly detail: ConflictDetail;
}

export function ConflictDetailView({ detail }: ConflictDetailViewProps) {
  const blocks = detail.blocks.slice(0, MAX_CONFLICT_DETAIL_BLOCKS);

  if (blocks.length === 0) return null;

  return (
    <section class="conflict-detail" data-testid="conflict-detail">
      <h2 class="conflict-detail__heading">{CONFLICT_DETAIL_HEADING}</h2>

      <ul class="conflict-detail__blocks">
        {blocks.map(({ block, summaries }) => (
          <li
            class="conflict-detail__block"
            key={`${block.weekday}:${block.startMinute}:${block.endMinute}`}
          >
            <p class="conflict-detail__when">
              <span class="conflict-detail__weekday">{block.weekday}</span>{' '}
              <span class="conflict-detail__times">
                {formatClock(block.startMinute)}
                {TIME_RANGE_SEPARATOR}
                {formatClock(block.endMinute)}
              </span>
            </p>

            {summaries.length > 0 && (
              <ul class="conflict-detail__summaries">
                {summaries
                  .slice(0, MAX_CONFLICT_DETAIL_SUMMARIES)
                  .map((summary, i) => (
                    <li class="conflict-detail__summary" key={i}>
                      {summary === '' ? UNTITLED_EVENT_TEXT : summary}
                    </li>
                  ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
