/**
 * Conflict_Detail for a conflicting team (Requirements 15.5, 15.6).
 *
 * Answers "which of my calendar blocks does this meeting land on, and what put
 * them there" for the Team_Detail_View. Everything is bounded so a pathological
 * calendar cannot turn one team page into a wall of text: at most 5 blocks, at
 * most 5 summaries each, each summary at most 200 characters.
 *
 * Empty summaries are kept as `''` rather than dropped or substituted here: the
 * view renders them as the no-title text (Requirement 15.6), and a block whose
 * only contributing event had no title still has to be reported.
 */

import {
  MAX_CONFLICT_DETAIL_BLOCKS,
  MAX_CONFLICT_DETAIL_SUMMARIES,
  MAX_SHORT_TEXT_LENGTH,
  WEEKDAYS,
  type BusyBlock,
  type BusySchedule,
  type ConflictDetail,
  type MeetingWindow,
  type Weekday,
} from '../shared/types';
import { classifyTeam, overlaps } from './conflicts';

const weekdayRank = new Map<Weekday, number>(
  WEEKDAYS.map((weekday, index) => [weekday, index]),
);

/** Canonical block order: weekday Monday..Sunday, then `startMinute` ascending. */
function byCanonicalOrder(a: BusyBlock, b: BusyBlock): number {
  return (
    (weekdayRank.get(a.weekday) ?? WEEKDAYS.length) -
      (weekdayRank.get(b.weekday) ?? WEEKDAYS.length) ||
    a.startMinute - b.startMinute ||
    a.endMinute - b.endMinute
  );
}

/**
 * The overlapping Busy_Blocks behind a team's conflict, capped and ordered.
 *
 * Returns no blocks for a team whose Conflict_State is not `conflicting`, which
 * covers both the unavailable Meeting_Window (`unknown`) and a window that
 * overlaps nothing (`clear`) — there is nothing to detail in either case.
 *
 * A Busy_Schedule already holds its blocks in canonical order, but the sort is
 * applied anyway so the cap always keeps the same 5 blocks regardless of how the
 * caller ordered them.
 */
export function conflictDetail(
  window: MeetingWindow,
  schedule: BusySchedule,
): ConflictDetail {
  if (classifyTeam(window, schedule) !== 'conflicting') return { blocks: [] };

  const entries = window ?? [];
  const overlapping = schedule.blocks.filter(block =>
    entries.some(
      entry => entry.weekday === block.weekday && overlaps(entry, block),
    ),
  );

  return {
    blocks: [...overlapping]
      .sort(byCanonicalOrder)
      .slice(0, MAX_CONFLICT_DETAIL_BLOCKS)
      .map(block => ({
        block,
        summaries: block.summaries
          .slice(0, MAX_CONFLICT_DETAIL_SUMMARIES)
          .map(summary => summary.slice(0, MAX_SHORT_TEXT_LENGTH)),
      })),
  };
}
