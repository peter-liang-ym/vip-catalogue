// @vitest-environment jsdom

/**
 * Property 52: The facet value-filter and the disclosure state never change the
 * Result_Set.
 *
 * **Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.9, 6.5**
 *
 * The domain the design fixes: datasets whose Major and Advisor facets run past
 * the 8-value cap, crossed with selections that include values ranked past that
 * cap and values no Value_Filter text matches; Value_Filter strings drawn from
 * real value substrings, differing letter case, whitespace, and text matching
 * nothing; and arbitrary sequences of disclosure, reveal, and Value_Filter
 * interactions over the four Filters.
 *
 * Two halves. The first is the claim in the property's title: a run of panel
 * interactions leaves the derived view — the Result_Set, its ordering, the page
 * slice, the facet counts, and the excluded-Team count — bit-for-bit what it was,
 * and commits nothing. That holds structurally, since none of this state is an
 * input to `derive`, and the property is what pins the structure down: the day
 * someone routes a Value_Filter through `Query_State`, `onCommit` fires and this
 * fails.
 *
 * The second half is what the panel displays, stated as invariants rather than as
 * an expected list, so the test does not become a second copy of the component's
 * own filtering: a displayed value is always one of that Filter's values; every
 * selected value is displayed regardless of the cap and of the Value_Filter text;
 * a collapsed group displays nothing but its selected values; an expanded group
 * displays at most 8 unselected values until its reveal control is used; and an
 * unselected displayed value always contains the Value_Filter text.
 *
 * Queries are asked through roles, labels, and text throughout, so the next visual
 * change to the panel does not land here.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/preact';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type Dataset,
  type TeamRecord,
  type Weekday,
} from '../../shared/types';
import { derive, type DerivedView } from '../derive';
import { foldValue, type FilterName } from '../facets';
import { facetView, type FacetOption } from '../facetView';
import {
  DEFAULT_QUERY_STATE,
  encodeQueryState,
  QUERY_PARAMS,
  type QueryState,
} from '../queryState';
import { buildIndex, type SearchIndex } from '../search';
import { CLEAR_ALL_RESET } from '../selections';
import {
  FilterPanel,
  noMatchText,
  VALUE_CAP,
  valueFilterLabel,
} from './FilterPanel';
import { FILTER_LABELS, isNarrowed } from './SelectedValues';

// ---------------------------------------------------------------------------
// The domain
// ---------------------------------------------------------------------------

const COLLEGES = ['Computing', 'Engineering', 'Sciences'] as const;

const WEEK: readonly Weekday[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function majorName(i: number): string {
  return `Major ${pad((i % 12) + 1)}`;
}

function advisorName(i: number): string {
  return `Advisor ${pad(i + 1)}`;
}

function team(i: number): TeamRecord {
  return {
    entryId: String(1000 + i),
    sourceUrl: `https://vip.gatech.edu/teams/entry/${1000 + i}`,
    name: `Team ${pad(i + 1)}`,
    imageUrl: '',
    imagePath: '',
    imageAlt: '',
    goals: '',
    issuesAddressed: '',
    partnersSponsors: '',
    methodsTechnologies: '',
    majorsSought: [
      {
        college: COLLEGES[i % COLLEGES.length] as string,
        major: majorName(i),
      },
    ],
    preferredInterests: '',
    advisors: [{ name: advisorName(i), affiliation: '', email: '' }],
    meeting: {
      day: WEEK[i % WEEK.length] as string,
      time: '9:30-10:20',
      location: '',
    },
    meetingWindow: [
      {
        weekday: WEEK[i % WEEK.length] as Weekday,
        startMinute: 570,
        endMinute: 620,
      },
    ],
  };
}

/**
 * A Dataset of `count` Teams. Each Team carries its own Advisor and its own
 * Major, so a `count` of 10 or more puts both facets past the 8-value cap, which
 * is the only reason the cap and the reveal control are reachable at all.
 */
function dataset(count: number): Dataset {
  const teams = Array.from({ length: count }, (_, i) => team(i));

  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt: '2026-01-05T04:30:00Z',
    teamCount: teams.length,
    teams,
  };
}

const arbIndex: fc.Arbitrary<SearchIndex> = fc
  .integer({ min: 10, max: 16 })
  .map(count => buildIndex(dataset(count)));

/**
 * Selections drawn from the values those Teams actually carry, including Majors
 * and Advisors ranked past the cap — `Advisor 12` is never among the first 8 —
 * and never all of them, so unselected values remain to be capped.
 */
function arbQueryStateFor(index: SearchIndex): fc.Arbitrary<QueryState> {
  const count = index.teams.length;
  const majors = [
    ...new Set(Array.from({ length: count }, (_, i) => majorName(i))),
  ];
  const advisors = Array.from({ length: count }, (_, i) => advisorName(i));

  const subset = (values: readonly string[], max: number) =>
    fc.uniqueArray(fc.constantFrom(...values), { maxLength: max });

  return fc.record({
    query: fc.constantFrom('', 'team', 'Team 01', 'zzz-matches-nothing'),
    filters: fc.record({
      college: subset(COLLEGES, 2),
      major: subset(majors, 3),
      day: subset(WEEK, 2),
      advisor: subset(advisors, 3),
    }),
    sort: fc.constantFrom(null, 'name-asc' as const, 'name-desc' as const),
    hideConflicts: fc.constant(false),
    pageNumber: fc.integer({ min: 1, max: 3 }),
    pageSize: fc.constantFrom(12 as const, 24 as const, 'all' as const),
  });
}

/** One thing a visitor can do to the panel without committing anything. */
type Interaction =
  | { readonly kind: 'toggle'; readonly filter: FilterName }
  | { readonly kind: 'reveal'; readonly filter: FilterName }
  | {
      readonly kind: 'type';
      readonly filter: 'major' | 'advisor';
      readonly text: string;
    };

/** Text drawn from real substrings, differing case, whitespace, and no-matches. */
const VALUE_FILTER_TEXTS: readonly string[] = [
  '',
  'advisor',
  'ADVISOR',
  'Major 1',
  'major 0',
  '9',
  ' ',
  'zzzz',
  'Advisor 12',
];

const arbInteraction: fc.Arbitrary<Interaction> = fc.oneof(
  fc
    .constantFrom<FilterName>('college', 'major', 'day', 'advisor')
    .map(filter => ({ kind: 'toggle' as const, filter })),
  fc
    .constantFrom<FilterName>('college', 'major', 'day', 'advisor')
    .map(filter => ({ kind: 'reveal' as const, filter })),
  fc
    .tuple(
      fc.constantFrom<'major' | 'advisor'>('major', 'advisor'),
      fc.constantFrom(...VALUE_FILTER_TEXTS),
    )
    .map(([filter, text]) => ({ kind: 'type' as const, filter, text })),
);

const arbInteractions = fc.array(arbInteraction, { maxLength: 8 });

// ---------------------------------------------------------------------------
// Reading the rendered panel through roles, labels, and text
// ---------------------------------------------------------------------------

const FILTERS = ['college', 'major', 'day', 'advisor'] as const;

/** One Filter's group, found by the accessible name its disclosure control gives it. */
function groupOf(filter: FilterName): HTMLElement {
  return screen.getByRole('group', {
    name: new RegExp(`^${FILTER_LABELS[filter]} \\d+ selected$`),
  });
}

/**
 * The four groups, resolved once per render.
 *
 * Accessible-name matching is the right way to ask for a group and an expensive
 * way to ask for it 300 times, and the `fieldset` elements survive every
 * re-render, so the lookup happens once and the assertions read those elements.
 */
function groups(): Readonly<Record<FilterName, HTMLElement>> {
  return {
    college: groupOf('college'),
    major: groupOf('major'),
    day: groupOf('day'),
    advisor: groupOf('advisor'),
  };
}

/** One Filter's disclosure control. */
function toggleOf(group: HTMLElement, filter: FilterName): HTMLElement {
  return within(group).getByRole('button', {
    name: new RegExp(`^${FILTER_LABELS[filter]} \\d+ selected$`),
  });
}

function isExpanded(group: HTMLElement, filter: FilterName): boolean {
  return toggleOf(group, filter).getAttribute('aria-expanded') === 'true';
}

/** One Filter's reveal control, or `null` while every value is displayed. */
function revealOf(group: HTMLElement): HTMLElement | null {
  return within(group).queryByRole('button', { name: /^Show \d+ more$/ });
}

interface DisplayedValue {
  readonly value: string;
  readonly count: number;
  readonly checked: boolean;
}

/**
 * What one Filter displays: every value with its count and its selected state,
 * read from the checkboxes and their labels rather than from any element class.
 */
function displayed(group: HTMLElement): readonly DisplayedValue[] {
  return within(group)
    .queryAllByRole('checkbox')
    .map(control => {
      const input = control as HTMLInputElement;
      const text = input.labels?.[0]?.textContent ?? '';
      const match = /^(.*) \((\d+)\)$/.exec(text.trim());

      return {
        value: match?.[1] ?? text,
        count: Number(match?.[2] ?? Number.NaN),
        checked: input.checked,
      };
    });
}

/** The derived view reduced to the answers Requirement 19.4 says cannot move. */
function signature(view: DerivedView) {
  return {
    resultSet: view.resultSet.map(scored => scored.team.entryId),
    page: view.page.map(scored => scored.team.entryId),
    pageNumber: view.pageNumber,
    pageCount: view.pageCount,
    totalCount: view.totalCount,
    hiddenByToggle: view.hiddenByToggle,
    facets: view.facets,
  };
}

afterEach(cleanup);

describe('Property 52: the value-filter and the disclosure state never change the Result_Set', () => {
  it('leaves the Result_Set, the page slice, the counts, and the address untouched, and displays every value the disclosure rules allow', () => {
    fc.assert(
      fc.property(
        arbIndex.chain(index =>
          fc.tuple(
            fc.constant(index),
            arbQueryStateFor(index),
            arbInteractions,
          ),
        ),
        ([index, qs, interactions]) => {
          const before = signature(derive(index, qs, null));
          const encodedBefore = encodeQueryState(qs);
          const onCommit = vi.fn();
          const facets = facetView(index, qs, null);

          render(<FilterPanel facets={facets} qs={qs} onCommit={onCommit} />);
          const group = groups();

          /** The Value_Filter text in force per Filter, as the run applies it. */
          const texts: Record<string, string> = { major: '', advisor: '' };

          for (const interaction of interactions) {
            if (interaction.kind === 'toggle') {
              fireEvent.click(
                toggleOf(group[interaction.filter], interaction.filter),
              );
              continue;
            }
            if (interaction.kind === 'reveal') {
              const control = revealOf(group[interaction.filter]);
              if (control !== null) fireEvent.click(control);
              continue;
            }
            // A Value_Filter is only on screen while its group is expanded.
            const input = screen.queryByLabelText(
              valueFilterLabel(interaction.filter),
            );
            if (input === null) continue;
            fireEvent.input(input, { target: { value: interaction.text } });
            texts[interaction.filter] = interaction.text;
          }

          // Nothing was committed, so nothing about the derivation moved
          // (Requirements 19.4, 19.5).
          expect(onCommit).not.toHaveBeenCalled();
          expect(signature(derive(index, qs, null))).toEqual(before);
          expect(encodeQueryState(qs)).toBe(encodedBefore);
          // Requirement 19.9: no parameter carries disclosure or Value_Filter state.
          for (const key of new URLSearchParams(encodedBefore).keys()) {
            expect(QUERY_PARAMS).toContain(key);
          }

          for (const filter of FILTERS) {
            const element = group[filter];
            const options = facets[filter];
            const byValue = new Map<string, FacetOption>(
              options.map(option => [option.value, option]),
            );
            const selectedFolded = new Set(qs.filters[filter].map(foldValue));
            const isSelected = (value: string) =>
              selectedFolded.has(foldValue(value));

            const open = isExpanded(element, filter);
            const text = texts[filter] ?? '';
            const shown = displayed(element);

            // Every displayed value is one of this Filter's values, carrying the
            // count `facetView` computed for it — the Value_Filter narrows what is
            // displayed and never what a count promises (Requirements 6.5, 19.4).
            for (const entry of shown) {
              const option = byValue.get(entry.value);
              expect(option).toBeDefined();
              expect(entry.count).toBe(option?.count);
              expect(entry.checked).toBe(isSelected(entry.value));
            }

            // Requirement 19.6: every selected value is displayed, whatever the
            // cap and whatever the Value_Filter says, so it can be deselected.
            const displayedValues = new Set(shown.map(entry => entry.value));
            for (const option of options) {
              if (isSelected(option.value)) {
                expect(displayedValues.has(option.value)).toBe(true);
              }
            }

            const unselected = shown.filter(entry => !entry.checked);

            if (!open) {
              // Requirement 19.2: a collapsed group displays its selected values
              // and no other.
              expect(unselected).toEqual([]);
              continue;
            }

            // Requirement 19.4: an unselected displayed value contains the text,
            // ignoring letter case.
            for (const entry of unselected) {
              expect(entry.value.toLowerCase()).toContain(text.toLowerCase());
            }

            const matching = options.filter(
              option =>
                !isSelected(option.value) &&
                option.value.toLowerCase().includes(text.toLowerCase()),
            );

            if (revealOf(element) === null) {
              // Nothing is held back, so every matching value is on screen.
              expect(unselected).toHaveLength(matching.length);
            } else {
              // Requirement 19.3: at most 8 until the reveal control is used, and
              // the control states exactly how many are not displayed.
              expect(unselected).toHaveLength(VALUE_CAP);
              expect(revealOf(element)?.textContent).toBe(
                `Show ${matching.length - VALUE_CAP} more`,
              );
            }

            // Requirement 19.5: the no-match message appears exactly when the
            // text matches no value of this Filter.
            const anyMatch = options.some(option =>
              option.value.toLowerCase().includes(text.toLowerCase()),
            );
            const message = within(element).queryByText(noMatchText(filter));
            expect(message !== null).toBe(text !== '' && !anyMatch);
          }

          cleanup();
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);

  it('empties every Value_Filter when clear-all lands (Requirement 19.7)', () => {
    fc.assert(
      fc.property(
        arbIndex.chain(index =>
          fc.tuple(
            fc.constant(index),
            arbQueryStateFor(index).filter(isNarrowed),
            fc.constantFrom(...VALUE_FILTER_TEXTS.filter(text => text !== '')),
          ),
        ),
        ([index, qs, text]) => {
          const onCommit = vi.fn();
          const view = render(
            <FilterPanel
              facets={facetView(index, qs, null)}
              qs={qs}
              onCommit={onCommit}
            />,
          );

          const group = groups();

          // Both Value_Filter groups start collapsed, so open them to type.
          for (const filter of ['major', 'advisor'] as const) {
            fireEvent.click(toggleOf(group[filter], filter));
            fireEvent.input(screen.getByLabelText(valueFilterLabel(filter)), {
              target: { value: text },
            });
            expect(
              (
                screen.getByLabelText(
                  valueFilterLabel(filter),
                ) as HTMLInputElement
              ).value,
            ).toBe(text);
          }

          // Clear-all is the shell's commit of the Query_State that narrows
          // nothing; the panel only ever sees its result.
          const cleared: QueryState = {
            ...DEFAULT_QUERY_STATE,
            ...CLEAR_ALL_RESET,
          };
          view.rerender(
            <FilterPanel
              facets={facetView(index, cleared, null)}
              qs={cleared}
              onCommit={onCommit}
            />,
          );

          for (const filter of ['major', 'advisor'] as const) {
            expect(
              (
                screen.getByLabelText(
                  valueFilterLabel(filter),
                ) as HTMLInputElement
              ).value,
            ).toBe('');
            expect(
              within(group[filter]).queryByText(noMatchText(filter)),
            ).toBeNull();
          }

          cleanup();
        },
      ),
      { numRuns: 15 },
    );
  }, 120_000);
});
