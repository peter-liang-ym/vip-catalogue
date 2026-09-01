/**
 * Property 36: Unavailable is returned for exactly the unresolvable meeting texts.
 *
 * **Validates: Requirements 13.9, 13.11, 13.12, 2.11**
 *
 * `deriveMeetingWindow` returns the unavailable value (`null`) if and only if the
 * meeting text is unresolvable: no weekday is named (13.11), no start clock time
 * is found (13.11), no end clock time is found (13.11), the resolved `endMinute`
 * is not greater than `startMinute` and the 12-hour repair cannot make it so
 * within 1440 (13.9), more than 7 weekdays are named (13.12), or more than one
 * start/end pair is present (13.12). In every such case at least one failure is
 * reported so the Ingestion_Report can record the omission (2.11); otherwise a
 * well-formed Meeting_Window is returned with no failures.
 *
 * The property is stated as a biconditional and checked two ways. A free-text
 * domain (arbitrary strings plus the design's adversarial texts) exercises the
 * `null` <=> failures equivalence and the totality of the branch. A targeted
 * domain then drives each individual failure condition so no branch is left to
 * chance, each paired with the specific failure kind the acceptance criteria
 * demand.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_MEETING_WINDOW_ENTRIES,
  MINUTES_PER_DAY,
  WEEKDAYS,
} from '../shared/types';
import {
  deriveMeetingWindow,
  type MeetingWindowFailure,
} from './meetingWindow';

const FAILURE_KINDS: readonly MeetingWindowFailure[] = [
  'noWeekday',
  'noStartTime',
  'noEndTime',
  'endNotAfterStart',
  'tooManyWeekdays',
  'tooManyRanges',
];

/** Asserts a result is a well-formed, non-unavailable Meeting_Window with no failures. */
function expectResolved(result: ReturnType<typeof deriveMeetingWindow>): void {
  expect(result.failures).toEqual([]);
  expect(result.window).not.toBeNull();
  const entries = result.window!;
  expect(entries.length).toBeGreaterThanOrEqual(1);
  expect(entries.length).toBeLessThanOrEqual(MAX_MEETING_WINDOW_ENTRIES);
  for (const entry of entries) {
    expect(entry.startMinute).toBeGreaterThanOrEqual(0);
    expect(entry.endMinute).toBeLessThanOrEqual(MINUTES_PER_DAY);
    expect(entry.endMinute).toBeGreaterThan(entry.startMinute);
  }
}

/** Asserts a result is the unavailable value carrying at least one known failure. */
function expectUnavailable(
  result: ReturnType<typeof deriveMeetingWindow>,
): void {
  expect(result.window).toBeNull();
  expect(result.failures.length).toBeGreaterThan(0);
  for (const failure of result.failures) {
    expect(FAILURE_KINDS).toContain(failure);
  }
}

describe('Property 36: Unavailable is returned for exactly the unresolvable meeting texts', () => {
  it('returns unavailable if and only if it reports a failure, over arbitrary text', () => {
    const arbFreeText = fc.oneof(
      fc.string(),
      fc.string({ unit: 'grapheme' }),
      fc.constantFrom(
        '',
        '   ',
        'by arrangement',
        'Monday',
        '9:30-10:20',
        '13:00 - 12:00',
        '12:00 - 12:00',
        'Monday, Wednesday 9-10 and Tuesday, Thursday 2-3',
        'Mon Tue Wed Thu Fri Sat Sun Mon',
      ),
    );

    fc.assert(
      fc.property(arbFreeText, arbFreeText, (dayText, timeText) => {
        const result = deriveMeetingWindow(dayText, timeText);

        // The biconditional: the unavailable value and a reported failure occur
        // together, never one without the other.
        expect(result.window === null).toBe(result.failures.length > 0);

        if (result.window === null) {
          expectUnavailable(result);
        } else {
          expectResolved(result);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('returns unavailable with noWeekday when the day text names no weekday (13.11)', () => {
    // Day text drawn from words that never spell a weekday, paired with a
    // resolvable time so only the missing weekday can force the branch.
    const arbNonWeekdayDay = fc.constantFrom(
      '',
      '   ',
      'by arrangement',
      'TBD',
      'flexible',
      'see syllabus',
    );

    fc.assert(
      fc.property(arbNonWeekdayDay, dayText => {
        const result = deriveMeetingWindow(dayText, '9:00 - 10:00 AM');
        expectUnavailable(result);
        expect(result.failures).toContain('noWeekday');
      }),
      { numRuns: 200 },
    );
  });

  it('returns unavailable with noStartTime or noEndTime when a clock time is missing (13.11)', () => {
    const arbUnresolvableTime = fc.constantFrom(
      '',
      '   ',
      'noon',
      'in the morning',
      'to 10:00',
      'until 5:00',
      '9:00 -',
      '9:00 to',
    );

    fc.assert(
      fc.property(arbUnresolvableTime, timeText => {
        const result = deriveMeetingWindow('Monday', timeText);
        expectUnavailable(result);
        expect(
          result.failures.includes('noStartTime') ||
            result.failures.includes('noEndTime'),
        ).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('returns unavailable with endNotAfterStart when the repair cannot order the range (13.9)', () => {
    // 24-hour times where the end is at or before the start and adding 12 hours
    // cannot land strictly after the start within 1440: either the repair is not
    // strictly greater than the start (`repaired == startMinute`) or it overflows
    // past 1440 because the end is already an afternoon 24-hour time.
    const arbUnorderable = fc.constantFrom(
      '15:00 - 3:00', // 900 vs 180; repaired 900 is not > 900
      '18:00 - 6:00', // 1080 vs 360; repaired 1080 is not > 1080
      '23:00 - 23:00', // 1380 vs 1380; repaired 2100 overflows 1440
      '20:00 - 20:00', // 1200 vs 1200; repaired 1920 overflows 1440
      '13:30 - 1:30', // 810 vs 810 (1:30 with no meridiem is afternoon); repaired 1530 overflows
    );

    fc.assert(
      fc.property(arbUnorderable, timeText => {
        const result = deriveMeetingWindow('Monday', timeText);
        expectUnavailable(result);
        expect(result.failures).toContain('endNotAfterStart');
      }),
      { numRuns: 200 },
    );
  });

  it('returns unavailable with tooManyWeekdays when more than 7 weekday tokens appear (13.12)', () => {
    // Every distinct weekday plus one repeat is 8 tokens: more than the 7 a
    // window can hold, so the text degrades rather than deriving entries.
    const arbTooManyDays = fc
      .constantFrom(...WEEKDAYS)
      .map(repeated => [...WEEKDAYS, repeated].join(', '));

    fc.assert(
      fc.property(arbTooManyDays, dayText => {
        const result = deriveMeetingWindow(dayText, '9:00 - 10:00 AM');
        expectUnavailable(result);
        expect(result.failures).toContain('tooManyWeekdays');
      }),
      { numRuns: 200 },
    );
  });

  it('returns unavailable with tooManyRanges when more than one time pair appears (13.12)', () => {
    const arbTwoRanges = fc.constantFrom(
      '9:00 - 10:00 and 2:00 - 3:00',
      '9-10 11-12',
      '10:00 to 11:00, 1:00 to 2:00',
    );

    fc.assert(
      fc.property(arbTwoRanges, timeText => {
        const result = deriveMeetingWindow('Monday', timeText);
        expectUnavailable(result);
        expect(result.failures).toContain('tooManyRanges');
      }),
      { numRuns: 200 },
    );
  });

  it('returns a valid Meeting_Window with no failures for resolvable text', () => {
    const arbWeekdaySubset = fc.uniqueArray(fc.constantFrom(...WEEKDAYS), {
      minLength: 1,
      maxLength: MAX_MEETING_WINDOW_ENTRIES,
    });
    // A start hour strictly before the end hour, both with an explicit meridiem,
    // so the range always resolves without needing the 12-hour repair.
    const arbResolvableTime = fc
      .tuple(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 2 }))
      .map(([start, span]) => `${start}:00 AM - ${start + span}:00 AM`);

    fc.assert(
      fc.property(arbWeekdaySubset, arbResolvableTime, (weekdays, timeText) => {
        const result = deriveMeetingWindow(weekdays.join(', '), timeText);
        expectResolved(result);
        // One entry per distinct named weekday, in Monday..Sunday order.
        expect(result.window!.map(entry => entry.weekday)).toEqual(
          WEEKDAYS.filter(weekday => weekdays.includes(weekday)),
        );
      }),
      { numRuns: 300 },
    );
  });
});
