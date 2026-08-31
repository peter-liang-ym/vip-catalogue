/**
 * Filter_Panel (Requirements 6.1, 6.2, 6.5, 6.6, 6.11, 11.7, 11.8).
 *
 * Exactly four Filters — College, Major, Meeting day, Advisor — each a group of
 * checkboxes, one per selectable value, showing the value as the Dataset spells it
 * and the count of Teams that selecting it would leave in the Result_Set.
 *
 * The panel renders a `FacetView` and derives nothing itself. `facetView` already
 * decides which values each Filter offers and in what order (Requirements 6.1,
 * 6.2), which Major values the selected Colleges leave on offer (Requirement 6.6),
 * what each count promises (Requirement 6.5), and that a zero count is not
 * selectable (Requirement 6.11). Recomputing any of that here would be a second
 * definition of rules that are already tested without a DOM, so the panel's whole
 * job is to display those answers and report the visitor's edits.
 *
 * A zero count renders `disabled`, which is both the not-selectable rendering and
 * the reason selecting it cannot change the Result_Set (Requirement 6.11) —
 * nothing is committed, so nothing is derived. Deselecting stays available through
 * the selected-value indicators, which is where Requirement 6.9's remove control
 * lives.
 *
 * Accessibility falls out of using native controls: each checkbox carries a
 * `label` associated by `for`, naming the value and its count, inside a `fieldset`
 * whose `legend` names the Filter, so the label identifies the control's purpose
 * (Requirement 11.7); and `checked` on a checkbox is the selected state assistive
 * technology reads, so selecting and deselecting expose it without any ARIA of our
 * own (Requirement 11.8).
 *
 * Edits go through `addSelection` and `removeSelection` and out through
 * `onCommit`, the shell's discrete-change path: one history entry per Filter value
 * (Requirement 8.1). The page number is left alone — the Result_Set changes, and
 * `derive` resets the page for exactly that reason (Requirement 4.7) — and the
 * shell prunes Majors that a College change orphaned (Requirement 6.10).
 */

import type { FacetOption, FacetView } from '../facetView';
import { foldValue, type FilterName } from '../facets';
import { FILTER_PARAMS, type QueryState } from '../queryState';
import { addSelection, removeSelection } from '../selections';
import { FILTER_LABELS } from './SelectedValues';

export interface FilterPanelProps {
  /** The four Filters' values, counts, and selectability, from `derive`. */
  readonly facets: FacetView;
  readonly qs: QueryState;
  /** The shell's discrete-change commit: one new Query_State, one history entry. */
  readonly onCommit: (qs: QueryState) => void;
}

/** The panel's accessible name, naming what the group of Filters does. */
export const FILTER_PANEL_LABEL = 'Filter teams';

/** The value with its count, as the checkbox's label reads (Requirement 6.5). */
export function optionLabel(option: FacetOption): string {
  return `${option.value} (${option.count})`;
}

/** The `input` id its `label` points at; values within one Filter are distinct. */
function optionId(filter: FilterName, index: number): string {
  return `filter-${filter}-${index}`;
}

export function FilterPanel({ facets, qs, onCommit }: FilterPanelProps) {
  return (
    <section class="filter-panel" aria-label={FILTER_PANEL_LABEL}>
      {FILTER_PARAMS.map(filter => {
        const selected = new Set(qs.filters[filter].map(foldValue));

        return (
          <fieldset
            class="filter-panel__group"
            key={filter}
            data-filter={filter}
          >
            <legend class="filter-panel__legend">
              {FILTER_LABELS[filter]}
            </legend>

            <ul class="filter-panel__values">
              {facets[filter].map((option, index) => {
                const id = optionId(filter, index);
                const checked = selected.has(foldValue(option.value));

                return (
                  <li class="filter-panel__value" key={option.value}>
                    <input
                      id={id}
                      class="filter-panel__checkbox"
                      type="checkbox"
                      checked={checked}
                      disabled={!option.selectable}
                      onChange={event => {
                        const filters = event.currentTarget.checked
                          ? addSelection(qs.filters, filter, option.value)
                          : removeSelection(qs.filters, filter, option.value);
                        onCommit({ ...qs, filters });
                      }}
                    />
                    <label class="filter-panel__label" for={id}>
                      {optionLabel(option)}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </section>
  );
}
