/**
 * Conflict classifier (Requirements 15.1, 15.2, 15.3, 15.7, 15.8).
 *
 * Pure and total: one team's Meeting_Window plus a Busy_Schedule map to exactly
 * one Conflict_State, and the whole Dataset maps to one Conflict_State per
 * `entryId`. Nothing here reads the Search_Query, the selected Filter values, the
 * Sort_Option, or the page size, which is what makes a recompute on load,
 * replacement, or removal leave all of them untouched (Requirements 15.8, 15.9).
 *
 * The strict overlap predicate is named on its own because the `<` versus `<=`
 * decision it encodes is the whole of Requirement 15.3.
 */

import type {
  BusySchedule,
  ConflictState,
  MeetingWindow,
  TeamRecord,
} from '../shared/types';

/**
 * Conflict_States keyed by `entryId`. `null` — not an empty map — is the
 * no-schedule case, so consumers can tell "nothing is loaded" from "loaded, and
 * this Dataset happens to be empty" (Requirement 15.7).
 */
export type ConflictMap = ReadonlyMap<string, ConflictState>;

/**
 * Whether two same-weekday minute intervals intersect: strict interval
 * intersection over half-open `[startMinute, endMinute)` (Requirement 15.2).
 *
 * Touching endpoints never overlap (Requirement 15.3): a class ending at 10:20
 * and a meeting starting at 10:20 share no minute. Empty or inverted intervals
 * overlap nothing, which falls out of the same two comparisons.
 */
export function overlaps(
  a: { readonly startMinute: number; readonly endMinute: number },
  b: { readonly startMinute: number; readonly endMinute: number },
): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/**
 * The one Conflict_State for a team (Requirement 15.1).
 *
 * `unknown` is exactly the unavailable Meeting_Window, `conflicting` is at least
 * one entry overlapping at least one Busy_Block of the same weekday, and `clear`
 * is a window with entries none of which overlaps. The three cases are
 * exhaustive and mutually exclusive by construction.
 *
 * With no schedule loaded a team still has no state to show; callers reach that
 * case through `classifyAll` returning `null` rather than by asking here, so a
 * `null` schedule is treated as an empty one: a window with entries is `clear`.
 */
export function classifyTeam(
  window: MeetingWindow,
  schedule: BusySchedule | null,
): ConflictState {
  if (window === null) return 'unknown';

  const blocks = schedule?.blocks ?? [];
  for (const entry of window) {
    for (const block of blocks) {
      if (block.weekday === entry.weekday && overlaps(entry, block)) {
        return 'conflicting';
      }
    }
  }

  return 'clear';
}

/**
 * Every team's Conflict_State keyed by `entryId`, or `null` when no
 * Busy_Schedule is loaded (Requirement 15.7). `null` in, `null` out.
 */
export function classifyAll(
  teams: readonly TeamRecord[],
  schedule: BusySchedule | null,
): ConflictMap | null {
  if (schedule === null) return null;

  const states = new Map<string, ConflictState>();
  for (const team of teams) {
    states.set(team.entryId, classifyTeam(team.meetingWindow, schedule));
  }

  return states;
}
