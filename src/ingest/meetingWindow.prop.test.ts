/**
 * Property 35: Meeting_Window entries are well formed under every time spelling.
 *
 * **Validates: Requirements 2.1, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.10**
 *
 * The domain is the one the design fixes: day text built from a chosen weekday
 * subset with random spelling (full name, 3-letter abbreviation, random casing,
 * random padding, random joining punctuation, deliberate repeats), crossed with
 * time text built from a chosen start/end pair rendered with a random separator,
 * random whitespace, optional minutes, and a meridiem on neither side, the start
 * only, the end only, or both — including pairs that need the 12-hour repair and
 * pairs that land exactly on 1440. Arbitrary free text is mixed in through a second
 * assertion so the unavailable branch is exercised by the same module.
 *
 * The expected minute values are computed here from the acceptance criteria
 * themselves (13.3, 13.5, 13.6, 13.7, 13.8) rather than by calling the module, so
 * the structural invariants and the resolution rules are both judged against the
 * requirements.
 *
 * Clock hours are drawn from 1..12 because those are the hours the meridiem
 * resolution rules of 13.6 and 13.7 speak about; 24-hour spellings belong to
 * Property 36's adversarial domain, and the free-text assertion below covers them
 * structurally.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_MEETING_WINDOW_ENTRIES,
  MINUTES_PER_DAY,
  WEEKDAYS,
  type Weekday,
} from '../shared/types';
import { deriveMeetingWindow } from './meetingWindow';

// ---------------------------------------------------------------------------
// Day text
// ---------------------------------------------------------------------------

/** The 3-letter English abbreviation of each weekday (Requirement 13.2). */
const ABBREVIATION: Readonly<Record<Weekday, string>> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

type Casing = 'lower' | 'upper' | 'title' | 'toggle';

function applyCasing(word: string, casing: Casing): string {
  switch (casing) {
    case 'lower':
      return word.toLowerCase();
    case 'upper':
      return word.toUpperCase();
    case 'title':
      return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
    case 'toggle':
      return [...word]
        .map((character, index) =>
          index % 2 === 0 ? character.toLowerCase() : character.toUpperCase(),
        )
        .join('');
  }
}

/** Joiners the source site uses between day names; none of them spells a weekday. */
const DAY_JOINERS: readonly string[] = [
  ', ',
  ',',
  '/',
  ' / ',
  ' & ',
  ' and ',
  ' ',
  '  ',
  ' , ',
];

const DAY_PADS: readonly string[] = ['', ' ', '  ', '\t'];

interface DayTokenSpelling {
  readonly abbreviated: boolean;
  readonly casing: Casing;
  readonly padLeft: string;
  readonly padRight: string;
}

interface DayPlan {
  /** The distinct weekdays named, in `WEEKDAYS` order. */
  readonly weekdays: readonly Weekday[];
  /** Every weekday token rendered, repeats included, in render order. */
  readonly tokens: readonly Weekday[];
  readonly spellings: readonly DayTokenSpelling[];
  readonly joiners: readonly string[];
}

const arbDayTokenSpelling: fc.Arbitrary<DayTokenSpelling> = fc.record({
  abbreviated: fc.boolean(),
  casing: fc.constantFrom<Casing>('lower', 'upper', 'title', 'toggle'),
  padLeft: fc.constantFrom(...DAY_PADS),
  padRight: fc.constantFrom(...DAY_PADS),
});

const arbDayPlan: fc.Arbitrary<DayPlan> = fc
  .uniqueArray(fc.constantFrom(...WEEKDAYS), { minLength: 1, maxLength: 7 })
  .chain(chosen => {
    const weekdays = WEEKDAYS.filter(weekday => chosen.includes(weekday));
    return fc
      // Deliberate repeats: each chosen weekday is named 1..2 times.
      .array(fc.integer({ min: 1, max: 2 }), {
        minLength: weekdays.length,
        maxLength: weekdays.length,
      })
      .chain(repeats => {
        const tokens = weekdays.flatMap((weekday, index) =>
          Array.from({ length: repeats[index]! }, () => weekday),
        );
        return fc.record({
          weekdays: fc.constant(weekdays),
          tokens: fc.constant(tokens),
          spellings: fc.array(arbDayTokenSpelling, {
            minLength: tokens.length,
            maxLength: tokens.length,
          }),
          joiners: fc.array(fc.constantFrom(...DAY_JOINERS), {
            minLength: Math.max(0, tokens.length - 1),
            maxLength: Math.max(0, tokens.length - 1),
          }),
        });
      });
  });

function renderDayText(plan: DayPlan): string {
  return plan.tokens
    .map((weekday, index) => {
      const spelling = plan.spellings[index]!;
      const word = spelling.abbreviated ? ABBREVIATION[weekday] : weekday;
      return `${spelling.padLeft}${applyCasing(word, spelling.casing)}${spelling.padRight}`;
    })
    .reduce(
      (text, token, index) =>
        index === 0 ? token : `${text}${plan.joiners[index - 1]!}${token}`,
      '',
    );
}

// ---------------------------------------------------------------------------
// Time text
// ---------------------------------------------------------------------------

type Meridiem = 'a' | 'p';

const MERIDIEM_SPELLINGS: Readonly<Record<Meridiem, readonly string[]>> = {
  a: ['AM', 'am', 'Am', 'A.M.', 'a.m.', 'aM'],
  p: ['PM', 'pm', 'Pm', 'P.M.', 'p.m.', 'pM'],
};

/** Every separator Requirement 13.4 accepts. */
const SEPARATORS: readonly string[] = ['-', '\u2013', '\u2014', 'to', 'until'];

/** A word separator needs whitespace around it to remain a word. */
function isWordSeparator(separator: string): boolean {
  return separator === 'to' || separator === 'until';
}

const TIME_PADS: readonly string[] = ['', ' ', '  ', '\t'];
const WHITESPACE_PADS: readonly string[] = [' ', '  ', '\t'];

interface ClockSpec {
  readonly hour: number; // 1..12
  readonly minute: number; // 0..59
  readonly meridiem: Meridiem | null;
  readonly meridiemSpelling: string;
  readonly spaceBeforeMeridiem: boolean;
  readonly omitMinutes: boolean; // only ever true when `minute` is 0
}

const arbClockSpec: fc.Arbitrary<ClockSpec> = fc
  .record({
    hour: fc.integer({ min: 1, max: 12 }),
    // Minute 0 is drawn often, since it is the value the omitted-minute
    // spelling of Requirement 13.5 applies to.
    minute: fc.oneof(
      { weight: 3, arbitrary: fc.constant(0) },
      { weight: 2, arbitrary: fc.integer({ min: 0, max: 59 }) },
    ),
    meridiem: fc.constantFrom<Meridiem | null>('a', 'p', null, null),
    meridiemIndex: fc.integer({ min: 0, max: 5 }),
    spaceBeforeMeridiem: fc.boolean(),
    omitMinutes: fc.boolean(),
  })
  .map(spec => ({
    hour: spec.hour,
    minute: spec.minute,
    meridiem: spec.meridiem,
    meridiemSpelling:
      spec.meridiem === null
        ? ''
        : MERIDIEM_SPELLINGS[spec.meridiem][spec.meridiemIndex]!,
    spaceBeforeMeridiem: spec.spaceBeforeMeridiem,
    omitMinutes: spec.minute === 0 && spec.omitMinutes,
  }));

interface TimePlan {
  readonly start: ClockSpec;
  readonly end: ClockSpec;
  readonly separator: string;
  readonly padLeft: string;
  readonly padRight: string;
}

const arbTimePlan: fc.Arbitrary<TimePlan> = fc
  .record({
    start: arbClockSpec,
    end: arbClockSpec,
    separator: fc.constantFrom(...SEPARATORS),
    padLeft: fc.constantFrom(...TIME_PADS),
    padRight: fc.constantFrom(...TIME_PADS),
    wordPadLeft: fc.constantFrom(...WHITESPACE_PADS),
    wordPadRight: fc.constantFrom(...WHITESPACE_PADS),
  })
  .map(plan => ({
    start: plan.start,
    end: plan.end,
    separator: plan.separator,
    padLeft: isWordSeparator(plan.separator) ? plan.wordPadLeft : plan.padLeft,
    padRight: isWordSeparator(plan.separator)
      ? plan.wordPadRight
      : plan.padRight,
  }));

function renderClock(
  clock: ClockSpec,
  options: { forceMinutes?: boolean } = {},
): string {
  const omitMinutes = options.forceMinutes === true ? false : clock.omitMinutes;
  const minutePart = omitMinutes
    ? ''
    : `:${String(clock.minute).padStart(2, '0')}`;
  const meridiemPart =
    clock.meridiem === null
      ? ''
      : `${clock.spaceBeforeMeridiem ? ' ' : ''}${clock.meridiemSpelling}`;
  return `${clock.hour}${minutePart}${meridiemPart}`;
}

function renderTimeText(
  plan: TimePlan,
  overrides: {
    separator?: string;
    padLeft?: string;
    padRight?: string;
    forceStartMinutes?: boolean;
    forceEndMinutes?: boolean;
  } = {},
): string {
  const separator = overrides.separator ?? plan.separator;
  const padLeft = overrides.padLeft ?? plan.padLeft;
  const padRight = overrides.padRight ?? plan.padRight;
  const start = renderClock(plan.start, {
    forceMinutes: overrides.forceStartMinutes,
  });
  const end = renderClock(plan.end, { forceMinutes: overrides.forceEndMinutes });
  return `${start}${padLeft}${separator}${padRight}${end}`;
}

// ---------------------------------------------------------------------------
// The acceptance criteria, read as an oracle
// ---------------------------------------------------------------------------

/**
 * The minute of day of one clock time (Requirements 13.3, 13.5, 13.6, 13.7):
 * a stated meridiem applies, otherwise the meridiem the other clock time states
 * applies, otherwise hour 1-7 is afternoon, 8-11 morning, and 12 is noon.
 */
function expectedMinutes(clock: ClockSpec, other: Meridiem | null): number {
  const stated = clock.meridiem ?? other;
  if (stated === 'a') return (clock.hour % 12) * 60 + clock.minute;
  if (stated === 'p') return ((clock.hour % 12) + 12) * 60 + clock.minute;
  if (clock.hour >= 1 && clock.hour <= 7) return (clock.hour + 12) * 60 + clock.minute;
  return clock.hour * 60 + clock.minute;
}

/** The start/end pair the time text resolves to, or `null` when it cannot resolve. */
function expectedRange(
  plan: TimePlan,
): { startMinute: number; endMinute: number } | null {
  const startMinute = expectedMinutes(plan.start, plan.end.meridiem);
  const endMinute = expectedMinutes(plan.end, plan.start.meridiem);
  if (endMinute > startMinute) return { startMinute, endMinute };

  // The 12-hour end repair (Requirement 13.8), and its failure (13.9).
  const repaired = endMinute + 12 * 60;
  if (repaired > startMinute && repaired <= MINUTES_PER_DAY) {
    return { startMinute, endMinute: repaired };
  }
  return null;
}

describe('Property 35: Meeting_Window entries are well formed under every time spelling', () => {
  it('derives one well-formed entry per named weekday, whatever the spelling', () => {
    fc.assert(
      fc.property(arbDayPlan, arbTimePlan, (dayPlan, timePlan) => {
        const dayText = renderDayText(dayPlan);
        const timeText = renderTimeText(timePlan);

        const result = deriveMeetingWindow(dayText, timeText);
        const range = expectedRange(timePlan);
        // Naming a weekday twice can push the token count past 7, which degrades
        // the window rather than deriving one (Requirement 13.12).
        const tooManyTokens =
          dayPlan.tokens.length > MAX_MEETING_WINDOW_ENTRIES;

        if (tooManyTokens || range === null) {
          expect(result.window).toBeNull();
          expect(result.failures.length).toBeGreaterThan(0);
          return;
        }

        // One entry per distinct named weekday, in Monday..Sunday order, each
        // carrying the same resolved range (Requirements 13.1, 13.2, 13.10).
        expect(result.failures).toEqual([]);
        expect(result.window).toEqual(
          dayPlan.weekdays.map(weekday => ({
            weekday,
            startMinute: range.startMinute,
            endMinute: range.endMinute,
          })),
        );

        // The structural invariants, asserted independently of the oracle.
        const entries = result.window!;
        expect(entries.length).toBeGreaterThanOrEqual(1);
        expect(entries.length).toBeLessThanOrEqual(MAX_MEETING_WINDOW_ENTRIES);
        expect(new Set(entries.map(entry => entry.weekday)).size).toBe(
          entries.length,
        );
        for (const entry of entries) {
          expect(Number.isInteger(entry.startMinute)).toBe(true);
          expect(Number.isInteger(entry.endMinute)).toBe(true);
          expect(entry.startMinute).toBeGreaterThanOrEqual(0);
          expect(entry.startMinute).toBeLessThanOrEqual(MINUTES_PER_DAY - 1);
          expect(entry.endMinute).toBeGreaterThanOrEqual(1);
          expect(entry.endMinute).toBeLessThanOrEqual(MINUTES_PER_DAY);
          expect(entry.endMinute).toBeGreaterThan(entry.startMinute);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('resolves the same window under every separator and whitespace spelling', () => {
    fc.assert(
      fc.property(arbDayPlan, arbTimePlan, (dayPlan, timePlan) => {
        const dayText = renderDayText(dayPlan);

        // Requirement 13.4: the five separators, with surrounding whitespace, all
        // separate the same start clock time from the same end clock time.
        const windows = SEPARATORS.map(separator =>
          deriveMeetingWindow(
            dayText,
            renderTimeText(timePlan, {
              separator,
              padLeft: ' ',
              padRight: '  ',
            }),
          ),
        );
        for (const window of windows) {
          expect(window).toEqual(windows[0]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('reads an omitted minute component as minute 0', () => {
    fc.assert(
      fc.property(arbDayPlan, arbTimePlan, (dayPlan, timePlan) => {
        const dayText = renderDayText(dayPlan);

        // Requirement 13.5: where the minutes are 0, spelling them and omitting
        // them are the same time text.
        expect(
          deriveMeetingWindow(dayText, renderTimeText(timePlan)),
        ).toEqual(
          deriveMeetingWindow(
            dayText,
            renderTimeText(timePlan, {
              forceStartMinutes: true,
              forceEndMinutes: true,
            }),
          ),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('is total over arbitrary day and time text', () => {
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
      ),
    );

    fc.assert(
      fc.property(arbFreeText, arbFreeText, (dayText, timeText) => {
        const { window } = deriveMeetingWindow(dayText, timeText);
        if (window === null) return;

        expect(window.length).toBeGreaterThanOrEqual(1);
        expect(window.length).toBeLessThanOrEqual(MAX_MEETING_WINDOW_ENTRIES);
        const ranks = window.map(entry => WEEKDAYS.indexOf(entry.weekday));
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        expect(new Set(ranks).size).toBe(ranks.length);
        for (const entry of window) {
          expect(Number.isInteger(entry.startMinute)).toBe(true);
          expect(Number.isInteger(entry.endMinute)).toBe(true);
          expect(entry.startMinute).toBeGreaterThanOrEqual(0);
          expect(entry.endMinute).toBeLessThanOrEqual(MINUTES_PER_DAY);
          expect(entry.endMinute).toBeGreaterThan(entry.startMinute);
        }
      }),
      { numRuns: 500 },
    );
  });
});
