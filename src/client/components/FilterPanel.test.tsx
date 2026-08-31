// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type Dataset,
  type TeamRecord,
} from '../../shared/types';
import { facetView } from '../facetView';
import { DEFAULT_QUERY_STATE, type QueryState } from '../queryState';
import { buildIndex } from '../search';
import { EMPTY_SELECTIONS } from '../selections';
import { FilterPanel, optionLabel } from './FilterPanel';
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

function state(overrides: Partial<QueryState> = {}): QueryState {
  return { ...DEFAULT_QUERY_STATE, ...overrides };
}

function mount(qs: QueryState = state()) {
  const onCommit = vi.fn();
  render(
    <FilterPanel
      facets={facetView(index, qs, null)}
      qs={qs}
      onCommit={onCommit}
    />,
  );
  return { onCommit };
}

/** The checkbox labels of one Filter group, in rendered order. */
function options(filter: keyof typeof FILTER_LABELS): readonly string[] {
  const group = document.querySelector(`[data-filter="${filter}"]`);
  return [...(group?.querySelectorAll('label') ?? [])].map(
    label => label.textContent ?? '',
  );
}

afterEach(cleanup);

describe('FilterPanel', () => {
  it('provides exactly the four Filters, each named (Requirements 6.1, 11.7)', () => {
    mount();

    expect(
      screen.getAllByRole('group').map(group => group.firstChild?.textContent),
    ).toEqual([
      FILTER_LABELS.college,
      FILTER_LABELS.major,
      FILTER_LABELS.day,
      FILTER_LABELS.advisor,
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
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Computing (0)',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Sciences (1)',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
  });

  it('offers only the Majors the selected Colleges pair with (Requirement 6.6)', () => {
    mount();
    expect(options('major')).toEqual([
      'Biology (1)',
      'Computer Science (1)',
      'Mechanical Engineering (1)',
    ]);

    cleanup();
    mount(state({ filters: { ...EMPTY_SELECTIONS, college: ['Sciences'] } }));
    expect(options('major')).toEqual(['Biology (1)']);
  });

  it('exposes the selected state of each Filter control (Requirement 11.8)', () => {
    mount(state({ filters: { ...EMPTY_SELECTIONS, college: ['Computing'] } }));

    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Computing (1)',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Sciences (2)',
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
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
});
