/**
 * Facet counts and selectability (Requirements 6.5, 6.11).
 *
 * A count is a promise: it says how large the Result_Set would be if the visitor
 * added that one value to the current selections. So it is computed by actually
 * making that Result_Set — the current Search_Query, every other Filter's
 * selections, this Filter's selections plus the candidate value, and the
 * hide-conflicts post-filter — rather than by tallying Dataset occurrences, which
 * would over-promise the moment any of those were in play.
 *
 * Adding a value to its own Filter widens that Filter (values inside one Filter
 * are OR-ed), so a count is never smaller than the current Result_Set, and a
 * value that is already selected reports exactly the current Result_Set size,
 * since adding it changes nothing.
 *
 * A count of zero marks the value not selectable (Requirement 6.11); the
 * Catalog_UI has nothing further to decide, and selecting such a value is a no-op
 * because the Result_Set it would produce is the one that was just measured as
 * empty.
 */

import type { ConflictMap } from './conflicts';
import { foldValue, type FilterName, type FilterSelections } from './facets';
import { applyFilters } from './filters';
import { hideConflicting } from './hideConflicting';
import { selectableMajors } from './majors';
import type { QueryState } from './queryState';
import { search, type SearchIndex } from './search';

export interface FacetOption {
  readonly value: string;
  /** The size of the Result_Set adding this value would produce. */
  readonly count: number;
  /** `false` for exactly the zero counts (Requirement 6.11). */
  readonly selectable: boolean;
}

export type FacetView = {
  readonly [K in FilterName]: readonly FacetOption[];
};

/** A mutable view of the selections, used only while building a candidate. */
type MutableSelections = {
  -readonly [K in FilterName]: readonly string[];
};

/**
 * `sel` with `value` added to `filter`, or `sel` itself when that Filter already
 * holds the value — comparing folded, since that is the comparison `applyFilters`
 * makes, so a differently spelled duplicate is not appended.
 */
function withValue(
  sel: FilterSelections,
  filter: FilterName,
  value: string,
): FilterSelections {
  const folded = foldValue(value);
  if (sel[filter].some(selected => foldValue(selected) === folded)) return sel;

  const next: MutableSelections = { ...sel };
  next[filter] = [...sel[filter], value];

  return next;
}

/**
 * The count and selectability of every value the Filter_Panel offers, for all
 * four Filters.
 *
 * The offered Major values follow the selected Colleges (Requirement 6.6); the
 * other three Filters offer the values derived from the whole Dataset
 * (Requirement 6.2). `conflicts` is the same `ConflictMap` the Result_Set is
 * derived with, `null` when no Busy_Schedule is loaded, which together with
 * `qs.hideConflicts` decides whether the post-filter narrows the counts at all.
 */
export function facetView(
  index: SearchIndex,
  qs: QueryState,
  conflicts: ConflictMap | null,
): FacetView {
  // The Search_Query is fixed across every candidate, so it is applied once.
  const matched = search(index, qs.query);

  const resultTotal = (sel: FilterSelections): number =>
    hideConflicting(applyFilters(matched, sel), conflicts, qs.hideConflicts)
      .kept.length;

  const options = (
    filter: FilterName,
    values: readonly string[],
  ): readonly FacetOption[] =>
    values.map(value => {
      const count = resultTotal(withValue(qs.filters, filter, value));
      return { value, count, selectable: count > 0 };
    });

  const { college, day, advisor } = index.facetValues;

  return {
    college: options('college', college),
    major: options('major', selectableMajors(index, qs.filters.college)),
    day: options('day', day),
    advisor: options('advisor', advisor),
  };
}
