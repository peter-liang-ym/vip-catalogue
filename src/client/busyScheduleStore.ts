/**
 * Busy_Schedule store (Requirements 17.1, 17.2, 17.7, 17.8).
 *
 * The only place that touches `localStorage`, under a single key, holding a
 * `StoredBusySchedule` and nothing else: the blocks with their summaries, the
 * Calendar_File name, the load time, and the storage version. No other part of
 * the Calendar_File is written (Requirement 17.1).
 *
 * Both directions are total. A throwing write is reported as `persisted: false`
 * so the caller keeps the schedule in memory for the visit and shows the
 * could-not-save notice — a storage failure costs persistence and nothing else
 * (Requirement 17.8). A stored value that is not JSON, is JSON of the wrong
 * shape, violates a Busy_Schedule invariant, or carries a different storage
 * version is `unreadable`, and the key is removed before returning: a value that
 * cannot be read once will not become readable later, and leaving it would
 * re-show the notice on every visit (Requirement 17.7).
 *
 * The storage version is deliberately separate from the Dataset `schemaVersion`:
 * one describes a device-local artifact, the other a published one, and bumping
 * either must not force a bump of the other.
 */

import {
  MAX_BUSY_BLOCKS,
  MAX_SHORT_TEXT_LENGTH,
  MINUTES_PER_DAY,
  WEEKDAYS,
  type BusyBlock,
  type BusySchedule,
  type StoredBusySchedule,
  type Weekday,
} from '../shared/types';

export const BUSY_SCHEDULE_KEY = 'vipmirror.busySchedule';
export const BUSY_SCHEDULE_STORAGE_VERSION = '1';

export type StoredLoadResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'loaded'; readonly schedule: BusySchedule }
  /** Corrupt or version mismatch; the key has been removed. */
  | { readonly kind: 'unreadable' };

const weekdayRank = new Map<Weekday, number>(
  WEEKDAYS.map((weekday, index) => [weekday, index]),
);

/**
 * The `Storage` to use, or `null` when there is none to use.
 *
 * Reading `globalThis.localStorage` is itself allowed to throw — a browser with
 * storage disabled does exactly that — so the lookup is guarded rather than
 * assumed. `null` makes every operation a well-defined no-op instead of an
 * exception at the call site.
 */
function resolveStore(store?: Storage): Storage | null {
  if (store !== undefined) return store;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isCappedString(value: unknown, maxLength: number): boolean {
  return typeof value === 'string' && value.length <= maxLength;
}

function isMinute(value: unknown): boolean {
  return (
    typeof value === 'number' && Number.isInteger(value) && !Number.isNaN(value)
  );
}

function isBusyBlock(value: unknown): value is BusyBlock {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as Record<string, unknown>;

  if (!weekdayRank.has(block.weekday as Weekday)) return false;
  if (!isMinute(block.startMinute) || !isMinute(block.endMinute)) return false;

  const start = block.startMinute as number;
  const end = block.endMinute as number;
  if (!(0 <= start && start < end && end <= MINUTES_PER_DAY)) return false;

  return (
    Array.isArray(block.summaries) &&
    block.summaries.every(summary =>
      isCappedString(summary, MAX_SHORT_TEXT_LENGTH),
    )
  );
}

/**
 * Whether the blocks hold the order and disjointness every Busy_Schedule
 * satisfies: weekday in `WEEKDAYS` order, then `startMinute` ascending, with no
 * two same-weekday blocks overlapping or touching (Requirement 14.13).
 *
 * Requiring a strictly increasing weekday rank across groups also rejects a
 * weekday that appears in two separate runs, which is what would let two
 * touching blocks slip past the pairwise check.
 */
function hasCanonicalBlocks(blocks: readonly BusyBlock[]): boolean {
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1]!;
    const current = blocks[index]!;
    const previousRank = weekdayRank.get(previous.weekday)!;
    const currentRank = weekdayRank.get(current.weekday)!;

    if (currentRank === previousRank) {
      if (current.startMinute <= previous.endMinute) return false;
    } else if (currentRank < previousRank) {
      return false;
    }
  }

  return true;
}

function isBusySchedule(value: unknown): value is BusySchedule {
  if (typeof value !== 'object' || value === null) return false;
  const schedule = value as Record<string, unknown>;

  if (!isCappedString(schedule.fileName, MAX_SHORT_TEXT_LENGTH)) return false;
  if (typeof schedule.loadedAt !== 'string') return false;
  if (typeof schedule.truncated !== 'boolean') return false;
  if (
    !isMinute(schedule.discardedBlocks) ||
    (schedule.discardedBlocks as number) < 0 ||
    (!schedule.truncated && schedule.discardedBlocks !== 0)
  ) {
    return false;
  }

  const blocks = schedule.blocks;
  if (!Array.isArray(blocks) || blocks.length > MAX_BUSY_BLOCKS) return false;
  if (!blocks.every(isBusyBlock)) return false;

  return hasCanonicalBlocks(blocks as readonly BusyBlock[]);
}

/**
 * The stored Busy_Schedule, if the key holds one that this version can read.
 *
 * Total over arbitrary stored strings: a missing key (or no usable storage at
 * all) is `none`, anything unreadable removes the key and reports `unreadable`,
 * and only a current-version, fully valid schedule is `loaded`
 * (Requirements 17.2, 17.7).
 */
export function loadStoredSchedule(store?: Storage): StoredLoadResult {
  const storage = resolveStore(store);
  if (storage === null) return { kind: 'none' };

  let raw: string | null;
  try {
    raw = storage.getItem(BUSY_SCHEDULE_KEY);
  } catch {
    // Storage that cannot be read holds nothing to restore and nothing to
    // remove, so there is no could-not-restore notice to earn here.
    return { kind: 'none' };
  }
  if (raw === null) return { kind: 'none' };

  const unreadable = (): StoredLoadResult => {
    removeStoredSchedule(storage);
    return { kind: 'unreadable' };
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unreadable();
  }

  if (typeof parsed !== 'object' || parsed === null) return unreadable();
  const stored = parsed as Record<string, unknown>;
  if (stored.storageVersion !== BUSY_SCHEDULE_STORAGE_VERSION) {
    return unreadable();
  }
  if (!isBusySchedule(stored.schedule)) return unreadable();

  return { kind: 'loaded', schedule: stored.schedule };
}

/**
 * Stores the Busy_Schedule under the single key, reporting whether it will
 * survive the visit.
 *
 * The written value is rebuilt field by field rather than serialized as given,
 * so nothing a caller happens to be carrying alongside a `BusySchedule` reaches
 * storage (Requirement 17.1).
 */
export function saveStoredSchedule(
  schedule: BusySchedule,
  store?: Storage,
): { readonly persisted: boolean } {
  const storage = resolveStore(store);
  if (storage === null) return { persisted: false };

  const stored: StoredBusySchedule = {
    storageVersion: BUSY_SCHEDULE_STORAGE_VERSION,
    schedule: {
      fileName: schedule.fileName,
      loadedAt: schedule.loadedAt,
      blocks: schedule.blocks.map(block => ({
        weekday: block.weekday,
        startMinute: block.startMinute,
        endMinute: block.endMinute,
        summaries: [...block.summaries],
      })),
      truncated: schedule.truncated,
      discardedBlocks: schedule.discardedBlocks,
    },
  };

  try {
    storage.setItem(BUSY_SCHEDULE_KEY, JSON.stringify(stored));
    return { persisted: true };
  } catch {
    return { persisted: false };
  }
}

/** Removes the stored Busy_Schedule. Never throws (Requirement 17.4). */
export function removeStoredSchedule(store?: Storage): void {
  const storage = resolveStore(store);
  if (storage === null) return;

  try {
    storage.removeItem(BUSY_SCHEDULE_KEY);
  } catch {
    // A removal that cannot happen leaves nothing for the caller to do.
  }
}
