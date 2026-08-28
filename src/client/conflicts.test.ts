import { describe, expect, it } from 'vitest';
import type {
  BusyBlock,
  BusySchedule,
  MeetingWindowEntry,
  TeamRecord,
  Weekday,
} from '../shared/types';
import { classifyAll, classifyTeam, overlaps } from './conflicts';

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

function entry(
  weekday: Weekday,
  startMinute: number,
  endMinute: number,
): MeetingWindowEntry {
  return { weekday, startMinute, endMinute };
}

function block(
  weekday: Weekday,
  startMinute: number,
  endMinute: number,
  ...summaries: string[]
): BusyBlock {
  return { weekday, startMinute, endMinute, summaries };
}

function schedule(blocks: readonly BusyBlock[]): BusySchedule {
  return {
    fileName: 'schedule.ics',
    loadedAt: '2026-01-05T04:30:00Z',
    blocks,
    truncated: false,
    discardedBlocks: 0,
  };
}

describe('overlaps', () => {
  it('is true for intersecting intervals in either argument order', () => {
    const a = { startMinute: 540, endMinute: 620 };
    const b = { startMinute: 600, endMinute: 700 };

    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(b, a)).toBe(true);
  });

  it('is false when the end of one equals the start of the other', () => {
    const a = { startMinute: 570, endMinute: 620 };
    const b = { startMinute: 620, endMinute: 680 };

    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(b, a)).toBe(false);
  });

  it('is true for a containment', () => {
    expect(
      overlaps(
        { startMinute: 540, endMinute: 720 },
        { startMinute: 600, endMinute: 610 },
      ),
    ).toBe(true);
  });

  it('is false for disjoint intervals', () => {
    expect(
      overlaps(
        { startMinute: 540, endMinute: 600 },
        { startMinute: 660, endMinute: 720 },
      ),
    ).toBe(false);
  });

  it('is false when an interval lies entirely before the other', () => {
    expect(
      overlaps(
        { startMinute: 0, endMinute: 480 },
        { startMinute: 480, endMinute: 1440 },
      ),
    ).toBe(false);
  });
});

describe('classifyTeam', () => {
  it('returns unknown for an unavailable Meeting_Window', () => {
    expect(classifyTeam(null, schedule([block('Monday', 0, 1440)]))).toBe(
      'unknown',
    );
  });

  it('returns unknown for an unavailable window even with no schedule', () => {
    expect(classifyTeam(null, null)).toBe('unknown');
  });

  it('returns conflicting when one entry overlaps a same-weekday block', () => {
    const window = [entry('Monday', 540, 620), entry('Wednesday', 540, 620)];

    expect(classifyTeam(window, schedule([block('Wednesday', 600, 660)]))).toBe(
      'conflicting',
    );
  });

  it('returns clear when the overlapping block falls on another weekday', () => {
    expect(
      classifyTeam(
        [entry('Monday', 540, 620)],
        schedule([block('Tuesday', 540, 620)]),
      ),
    ).toBe('clear');
  });

  it('returns clear for touching endpoints in both directions', () => {
    const blocks = [block('Friday', 480, 540), block('Friday', 620, 680)];

    expect(classifyTeam([entry('Friday', 540, 620)], schedule(blocks))).toBe(
      'clear',
    );
  });

  it('returns clear for a window with entries and an empty schedule', () => {
    expect(classifyTeam([entry('Monday', 540, 620)], schedule([]))).toBe(
      'clear',
    );
  });
});

describe('classifyAll', () => {
  it('returns null when no Busy_Schedule is loaded', () => {
    expect(classifyAll([team({ entryId: '1248' })], null)).toBeNull();
  });

  it('assigns every team exactly one state keyed by entryId', () => {
    const teams = [
      team({ entryId: '1', meetingWindow: [entry('Monday', 540, 620)] }),
      team({ entryId: '2', meetingWindow: [entry('Monday', 700, 760)] }),
      team({ entryId: '3', meetingWindow: null }),
    ];

    const states = classifyAll(
      teams,
      schedule([block('Monday', 600, 660, 'CS 1301')]),
    );

    expect(states).not.toBeNull();
    expect(states?.size).toBe(3);
    expect(states?.get('1')).toBe('conflicting');
    expect(states?.get('2')).toBe('clear');
    expect(states?.get('3')).toBe('unknown');
  });

  it('returns an empty map for an empty Dataset with a loaded schedule', () => {
    expect(classifyAll([], schedule([]))?.size).toBe(0);
  });
});
