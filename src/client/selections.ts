/**
 * Filter selection mutators (Requirements 6.7, 6.9, 16.6).
 *
 * Every visitor interaction with the Filter_Panel is one of three edits: add a
 * value, remove a single value, or clear everything. They live here as pure
 * functions over `FilterSelections` so the isolation claims — removing one value
 * touches no other value and no other Filter — are properties of the data
 * transformation rather than of the components that call it.
 *
 * Comparison goes through `foldValue`, the same folding the facet derivation and
 * `applyFilters` use, so a value added under one spelling is recognized as already
 * selected under any other spelling of it.
 */

import { foldValue, type FilterName, type FilterSelections } from './facets';

/** No value selected in any of the four Filters (Requirement 6.7). */
export const EMPTY_SELECTIONS: FilterSelections = {
  college: [],
  major: [],
  day: [],
  advisor: [],
};

/**
 * The same selections with `value` selected in `filter`, appended so order within
 * a Filter follows the order the visitor selected in. A value already selected
 * under any spelling of it is left alone, keeping selections deduped, and every
 * other Filter is returned untouched.
 */
export function addSelection(
  sel: FilterSelections,
  filter: FilterName,
  value: string,
): FilterSelections {
  const folded = foldValue(value);
  if (sel[filter].some(selected => foldValue(selected) === folded)) return sel;

  return { ...sel, [filter]: [...sel[filter], value] };
}

/**
 * The same selections with exactly `value` deselected in `filter`
 * (Requirement 6.9). Every other selected value of that Filter, and every other
 * Filter's selections, are retained; the Search_Query is not this function's to
 * touch and is retained by construction.
 */
export function removeSelection(
  sel: FilterSelections,
  filter: FilterName,
  value: string,
): FilterSelections {
  const folded = foldValue(value);
  const kept = sel[filter].filter(selected => foldValue(selected) !== folded);

  return kept.length === sel[filter].length ? sel : { ...sel, [filter]: kept };
}

/** Deselects every value in every Filter (Requirement 6.7). */
export function clearAllSelections(): FilterSelections {
  return EMPTY_SELECTIONS;
}

/**
 * The Query_State fields clear-all resets: an empty Search_Query, no selected
 * Filter values (Requirement 6.7), and the hide-conflicts toggle off
 * (Requirement 16.6). Spread over the current Query_State by the clear-all
 * handler, so the fields clear-all is silent about — the Sort_Option and the page
 * size — survive, and the page number is reset by the Result_Set change rather
 * than from here.
 *
 * Requirement 16.6 also has clear-all retain the loaded Busy_Schedule and every
 * Conflict_State. Nothing here can violate that: the Busy_Schedule lives outside
 * Query_State entirely, so resetting the toggle is the only calendar-adjacent
 * effect clear-all has.
 */
export const CLEAR_ALL_RESET = {
  query: '',
  filters: EMPTY_SELECTIONS,
  hideConflicts: false,
} as const;
