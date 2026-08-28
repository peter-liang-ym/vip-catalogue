/**
 * Meeting_Window derivation (Requirement 13).
 *
 * The Parser hands over the meeting day text and meeting time text exactly as the
 * source site states them; this module derives the structured window from them and
 * never modifies either text value. When the text cannot be resolved the window is
 * the unavailable value (`null`) and the reasons come back as failures the
 * Ingestion_Job records as omissions.
 */

import {
  MAX_MEETING_WINDOW_ENTRIES,
  MINUTES_PER_DAY,
  WEEKDAYS,
  type MeetingWindow,
  type MeetingWindowEntry,
  type Weekday,
} from '../shared/types';

export type MeetingWindowFailure =
  | 'noWeekday'
  | 'noStartTime'
  | 'noEndTime'
  | 'endNotAfterStart'
  | 'tooManyWeekdays'
  | 'tooManyRanges';

export interface MeetingWindowResult {
  readonly window: MeetingWindow; // entry list, or null for unavailable
  readonly failures: readonly MeetingWindowFailure[]; // empty when window is a list
}

/** Reported in this order so an Ingestion_Report entry is deterministic. */
const FAILURE_ORDER: readonly MeetingWindowFailure[] = [
  'noWeekday',
  'noStartTime',
  'noEndTime',
  'endNotAfterStart',
  'tooManyWeekdays',
  'tooManyRanges',
];

/**
 * Accepted weekday spellings: the full English name and the 3-letter abbreviation,
 * plus the longer abbreviations the source site uses (`Tues`, `Thurs`, `Weds`).
 */
const WEEKDAY_SPELLINGS: Readonly<Record<string, Weekday>> = {
  monday: 'Monday',
  mon: 'Monday',
  tuesday: 'Tuesday',
  tues: 'Tuesday',
  tue: 'Tuesday',
  wednesday: 'Wednesday',
  weds: 'Wednesday',
  wed: 'Wednesday',
  thursday: 'Thursday',
  thurs: 'Thursday',
  thur: 'Thursday',
  thu: 'Thursday',
  friday: 'Friday',
  fri: 'Friday',
  saturday: 'Saturday',
  sat: 'Saturday',
  sunday: 'Sunday',
  sun: 'Sunday',
};

/**
 * The accepted weekday spellings as a regex alternation, the longest spelling of
 * each day first. Exported so the Parser can locate the meeting day component
 * without redefining the spellings.
 */
export const WEEKDAY_WORD_SOURCE = Object.keys(WEEKDAY_SPELLINGS).join('|');

// Word boundaries make the scan whitespace- and punctuation-insensitive, so
// `Tue/Thu`, `Tuesday, Thursday`, and `TUES  THURS` all yield the same pair.
const WEEKDAY_PATTERN = new RegExp(`\\b(${WEEKDAY_WORD_SOURCE})\\b`, 'gi');

const MERIDIEM = '(?:([ap])\\.?m\\.?)?';
const CLOCK = `(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}`;
const SEPARATOR = '(?:-|\\u2013|\\u2014|\\bto\\b|\\buntil\\b)';
const RANGE_PATTERN = new RegExp(`${CLOCK}\\s*${SEPARATOR}\\s*${CLOCK}`, 'gi');
const CLOCK_PATTERN = new RegExp(CLOCK, 'i');
const SEPARATOR_PATTERN = new RegExp(SEPARATOR, 'i');

type Meridiem = 'a' | 'p';

interface Clock {
  readonly hour: number;
  readonly minute: number;
  readonly meridiem: Meridiem | null;
}

interface WeekdayScan {
  readonly tokenCount: number;
  readonly weekdays: readonly Weekday[]; // distinct, in WEEKDAYS order
}

function scanWeekdays(dayText: string): WeekdayScan {
  const found = new Set<Weekday>();
  let tokenCount = 0;

  for (const match of dayText.matchAll(WEEKDAY_PATTERN)) {
    const weekday = WEEKDAY_SPELLINGS[match[1]!.toLowerCase()];
    if (weekday === undefined) continue;
    tokenCount += 1;
    found.add(weekday);
  }

  return {
    tokenCount,
    weekdays: WEEKDAYS.filter(weekday => found.has(weekday)),
  };
}

/**
 * The distinct weekdays named in `text`, in Monday..Sunday order. Exported so the
 * day facet reads weekdays out of the meeting day text with the same accepted
 * spellings the Meeting_Window derivation uses (Requirement 6.2).
 */
export function weekdaysInText(text: string): readonly Weekday[] {
  return scanWeekdays(text).weekdays;
}

/** `null` when the captured text is not a clock time (hour past 23, minute past 59). */
function toClock(
  hourText: string | undefined,
  minuteText: string | undefined,
  meridiemText: string | undefined,
): Clock | null {
  if (hourText === undefined) return null;

  const hour = Number(hourText);
  // An omitted minute component is minute 0 (Requirement 13.5).
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  if (hour > 23 || minute > 59) return null;

  return {
    hour,
    minute,
    meridiem:
      meridiemText === undefined
        ? null
        : (meridiemText.toLowerCase() as Meridiem),
  };
}

function matchClock(text: string): Clock | null {
  const match = CLOCK_PATTERN.exec(text);
  if (match === null) return null;
  return toClock(match[1], match[2], match[3]);
}

/**
 * Minute of day after meridiem resolution (Requirements 13.6, 13.7):
 * a stated meridiem wins, otherwise the one the other clock time states is
 * inherited, otherwise a bare hour of 1-7 is afternoon, 8-11 morning, 12 noon.
 */
function resolveMinutes(clock: Clock, otherMeridiem: Meridiem | null): number {
  const stated = clock.meridiem ?? otherMeridiem;
  let hour = clock.hour;

  if (stated !== null && hour >= 1 && hour <= 12) {
    hour = stated === 'p' ? (hour % 12) + 12 : hour % 12;
  } else if (stated === null && hour >= 1 && hour <= 7) {
    hour += 12;
  }

  return hour * 60 + clock.minute;
}

interface TimeRange {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * Resolves the single start/end pair `timeText` states, pushing a failure for each
 * component it cannot determine.
 */
function resolveTimeRange(
  timeText: string,
  failures: MeetingWindowFailure[],
): TimeRange | null {
  const ranges = [...timeText.matchAll(RANGE_PATTERN)];

  // More than one pair is ambiguous, so the window degrades rather than guessing
  // which pair the team means (Requirement 13.12).
  if (ranges.length > 1) {
    failures.push('tooManyRanges');
    return null;
  }

  if (ranges.length === 0) {
    // Either side may be the missing one; when no separator is present at all the
    // single clock time found, if any, counts as the start.
    const separator = SEPARATOR_PATTERN.exec(timeText);
    const start =
      separator === null
        ? matchClock(timeText)
        : matchClock(timeText.slice(0, separator.index));
    const end =
      separator === null
        ? null
        : matchClock(timeText.slice(separator.index + separator[0].length));

    if (start === null) failures.push('noStartTime');
    if (end === null) failures.push('noEndTime');
    return null;
  }

  const range = ranges[0]!;
  const start = toClock(range[1], range[2], range[3]);
  const end = toClock(range[4], range[5], range[6]);
  if (start === null) failures.push('noStartTime');
  if (end === null) failures.push('noEndTime');
  if (start === null || end === null) return null;

  const startMinute = resolveMinutes(start, end.meridiem);
  let endMinute = resolveMinutes(end, start.meridiem);

  // 12-hour end repair: `11:00 - 1:00` means 660-780 (Requirement 13.8).
  if (endMinute <= startMinute) {
    const repaired = endMinute + 12 * 60;
    if (repaired > startMinute && repaired <= MINUTES_PER_DAY) {
      endMinute = repaired;
    } else {
      failures.push('endNotAfterStart');
      return null;
    }
  }

  return { startMinute, endMinute };
}

/**
 * Derives the Meeting_Window from the meeting day and time text.
 *
 * Returns one entry per distinct named weekday in Monday..Sunday order, each
 * carrying the same start and end minute of day, or the unavailable value with the
 * failures that made the text unresolvable.
 */
export function deriveMeetingWindow(
  dayText: string,
  timeText: string,
): MeetingWindowResult {
  const failures: MeetingWindowFailure[] = [];

  const { tokenCount, weekdays } = scanWeekdays(dayText);
  if (tokenCount === 0) failures.push('noWeekday');
  if (tokenCount > MAX_MEETING_WINDOW_ENTRIES) failures.push('tooManyWeekdays');

  const range = resolveTimeRange(timeText, failures);

  if (failures.length > 0 || range === null) {
    return {
      window: null,
      failures: FAILURE_ORDER.filter(failure => failures.includes(failure)),
    };
  }

  const entries: MeetingWindowEntry[] = weekdays.map(weekday => ({
    weekday,
    startMinute: range.startMinute,
    endMinute: range.endMinute,
  }));

  return { window: entries, failures: [] };
}
