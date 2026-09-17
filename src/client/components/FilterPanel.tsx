/**
 * Filter_Panel (Requirements 19.1–19.7, 19.9, 6.1, 6.2, 6.5, 6.6, 6.11, 11.7,
 * 11.8, 11.13, 11.14).
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
 * What this component *does* own is how much of that answer is on screen at once.
 * Advisor and Major run to hundreds of values, so each Filter sits in its own
 * disclosure: a `button` in the group's `legend` carrying `aria-expanded` and
 * `aria-controls`, naming the Filter and the count of its values currently
 * selected (Requirements 19.1, 19.2, 11.13). College and Meeting day open;
 * Major and Advisor closed, since those two are the long ones. An expanded group
 * displays at most `VALUE_CAP` unselected values with a control that reveals the
 * rest and states how many are not displayed (Requirement 19.3), and Major and
 * Advisor each carry a Value_Filter that narrows the displayed values only
 * (Requirement 19.4), with a message when it matches none (Requirement 19.5).
 *
 * Selected values are exempt from both the cap and the Value_Filter, and are
 * displayed even while the group is collapsed (Requirements 19.2, 19.6): a checked
 * checkbox is the control that deselects it (Requirement 6.9), so a selection the
 * cap or the Value_Filter hid would be a selection the visitor could not remove
 * here.
 *
 * None of that presentation state is Query_State. Which disclosures are open,
 * which groups have been revealed past the cap, and each Value_Filter's text are
 * component-local: they describe how one visitor is reading the panel, not which
 * Teams the panel is asking for, so they reach neither the codec nor the address
 * bar (Requirement 19.9), and — the part that matters more — they are not inputs
 * to `derive`. The Result_Set, its ordering, the page slice, and the counts are
 * whatever `facetView` and `derive` already produced, so a Value_Filter cannot
 * change any of them (Requirement 19.4).
 *
 * Requirement 19.7 is the one coupling to the rest of the page: clear-all empties
 * every Value_Filter. Clear-all is not this component's control — it lives with the
 * selected-value indicators and in the empty state — so what is observed here is
 * its result, the Query_State that narrows nothing at all, which is exactly what
 * `isNarrowed` names.
 *
 * A zero count renders `disabled`, which is both the not-selectable rendering and
 * the reason selecting it cannot change the Result_Set (Requirement 6.11) —
 * nothing is committed, so nothing is derived.
 *
 * Accessibility falls out of using native controls: each checkbox carries a
 * `label` associated by `for`, naming the value and its count, inside a `fieldset`
 * whose `legend` names the Filter, so the label identifies the control's purpose
 * (Requirement 11.7); `checked` on a checkbox is the selected state assistive
 * technology reads, so selecting and deselecting expose it without any ARIA of our
 * own (Requirement 11.8); and the disclosure control is a `button`, so it is
 * reachable and activatable from the keyboard and keeps focus when it collapses
 * its own group (Requirements 11.13, 11.14).
 *
 * Edits go through `addSelection` and `removeSelection` and out through
 * `onCommit`, the shell's discrete-change path: one history entry per Filter value
 * (Requirement 8.1). The page number is left alone — the Result_Set changes, and
 * `derive` resets the page for exactly that reason (Requirement 4.7) — and the
 * shell prunes Majors that a College change orphaned (Requirement 6.10).
 */

import { useEffect, useState } from 'preact/hooks';
import type { FacetOption, FacetView } from '../facetView';
import { foldValue, type FilterName } from '../facets';
import { FILTER_PARAMS, type QueryState } from '../queryState';
import { addSelection, removeSelection } from '../selections';
import { FILTER_LABELS, isNarrowed } from './SelectedValues';

export interface FilterPanelProps {
  /** The four Filters' values, counts, and selectability, from `derive`. */
  readonly facets: FacetView;
  readonly qs: QueryState;
  /** The shell's discrete-change commit: one new Query_State, one history entry. */
  readonly onCommit: (qs: QueryState) => void;
}

/** The panel's accessible name, naming what the group of Filters does. */
export const FILTER_PANEL_LABEL = 'Filter teams';

/**
 * The most unselected values an expanded Filter displays before the reveal
 * control (Requirement 19.3). Selected values are counted separately, since
 * Requirement 19.6 exempts them.
 */
export const VALUE_CAP = 8;

/** Which disclosures are open before the visitor has touched any (Requirement 19.1). */
export const DEFAULT_EXPANDED: Readonly<Record<FilterName, boolean>> = {
  college: true,
  major: false,
  day: true,
  advisor: false,
};

/** The two Filters that carry a Value_Filter, and no others (Requirement 19.4). */
export const VALUE_FILTER_FILTERS = ['major', 'advisor'] as const;

type ValueFilterName = (typeof VALUE_FILTER_FILTERS)[number];

/** Every Value_Filter empty: the initial text, and what clear-all restores (19.7). */
const EMPTY_VALUE_FILTERS: Readonly<Record<ValueFilterName, string>> = {
  major: '',
  advisor: '',
};

const NO_REVEALS: Readonly<Record<FilterName, boolean>> = {
  college: false,
  major: false,
  day: false,
  advisor: false,
};

function hasValueFilter(filter: FilterName): filter is ValueFilterName {
  return filter === 'major' || filter === 'advisor';
}

/** The count as it reads beside its value (Requirement 6.5). */
export function countText(count: number): string {
  return `(${count})`;
}

/** The value with its count, as the checkbox's label reads (Requirement 6.5). */
export function optionLabel(option: FacetOption): string {
  return `${option.value} ${countText(option.count)}`;
}

/**
 * The selected count as the disclosure control states it, including zero
 * (Requirement 19.2).
 */
export function selectedCountText(count: number): string {
  return `${count} selected`;
}

/**
 * The disclosure control's accessible name: the Filter it controls and how many of
 * its values are selected (Requirements 19.2, 11.13).
 */
export function toggleLabel(filter: FilterName, selected: number): string {
  return `${FILTER_LABELS[filter]} ${selectedCountText(selected)}`;
}

/** The reveal control, stating the count of values not displayed (Requirement 19.3). */
export function revealText(hidden: number): string {
  return `Show ${hidden} more`;
}

/** The Value_Filter's label (Requirements 19.4, 11.7). */
export function valueFilterLabel(filter: FilterName): string {
  return `Filter ${FILTER_LABELS[filter]} values`;
}

/** The message shown when a Value_Filter matches no value (Requirement 19.5). */
export function noMatchText(filter: FilterName): string {
  return `No ${FILTER_LABELS[filter]} values match that text.`;
}

/**
 * Whether a value is displayed under a Value_Filter: it contains the text as a
 * substring, ignoring letter case (Requirement 19.4). The text is compared as
 * typed — not trimmed — because the requirement is a substring test, and a space
 * is a character values can genuinely contain.
 */
export function matchesValueFilter(value: string, text: string): boolean {
  return value.toLowerCase().includes(text.toLowerCase());
}

/** The `input` id its `label` points at; values within one Filter are distinct. */
function optionId(filter: FilterName, index: number): string {
  return `filter-${filter}-${index}`;
}

/** The id the disclosure control's `aria-controls` names. */
function bodyId(filter: FilterName): string {
  return `filter-${filter}-values`;
}

function valueFilterId(filter: FilterName): string {
  return `filter-${filter}-value-filter`;
}

export function FilterPanel({ facets, qs, onCommit }: FilterPanelProps) {
  const [expanded, setExpanded] = useState(DEFAULT_EXPANDED);
  const [revealed, setRevealed] = useState(NO_REVEALS);
  const [valueFilters, setValueFilters] = useState(EMPTY_VALUE_FILTERS);

  /*
   * Requirement 19.7. Clear-all is the transition to a Query_State that narrows
   * nothing, so that is what is watched; the effect depends on the boolean alone,
   * so typing into a Value_Filter while nothing is narrowed does not re-run it and
   * cannot wipe what is being typed.
   */
  const narrowed = isNarrowed(qs);
  useEffect(() => {
    if (!narrowed) setValueFilters(EMPTY_VALUE_FILTERS);
  }, [narrowed]);

  return (
    <section class="filter-panel" aria-label={FILTER_PANEL_LABEL}>
      {FILTER_PARAMS.map(filter => {
        const options = facets[filter];
        const selected = new Set(qs.filters[filter].map(foldValue));
        const isSelected = (option: FacetOption) =>
          selected.has(foldValue(option.value));

        const text = hasValueFilter(filter) ? valueFilters[filter] : '';
        const matching =
          text === ''
            ? options
            : options.filter(option => matchesValueFilter(option.value, text));

        // The cap counts unselected values only: Requirement 19.6 keeps every
        // selected value on screen regardless of it.
        const unselected = matching.filter(option => !isSelected(option));
        const shownCount = revealed[filter]
          ? unselected.length
          : Math.min(VALUE_CAP, unselected.length);
        const hidden = unselected.length - shownCount;
        const shown = new Set(
          unselected.slice(0, shownCount).map(option => option.value),
        );

        const open = expanded[filter];
        const displayed = options
          .map((option, index) => ({ option, index }))
          .filter(
            ({ option }) =>
              isSelected(option) || (open && shown.has(option.value)),
          );

        return (
          <fieldset
            class="filter-panel__group"
            key={filter}
            data-filter={filter}
          >
            <legend class="filter-panel__legend">
              {/* Requirements 19.1, 19.2, 11.13: the disclosure control names the
                  group it controls and how many of its values are selected, and
                  exposes the group's state through `aria-expanded`. */}
              <button
                class="filter-panel__toggle"
                type="button"
                aria-expanded={open}
                aria-controls={bodyId(filter)}
                onClick={() =>
                  setExpanded(current => ({
                    ...current,
                    [filter]: !current[filter],
                  }))
                }
              >
                <span class="filter-panel__filter-name">
                  {FILTER_LABELS[filter]}
                </span>{' '}
                <span class="filter-panel__selected-count numeric">
                  {selectedCountText(qs.filters[filter].length)}
                </span>
              </button>
            </legend>

            {/*
              The body holds what the disclosure controls. It stays in the
              document while collapsed rather than being `hidden`, because a
              collapsed group still displays its selected values and nothing else
              (Requirements 19.2, 19.6) — the checkbox that deselects a value has
              to be reachable whether or not the group is open.
            */}
            <div class="filter-panel__body" id={bodyId(filter)}>
              {/* Requirement 19.4: a Value_Filter on Major and Advisor, on no
                  other Filter, narrowing the displayed values only. */}
              {open && hasValueFilter(filter) && (
                <div class="filter-panel__value-filter">
                  <label
                    class="filter-panel__value-filter-label"
                    for={valueFilterId(filter)}
                  >
                    {valueFilterLabel(filter)}
                  </label>
                  <input
                    id={valueFilterId(filter)}
                    class="filter-panel__value-filter-input"
                    type="search"
                    value={valueFilters[filter]}
                    onInput={event => {
                      const next = event.currentTarget.value;
                      setValueFilters(current => ({
                        ...current,
                        [filter]: next,
                      }));
                    }}
                  />
                </div>
              )}

              {displayed.length > 0 && (
                <ul class="filter-panel__values">
                  {displayed.map(({ option, index }) => {
                    const id = optionId(filter, index);
                    const checked = isSelected(option);

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
                              : removeSelection(
                                  qs.filters,
                                  filter,
                                  option.value,
                                );
                            onCommit({ ...qs, filters });
                          }}
                        />
                        {/* The value and its count are separate spans so the count
                            can sit in the right-aligned tabular column while the
                            value wraps; the label's text is still exactly
                            `optionLabel(option)`, so the control's accessible name
                            names the value and the count together. */}
                        <label class="filter-panel__label" for={id}>
                          <span class="filter-panel__value-text">
                            {option.value}
                          </span>{' '}
                          <span class="filter-panel__count numeric">
                            {countText(option.count)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Requirement 19.5: the Value_Filter matches no value of this
                  Filter. The Result_Set is untouched — nothing is committed. */}
              {open && text !== '' && matching.length === 0 && (
                <p class="filter-panel__no-match" data-testid="no-match">
                  {noMatchText(filter)}
                </p>
              )}

              {/* Requirement 19.3: the values past the cap, and how many they are. */}
              {open && hidden > 0 && (
                <button
                  class="filter-panel__reveal"
                  type="button"
                  onClick={() =>
                    setRevealed(current => ({ ...current, [filter]: true }))
                  }
                >
                  {revealText(hidden)}
                </button>
              )}
            </div>
          </fieldset>
        );
      })}
    </section>
  );
}
