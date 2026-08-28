/**
 * The hide-conflicts post-filter (Requirements 16.2, 16.3, 16.4).
 *
 * Hide-conflicts is not a fifth Filter: it has no values derived from the
 * Dataset and it depends on device state rather than Dataset content. It is a
 * post-filter applied after `applyFilters`, removing exactly the Teams whose
 * Conflict_State is `conflicting` and reporting how many it removed so the
 * Catalog_UI can display that count, zero included (Requirement 16.3).
 *
 * The two no-op cases — the toggle off, and the toggle on with no Busy_Schedule
 * loaded — share one code path returning the input and 0, which is how
 * Requirement 16.4 falls out rather than being special-cased.
 */

import type { ConflictMap } from './conflicts';
import type { ScoredTeam } from './search';

export interface HideConflictingResult {
  readonly kept: readonly ScoredTeam[];
  readonly removed: number;
}

/**
 * The Teams surviving the toggle, in the order they were given, and the count
 * removed. Match_Score and the name-hit flag pass through untouched: this only
 * removes Teams.
 *
 * A Team absent from the `ConflictMap` has no `conflicting` state to remove it,
 * so it is kept — the same treatment `clear` and `unknown` get (Requirement 16.2).
 */
export function hideConflicting(
  teams: readonly ScoredTeam[],
  conflicts: ConflictMap | null,
  hideConflicts: boolean,
): HideConflictingResult {
  if (!hideConflicts || conflicts === null) {
    return { kept: teams, removed: 0 };
  }

  const kept = teams.filter(
    scored => conflicts.get(scored.team.entryId) !== 'conflicting',
  );

  return { kept, removed: teams.length - kept.length };
}
