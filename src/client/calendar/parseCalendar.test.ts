import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import type { BusyBlock } from '../../shared/types';
import {
  parseCalendar,
  scanVevents,
  type CalendarClock,
  type CalendarParseOptions,
  type CalendarParseResult,
  type EventScanOptions,
} from './parseCalendar';

const OPTIONS: EventScanOptions = {
  // A Monday, so the 120-day window covers 2026-02-09 through 2026-06-08.
  loadedAt: new Date('2026-02-09T12:00:00Z'),
  maxEvents: 5_000,
  windowDays: 120,
};

const PACIFIC_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'BEGIN:STANDARD',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
].join('\r\n');

function icsText(...lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    ...lines,
    'END:VCALENDAR',
  ].join('\r\n');
}

function calendar(...lines: string[]): InstanceType<typeof ICAL.Component> {
  return new ICAL.Component(ICAL.parse(icsText(...lines)));
}

function vevent(...lines: string[]): string {
  return ['BEGIN:VEVENT', 'UID:1', ...lines, 'END:VEVENT'].join('\r\n');
}

/** The whole scan of one calendar, the way `parseCalendar` will consume it. */
function scan(
  vcalendar: InstanceType<typeof ICAL.Component>,
  options: EventScanOptions = OPTIONS,
): { blocks: readonly BusyBlock[]; skippedEvents: number; evaluated: number } {
  const blocks: BusyBlock[] = [];
  let skippedEvents = 0;
  let evaluated = 0;

  for (const outcome of scanVevents(vcalendar, options)) {
    evaluated += 1;
    if (outcome.skipped) skippedEvents += 1;
    blocks.push(...outcome.blocks);
  }

  return { blocks, skippedEvents, evaluated };
}

describe('scanVevents eligibility (14.6, 14.8)', () => {
  it('derives a block from a weekly rule with a start and an end', () => {
    const result = scan(
      calendar(
        vevent(
          'SUMMARY:CS 1331',
          'DTSTART:20260210T093000',
          'DTEND:20260210T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    expect(result).toEqual({
      blocks: [
        {
          weekday: 'Tuesday',
          startMinute: 570,
          endMinute: 620,
          summaries: ['CS 1331'],
        },
      ],
      skippedEvents: 0,
      evaluated: 1,
    });
  });

  it('accepts a stated INTERVAL of 1 and rejects a greater one (14.8)', () => {
    const once = scan(
      calendar(
        vevent(
          'DTSTART:20260210T090000',
          'DTEND:20260210T100000',
          'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        ),
      ),
    );
    expect(once.blocks).toHaveLength(1);

    const biweekly = scan(
      calendar(
        vevent(
          'DTSTART:20260210T090000',
          'DTEND:20260210T100000',
          'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
        ),
      ),
    );
    expect(biweekly).toMatchObject({ blocks: [], skippedEvents: 1 });
  });

  it('skips an entry with no RRULE and a non-weekly FREQ (14.8)', () => {
    const result = scan(
      calendar(
        vevent('DTSTART:20260210T090000', 'DTEND:20260210T100000'),
        vevent(
          'DTSTART:20260210T090000',
          'DTEND:20260210T100000',
          'RRULE:FREQ=DAILY',
        ),
        vevent(
          'DTSTART:20260210T090000',
          'DTEND:20260210T100000',
          'RRULE:FREQ=MONTHLY;BYDAY=2TU',
        ),
      ),
    );

    expect(result).toEqual({ blocks: [], skippedEvents: 3, evaluated: 3 });
  });

  it('skips an entry with no start, and one with neither end nor duration (14.6)', () => {
    const result = scan(
      calendar(
        vevent('DTEND:20260210T100000', 'RRULE:FREQ=WEEKLY;BYDAY=TU'),
        vevent('DTSTART:20260210T090000', 'RRULE:FREQ=WEEKLY;BYDAY=TU'),
      ),
    );

    expect(result).toEqual({ blocks: [], skippedEvents: 2, evaluated: 2 });
  });

  it('accepts a DURATION in place of a DTEND (14.6)', () => {
    const result = scan(
      calendar(
        vevent(
          'SUMMARY:Lab',
          'DTSTART:20260211T140000',
          'DURATION:PT1H50M',
          'RRULE:FREQ=WEEKLY;BYDAY=WE',
        ),
      ),
    );

    expect(result.blocks).toEqual([
      {
        weekday: 'Wednesday',
        startMinute: 840,
        endMinute: 950,
        summaries: ['Lab'],
      },
    ]);
  });

  it('skips an all-day entry, which states no clock time (14.6)', () => {
    const result = scan(
      calendar(
        vevent(
          'DTSTART;VALUE=DATE:20260210',
          'DTEND;VALUE=DATE:20260211',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    expect(result).toMatchObject({ blocks: [], skippedEvents: 1 });
  });

  it('evaluates at most the first maxEvents entries (14.6)', () => {
    const entries = Array.from({ length: 5 }, (_unused, index) =>
      vevent(
        `SUMMARY:Class ${index}`,
        `DTSTART:20260210T0${index}0000`,
        `DTEND:20260210T0${index}3000`,
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
      ),
    );

    const result = scan(calendar(...entries), { ...OPTIONS, maxEvents: 2 });

    expect(result.evaluated).toBe(2);
    expect(result.blocks.map(block => block.summaries)).toEqual([
      ['Class 0'],
      ['Class 1'],
    ]);
  });

  it('derives one block per weekday named by a BYDAY list (14.7)', () => {
    const result = scan(
      calendar(
        vevent(
          'SUMMARY:MWF',
          'DTSTART:20260209T093000',
          'DTEND:20260209T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
        ),
      ),
    );

    expect(result.blocks.map(block => block.weekday)).toEqual([
      'Monday',
      'Wednesday',
      'Friday',
    ]);
    expect(result.blocks.every(block => block.startMinute === 570)).toBe(true);
  });

  it('emits a repeating occurrence once, and both readings across a DST shift (14.10)', () => {
    // Stated in UTC, so the Atlanta wall clock moves an hour at the March
    // transition: 09:00 EST before it, 10:00 EDT after.
    const result = scan(
      calendar(
        vevent(
          'SUMMARY:UTC class',
          'DTSTART:20260210T140000Z',
          'DTEND:20260210T145000Z',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    expect(result.blocks).toEqual([
      {
        weekday: 'Tuesday',
        startMinute: 540,
        endMinute: 590,
        summaries: ['UTC class'],
      },
      {
        weekday: 'Tuesday',
        startMinute: 600,
        endMinute: 650,
        summaries: ['UTC class'],
      },
    ]);
  });

  it('converts a TZID occurrence through the calendar VTIMEZONE (14.10)', () => {
    const result = scan(
      calendar(
        PACIFIC_VTIMEZONE,
        vevent(
          'SUMMARY:Pacific',
          'DTSTART;TZID=America/Los_Angeles:20260210T090000',
          'DTEND;TZID=America/Los_Angeles:20260210T095000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    // 09:00 Pacific is 12:00 Atlanta, on both sides of the shared transition.
    expect(result.blocks).toEqual([
      {
        weekday: 'Tuesday',
        startMinute: 720,
        endMinute: 770,
        summaries: ['Pacific'],
      },
    ]);
  });

  it('carries an empty summary when the entry states none', () => {
    const result = scan(
      calendar(
        vevent(
          'DTSTART:20260210T090000',
          'DTEND:20260210T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    expect(result.blocks[0]?.summaries).toEqual(['']);
  });

  it('clamps an occurrence whose end falls on the next Atlanta day (14.12)', () => {
    const result = scan(
      calendar(
        vevent(
          'SUMMARY:Late lab',
          'DTSTART:20260210T230000',
          'DTEND:20260211T010000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    expect(result.blocks).toEqual([
      {
        weekday: 'Tuesday',
        startMinute: 1380,
        endMinute: 1440,
        summaries: ['Late lab'],
      },
    ]);
  });
});

describe('scanVevents window expansion (14.9)', () => {
  it('skips a rule whose UNTIL precedes the window', () => {
    const result = scan(
      calendar(
        vevent(
          'DTSTART:20251209T093000',
          'DTEND:20251209T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20251223T235959Z',
        ),
      ),
    );

    expect(result).toMatchObject({ blocks: [], skippedEvents: 1 });
  });

  it('skips a rule whose COUNT is exhausted before the window', () => {
    const result = scan(
      calendar(
        vevent(
          'DTSTART:20251209T093000',
          'DTEND:20251209T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3',
        ),
      ),
    );

    expect(result).toMatchObject({ blocks: [], skippedEvents: 1 });
  });

  it('keeps a rule that starts before the window and still runs inside it', () => {
    const result = scan(
      calendar(
        vevent(
          'SUMMARY:Ongoing',
          'DTSTART:20250902T093000',
          'DTEND:20250902T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    expect(result.blocks).toEqual([
      {
        weekday: 'Tuesday',
        startMinute: 570,
        endMinute: 620,
        summaries: ['Ongoing'],
      },
    ]);
  });

  it('skips a rule whose only occurrences fall after the window', () => {
    const result = scan(
      calendar(
        vevent(
          'DTSTART:20261006T093000',
          'DTEND:20261006T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    expect(result).toMatchObject({ blocks: [], skippedEvents: 1 });
  });

  it('skips a rule whose every in-window occurrence is excluded by EXDATE', () => {
    const result = scan(
      calendar(
        vevent(
          'DTSTART:20260210T093000',
          'DTEND:20260210T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2',
          'EXDATE:20260210T093000',
          'EXDATE:20260217T093000',
        ),
      ),
    );

    expect(result).toMatchObject({ blocks: [], skippedEvents: 1 });
  });

  it('keeps the occurrences an EXDATE does not remove', () => {
    const result = scan(
      calendar(
        vevent(
          'SUMMARY:Partly cancelled',
          'DTSTART:20260210T093000',
          'DTEND:20260210T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2',
          'EXDATE:20260210T093000',
        ),
      ),
    );

    expect(result.blocks).toEqual([
      {
        weekday: 'Tuesday',
        startMinute: 570,
        endMinute: 620,
        summaries: ['Partly cancelled'],
      },
    ]);
  });

  it('honors a date-only EXDATE over the whole day', () => {
    const result = scan(
      calendar(
        vevent(
          'DTSTART:20260210T093000',
          'DTEND:20260210T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=1',
          'EXDATE;VALUE=DATE:20260210',
        ),
      ),
    );

    expect(result).toMatchObject({ blocks: [], skippedEvents: 1 });
  });

  it('expands the window from loadedAt, so the same file moves with the load date', () => {
    const spring = calendar(
      vevent(
        'SUMMARY:Spring only',
        'DTSTART:20260210T093000',
        'DTEND:20260210T102000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20260428T235959Z',
      ),
    );

    expect(scan(spring).blocks).toHaveLength(1);
    expect(
      scan(spring, { ...OPTIONS, loadedAt: new Date('2026-09-01T12:00:00Z') }),
    ).toMatchObject({ blocks: [], skippedEvents: 1 });
  });

  it('treats the window as 120 days from the load date', () => {
    // 2026-06-09 is 120 days after 2026-02-09: the first day outside the window.
    const justOutside = calendar(
      vevent(
        'DTSTART:20260609T093000',
        'DTEND:20260609T102000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=1',
      ),
    );
    const justInside = calendar(
      vevent(
        'DTSTART:20260608T093000',
        'DTEND:20260608T102000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1',
      ),
    );

    expect(scan(justOutside)).toMatchObject({ blocks: [], skippedEvents: 1 });
    expect(scan(justInside).blocks).toHaveLength(1);
  });
});

describe('scanVevents robustness', () => {
  it('yields nothing for a calendar with no VEVENT', () => {
    expect(scan(calendar())).toEqual({
      blocks: [],
      skippedEvents: 0,
      evaluated: 0,
    });
  });

  it('skips an entry whose end does not follow its start', () => {
    const result = scan(
      calendar(
        vevent(
          'DTSTART:20260210T093000',
          'DTEND:20260210T093000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    expect(result).toMatchObject({ blocks: [], skippedEvents: 1 });
  });

  it('keeps the eligible entries of a file that also holds ineligible ones', () => {
    const result = scan(
      calendar(
        vevent(
          'SUMMARY:Weekly',
          'DTSTART:20260210T093000',
          'DTEND:20260210T102000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
        vevent(
          'SUMMARY:One-off',
          'DTSTART:20260212T093000',
          'DTEND:20260212T102000',
        ),
        vevent(
          'SUMMARY:Biweekly',
          'DTSTART:20260213T093000',
          'DTEND:20260213T102000',
          'RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=FR',
        ),
      ),
    );

    expect(result).toMatchObject({ skippedEvents: 2, evaluated: 3 });
    expect(result.blocks.map(block => block.summaries)).toEqual([['Weekly']]);
  });
});

/** A clock that advances by `stepMs` on every reading, starting at 0. */
function steppingClock(stepMs: number): CalendarClock {
  let elapsed = 0;

  return {
    now: () => {
      const reading = elapsed;
      elapsed += stepMs;
      return reading;
    },
  };
}

const PARSE_OPTIONS: Omit<CalendarParseOptions, 'clock'> = {
  ...OPTIONS,
  fileName: 'schedule.ics',
  deadlineMs: 2_000,
  maxBlocks: 200,
};

function parse(
  text: string,
  overrides: Partial<CalendarParseOptions> = {},
): CalendarParseResult {
  return parseCalendar(text, {
    ...PARSE_OPTIONS,
    clock: steppingClock(0),
    ...overrides,
  });
}

const WEEKLY_TUESDAY = vevent(
  'SUMMARY:CS 1331',
  'DTSTART:20260210T093000',
  'DTEND:20260210T102000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU',
);

describe('parseCalendar success cases (14.2)', () => {
  it('returns ok with the derived schedule', () => {
    const result = parse(icsText(WEEKLY_TUESDAY));

    expect(result).toEqual({
      kind: 'ok',
      skippedEvents: 0,
      schedule: {
        fileName: 'schedule.ics',
        loadedAt: '2026-02-09T12:00:00.000Z',
        blocks: [
          {
            weekday: 'Tuesday',
            startMinute: 570,
            endMinute: 620,
            summaries: ['CS 1331'],
          },
        ],
        truncated: false,
        discardedBlocks: 0,
      },
    });
  });

  it('counts the skipped entries alongside the usable ones (14.8)', () => {
    const result = parse(
      icsText(
        WEEKLY_TUESDAY,
        vevent(
          'SUMMARY:One-off',
          'DTSTART:20260212T090000',
          'DTEND:20260212T100000',
        ),
        vevent(
          'SUMMARY:Daily',
          'DTSTART:20260212T090000',
          'DTEND:20260212T100000',
          'RRULE:FREQ=DAILY',
        ),
      ),
    );

    expect(result).toMatchObject({ kind: 'ok', skippedEvents: 2 });
  });

  it('merges touching blocks and carries both summaries (14.13)', () => {
    const result = parse(
      icsText(
        vevent(
          'SUMMARY:Lecture',
          'DTSTART:20260210T090000',
          'DTEND:20260210T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
        vevent(
          'SUMMARY:Lab',
          'DTSTART:20260210T100000',
          'DTEND:20260210T110000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
    );

    expect(result).toMatchObject({
      kind: 'ok',
      schedule: {
        blocks: [
          {
            weekday: 'Tuesday',
            startMinute: 540,
            endMinute: 660,
            summaries: ['Lecture', 'Lab'],
          },
        ],
      },
    });
  });

  it('caps the Calendar_File name at the short-text limit', () => {
    const result = parse(icsText(WEEKLY_TUESDAY), {
      fileName: `${'a'.repeat(250)}.ics`,
    });

    expect(result).toMatchObject({
      kind: 'ok',
      schedule: { fileName: 'a'.repeat(200) },
    });
  });
});

describe('parseCalendar block ordering (14.14)', () => {
  it('orders blocks by weekday Monday..Sunday then start minute', () => {
    const result = parse(
      icsText(
        vevent(
          'SUMMARY:Friday',
          'DTSTART:20260213T140000',
          'DTEND:20260213T150000',
          'RRULE:FREQ=WEEKLY;BYDAY=FR',
        ),
        vevent(
          'SUMMARY:Monday late',
          'DTSTART:20260209T160000',
          'DTEND:20260209T170000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
        ),
        vevent(
          'SUMMARY:Monday early',
          'DTSTART:20260209T080000',
          'DTEND:20260209T090000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
        ),
        vevent(
          'SUMMARY:Sunday',
          'DTSTART:20260215T100000',
          'DTEND:20260215T110000',
          'RRULE:FREQ=WEEKLY;BYDAY=SU',
        ),
      ),
    );

    expect(result.kind).toBe('ok');
    const blocks = result.kind === 'ok' ? result.schedule.blocks : [];
    expect(blocks.map(block => [block.weekday, block.startMinute])).toEqual([
      ['Monday', 480],
      ['Monday', 960],
      ['Friday', 840],
      ['Sunday', 600],
    ]);
  });
});

describe('parseCalendar block cap (14.14)', () => {
  /** One VEVENT per half hour, on every weekday: 48 * 7 = 336 merged blocks. */
  function overCapCalendar(): string {
    const entries = Array.from({ length: 48 }, (_unused, index) => {
      const hour = String(Math.floor(index / 2)).padStart(2, '0');
      const minute = index % 2 === 0 ? '00' : '30';

      return vevent(
        `SUMMARY:Slot ${index}`,
        `DTSTART:20260209T${hour}${minute}00`,
        'DURATION:PT20M',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
      );
    });

    return icsText(...entries);
  }

  it('retains the first 200 blocks in canonical order and reports the rest', () => {
    const result = parse(overCapCalendar());

    expect(result).toMatchObject({
      kind: 'truncated',
      discardedBlocks: 136,
      schedule: { truncated: true, discardedBlocks: 136 },
    });

    const blocks = result.kind === 'truncated' ? result.schedule.blocks : [];
    expect(blocks).toHaveLength(200);
    // 48 blocks per weekday: Monday..Thursday fill 192, so Friday keeps 8.
    expect(blocks[0]).toMatchObject({
      weekday: 'Monday',
      startMinute: 0,
      endMinute: 20,
    });
    expect(blocks[199]).toMatchObject({
      weekday: 'Friday',
      startMinute: 210,
      endMinute: 230,
    });
  });

  it('keeps the order prefix under a smaller cap', () => {
    const result = parse(
      icsText(
        vevent(
          'SUMMARY:Wednesday',
          'DTSTART:20260211T090000',
          'DTEND:20260211T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=WE',
        ),
        vevent(
          'SUMMARY:Monday',
          'DTSTART:20260209T090000',
          'DTEND:20260209T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
        ),
        vevent(
          'SUMMARY:Tuesday',
          'DTSTART:20260210T090000',
          'DTEND:20260210T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=TU',
        ),
      ),
      { maxBlocks: 2 },
    );

    expect(result).toMatchObject({ kind: 'truncated', discardedBlocks: 1 });
    const blocks = result.kind === 'truncated' ? result.schedule.blocks : [];
    expect(blocks.map(block => block.weekday)).toEqual(['Monday', 'Tuesday']);
  });
});

describe('parseCalendar failure cases (14.15, 14.16, 14.17)', () => {
  it('reports invalidCalendar for text with no BEGIN:VCALENDAR line (14.15)', () => {
    expect(parse('')).toEqual({ kind: 'invalidCalendar' });
    expect(parse('this is not a calendar at all')).toEqual({
      kind: 'invalidCalendar',
    });
    expect(
      parse(
        ['BEGIN:VEVENT', 'DTSTART:20260210T090000', 'END:VEVENT'].join('\r\n'),
      ),
    ).toEqual({ kind: 'invalidCalendar' });
  });

  it('reports invalidCalendar for content that cannot be read as iCalendar (14.15)', () => {
    expect(
      parse('BEGIN:VCALENDAR\r\nthis line has no name\r\nEND:VCALENDAR'),
    ).toEqual({ kind: 'invalidCalendar' });
    expect(parse('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toEqual({
      kind: 'invalidCalendar',
    });
  });

  it('reports noUsableEvents for a valid calendar with no usable entry (14.16)', () => {
    const result = parse(
      icsText(
        vevent(
          'SUMMARY:One-off',
          'DTSTART:20260212T090000',
          'DTEND:20260212T100000',
        ),
        vevent(
          'SUMMARY:Biweekly',
          'DTSTART:20260212T090000',
          'DTEND:20260212T100000',
          'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH',
        ),
      ),
    );

    expect(result).toEqual({ kind: 'noUsableEvents', skippedEvents: 2 });
  });

  it('reports noUsableEvents for a calendar with no VEVENT at all (14.16)', () => {
    expect(parse(icsText())).toEqual({
      kind: 'noUsableEvents',
      skippedEvents: 0,
    });
  });

  it('reports timeout once the deadline has elapsed at a VEVENT boundary (14.17)', () => {
    const result = parse(icsText(WEEKLY_TUESDAY, WEEKLY_TUESDAY), {
      clock: steppingClock(2_000),
    });

    expect(result).toEqual({ kind: 'timeout', elapsedMs: 2_000 });
  });

  it('checks the deadline at every VEVENT boundary, not only the first (14.17)', () => {
    const three = icsText(WEEKLY_TUESDAY, WEEKLY_TUESDAY, WEEKLY_TUESDAY);

    // 800 ms per boundary: 800, 1600, then 2400 crosses the 2,000 ms budget.
    expect(parse(three, { clock: steppingClock(800) })).toEqual({
      kind: 'timeout',
      elapsedMs: 2_400,
    });

    // 600 ms per boundary tops out at 1,800 ms, inside the budget.
    expect(parse(three, { clock: steppingClock(600) })).toMatchObject({
      kind: 'ok',
    });
  });

  it('returns no schedule on any failure path, so the caller keeps its own (14.2)', () => {
    const failures = [
      parse('not a calendar'),
      parse(icsText()),
      parse(icsText(WEEKLY_TUESDAY), { clock: steppingClock(2_000) }),
    ];

    for (const failure of failures) {
      expect(failure).not.toHaveProperty('schedule');
    }
  });
});
