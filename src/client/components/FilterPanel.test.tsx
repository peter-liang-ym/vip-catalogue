// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type Dataset,
  type TeamRecord,
} from '../../shared/types';
import type { FilterName } from '../facets';
import { facetView } from '../facetView';
import { DEFAULT_QUERY_STATE, type QueryState } from '../queryState';
import { buildIndex } from '../search';
import { CLEAR_ALL_RESET, EMPTY_SELECTIONS } from '../selections';
import {
  FilterPanel,
  noMatchText,
  optionLabel,
  revealText,
  toggleLabel,
  VALUE_CAP,
  valueFilterLabel,
} from './FilterPanel';
import { FILTER_LABELS } from './SelectedValues';

function team(
  overrides: Partial<TeamRecord> & { entryId: string },
): TeamRecord {
  return {
    sourceUrl: `https://vip.gatech.edu/teams/entry/${overrides.entryId}`,
    name: 'Team',
    imageUrl: '',
    imagePath: '',
    imageAlt: '',
    goals: '',
    issuesAddressed: '',
    partnersSponsors: '',
    methodsTechnologies: '',
    majorsSought: [],
    preferredInterests: '',
    advisors: [],
    meeting: { day: '', time: '', location: '' },
    meetingWindow: null,
    ...overrides,
  };
}

function dataset(teams: readonly TeamRecord[]): Dataset {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt: '2026-01-05T04:30:00Z',
    teamCount: teams.length,
    teams,
  };
}

const index = buildIndex(
  dataset([
    team({
      entryId: '1',
      name: 'Robotics Swarm',
      majorsSought: [
        { college: 'Computing', major: 'Computer Science' },
        { college: 'Engineering', major: 'Mechanical Engineering' },
      ],
      advisors: [{ name: 'Ada Lovelace', affiliation: '', email: '' }],
      meeting: { day: 'Monday, Wednesday', time: '', location: '' },
    }),
    team({
      entryId: '2',
      name: 'Coral Reef Health',
      majorsSought: [{ college: 'Sciences', major: 'Biology' }],
      advisors: [{ name: 'Grace Hopper', affiliation: '', email: '' }],
      meeting: { day: 'Tuesday', time: '', location: '' },
    }),
  ]),
);

/** Twelve Advisor values, so the 8-value cap has something to hide. */
const wide = buildIndex(
  dataset(
    Array.from({ length: 12 }, (_, i) =>
      team({
        entryId: String(i + 1),
        name: `Team ${i + 1}`,
        advisors: [
          {
            name: `Advisor ${String(i + 1).padStart(2, '0')}`,
            affiliation: '',
            email: '',
          },
        ],
        meeting: { day: 'Monday', time: '', location: '' },
      }),
    ),
  ),
);

function state(overrides: Partial<QueryState> = {}): QueryState {
  return { ...DEFAULT_QUERY_STATE, ...overrides };
}

function mount(qs: QueryState = state(), on = index) {
  const onCommit = vi.fn();
  const view = render(
    <FilterPanel
      facets={facetView(on, qs, null)}
      qs={qs}
      onCommit={onCommit}
    />,
  );
  const rerender = (next: QueryState) =>
    view.rerender(
      <FilterPanel
        facets={facetView(on, next, null)}
        qs={next}
        onCommit={onCommit}
      />,
    );
  return { onCommit, rerender };
}

/**
 * One Filter's group, asked for the way assistive technology finds it: the
 * accessible name its `legend` gives it, which is the Filter's name and its
 * selected count. Nothing here depends on the panel's markup, so a visual change
 * that keeps the semantics keeps these tests.
 */
function group(filter: FilterName): HTMLElement {
  return screen.getByRole('group', {
    name: new RegExp(`^${FILTER_LABELS[filter]} \\d+ selected$`),
  });
}

/** The value labels of one Filter group, in rendered order. */
function options(filter: FilterName): readonly string[] {
  return within(group(filter))
    .queryAllByRole('checkbox')
    .map(
      control => (control as HTMLInputElement).labels?.[0]?.textContent ?? '',
    );
}

/** The checkbox offering one value, named by that value and its count. */
function checkbox(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement;
}

/** The disclosure control of one Filter. */
function toggle(filter: FilterName): HTMLButtonElement {
  return within(group(filter)).getByRole('button', {
    name: new RegExp(`^${FILTER_LABELS[filter]} \\d+ selected$`),
  }) as HTMLButtonElement;
}

/** One Filter's reveal control, or `null` while every value is displayed. */
function reveal(filter: FilterName): HTMLElement | null {
  return within(group(filter)).queryByRole('button', {
    name: /^Show \d+ more$/,
  });
}

/** One Filter's Value_Filter input, or `null` when it offers none. */
function valueFilterInput(filter: FilterName): HTMLInputElement | null {
  return within(group(filter)).queryByRole(
    'searchbox',
  ) as HTMLInputElement | null;
}

/** Opens a Filter's disclosure, which is how its unselected values are reached. */
function expand(filter: FilterName): void {
  fireEvent.click(toggle(filter));
}

function typeValueFilter(filter: 'major' | 'advisor', text: string): void {
  const input = screen.getByLabelText(valueFilterLabel(filter));
  fireEvent.input(input, { target: { value: text } });
}

afterEach(cleanup);

describe('FilterPanel', () => {
  it('provides exactly the four Filters, each named (Requirements 6.1, 11.7)', () => {
    mount();

    // Four groups, in order, each named for the Filter it holds.
    expect(
      screen
        .getAllByRole('group')
        .map(fieldset => within(fieldset).getByRole('button').textContent),
    ).toEqual([
      toggleLabel('college', 0),
      toggleLabel('major', 0),
      toggleLabel('day', 0),
      toggleLabel('advisor', 0),
    ]);
  });

  it('offers the Dataset values in facet order with their counts (Requirements 6.2, 6.5)', () => {
    mount();

    expect(options('college')).toEqual([
      'Computing (1)',
      'Engineering (1)',
      'Sciences (1)',
    ]);
    expect(options('day')).toEqual([
      'Monday (1)',
      'Tuesday (1)',
      'Wednesday (1)',
    ]);

    expand('advisor');
    expect(options('advisor')).toEqual([
      'Ada Lovelace (1)',
      'Grace Hopper (1)',
    ]);
  });

  it('associates a label with every Filter control (Requirement 11.7)', () => {
    mount();

    expect(
      screen.getByRole('checkbox', { name: 'Computing (1)' }),
    ).toBeTruthy();
  });

  it('renders a zero count as not selectable (Requirement 6.11)', () => {
    mount(state({ query: 'coral' }));

    expect(options('college')).toEqual([
      'Computing (0)',
      'Engineering (0)',
      'Sciences (1)',
    ]);
    expect(checkbox('Computing (0)').disabled).toBe(true);
    expect(checkbox('Sciences (1)').disabled).toBe(false);
  });

  it('offers only the Majors the selected Colleges pair with (Requirement 6.6)', () => {
    mount();
    expand('major');
    expect(options('major')).toEqual([
      'Biology (1)',
      'Computer Science (1)',
      'Mechanical Engineering (1)',
    ]);

    cleanup();
    mount(state({ filters: { ...EMPTY_SELECTIONS, college: ['Sciences'] } }));
    expand('major');
    expect(options('major')).toEqual(['Biology (1)']);
  });

  it('exposes the selected state of each Filter control (Requirement 11.8)', () => {
    mount(state({ filters: { ...EMPTY_SELECTIONS, college: ['Computing'] } }));

    expect(checkbox('Computing (1)').checked).toBe(true);
    expect(checkbox('Sciences (2)').checked).toBe(false);
  });

  it('commits the added value, leaving every other Filter untouched', () => {
    const qs = state({ filters: { ...EMPTY_SELECTIONS, day: ['Monday'] } });
    const { onCommit } = mount(qs);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Computing (1)' }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toEqual({
      ...qs,
      filters: { ...EMPTY_SELECTIONS, college: ['Computing'], day: ['Monday'] },
    });
  });

  it('commits the removal when a selected value is unchecked', () => {
    const qs = state({
      filters: { ...EMPTY_SELECTIONS, college: ['Computing', 'Sciences'] },
    });
    const { onCommit } = mount(qs);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Computing (2)' }));

    expect(onCommit.mock.calls[0]?.[0]).toEqual({
      ...qs,
      filters: { ...EMPTY_SELECTIONS, college: ['Sciences'] },
    });
  });

  it('renders nothing selectable for an empty Dataset (Requirement 6.1)', () => {
    const empty = buildIndex(dataset([]));
    render(
      <FilterPanel
        facets={facetView(empty, DEFAULT_QUERY_STATE, null)}
        qs={state()}
        onCommit={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('group')).toHaveLength(4);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });

  it('labels a value with its own count', () => {
    expect(
      optionLabel({ value: 'Computing', count: 3, selectable: true }),
    ).toBe('Computing (3)');
  });

  describe('disclosures (Requirements 19.1, 19.2, 11.13)', () => {
    it('expands College and Meeting day and collapses Major and Advisor', () => {
      mount();

      expect(toggle('college').getAttribute('aria-expanded')).toBe('true');
      expect(toggle('day').getAttribute('aria-expanded')).toBe('true');
      expect(toggle('major').getAttribute('aria-expanded')).toBe('false');
      expect(toggle('advisor').getAttribute('aria-expanded')).toBe('false');
      expect(options('major')).toEqual([]);
      expect(options('advisor')).toEqual([]);
    });

    it('names the group it controls and the count selected, including zero', () => {
      mount(
        state({ filters: { ...EMPTY_SELECTIONS, college: ['Computing'] } }),
      );

      expect(toggle('college').textContent).toBe(toggleLabel('college', 1));
      expect(toggle('major').textContent).toBe(toggleLabel('major', 0));
      // And it is the group's accessible name too, since the control is the
      // `legend` (Requirement 11.7).
      expect(
        screen.getByRole('group', { name: toggleLabel('major', 0) }),
      ).toBeTruthy();
    });

    it('controls the group body it names', () => {
      mount();
      const body = toggle('major').getAttribute('aria-controls');

      expect(document.getElementById(body ?? '')).toBeTruthy();
    });

    it('is a native button, so Enter and Space operate it (Requirement 11.13)', () => {
      mount();

      for (const filter of ['college', 'major', 'day', 'advisor'] as const) {
        const control = toggle(filter);
        // A `button` is keyboard-operable and in the tab order without a
        // `tabindex` or a key handler of our own, which is why the disclosure is
        // one rather than a clickable heading.
        expect(control.tagName).toBe('BUTTON');
        expect(control.type).toBe('button');
        expect(control.hasAttribute('disabled')).toBe(false);
        expect(control.getAttribute('tabindex')).toBeNull();
        // Requirement 19.2: the state is exposed, and as a boolean.
        expect(['true', 'false']).toContain(
          control.getAttribute('aria-expanded'),
        );
      }
    });

    it('keeps focus on the control that collapsed the group (Requirement 11.14)', () => {
      mount();
      const control = toggle('college');
      control.focus();
      expect(document.activeElement).toBe(control);

      // Collapsing removes the values below the control, so focus would be lost
      // if it were anywhere but on the control itself.
      fireEvent.click(control);
      expect(toggle('college').getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(control);

      fireEvent.click(control);
      expect(toggle('college').getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(control);
    });

    it('leaves every displayed control in the tab order (Requirement 11.6)', () => {
      mount(state(), wide);
      expand('advisor');

      const focusable = [
        ...screen.getAllByRole('button'),
        ...screen.getAllByRole('checkbox'),
        ...screen.getAllByRole('searchbox'),
      ];
      for (const control of focusable) {
        expect(control.getAttribute('tabindex')).not.toBe('-1');
      }
    });

    it('collapses again on a second activation', () => {
      mount();
      expand('college');

      expect(toggle('college').getAttribute('aria-expanded')).toBe('false');
      expect(options('college')).toEqual([]);
    });

    it('displays a selected value while the group is collapsed (Requirement 19.6)', () => {
      mount(state({ filters: { ...EMPTY_SELECTIONS, major: ['Biology'] } }));

      expect(toggle('major').getAttribute('aria-expanded')).toBe('false');
      expect(options('major')).toEqual(['Biology (1)']);
      expect(checkbox('Biology (1)').checked).toBe(true);
    });
  });

  describe('the 8-value cap (Requirement 19.3)', () => {
    it('displays 8 values and a control naming the remainder', () => {
      mount(state(), wide);
      expand('advisor');

      expect(options('advisor')).toHaveLength(VALUE_CAP);
      expect(screen.getByRole('button', { name: revealText(4) })).toBeTruthy();
    });

    it('displays the remaining values when that control is activated', () => {
      mount(state(), wide);
      expand('advisor');
      fireEvent.click(screen.getByRole('button', { name: revealText(4) }));

      expect(options('advisor')).toHaveLength(12);
      expect(screen.queryByRole('button', { name: revealText(4) })).toBe(null);
    });

    it('offers no reveal control while every value is displayed', () => {
      mount();
      expand('advisor');

      expect(options('advisor')).toHaveLength(2);
      expect(reveal('advisor')).toBe(null);
    });

    it('displays a selected value ranked past the cap (Requirement 19.6)', () => {
      mount(
        state({ filters: { ...EMPTY_SELECTIONS, advisor: ['Advisor 12'] } }),
        wide,
      );
      expand('advisor');

      // The selected value is displayed on top of the 8 unselected ones, so the
      // cap can never hide the checkbox that would deselect it.
      expect(options('advisor')).toHaveLength(VALUE_CAP + 1);
      expect(options('advisor')).toContain('Advisor 12 (1)');
      expect(screen.getByRole('button', { name: revealText(3) })).toBeTruthy();
    });
  });

  describe('the Value_Filter (Requirements 19.4, 19.5, 19.7)', () => {
    it('is offered on Major and Advisor and on no other Filter', () => {
      mount();
      expand('major');
      expand('advisor');

      expect(screen.getByLabelText(valueFilterLabel('major'))).toBe(
        valueFilterInput('major'),
      );
      expect(screen.getByLabelText(valueFilterLabel('advisor'))).toBe(
        valueFilterInput('advisor'),
      );
      // Two in the whole panel, and neither of them in College or Meeting day.
      expect(screen.getAllByRole('searchbox')).toHaveLength(2);
      expect(valueFilterInput('college')).toBe(null);
      expect(valueFilterInput('day')).toBe(null);
    });

    it('displays only the values containing the text, ignoring letter case', () => {
      mount();
      expand('major');
      typeValueFilter('major', 'BIOL');

      expect(options('major')).toEqual(['Biology (1)']);
    });

    it('commits nothing, so the Result_Set is untouched', () => {
      const { onCommit } = mount();
      expand('major');
      typeValueFilter('major', 'biol');

      expect(onCommit).not.toHaveBeenCalled();
      // The other Filters' values and counts are exactly what they were.
      expect(options('college')).toEqual([
        'Computing (1)',
        'Engineering (1)',
        'Sciences (1)',
      ]);
    });

    it('states that no value matches when none does (Requirement 19.5)', () => {
      const { onCommit } = mount();
      expand('major');
      typeValueFilter('major', 'zzz');

      expect(options('major')).toEqual([]);
      expect(screen.getByText(noMatchText('major'))).toBeTruthy();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('keeps a selected value displayed through text it does not match (19.6)', () => {
      mount(state({ filters: { ...EMPTY_SELECTIONS, major: ['Biology'] } }));
      expand('major');
      typeValueFilter('major', 'mechanical');

      expect(options('major')).toEqual([
        'Biology (1)',
        'Mechanical Engineering (2)',
      ]);
    });

    it('is emptied by clear-all (Requirement 19.7)', () => {
      const qs = state({
        filters: { ...EMPTY_SELECTIONS, college: ['Sciences'] },
      });
      const { rerender } = mount(qs);
      expand('major');
      typeValueFilter('major', 'zzz');
      expect(screen.getByText(noMatchText('major'))).toBeTruthy();

      // Clear-all is the shell's commit of `CLEAR_ALL_RESET`; the panel sees only
      // the Query_State it produces.
      rerender({ ...qs, ...CLEAR_ALL_RESET });

      expect(
        (screen.getByLabelText(valueFilterLabel('major')) as HTMLInputElement)
          .value,
      ).toBe('');
      expect(screen.queryByText(noMatchText('major'))).toBe(null);
    });
  });
});
