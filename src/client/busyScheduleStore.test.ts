import { describe, expect, it } from 'vitest';
import type { BusyBlock, BusySchedule, Weekday } from '../shared/types';
import {
  BUSY_SCHEDULE_KEY,
  BUSY_SCHEDULE_STORAGE_VERSION,
  loadStoredSchedule,
  removeStoredSchedule,
  saveStoredSchedule,
} from './busyScheduleStore';

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

function block(
  weekday: Weekday,
  startMinute: number,
  endMinute: number,
  ...summaries: string[]
): BusyBlock {
  return { weekday, startMinute, endMinute, summaries };
}

function schedule(overrides: Partial<BusySchedule> = {}): BusySchedule {
  return {
    fileName: 'schedule.ics',
    loadedAt: '2025-01-15T14:30:00.000Z',
    blocks: [
      block('Monday', 570, 620, 'MATH 1554', ''),
      block('Monday', 780, 830, 'CS 1332'),
      block('Wednesday', 570, 620, 'MATH 1554'),
    ],
    truncated: false,
    discardedBlocks: 0,
    ...overrides,
  };
}

/** Puts a raw string under the key, bypassing `saveStoredSchedule`. */
function seed(store: Storage, raw: string): void {
  store.setItem(BUSY_SCHEDULE_KEY, raw);
}

describe('saveStoredSchedule', () => {
  it('round-trips blocks, summaries, order, file name, and load time', () => {
    const store = new MemoryStorage();
    const original = schedule();

    expect(saveStoredSchedule(original, store)).toEqual({ persisted: true });
    expect(loadStoredSchedule(store)).toEqual({
      kind: 'loaded',
      schedule: original,
    });
  });

  it('round-trips a truncated schedule and an empty one', () => {
    const store = new MemoryStorage();
    const truncated = schedule({ truncated: true, discardedBlocks: 17 });
    saveStoredSchedule(truncated, store);
    expect(loadStoredSchedule(store)).toEqual({
      kind: 'loaded',
      schedule: truncated,
    });

    const empty = schedule({ blocks: [] });
    saveStoredSchedule(empty, store);
    expect(loadStoredSchedule(store)).toEqual({
      kind: 'loaded',
      schedule: empty,
    });
  });

  it('writes the storage version and the schedule values, and nothing else', () => {
    const store = new MemoryStorage();
    const original = schedule();
    saveStoredSchedule(
      { ...original, secretFileText: 'BEGIN:VCALENDAR' } as BusySchedule,
      store,
    );

    const raw = store.getItem(BUSY_SCHEDULE_KEY) ?? '';
    expect(JSON.parse(raw)).toEqual({
      storageVersion: BUSY_SCHEDULE_STORAGE_VERSION,
      schedule: original,
    });
    expect(raw).not.toContain('BEGIN:VCALENDAR');
  });

  it('reports persisted: false when the write throws, and stores nothing', () => {
    const store = new MemoryStorage();
    store.setItem = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    };

    expect(saveStoredSchedule(schedule(), store)).toEqual({
      persisted: false,
    });
    expect(loadStoredSchedule(store)).toEqual({ kind: 'none' });
  });
});

describe('loadStoredSchedule', () => {
  it('returns none when the key holds nothing', () => {
    expect(loadStoredSchedule(new MemoryStorage())).toEqual({ kind: 'none' });
  });

  it.each([
    ['not JSON at all', 'not json'],
    ['truncated JSON', '{"storageVersion":"1","schedu'],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON number', '42'],
  ])('returns unreadable for %s and removes the key', (_label, raw) => {
    const store = new MemoryStorage();
    seed(store, raw);

    expect(loadStoredSchedule(store)).toEqual({ kind: 'unreadable' });
    expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
  });

  it.each(['0', '2', 1, undefined])(
    'returns unreadable for storage version %s',
    version => {
      const store = new MemoryStorage();
      seed(
        store,
        JSON.stringify({ storageVersion: version, schedule: schedule() }),
      );

      expect(loadStoredSchedule(store)).toEqual({ kind: 'unreadable' });
      expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
    },
  );

  it.each<[string, unknown]>([
    ['a missing schedule', undefined],
    ['a non-object schedule', 'schedule.ics'],
    ['a missing file name', { ...schedule(), fileName: undefined }],
    ['a non-string load time', { ...schedule(), loadedAt: 1737000000000 }],
    ['a non-boolean truncated flag', { ...schedule(), truncated: 'yes' }],
    [
      'discarded blocks without truncation',
      { ...schedule(), discardedBlocks: 3 },
    ],
    ['a non-array blocks value', { ...schedule(), blocks: {} }],
    [
      'an unknown weekday',
      { ...schedule(), blocks: [block('Funday' as Weekday, 570, 620)] },
    ],
    [
      'a non-integer minute',
      { ...schedule(), blocks: [block('Monday', 570.5, 620)] },
    ],
    [
      'an end minute past the day',
      { ...schedule(), blocks: [block('Monday', 1430, 1441)] },
    ],
    [
      'an inverted block',
      { ...schedule(), blocks: [block('Monday', 620, 570)] },
    ],
    ['an empty block', { ...schedule(), blocks: [block('Monday', 570, 570)] }],
    [
      'overlapping same-weekday blocks',
      {
        ...schedule(),
        blocks: [block('Monday', 570, 620), block('Monday', 600, 700)],
      },
    ],
    [
      'touching same-weekday blocks',
      {
        ...schedule(),
        blocks: [block('Monday', 570, 620), block('Monday', 620, 700)],
      },
    ],
    [
      'blocks out of weekday order',
      {
        ...schedule(),
        blocks: [block('Wednesday', 570, 620), block('Monday', 570, 620)],
      },
    ],
    [
      'blocks out of start-minute order',
      {
        ...schedule(),
        blocks: [block('Monday', 780, 830), block('Monday', 570, 620)],
      },
    ],
    [
      'a weekday split across two runs',
      {
        ...schedule(),
        blocks: [
          block('Monday', 570, 620),
          block('Tuesday', 570, 620),
          block('Monday', 620, 700),
        ],
      },
    ],
    [
      'more than 200 blocks',
      {
        ...schedule(),
        blocks: Array.from({ length: 201 }, (_unused, index) =>
          block('Monday', index * 2, index * 2 + 1),
        ),
      },
    ],
    [
      'a non-string summary',
      { ...schedule(), blocks: [block('Monday', 570, 620, 7 as never)] },
    ],
  ])('returns unreadable for %s and removes the key', (_label, badSchedule) => {
    const store = new MemoryStorage();
    seed(
      store,
      JSON.stringify({
        storageVersion: BUSY_SCHEDULE_STORAGE_VERSION,
        schedule: badSchedule,
      }),
    );

    expect(loadStoredSchedule(store)).toEqual({ kind: 'unreadable' });
    expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
  });

  it('returns none when reading the store throws', () => {
    const store = new MemoryStorage();
    store.getItem = () => {
      throw new DOMException('storage disabled', 'SecurityError');
    };

    expect(loadStoredSchedule(store)).toEqual({ kind: 'none' });
  });
});

describe('removeStoredSchedule', () => {
  it('leaves no stored schedule behind', () => {
    const store = new MemoryStorage();
    saveStoredSchedule(schedule(), store);

    removeStoredSchedule(store);

    expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
    expect(loadStoredSchedule(store)).toEqual({ kind: 'none' });
  });

  it('is a no-op when nothing is stored and when removal throws', () => {
    const store = new MemoryStorage();
    expect(() => removeStoredSchedule(store)).not.toThrow();

    store.removeItem = () => {
      throw new DOMException('storage disabled', 'SecurityError');
    };
    expect(() => removeStoredSchedule(store)).not.toThrow();
  });
});
