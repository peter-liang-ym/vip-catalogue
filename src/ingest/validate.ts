/**
 * Dataset validation and the publication gate (Requirements 3.3, 3.5, 3.7).
 *
 * `validateDataset` answers one question: is this Dataset fit to publish or to
 * render? It reports every failed check rather than the first, because the
 * Ingestion_Report is what a maintainer reads to work out what drifted on the
 * source site, and one entry per affected record is more useful than a single
 * abort reason.
 *
 * `checkPublishable` adds the two guards that depend on facts outside the
 * document itself: a Dataset with no records never replaces a good one, and
 * neither does one that lost more than a fifth of the previous run's records —
 * that ratio is the guard that catches wholesale markup drift.
 *
 * Both functions are total. A Dataset reaching here has usually come back through
 * `deserialize`, which does no checking at all, so every value is treated as
 * unknown until it has been examined; nothing here throws on a malformed
 * document.
 */

import {
  MAX_MEETING_WINDOW_ENTRIES,
  MINUTES_PER_DAY,
  WEEKDAYS,
  type Dataset,
} from '../shared/types';

export type ValidationCheck =
  | 'schemaVersionMissing'
  | 'generatedAtMissing'
  | 'nameEmpty'
  | 'sourceUrlEmpty'
  | 'entryIdEmpty'
  | 'entryIdDuplicated'
  | 'fieldMissing'
  | 'meetingWindowInvalid'
  | 'zeroRecords'
  | 'countDrop';

export interface ValidationFailure {
  readonly check: ValidationCheck;
  readonly entryId?: string;
  readonly detail?: string;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failures: readonly ValidationFailure[] };

/**
 * The text-valued fields of Requirement 2 acceptance criterion 1. Each must be
 * present as a string, using `''` where the Parser produced nothing.
 *
 * `imagePath` is deliberately absent: it names the local image copy, which the
 * publish store writes after the publication gate has already passed, so
 * requiring it here would reject every Dataset on its first run.
 */
const REQUIRED_TEXT_FIELDS = [
  'imageUrl',
  'imageAlt',
  'goals',
  'issuesAddressed',
  'partnersSponsors',
  'methodsTechnologies',
  'preferredInterests',
] as const;

/** The list-valued fields of Requirement 2 acceptance criterion 1. */
const REQUIRED_LIST_FIELDS = ['majorsSought', 'advisors'] as const;

/** Meeting_Info is present as an object holding these three text values. */
const REQUIRED_MEETING_FIELDS = ['day', 'time', 'location'] as const;

/** The new Dataset must keep at least this share of the previous record count. */
const COUNT_DROP_NUMERATOR = 4;
const COUNT_DROP_DENOMINATOR = 5;

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function readEntryId(record: Record<string, unknown>): string | undefined {
  const { entryId } = record;
  return typeof entryId === 'string' ? entryId : undefined;
}

/**
 * Requirement 3.3 on `meetingWindow`: present, and either the unavailable value
 * (`null`) or a list of 1..7 entries with distinct canonical weekdays and integer
 * minutes satisfying `0 <= startMinute < endMinute <= 1440`.
 *
 * An empty list is invalid. Unavailable has exactly one spelling, `null`, because
 * Requirement 15.1 gives "no entries" and "unavailable" different Conflict_States
 * and a second spelling would make that classification ambiguous.
 *
 * Returns the reason the field is invalid, or `undefined` when it is valid.
 */
function meetingWindowProblem(
  record: Record<string, unknown>,
): string | undefined {
  if (!('meetingWindow' in record)) return 'field not present';

  const window = record.meetingWindow;
  if (window === null) return undefined;
  if (!Array.isArray(window)) return 'neither null nor a list of entries';
  if (window.length === 0) {
    return 'empty list; unavailable is spelled null';
  }
  if (window.length > MAX_MEETING_WINDOW_ENTRIES) {
    return `${window.length} entries exceeds the ${MAX_MEETING_WINDOW_ENTRIES} weekday maximum`;
  }

  const seen = new Set<string>();
  for (const [index, entry] of window.entries()) {
    if (!isRecordObject(entry)) return `entry ${index} is not an object`;

    const { weekday, startMinute, endMinute } = entry;
    if (
      typeof weekday !== 'string' ||
      !WEEKDAYS.includes(weekday as (typeof WEEKDAYS)[number])
    ) {
      return `entry ${index} has no canonical weekday`;
    }
    if (seen.has(weekday)) return `weekday ${weekday} occurs more than once`;
    seen.add(weekday);

    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
      return `entry ${index} (${weekday}) has non-integer minutes`;
    }
    const start = startMinute as number;
    const end = endMinute as number;
    if (start < 0 || end > MINUTES_PER_DAY || start >= end) {
      return `entry ${index} (${weekday}) has minutes outside 0 <= ${start} < ${end} <= ${MINUTES_PER_DAY}`;
    }
  }

  return undefined;
}

function validateRecord(
  value: unknown,
  index: number,
  seenEntryIds: Set<string>,
  failures: ValidationFailure[],
): void {
  if (!isRecordObject(value)) {
    failures.push({
      check: 'fieldMissing',
      detail: `team at position ${index} is not a record`,
    });
    return;
  }

  const entryId = readEntryId(value);

  if (!isNonEmptyString(value.entryId)) {
    failures.push({
      check: 'entryIdEmpty',
      entryId,
      detail: `team at position ${index}`,
    });
  } else if (seenEntryIds.has(value.entryId as string)) {
    failures.push({ check: 'entryIdDuplicated', entryId });
  } else {
    seenEntryIds.add(value.entryId as string);
  }

  if (!isNonEmptyString(value.name)) {
    failures.push({ check: 'nameEmpty', entryId });
  }
  if (!isNonEmptyString(value.sourceUrl)) {
    failures.push({ check: 'sourceUrlEmpty', entryId });
  }

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (typeof value[field] !== 'string') {
      failures.push({ check: 'fieldMissing', entryId, detail: field });
    }
  }
  for (const field of REQUIRED_LIST_FIELDS) {
    if (!Array.isArray(value[field])) {
      failures.push({ check: 'fieldMissing', entryId, detail: field });
    }
  }

  const meeting = value.meeting;
  if (!isRecordObject(meeting)) {
    failures.push({ check: 'fieldMissing', entryId, detail: 'meeting' });
  } else {
    for (const field of REQUIRED_MEETING_FIELDS) {
      if (typeof meeting[field] !== 'string') {
        failures.push({
          check: 'fieldMissing',
          entryId,
          detail: `meeting.${field}`,
        });
      }
    }
  }

  const problem = meetingWindowProblem(value);
  if (problem !== undefined) {
    failures.push({ check: 'meetingWindowInvalid', entryId, detail: problem });
  }
}

/**
 * Runs every Requirement 3.3 check over a Dataset and returns all failures.
 *
 * The record count guards are not here: they live in `checkPublishable`, so a
 * Dataset can be validated for shape without a previous run to compare against.
 */
export function validateDataset(dataset: Dataset): ValidationResult {
  const failures: ValidationFailure[] = [];
  const document = dataset as unknown;

  if (!isRecordObject(document)) {
    return {
      ok: false,
      failures: [
        { check: 'fieldMissing', detail: 'dataset is not a JSON object' },
      ],
    };
  }

  if (!isNonEmptyString(document.schemaVersion)) {
    failures.push({ check: 'schemaVersionMissing' });
  }
  if (!isNonEmptyString(document.generatedAt)) {
    failures.push({ check: 'generatedAtMissing' });
  }

  const teams = document.teams;
  if (!Array.isArray(teams)) {
    failures.push({ check: 'fieldMissing', detail: 'teams' });
    return { ok: false, failures };
  }

  const seenEntryIds = new Set<string>();
  for (const [index, team] of teams.entries()) {
    validateRecord(team, index, seenEntryIds, failures);
  }

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

/**
 * The publication gate: the Requirement 3.3 checks plus the zero-record
 * (Requirement 3.7) and count-drop (Requirement 3.5) guards.
 *
 * `previousCount` is `undefined` when no Dataset has been published before, in
 * which case the count-drop guard does not apply. The comparison is done in
 * integers so a Dataset sitting exactly on the 80 percent line always passes.
 */
export function checkPublishable(
  dataset: Dataset,
  previousCount: number | undefined,
): ValidationResult {
  const shape = validateDataset(dataset);
  const failures: ValidationFailure[] = shape.ok ? [] : [...shape.failures];

  const teams = (dataset as unknown as Record<string, unknown>).teams;
  const count = Array.isArray(teams) ? teams.length : 0;

  if (count === 0) {
    failures.push({
      check: 'zeroRecords',
      detail: 'the Dataset has 0 records',
    });
  } else if (
    previousCount !== undefined &&
    count * COUNT_DROP_DENOMINATOR < previousCount * COUNT_DROP_NUMERATOR
  ) {
    failures.push({
      check: 'countDrop',
      detail: `${count} records is below 80 percent of the previous ${previousCount}`,
    });
  }

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
