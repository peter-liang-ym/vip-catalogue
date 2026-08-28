/**
 * Derived view composition (Requirements 4.1, 4.6, 4.7, 4.9, 5.7, 12.9, 15.9,
 * 16.8, 16.9).
 *
 * `derive` is the one place search, filtering, the hide-conflicts post-filter,
 * sorting, page clamping, slicing, and facet counting compose, in that order:
 *
 *   search -> facet filters -> hide-conflicts -> sort -> clamp -> slice
 *
 * Composing once here is what makes those rules testable without a DOM, and it is
 * what keeps a recompute honest: nothing in this function writes to `QueryState`,
 * so loading, replacing, or removing a Busy_Schedule leaves the Search_Query, the
 * selected Filter values, the Sort_Option, and the page size exactly as they were
 * (Requirement 15.9).
 *
 * The Busy_Schedule arrives as its own argument rather than as a field of
 * `QueryState` because it is device state, not shared state: the same link must
 * derive correctly for a visitor with a different calendar or none at all, and
 * Requirement 8.9 forbids encoding it. Passing `null` reproduces the pre-calendar
 * behavior exactly.
 */

import type { BusySchedule } from '../shared/types';
import { classifyAll, type ConflictMap } from './conflicts';
import { facetView, type FacetView } from './facetView';
import { applyFilters } from './filters';
import { hideConflicting } from './hideConflicting';
import {
  clampPage,
  DEFAULT_PAGE_NUMBER,
  pageCount,
  pageSlice,
} from './paginate';
import type { QueryState } from './queryState';
import { search, type ScoredTeam, type SearchIndex } from './search';
import { effectiveSort, sortResults } from './sort';

/**
 * Why the Result_Set holds no Teams, distinguishing the two empty states that
 * Requirements 16.8 and 16.9 give different messages: `allConflict` when the
 * hide-conflicts toggle removed everything that matched, `noMatch` otherwise
 * (Requirement 5.7). `none` is the non-empty case.
 */
export type EmptyReason = 'none' | 'noMatch' | 'allConflict';

export interface DerivedView {
  /** Searched, filtered, post-filtered, and sorted. */
  readonly resultSet: readonly ScoredTeam[];
  /** The current page slice of `resultSet` (Requirement 4.5). */
  readonly page: readonly ScoredTeam[];
  /** The page actually shown: `qs.pageNumber` clamped into range (Requirement 4.6). */
  readonly pageNumber: number;
  /** Pages available for this Result_Set, at least 1 (Requirement 4.8). */
  readonly pageCount: number;
  /** Teams in the Result_Set (Requirement 4.1). */
  readonly totalCount: number;
  readonly facets: FacetView;
  /** `null` whenever no Busy_Schedule is loaded (Requirement 15.7). */
  readonly conflicts: ConflictMap | null;
  /** Teams the hide-conflicts toggle removed; 0 when off (Requirement 16.3). */
  readonly hiddenByToggle: number;
  readonly emptyReason: EmptyReason;
}

/**
 * Conflict_States per `(Dataset, Busy_Schedule)` pair.
 *
 * Requirement 15.8 recomputes every Team's Conflict_State on load, replacement,
 * and removal, and Requirement 12.9 gives that recompute a 300 ms budget for 500
 * Teams and 100 Busy_Blocks — but `derive` runs again on every keystroke, Filter
 * change, sort, and page step with the same pair, so the classification is
 * computed once per pair and reused. Both keys are held weakly: a replaced
 * Busy_Schedule or a reloaded Dataset is a new object, and its entry goes with it.
 *
 * `SearchIndex` stands in for the Dataset it was built from, since exactly one
 * index is built per Dataset.
 */
const conflictCache = new WeakMap<
  SearchIndex,
  WeakMap<BusySchedule, ConflictMap | null>
>();

function conflictsFor(
  index: SearchIndex,
  busy: BusySchedule | null,
): ConflictMap | null {
  if (busy === null) return null;

  let perSchedule = conflictCache.get(index);
  if (perSchedule === undefined) {
    perSchedule = new WeakMap();
    conflictCache.set(index, perSchedule);
  }

  let states = perSchedule.get(busy);
  if (states === undefined) {
    states = classifyAll(index.teams, busy);
    perSchedule.set(busy, states);
  }

  return states;
}

/**
 * Whether two Result_Sets are the same list of Teams in the same order.
 *
 * Identity is the ordered `entryId` sequence rather than object identity, because
 * every derivation builds fresh `ScoredTeam` objects: a re-derivation that
 * happens to produce the same list is not a change, while a re-sort of the same
 * Teams is.
 */
function sameResultSet(
  a: readonly ScoredTeam[],
  b: readonly ScoredTeam[],
): boolean {
  return (
    a.length === b.length &&
    a.every((scored, i) => scored.team.entryId === b[i]?.team.entryId)
  );
}

/**
 * The whole derived view for one `Query_State` over one `Dataset` and one
 * `Busy_Schedule`.
 *
 * `previous` is the view this one replaces, and it exists for Requirement 4.7:
 * when the Result_Set changes, the current page number returns to 1. Deciding
 * that here means every interaction that changes the Result_Set — a Search_Query
 * edit, a Filter selection, the hide-conflicts toggle — gets the reset from one
 * rule instead of each mutator remembering it, and it also covers a Result_Set
 * that changed without the Query_State changing, which is what a loaded or
 * removed Busy_Schedule does while the toggle is on. Requirement 4.9's reset on a
 * page-size change is not a Result_Set change and belongs to the caller.
 *
 * Omitting `previous` is the first derivation, where `qs.pageNumber` is honored
 * as given, clamped into range.
 */
export function derive(
  index: SearchIndex,
  qs: QueryState,
  busy: BusySchedule | null,
  previous: DerivedView | null = null,
): DerivedView {
  const conflicts = conflictsFor(index, busy);

  const matched = applyFilters(search(index, qs.query), qs.filters);
  const { kept, removed } = hideConflicting(
    matched,
    conflicts,
    qs.hideConflicts,
  );

  const resultSet = sortResults(
    kept,
    effectiveSort(qs.sort, qs.query),
    qs.query,
    conflicts,
  );

  const totalCount = resultSet.length;
  const count = pageCount(totalCount, qs.pageSize);
  const requested =
    previous !== null && !sameResultSet(previous.resultSet, resultSet)
      ? DEFAULT_PAGE_NUMBER
      : qs.pageNumber;
  const pageNumber = clampPage(requested, count);

  return {
    resultSet,
    page: pageSlice(resultSet, pageNumber, qs.pageSize),
    pageNumber,
    pageCount: count,
    totalCount,
    facets: facetView(index, qs, conflicts),
    conflicts,
    hiddenByToggle: removed,
    emptyReason:
      totalCount > 0 ? 'none' : removed > 0 ? 'allConflict' : 'noMatch',
  };
}
