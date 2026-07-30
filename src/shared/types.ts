/**
 * The shared data model. Parser, Serializer, validator, and UI all import these
 * types and caps from here, so a schema change breaks compilation on both halves
 * of the project instead of silently diverging.
 */

/** Cap for every text value in a Team_Record (Requirement 2.1). */
export const MAX_TEXT_LENGTH = 20_000;

/**
 * Cap for the short text values: College and Major names, advisor name,
 * affiliation and email, meeting day/time/location, Busy_Block summaries, and
 * the Calendar_File name (Requirements 2.1, 15.6).
 */
export const MAX_SHORT_TEXT_LENGTH = 200;

/** `majorsSought` holds at most this many entries (Requirement 2.1). */
export const MAX_MAJOR_ENTRIES = 200;

/** `advisors` holds at most this many entries (Requirement 2.1). */
export const MAX_ADVISORS = 20;

/** Minute-of-day upper bound: `1440` is end-of-day, never a start. */
export const MINUTES_PER_DAY = 1440;

/** A Meeting_Window holds 1..7 entries, one per distinct weekday. */
export const MAX_MEETING_WINDOW_ENTRIES = 7;

/** `schemaVersion` of the published Dataset; bumped when `meetingWindow` became required. */
export const DATASET_SCHEMA_VERSION = '2';

/** A Busy_Schedule retains at most this many merged blocks (Requirement 14.14). */
export const MAX_BUSY_BLOCKS = 200;

/** A Conflict_Detail reports at most this many blocks, each with at most this many summaries (Requirement 15.5). */
export const MAX_CONFLICT_DETAIL_BLOCKS = 5;
export const MAX_CONFLICT_DETAIL_SUMMARIES = 5;

export interface MajorEntry {
  readonly college: string; // trimmed, <= MAX_SHORT_TEXT_LENGTH
  readonly major: string; // trimmed, <= MAX_SHORT_TEXT_LENGTH
}

export interface Advisor {
  readonly name: string; // trimmed, <= MAX_SHORT_TEXT_LENGTH
  readonly affiliation: string; // trimmed, <= MAX_SHORT_TEXT_LENGTH, '' when absent
  readonly email: string; // trimmed, <= MAX_SHORT_TEXT_LENGTH, '' when absent
}

/** The meeting text exactly as the source site states it; always retained, never replaced by the derived window. */
export interface MeetingInfo {
  readonly day: string; // '' when unidentifiable
  readonly time: string; // '' when unidentifiable
  readonly location: string; // '' when unidentifiable
}

export type Weekday =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

/** Canonical weekday order. Meeting_Window entries, Busy_Blocks, and the day facet all order by this. */
export const WEEKDAYS: readonly Weekday[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export interface MeetingWindowEntry {
  readonly weekday: Weekday;
  readonly startMinute: number; // integer 0..1439, Atlanta wall clock
  readonly endMinute: number; // integer 1..1440, strictly greater than startMinute
}

/**
 * A list of 1..7 entries with distinct weekdays in WEEKDAYS order, or `null` for
 * unavailable.
 *
 * Unavailable is `null`, never `[]`. The empty array is not a legal value and the
 * validator rejects it: Requirement 15.1 classifies an unavailable window as
 * `unknown` and a window with entries as `clear` or `conflicting`, so two
 * spellings of "no entries" would make that classification ambiguous. `null` also
 * survives `JSON.stringify`/`JSON.parse` unchanged, which `undefined` would not.
 */
export type MeetingWindow = readonly MeetingWindowEntry[] | null;

/**
 * Invariants every published Team_Record satisfies: every text value is trimmed
 * and at most MAX_TEXT_LENGTH (MAX_SHORT_TEXT_LENGTH for the capped fields);
 * every field is present, using `''` or `[]` where the Parser found nothing;
 * `entryId`, `sourceUrl`, and `name` are non-empty; `meetingWindow` is `null` or
 * 1..MAX_MEETING_WINDOW_ENTRIES entries with distinct weekdays and
 * `0 <= startMinute < endMinute <= MINUTES_PER_DAY`, emitted in WEEKDAYS order.
 */
export interface TeamRecord {
  readonly entryId: string; // digits from /entry/{id}, non-empty, unique in a Dataset
  readonly sourceUrl: string; // https://vip.gatech.edu/teams/entry/{entryId}, non-empty
  readonly name: string; // non-empty; a record is not produced without it
  readonly imageUrl: string; // absolute source URL, '' when absent
  readonly imagePath: string; // local cached copy, e.g. images/1248.png, '' when absent
  readonly imageAlt: string;
  readonly goals: string;
  readonly issuesAddressed: string;
  readonly partnersSponsors: string;
  readonly methodsTechnologies: string;
  readonly majorsSought: readonly MajorEntry[]; // <= MAX_MAJOR_ENTRIES, pairs unique
  readonly preferredInterests: string;
  readonly advisors: readonly Advisor[]; // <= MAX_ADVISORS
  readonly meeting: MeetingInfo; // the source text, always retained
  readonly meetingWindow: MeetingWindow; // derived; null when unavailable
}

/** The published artifact: one JSON document holding every Team_Record. */
export interface Dataset {
  readonly schemaVersion: string; // DATASET_SCHEMA_VERSION
  readonly generatedAt: string; // ISO 8601 UTC, second precision: 2026-01-05T04:30:00Z
  readonly teamCount: number;
  readonly teams: readonly TeamRecord[];
}

// Calendar and conflict models. These exist only in the browser: none of them is
// published, and none of them is encoded into the address bar.

export interface BusyBlock {
  readonly weekday: Weekday;
  readonly startMinute: number; // integer 0..1439, Atlanta wall clock
  readonly endMinute: number; // integer 1..1440, strictly greater than startMinute
  // contributing event SUMMARYs, each <= MAX_SHORT_TEXT_LENGTH, deduplicated in
  // first-seen order, '' allowed
  readonly summaries: readonly string[];
}

/**
 * Invariants every Busy_Schedule satisfies, both from the Calendar_Parser and
 * after a store round trip: at most MAX_BUSY_BLOCKS blocks; no two blocks share a
 * weekday and overlap or touch; every block has
 * `0 <= startMinute < endMinute <= MINUTES_PER_DAY`; blocks are ordered by
 * weekday in WEEKDAYS order then `startMinute` ascending (Requirement 14.13).
 */
export interface BusySchedule {
  readonly fileName: string; // Calendar_File name, <= MAX_SHORT_TEXT_LENGTH
  readonly loadedAt: string; // ISO 8601, the load time shown to the visitor
  readonly blocks: readonly BusyBlock[];
  readonly truncated: boolean;
  readonly discardedBlocks: number; // 0 unless truncated
}

/** Exhaustive and mutually exclusive: `unknown` is exactly the null Meeting_Window case (Requirement 15.1). */
export type ConflictState = 'conflicting' | 'clear' | 'unknown';

export interface ConflictDetail {
  readonly blocks: readonly {
    readonly block: BusyBlock; // one of the overlapping blocks
    readonly summaries: readonly string[]; // <= MAX_CONFLICT_DETAIL_SUMMARIES, each <= MAX_SHORT_TEXT_LENGTH
  }[]; // <= MAX_CONFLICT_DETAIL_BLOCKS entries, canonical block order
}

/** The only persisted client artifact. `storageVersion` is compared exactly on load. */
export interface StoredBusySchedule {
  readonly storageVersion: string;
  readonly schedule: BusySchedule;
}
