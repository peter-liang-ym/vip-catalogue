/**
 * Selected-value indicators and the clear-all control
 * (Requirements 5.6, 6.7, 6.8, 6.9, 16.6, 16.7).
 *
 * One indicator per selected Filter value, above the listing, each naming its
 * Filter, showing the value as the Dataset spells it, and carrying the control
 * that removes that one value. The clear-all control sits beside them and is
 * displayed whenever anything is narrowing the listing: a Search_Query with at
 * least one non-whitespace character, at least one selected Filter value, or the
 * hide-conflicts toggle on (Requirements 5.6, 16.7). When none of those holds
 * there is nothing to indicate and nothing to clear, so the component renders
 * nothing at all.
 *
 * The edits themselves are `removeSelection` and `CLEAR_ALL_RESET` from
 * `selections.ts`: this component decides *when* a control shows and *which*
 * value it names, never what an edit means. That keeps Requirement 6.9's
 * isolation claim and Requirement 6.7's reset a property of the mutators, tested
 * without a DOM, and leaves one definition of each rather than two.
 *
 * The next Query_State goes out through `onCommit`, the shell's discrete-change
 * path, which is what gives each removal and the clear-all its own history entry
 * and its own address (Requirement 8.1). The page number is left as it is: the
 * Result_Set changes, and `derive` resets the page for exactly that reason
 * (Requirement 4.7).
 */

import type { FilterName } from '../facets';
import { FILTER_PARAMS, type QueryState } from '../queryState';
import { CLEAR_ALL_RESET, removeSelection } from '../selections';

/**
 * How each Filter is named to the visitor (Requirement 6.8). The same wording the
 * Filter_Panel heads its groups with, so an indicator points back at the control
 * the value came from.
 */
export const FILTER_LABELS: Readonly<Record<FilterName, string>> = {
  college: 'College',
  major: 'Major',
  day: 'Meeting day',
  advisor: 'Advisor',
};

/** The clear-all control's accessible name (Requirements 5.6, 6.7). */
export const CLEAR_ALL_LABEL = 'Clear search and filters';

export interface SelectedValuesProps {
  readonly qs: QueryState;
  /** The shell's discrete-change commit: one new Query_State, one history entry. */
  readonly onCommit: (qs: QueryState) => void;
}

/**
 * Whether anything is narrowing the listing, and so whether the clear-all control
 * is displayed (Requirements 5.6, 16.7). A Search_Query of nothing but whitespace
 * narrows nothing — the Search_Engine returns every Team for it — so it does not
 * count.
 */
export function isNarrowed(qs: QueryState): boolean {
  return (
    qs.query.trim() !== '' ||
    qs.hideConflicts ||
    FILTER_PARAMS.some(filter => qs.filters[filter].length > 0)
  );
}

export function SelectedValues({ qs, onCommit }: SelectedValuesProps) {
  const selected = FILTER_PARAMS.flatMap(filter =>
    qs.filters[filter].map(value => ({ filter, value })),
  );

  if (!isNarrowed(qs)) return null;

  return (
    <div class="selected-values" data-testid="selected-values">
      {selected.length > 0 && (
        <ul class="selected-values__list">
          {selected.map(({ filter, value }) => (
            <li
              class="selected-values__item"
              key={`${filter}:${value}`}
              data-filter={filter}
            >
              <span class="selected-values__filter">
                {FILTER_LABELS[filter]}
              </span>{' '}
              <span class="selected-values__value">{value}</span>{' '}
              <button
                class="selected-values__remove"
                type="button"
                aria-label={`Remove ${FILTER_LABELS[filter]} ${value}`}
                onClick={() =>
                  onCommit({
                    ...qs,
                    filters: removeSelection(qs.filters, filter, value),
                  })
                }
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        class="selected-values__clear"
        type="button"
        onClick={() => onCommit({ ...qs, ...CLEAR_ALL_RESET })}
      >
        {CLEAR_ALL_LABEL}
      </button>
    </div>
  );
}
