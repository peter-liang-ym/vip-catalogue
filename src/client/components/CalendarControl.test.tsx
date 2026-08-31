// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import type { BusySchedule } from '../../shared/types';
import { BUSY_SCHEDULE_KEY, saveStoredSchedule } from '../busyScheduleStore';
import { parseCalendar } from '../calendar/parseCalendar';
import { NO_CALENDAR, scheduleOf, type CalendarState } from '../calendarState';
import {
  busyText,
  CALENDAR_CONTROL_LABEL,
  CalendarControl,
  isCalendarFile,
  MAX_CALENDAR_BYTES,
  PRIVACY_STATEMENT,
  rejectionOf,
  REMOVE_CALENDAR_LABEL,
  TOO_LARGE_MESSAGE,
  WRONG_TYPE_MESSAGE,
  type CalendarControlProps,
} from './CalendarControl';

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

/**
 * A Monday 9:00-10:00 Atlanta class, stated in UTC. Parsed with `LOADED_AT` the
 * 120-day window opens on the same Monday.
 */
const WEEKLY_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//test//test//EN',
  'BEGIN:VEVENT',
  'UID:cs1332',
  'DTSTART:20260209T140000Z',
  'DTEND:20260209T150000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'SUMMARY:CS 1332',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

/** 2026-02-09 is a Monday. */
const LOADED_AT = new Date('2026-02-09T12:00:00Z');

const CLOCK = { now: () => LOADED_AT.getTime() };

/** A schedule that is already loaded, so retention on rejection is observable. */
function loadedSchedule(): BusySchedule {
  return {
    fileName: 'fall-2026.ics',
    loadedAt: '2026-01-05T14:00:00Z',
    blocks: [
      {
        weekday: 'Tuesday',
        startMinute: 840,
        endMinute: 900,
        summaries: ['MATH 2551'],
      },
    ],
    truncated: false,
    discardedBlocks: 0,
  };
}

function icsFile(
  name = 'spring-2026.ics',
  type = 'text/calendar',
  text = WEEKLY_ICS,
): File {
  return new File([text], name, { type });
}

/** The same file, reported at a size over the 5 MB limit (Requirement 14.4). */
function oversized(file: File): File {
  Object.defineProperty(file, 'size', { value: MAX_CALENDAR_BYTES + 1 });

  return file;
}

/**
 * Renders the control inside a harness that holds the `CalendarState`, so the
 * transitions the control commits are the ones it then renders, and records every
 * committed state in order.
 */
function mount(overrides: Partial<CalendarControlProps> = {}): {
  readonly states: CalendarState[];
} {
  const states: CalendarState[] = [];
  const initial = overrides.state ?? NO_CALENDAR;

  function Harness() {
    const [state, setState] = useState<CalendarState>(initial);

    return (
      <CalendarControl
        clock={CLOCK}
        loadParser={async () => parseCalendar}
        yieldToPaint={() => Promise.resolve()}
        store={new MemoryStorage()}
        {...overrides}
        state={state}
        onState={next => {
          states.push(next);
          setState(next);
        }}
      />
    );
  }

  render(<Harness />);

  return { states };
}

function input(): HTMLInputElement {
  return screen.getByLabelText(CALENDAR_CONTROL_LABEL) as HTMLInputElement;
}

/** Supplies a file through the selection control (Requirement 14.1). */
function select(file: File): void {
  const element = input();
  Object.defineProperty(element, 'files', {
    value: [file],
    configurable: true,
  });
  fireEvent.change(element);
}

/** Supplies a file by dropping it on the control (Requirement 14.1). */
function drop(file: File): void {
  fireEvent.drop(screen.getByTestId('calendar-control'), {
    dataTransfer: { files: [file] },
  });
}

/** The state the control last committed. */
function last(states: readonly CalendarState[]): CalendarState {
  const state = states.at(-1);
  if (state === undefined) throw new Error('no state was committed');

  return state;
}

afterEach(cleanup);

describe('rejectionOf', () => {
  it('accepts a file named .ics, and one declared text/calendar (Requirement 14.2)', () => {
    expect(rejectionOf(icsFile('spring.ics', ''))).toBeNull();
    expect(rejectionOf(icsFile('SPRING.ICS', ''))).toBeNull();
    expect(rejectionOf(icsFile('export', 'text/calendar'))).toBeNull();
  });

  it('rejects a file that is neither named .ics nor typed text/calendar (Requirement 14.3)', () => {
    expect(rejectionOf(icsFile('schedule.pdf', 'application/pdf'))).toBe(
      'wrongType',
    );
    expect(isCalendarFile(icsFile('notes.txt', 'text/plain'))).toBe(false);
  });

  it('rejects a calendar file over the 5 megabyte limit (Requirement 14.4)', () => {
    expect(rejectionOf(oversized(icsFile()))).toBe('tooLarge');
  });

  it('accepts a calendar file exactly at the limit (Requirement 14.2)', () => {
    const file = icsFile();
    Object.defineProperty(file, 'size', { value: MAX_CALENDAR_BYTES });

    expect(rejectionOf(file)).toBeNull();
  });

  it('reports one message for a file that is both wrong-typed and oversized', () => {
    expect(rejectionOf(oversized(icsFile('huge.pdf', 'application/pdf')))).toBe(
      'wrongType',
    );
  });
});

describe('CalendarControl', () => {
  it('states that the file is read on the device and can be removed (Requirement 17.9)', () => {
    mount();

    expect(screen.getByTestId('calendar-control-privacy').textContent).toBe(
      PRIVACY_STATEMENT,
    );
    expect(input().getAttribute('aria-describedby')).toContain(
      'calendar-file-privacy',
    );
  });

  it('associates a label with the file control (Requirement 11.10)', () => {
    mount();

    expect(input().type).toBe('file');
    expect(input().disabled).toBe(false);
  });

  it('derives a Busy_Schedule from a selected .ics file (Requirements 14.1, 14.2)', async () => {
    const { states } = mount();

    select(icsFile());

    await waitFor(() => expect(last(states).kind).toBe('loaded'));

    // 14:00-15:00 UTC is 9:00-10:00 in Atlanta before the March DST change and
    // 10:00-11:00 after it, and those two touching Monday blocks merge into one
    // 9:00-11:00 stretch (Requirement 14.13).
    expect(scheduleOf(last(states))).toEqual({
      fileName: 'spring-2026.ics',
      loadedAt: LOADED_AT.toISOString(),
      blocks: [
        {
          weekday: 'Monday',
          startMinute: 540,
          endMinute: 660,
          summaries: ['CS 1332'],
        },
      ],
      truncated: false,
      discardedBlocks: 0,
    });
  });

  it('derives a Busy_Schedule from a dropped .ics file (Requirement 14.1)', async () => {
    const { states } = mount();

    drop(icsFile());

    await waitFor(() => expect(last(states).kind).toBe('loaded'));
  });

  it('shows a keyboard-focusable busy affordance while parsing (Requirement 11.10)', () => {
    mount({
      state: { kind: 'parsing', fileName: 'spring-2026.ics', schedule: null },
    });

    const busy = screen.getByTestId('calendar-control-busy');

    expect(busy.textContent).toBe(busyText('spring-2026.ics'));
    expect(busy.getAttribute('tabindex')).toBe('0');
    expect(input().getAttribute('aria-busy')).toBe('true');
  });

  it('rejects a file that is not a calendar file and keeps the loaded schedule (Requirement 14.3)', () => {
    const schedule = loadedSchedule();
    const { states } = mount({
      state: { kind: 'loaded', schedule, persisted: true, notice: null },
    });

    select(icsFile('schedule.pdf', 'application/pdf'));

    expect(states).toEqual([{ kind: 'error', notice: 'wrongType', schedule }]);
    expect(screen.getByTestId('calendar-control-notice').textContent).toBe(
      WRONG_TYPE_MESSAGE,
    );
    expect(screen.queryByTestId('calendar-control-busy')).toBeNull();
  });

  it('rejects a file over the limit and keeps the loaded schedule (Requirement 14.4)', () => {
    const schedule = loadedSchedule();
    const { states } = mount({
      state: { kind: 'loaded', schedule, persisted: true, notice: null },
    });

    select(oversized(icsFile()));

    expect(states).toEqual([{ kind: 'error', notice: 'tooLarge', schedule }]);
    expect(screen.getByTestId('calendar-control-notice').textContent).toBe(
      TOO_LARGE_MESSAGE,
    );
  });

  it('reports a chunk that will not load and keeps the loaded schedule (Requirement 11.10)', async () => {
    const schedule = loadedSchedule();
    const { states } = mount({
      state: { kind: 'loaded', schedule, persisted: true, notice: null },
      loadParser: () => Promise.reject(new Error('offline')),
    });

    select(icsFile());

    await waitFor(() => expect(last(states).kind).toBe('error'));

    expect(states).toEqual([
      { kind: 'parsing', fileName: 'spring-2026.ics', schedule },
      { kind: 'error', notice: 'parserUnavailable', schedule },
    ]);
  });

  it('reports an unreadable calendar and keeps the loaded schedule (Requirement 14.15)', async () => {
    const schedule = loadedSchedule();
    const { states } = mount({
      state: { kind: 'loaded', schedule, persisted: true, notice: null },
    });

    select(icsFile('spring-2026.ics', 'text/calendar', 'not a calendar'));

    await waitFor(() => expect(last(states).kind).toBe('error'));

    expect(last(states)).toEqual({
      kind: 'error',
      notice: 'invalidCalendar',
      schedule,
    });
  });

  it('offers no removal control while no Busy_Schedule is loaded (Requirement 17.6)', () => {
    mount();

    expect(screen.queryByTestId('calendar-remove')).toBeNull();
  });

  it('removes the loaded and the stored Busy_Schedule (Requirements 17.4, 11.10)', () => {
    const store = new MemoryStorage();
    const schedule = loadedSchedule();
    saveStoredSchedule(schedule, store);
    const { states } = mount({
      state: { kind: 'loaded', schedule, persisted: true, notice: null },
      store,
    });

    // The accessible name is the button's own text (Requirement 11.10).
    const remove = screen.getByRole('button', { name: REMOVE_CALENDAR_LABEL });
    fireEvent.click(remove);

    // `none` withdraws the schedule, which is what clears every Conflict_State,
    // every Conflict_Detail, and the excluded count where they are derived.
    expect(states).toEqual([NO_CALENDAR]);
    expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
    expect(screen.queryByTestId('calendar-remove')).toBeNull();
  });

  it('keeps offering removal while a rejected file leaves a schedule loaded (Requirement 17.4)', () => {
    mount({
      state: {
        kind: 'error',
        notice: 'invalidCalendar',
        schedule: loadedSchedule(),
      },
    });

    expect(screen.getByTestId('calendar-remove')).toBeTruthy();
  });

  it('does not fetch the parser for a rejected file (Requirements 14.3, 14.4)', () => {
    let calls = 0;
    const { states } = mount({
      loadParser: async () => {
        calls += 1;
        return parseCalendar;
      },
    });

    select(icsFile('schedule.pdf', 'application/pdf'));
    select(oversized(icsFile()));

    expect(calls).toBe(0);
    expect(states.map(state => state.kind)).toEqual(['error', 'error']);
  });
});
