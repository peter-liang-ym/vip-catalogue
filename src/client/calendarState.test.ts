import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type BusySchedule,
  type Dataset,
  type MeetingWindow,
  type TeamRecord,
} from '../shared/types';
import {
  BUSY_SCHEDULE_KEY,
  BUSY_SCHEDULE_STORAGE_VERSION,
  saveStoredSchedule,
} from './busyScheduleStore';
import type { CalendarParseResult } from './calendar/parseCalendar';
import {
  applyParseResult,
  NO_CALENDAR,
  removeCalendar,
  restoreCalendar,
  scheduleOf,
  type CalendarState,
} from './calendarState';
import { conflictDetail } from './conflictDetail';
import { derive } from './derive';
import { DEFAULT_QUERY_STATE } from './queryState';
import { buildIndex } from './search';

/** In-memory `Storage`, so no test touches a real `localStorage`. */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

function schedule(overrides: Partial<BusySchedule> = {}): BusySchedule {
  return {
    fileName: 'fall-2026.ics',
    loadedAt: '2026-01-05T09:00:00.000Z',
    blocks: [
      {
        weekday: 'Monday',
        startMinute: 570,
        endMinute: 620,
        summaries: ['CS 1331', ''],
      },
    ],
    truncated: false,
    discardedBlocks: 0,
    ...overrides,
  };
}

/** A schedule distinguishable from `schedule()` by file name. */
const OTHER = schedule({ fileName: 'spring-2027.ics' });

const FAILURES: readonly CalendarParseResult[] = [
  { kind: 'invalidCalendar' },
  { kind: 'noUsableEvents', skippedEvents: 3 },
  { kind: 'timeout', elapsedMs: 2000 },
];

describe('scheduleOf', () => {
  it('is the loaded schedule, or null when there is none', () => {
    const loaded = schedule();

    expect(scheduleOf(NO_CALENDAR)).toBeNull();
    expect(
      scheduleOf({ kind: 'parsing', fileName: 'a.ics', schedule: null }),
    ).toBeNull();
    expect(
      scheduleOf({ kind: 'parsing', fileName: 'a.ics', schedule: loaded }),
    ).toBe(loaded);
    expect(
      scheduleOf({
        kind: 'loaded',
        schedule: loaded,
        persisted: true,
        notice: null,
      }),
    ).toBe(loaded);
    expect(
      scheduleOf({ kind: 'error', notice: 'timeout', schedule: loaded }),
    ).toBe(loaded);
    expect(
      scheduleOf({ kind: 'error', notice: 'notRestored', schedule: null }),
    ).toBeNull();
  });
});

describe('restoreCalendar (17.2, 17.6, 17.7)', () => {
  it('applies a stored schedule so its file name, block count, and load time display (17.2)', () => {
    const store = new MemoryStorage();
    const stored = schedule();
    saveStoredSchedule(stored, store);

    const state = restoreCalendar(store);

    expect(state).toEqual({
      kind: 'loaded',
      schedule: stored,
      persisted: true,
      notice: null,
    });
    expect(scheduleOf(state)).toEqual(stored);
  });

  it('applies nothing when storage holds no schedule (17.6)', () => {
    expect(restoreCalendar(new MemoryStorage())).toEqual({ kind: 'none' });
  });

  it.each([
    ['a value that is not JSON', 'not json'],
    ['a JSON value of the wrong shape', '{"storageVersion":"1"}'],
    [
      'another storage version',
      JSON.stringify({ storageVersion: 'x', schedule: schedule() }),
    ],
  ])(
    'reports could-not-restore for %s, applies nothing, and the key is gone (17.7)',
    (_label, raw) => {
      const store = new MemoryStorage();
      store.setItem(BUSY_SCHEDULE_KEY, raw);

      const state = restoreCalendar(store);

      expect(state).toEqual({
        kind: 'error',
        notice: 'notRestored',
        schedule: null,
      });
      expect(scheduleOf(state)).toBeNull();
      expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
    },
  );

  it('does not re-report a value it already removed on a second visit (17.7)', () => {
    const store = new MemoryStorage();
    store.setItem(BUSY_SCHEDULE_KEY, 'not json');

    expect(restoreCalendar(store).kind).toBe('error');
    expect(restoreCalendar(store)).toEqual({ kind: 'none' });
  });
});

describe('applyParseResult (17.1, 17.8)', () => {
  it('stores the schedule on a successful parse and applies it (17.1)', () => {
    const store = new MemoryStorage();
    const parsed = schedule();

    const state = applyParseResult(
      { kind: 'ok', schedule: parsed, skippedEvents: 2 },
      NO_CALENDAR,
      store,
    );

    expect(state).toEqual({
      kind: 'loaded',
      schedule: parsed,
      persisted: true,
      notice: null,
    });
    expect(JSON.parse(store.getItem(BUSY_SCHEDULE_KEY) ?? '')).toEqual({
      storageVersion: BUSY_SCHEDULE_STORAGE_VERSION,
      schedule: parsed,
    });
    // A restore in a later visit sees the same schedule (17.2).
    expect(restoreCalendar(store)).toEqual(state);
  });

  it('stores a truncated schedule and carries the retained-count notice (14.14)', () => {
    const store = new MemoryStorage();
    const parsed = schedule({ truncated: true, discardedBlocks: 12 });

    const state = applyParseResult(
      {
        kind: 'truncated',
        schedule: parsed,
        skippedEvents: 0,
        discardedBlocks: 12,
      },
      NO_CALENDAR,
      store,
    );

    expect(state).toEqual({
      kind: 'loaded',
      schedule: parsed,
      persisted: true,
      notice: 'truncated',
    });
    expect(restoreCalendar(store)).toMatchObject({ schedule: parsed });
  });

  it('applies the schedule with persisted: false when the write fails (17.8)', () => {
    const store = new MemoryStorage();
    store.setItem = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    };
    const parsed = schedule();

    const state = applyParseResult(
      { kind: 'ok', schedule: parsed, skippedEvents: 0 },
      NO_CALENDAR,
      store,
    );

    expect(state).toEqual({
      kind: 'loaded',
      schedule: parsed,
      persisted: false,
      notice: null,
    });
    // The schedule still applies, so every Conflict_State is still computed.
    expect(scheduleOf(state)).toEqual(parsed);
  });

  it.each(FAILURES)(
    'retains the loaded schedule and stored value on $kind (14.15, 14.16, 14.17)',
    result => {
      const store = new MemoryStorage();
      const kept = schedule();
      saveStoredSchedule(kept, store);
      const previous: CalendarState = {
        kind: 'parsing',
        fileName: 'broken.ics',
        schedule: kept,
      };

      const state = applyParseResult(result, previous, store);

      expect(state).toEqual({
        kind: 'error',
        notice: result.kind,
        schedule: kept,
      });
      expect(scheduleOf(state)).toEqual(kept);
      expect(restoreCalendar(store)).toMatchObject({ schedule: kept });
    },
  );

  it.each(FAILURES)(
    'carries no schedule on $kind when none was loaded',
    result => {
      const store = new MemoryStorage();

      expect(applyParseResult(result, NO_CALENDAR, store)).toEqual({
        kind: 'error',
        notice: result.kind,
        schedule: null,
      });
      expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
    },
  );

  it('replaces a loaded schedule with a newly parsed one', () => {
    const store = new MemoryStorage();
    saveStoredSchedule(schedule(), store);
    const previous = restoreCalendar(store);

    const state = applyParseResult(
      { kind: 'ok', schedule: OTHER, skippedEvents: 0 },
      previous,
      store,
    );

    expect(scheduleOf(state)).toEqual(OTHER);
    expect(restoreCalendar(store)).toMatchObject({ schedule: OTHER });
  });
});

describe('removeCalendar (17.4, 17.6)', () => {
  it('removes the stored schedule and the loaded one', () => {
    const store = new MemoryStorage();
    saveStoredSchedule(schedule(), store);

    const state = removeCalendar(store);

    expect(state).toEqual({ kind: 'none' });
    expect(scheduleOf(state)).toBeNull();
    expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
    // The removal survives a reload (17.6).
    expect(restoreCalendar(store)).toEqual({ kind: 'none' });
  });

  it('removes an unreadable stored value too, with no could-not-restore notice', () => {
    const store = new MemoryStorage();
    store.setItem(BUSY_SCHEDULE_KEY, 'not json');

    expect(removeCalendar(store)).toEqual({ kind: 'none' });
    expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
  });

  it('is a no-op when nothing is stored', () => {
    const store = new MemoryStorage();

    expect(removeCalendar(store)).toEqual({ kind: 'none' });
    expect(store.length).toBe(0);
  });
});

/**
 * What removal has to clear is not stored in `CalendarState` at all: every
 * Conflict_State, every Conflict_Detail, and the excluded count are derived from
 * the schedule `scheduleOf` yields, and the hide-conflicts toggle setting lives in
 * `QueryState`, which removal never touches.
 */
describe('removal clears every derived conflict value and retains the toggle (17.4, 17.5)', () => {
  function team(entryId: string, meetingWindow: MeetingWindow): TeamRecord {
    return {
      entryId,
      sourceUrl: `https://vip.gatech.edu/teams/entry/${entryId}`,
      name: `Team ${entryId}`,
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
      meetingWindow,
    };
  }

  /** `1` conflicts with `schedule()`, `2` is clear, `3` is unknown. */
  const teams: readonly TeamRecord[] = [
    team('1', [{ weekday: 'Monday', startMinute: 600, endMinute: 660 }]),
    team('2', [{ weekday: 'Monday', startMinute: 660, endMinute: 720 }]),
    team('3', null),
  ];

  const dataset: Dataset = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt: '2026-01-05T04:30:00Z',
    teamCount: teams.length,
    teams,
  };

  const index = buildIndex(dataset);
  const qs = { ...DEFAULT_QUERY_STATE, hideConflicts: true };

  it('clears the Conflict_States, the Conflict_Detail, and the excluded count', () => {
    const store = new MemoryStorage();
    saveStoredSchedule(schedule(), store);
    const loaded = restoreCalendar(store);

    const before = derive(index, qs, scheduleOf(loaded));
    expect(before.conflicts?.get('1')).toBe('conflicting');
    expect(before.conflicts?.get('2')).toBe('clear');
    expect(before.conflicts?.get('3')).toBe('unknown');
    expect(before.hiddenByToggle).toBe(1);
    expect(
      conflictDetail(teams[0]!.meetingWindow, scheduleOf(loaded)!).blocks,
    ).toHaveLength(1);

    const removed = removeCalendar(store);
    const after = derive(index, qs, scheduleOf(removed), before);

    // No Conflict_State at all, rather than an empty map (15.7).
    expect(after.conflicts).toBeNull();
    expect(after.hiddenByToggle).toBe(0);
  });

  it('retains the toggle setting and returns every matching team to the Result_Set (17.5)', () => {
    const store = new MemoryStorage();
    saveStoredSchedule(schedule(), store);
    const before = derive(index, qs, scheduleOf(restoreCalendar(store)));
    expect(before.resultSet.map(scored => scored.team.entryId)).toEqual([
      '2',
      '3',
    ]);

    const after = derive(index, qs, scheduleOf(removeCalendar(store)), before);

    // The toggle is still on, and with no schedule it excludes nothing (16.4).
    expect(qs.hideConflicts).toBe(true);
    expect(after.resultSet.map(scored => scored.team.entryId)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('leaves the Search_Query, Filter values, Sort_Option, and page size unchanged (15.9)', () => {
    const store = new MemoryStorage();
    saveStoredSchedule(schedule(), store);
    const restored = restoreCalendar(store);
    const before = derive(index, qs, scheduleOf(restored));

    derive(index, qs, scheduleOf(removeCalendar(store)), before);

    expect(qs).toEqual({ ...DEFAULT_QUERY_STATE, hideConflicts: true });
  });
});
