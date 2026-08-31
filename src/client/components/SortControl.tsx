/**
 * The Sort_Option control (Requirements 7.1, 7.2, 7.4, 11.7).
 *
 * One `select` holding exactly the four Sort_Options of Requirement 7.1, which a
 * `select` makes mutually exclusive by construction: one value is chosen at a
 * time, and that value is the option applied to the Result_Set.
 *
 * The chosen value is `effectiveSort`, not `qs.sort`, so the control shows the
 * option actually in force rather than the absence of a selection — with no
 * selection made that is name ascending for an empty Search_Query and relevance
 * for a non-empty one (Requirements 7.3, 7.8). The resolution lives in
 * `src/client/sort.ts`; this component only displays its answer.
 *
 * No option is ever disabled or withheld (Requirement 7.4). `relevance` is
 * offered with an empty query and `conflict-free` with no Busy_Schedule loaded,
 * because both remain the selected option and order by name in those cases
 * (Requirements 7.9, 7.11) — which is also why this component takes no calendar
 * state at all: there is nothing about the Busy_Schedule it could need to know.
 *
 * A change commits the new Sort_Option with the page number set back to 1 and the
 * Search_Query and the selected Filter values carried through untouched, which is
 * the whole of Requirement 7.2's accompanying state change.
 */

import { DEFAULT_PAGE_NUMBER } from '../paginate';
import type { QueryState } from '../queryState';
import { effectiveSort, SORT_OPTIONS, type SortOption } from '../sort';

/**
 * The visitor-facing name of each Sort_Option. Exported so a test names an option
 * the same way the control does.
 */
export const SORT_LABELS: Readonly<Record<SortOption, string>> = {
  'name-asc': 'Team name (A–Z)',
  'name-desc': 'Team name (Z–A)',
  relevance: 'Search relevance',
  'conflict-free': 'Conflict-free first',
};

/** The label identifying the control's purpose (Requirement 11.7). */
export const SORT_CONTROL_LABEL = 'Sort teams by';

/** The `select` id the label points at; the listing renders one sort control. */
export const SORT_CONTROL_ID = 'sort-control';

export interface SortControlProps {
  readonly qs: QueryState;
  /** Applies a discrete Query_State change, one history entry (Requirement 8.1). */
  readonly onCommit: (qs: QueryState) => void;
}

export function SortControl({ qs, onCommit }: SortControlProps) {
  const applied = effectiveSort(qs.sort, qs.query);

  return (
    <div class="sort-control">
      {/* Requirement 11.7: a visible label, associated by `for`, naming what the
          control does. */}
      <label class="sort-control__label" for={SORT_CONTROL_ID}>
        {SORT_CONTROL_LABEL}
      </label>
      <select
        id={SORT_CONTROL_ID}
        class="sort-control__select"
        value={applied}
        onChange={event => {
          // The options rendered are exactly `SORT_OPTIONS`, so the value chosen
          // is one of them.
          const sort = event.currentTarget.value as SortOption;
          onCommit({ ...qs, sort, pageNumber: DEFAULT_PAGE_NUMBER });
        }}
      >
        {SORT_OPTIONS.map(option => (
          <option key={option} value={option}>
            {SORT_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
