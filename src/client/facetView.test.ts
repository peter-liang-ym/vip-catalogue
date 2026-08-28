import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type ConflictState,
  type Dataset,
  type TeamRecord,
} from '../shared/types';
import type { ConflictMap } from './conflicts';
import { facetView, type FacetOption } from './facetView';
import type { FilterSelections } from './facets';
import { DEFAULT_QUERY_STATE, type QueryState } from './queryState';
import { buildIndex } from './search';

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

function advisor(name: string) {
  return { name, affiliation: '', email: '' };
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
      advisors: [advisor('Ada Lovelace')],
      meeting: { day: 'Monday, Wednesday', time: '', location: '' },
    }),
    team({
      entryId: '2',
      name: 'Coral Reef Health',
      majorsSought: [{ college: 'Sciences', major: 'Biology' }],
      advisors: [advisor('Grace Hopper')],
      meeting: { day: 'Tuesday', time: '', location: '' },
    }),
    team({
      entryId: '3',
      name: 'Robotic Coral Mapping',
      majorsSought: [{ college: 'Computing', major: 'Computational Media' }],
      advisors: [advisor('Ada Lovelace')],
      meeting: { day: 'Monday', time: '', location: '' },
    }),
    team({
      entryId: '4',
      name: 'Solar Racing',
      majorsSought: [
        { college: 'Engineering', major: 'Mechanical Engineering' },
      ],
      advisors: [advisor('Alan Turing')],
      meeting: { day: 'Friday', time: '', location: '' },
    }),
  ]),
);

function selections(over: Partial<FilterSelections>): FilterSelections {
  return { college: [], major: [], day: [], advisor: [], ...over };
}

function query(over: Partial<QueryState>): QueryState {
  return { ...DEFAULT_QUERY_STATE, ...over };
}

function counts(options: readonly FacetOption[]): Record<string, number> {
  return Object.fromEntries(
    options.map(option => [option.value, option.count]),
  );
}

function conflictMap(entries: Record<string, ConflictState>): ConflictMap {
  return new Map(Object.entries(entries));
}

const conflicts = conflictMap({
  '1': 'conflicting',
  '2': 'clear',
  '3': 'unknown',
  '4': 'conflicting',
});

describe('facetView', () => {
  it('counts the teams holding each value when nothing narrows the result set', () => {
    const view = facetView(index, DEFAULT_QUERY_STATE, null);

    expect(counts(view.college)).toEqual({
      Computing: 2,
      Engineering: 2,
      Sciences: 1,
    });
    expect(counts(view.major)).toEqual({
      Biology: 1,
      'Computational Media': 1,
      'Computer Science': 1,
      'Mechanical Engineering': 2,
    });
    expect(counts(view.day)).toEqual({
      Monday: 2,
      Tuesday: 1,
      Wednesday: 1,
      Friday: 1,
    });
    expect(counts(view.advisor)).toEqual({
      'Ada Lovelace': 2,
      'Alan Turing': 1,
      'Grace Hopper': 1,
    });
    expect(
      [...view.college, ...view.major, ...view.day, ...view.advisor].every(
        option => option.selectable,
      ),
    ).toBe(true);
  });

  it('applies the current Search_Query to every count', () => {
    const view = facetView(index, query({ query: 'coral' }), null);

    expect(counts(view.college)).toEqual({
      Computing: 1,
      Engineering: 0,
      Sciences: 1,
    });
  });

  it('marks a zero count not selectable', () => {
    const view = facetView(index, query({ query: 'coral' }), null);

    expect(view.college).toEqual([
      { value: 'Computing', count: 1, selectable: true },
      { value: 'Engineering', count: 0, selectable: false },
      { value: 'Sciences', count: 1, selectable: true },
    ]);
  });

  it('applies the other filters selections to a value count', () => {
    const view = facetView(
      index,
      query({ filters: selections({ college: ['Computing'] }) }),
      null,
    );

    expect(counts(view.day)).toEqual({
      Monday: 2,
      Tuesday: 0,
      Wednesday: 1,
      Friday: 0,
    });
    expect(counts(view.advisor)).toEqual({
      'Ada Lovelace': 2,
      'Alan Turing': 0,
      'Grace Hopper': 0,
    });
  });

  it('widens its own filter, since values inside one filter are OR-ed', () => {
    const view = facetView(
      index,
      query({ filters: selections({ college: ['Sciences'] }) }),
      null,
    );

    expect(counts(view.college)).toEqual({
      Computing: 3,
      Engineering: 3,
      Sciences: 1,
    });
  });

  it('reports the current result set size for an already selected value', () => {
    const view = facetView(
      index,
      query({ filters: selections({ college: ['  COMPUTING '] }) }),
      null,
    );

    expect(counts(view.college).Computing).toBe(2);
  });

  it('offers the major values the selected colleges pair with', () => {
    const view = facetView(
      index,
      query({ filters: selections({ college: ['Computing'] }) }),
      null,
    );

    expect(view.major.map(option => option.value)).toEqual([
      'Computational Media',
      'Computer Science',
    ]);
  });

  it('narrows counts by the hide-conflicts post-filter', () => {
    const view = facetView(index, query({ hideConflicts: true }), conflicts);

    expect(counts(view.college)).toEqual({
      Computing: 1,
      Engineering: 0,
      Sciences: 1,
    });
    expect(counts(view.day)).toEqual({
      Monday: 1,
      Tuesday: 1,
      Wednesday: 0,
      Friday: 0,
    });
    expect(view.college[1]).toEqual({
      value: 'Engineering',
      count: 0,
      selectable: false,
    });
  });

  it('ignores the conflict states while the toggle is off', () => {
    expect(facetView(index, DEFAULT_QUERY_STATE, conflicts)).toEqual(
      facetView(index, DEFAULT_QUERY_STATE, null),
    );
  });

  it('ignores the toggle while no busy schedule is loaded', () => {
    expect(facetView(index, query({ hideConflicts: true }), null)).toEqual(
      facetView(index, DEFAULT_QUERY_STATE, null),
    );
  });

  it('counts folded spellings of one value together', () => {
    const folded = buildIndex(
      dataset([
        team({
          entryId: '1',
          majorsSought: [{ college: 'Computing', major: 'Computer Science' }],
        }),
        team({
          entryId: '2',
          majorsSought: [{ college: ' computing ', major: 'Computer Science' }],
        }),
      ]),
    );

    expect(
      counts(facetView(folded, DEFAULT_QUERY_STATE, null).college),
    ).toEqual({ Computing: 2 });
  });

  it('reports zero for every value over an empty dataset', () => {
    const empty = buildIndex(dataset([]));
    const view = facetView(empty, DEFAULT_QUERY_STATE, null);

    expect(view).toEqual({ college: [], major: [], day: [], advisor: [] });
  });
});
