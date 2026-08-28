import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type BusySchedule,
  type Dataset,
  type MeetingWindow,
  type TeamRecord,
} from '../shared/types';
import { derive, type DerivedView } from './derive';
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

/** A Monday window, so a Monday busy block decides the Conflict_State. */
function monday(startMinute: number, endMinute: number): MeetingWindow {
  return [{ weekday: 'Monday', startMinute, endMinute }];
}

function schedule(blocks: BusySchedule['blocks']): BusySchedule {
  return {
    fileName: 'calendar.ics',
    loadedAt: '2026-01-05T09:00:00Z',
    blocks,
    truncated: false,
    discardedBlocks: 0,
  };
}

/** Busy Monday 9:30-10:20, which overlaps the conflicting teams below. */
const busy = schedule([
  {
    weekday: 'Monday',
    startMinute: 570,
    endMinute: 620,
    summaries: ['CS 1331'],
  },
]);

function selections(over: Partial<FilterSelections>): FilterSelections {
  return { college: [], major: [], day: [], advisor: [], ...over };
}

function query(over: Partial<QueryState>): QueryState {
  return { ...DEFAULT_QUERY_STATE, ...over };
}

function entryIds(view: DerivedView): readonly string[] {
  return view.page.map(scored => scored.team.entryId);
}

/**
 * Four teams: `1` and `2` conflict with `busy`, `3` is clear, `4` is unknown.
 * Names are ordered so `name-asc` is 1, 2, 3, 4.
 */
const index = buildIndex(
  dataset([
    team({
      entryId: '1',
      name: 'Alpha Robotics',
      goals: 'robotics swarm research',
      meetingWindow: monday(600, 660),
      majorsSought: [{ college: 'Computing', major: 'Computer Science' }],
    }),
    team({
      entryId: '2',
      name: 'Bravo Reef',
      goals: 'coral reef health',
      meetingWindow: monday(580, 640),
      majorsSought: [{ college: 'Sciences', major: 'Biology' }],
    }),
    team({
      entryId: '3',
      name: 'Charlie Solar',
      goals: 'solar racing',
      meetingWindow: monday(660, 720),
      majorsSought: [{ college: 'Engineering', major: 'Mechanical' }],
    }),
    team({
      entryId: '4',
      name: 'Delta Mapping',
      goals: 'coral mapping robotics',
      meetingWindow: null,
      majorsSought: [{ college: 'Computing', major: 'Computational Media' }],
    }),
  ]),
);

/**
 * 30 teams named `Team 01`..`Team 30`, for the pagination cases. The
 * even-numbered ones meet during `busy`, so a loaded schedule halves the
 * Result_Set while the toggle is on.
 */
const many = buildIndex(
  dataset(
    Array.from({ length: 30 }, (_, i) => {
      const id = String(i + 1).padStart(2, '0');
      return team({
        entryId: id,
        name: `Team ${id}`,
        meetingWindow: (i + 1) % 2 === 0 ? monday(600, 660) : null,
      });
    }),
  ),
);

describe('derive', () => {
  it('returns the first page, the total, and the page count for the default query state', () => {
    const view = derive(many, DEFAULT_QUERY_STATE, null);

    expect(view.totalCount).toBe(30);
    expect(view.pageNumber).toBe(1);
    expect(view.pageCount).toBe(2);
    expect(view.page).toHaveLength(24);
    expect(entryIds(view)[0]).toBe('01');
    expect(view.emptyReason).toBe('none');
    expect(view.hiddenByToggle).toBe(0);
    expect(view.conflicts).toBeNull();
  });

  it('slices the requested page out of the sorted result set', () => {
    const view = derive(many, query({ pageNumber: 2 }), null);

    expect(view.pageNumber).toBe(2);
    expect(entryIds(view)).toEqual(['25', '26', '27', '28', '29', '30']);
  });

  it('clamps a page number outside the available range', () => {
    expect(derive(many, query({ pageNumber: 9 }), null).pageNumber).toBe(2);
    expect(derive(many, query({ pageNumber: -3 }), null).pageNumber).toBe(1);
    expect(
      derive(many, query({ pageNumber: Number.NaN }), null).pageNumber,
    ).toBe(1);
  });

  it('composes the search query, the filters, and the sort option', () => {
    const view = derive(
      index,
      query({
        query: 'coral',
        filters: selections({ college: ['Computing'] }),
        sort: 'name-desc',
      }),
      null,
    );

    expect(entryIds(view)).toEqual(['4']);
    expect(view.totalCount).toBe(1);
  });

  it('reports the facet counts for the current query state', () => {
    const view = derive(index, query({ query: 'coral' }), null);

    expect(
      Object.fromEntries(
        view.facets.college.map(option => [option.value, option.count]),
      ),
    ).toEqual({ Computing: 1, Engineering: 0, Sciences: 1 });
  });

  it('assigns every team a conflict state while a schedule is loaded', () => {
    const view = derive(index, DEFAULT_QUERY_STATE, busy);

    expect(view.conflicts && [...view.conflicts]).toEqual([
      ['1', 'conflicting'],
      ['2', 'conflicting'],
      ['3', 'clear'],
      ['4', 'unknown'],
    ]);
    expect(view.totalCount).toBe(4);
    expect(view.hiddenByToggle).toBe(0);
  });

  it('reuses one conflict map per dataset and schedule pair', () => {
    const first = derive(index, DEFAULT_QUERY_STATE, busy);
    const second = derive(index, query({ query: 'coral' }), busy);
    const replaced = derive(index, DEFAULT_QUERY_STATE, schedule(busy.blocks));

    expect(second.conflicts).toBe(first.conflicts);
    expect(replaced.conflicts).not.toBe(first.conflicts);
    expect(replaced.conflicts).toEqual(first.conflicts);
  });

  it('removes exactly the conflicting teams while the toggle is on', () => {
    const view = derive(index, query({ hideConflicts: true }), busy);

    expect(entryIds(view)).toEqual(['3', '4']);
    expect(view.totalCount).toBe(2);
    expect(view.hiddenByToggle).toBe(2);
    expect(view.emptyReason).toBe('none');
  });

  it('leaves the result set alone while the toggle is on and no schedule is loaded', () => {
    const view = derive(index, query({ hideConflicts: true }), null);

    expect(entryIds(view)).toEqual(['1', '2', '3', '4']);
    expect(view.hiddenByToggle).toBe(0);
  });

  it('applies the toggle before sorting and slicing', () => {
    const view = derive(
      index,
      query({ hideConflicts: true, sort: 'name-desc', pageSize: 12 }),
      busy,
    );

    expect(entryIds(view)).toEqual(['4', '3']);
  });

  it('sorts the conflict-free teams first', () => {
    const view = derive(index, query({ sort: 'conflict-free' }), busy);

    expect(entryIds(view)).toEqual(['3', '4', '1', '2']);
  });

  it('reports noMatch when nothing matches the query and the filters', () => {
    const view = derive(index, query({ query: 'nothing matches this' }), null);

    expect(view.totalCount).toBe(0);
    expect(view.page).toEqual([]);
    expect(view.pageCount).toBe(1);
    expect(view.pageNumber).toBe(1);
    expect(view.emptyReason).toBe('noMatch');
  });

  it('reports allConflict when the toggle removed everything that matched', () => {
    const view = derive(
      index,
      query({ query: 'reef', hideConflicts: true }),
      busy,
    );

    expect(view.totalCount).toBe(0);
    expect(view.hiddenByToggle).toBe(1);
    expect(view.emptyReason).toBe('allConflict');
  });

  it('reports noMatch for an empty result set holding no conflicting team', () => {
    const view = derive(
      index,
      query({ query: 'nothing matches this', hideConflicts: true }),
      busy,
    );

    expect(view.hiddenByToggle).toBe(0);
    expect(view.emptyReason).toBe('noMatch');
  });

  it('resets the page number to 1 when the result set changes', () => {
    const previous = derive(many, query({ pageNumber: 2 }), null);
    const narrowed = derive(
      many,
      query({ pageNumber: 2, query: 'Team 0' }),
      null,
      previous,
    );

    expect(previous.pageNumber).toBe(2);
    expect(narrowed.pageNumber).toBe(1);
    expect(entryIds(narrowed)[0]).toBe('01');
  });

  it('keeps the page number when the result set is unchanged', () => {
    const previous = derive(many, query({ pageNumber: 2 }), null);
    const again = derive(many, query({ pageNumber: 2 }), null, previous);

    expect(again.pageNumber).toBe(2);
  });

  it('resets the page number when a loaded schedule changes the result set', () => {
    const qs = query({ pageNumber: 2, pageSize: 12, hideConflicts: true });
    const before = derive(many, qs, null);
    const after = derive(many, qs, busy, before);

    expect(before.pageNumber).toBe(2);
    expect(after.hiddenByToggle).toBe(15);
    expect(after.pageCount).toBe(2);
    expect(after.pageNumber).toBe(1);
  });

  it('treats a re-sorted result set as changed', () => {
    const previous = derive(many, query({ pageNumber: 2 }), null);
    const reversed = derive(
      many,
      query({ pageNumber: 2, sort: 'name-desc' }),
      null,
      previous,
    );

    expect(reversed.pageNumber).toBe(1);
  });

  it('leaves the query state untouched, schedule loaded or not', () => {
    const qs = query({
      query: 'coral',
      filters: selections({ college: ['Computing'] }),
      sort: 'relevance',
      pageNumber: 2,
      pageSize: 12,
    });
    const snapshot = structuredClone(qs);

    derive(index, qs, null);
    derive(index, qs, busy);

    expect(qs).toEqual(snapshot);
  });

  it('derives an empty dataset without failing', () => {
    const empty = buildIndex(dataset([]));
    const view = derive(empty, query({ pageNumber: 4, pageSize: 'all' }), busy);

    expect(view).toMatchObject({
      resultSet: [],
      page: [],
      pageNumber: 1,
      pageCount: 1,
      totalCount: 0,
      hiddenByToggle: 0,
      emptyReason: 'noMatch',
    });
    expect(view.conflicts && [...view.conflicts]).toEqual([]);
  });
});
