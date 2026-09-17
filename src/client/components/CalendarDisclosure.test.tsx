// @vitest-environment jsdom
/**
 * `CalendarDisclosure`: where the calendar surfaces sit and what is on screen in
 * each state of the disclosure (Requirements 14.1, 14.18, 17.4, 17.6, 17.9, 11.10).
 *
 * What the file control itself does with a file — the two pre-parse checks, the
 * lazy parser, the busy affordance, the retained schedule — is `CalendarControl`'s
 * suite, and what the summary says is `CalendarStatus`'s. This suite covers only
 * the disclosure: collapsed by default, what expanding reveals, the collapse a load
 * causes, and the removal control beside the summary.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { BusySchedule } from '../../shared/types';
import { BUSY_SCHEDULE_KEY, saveStoredSchedule } from '../busyScheduleStore';
import { NO_CALENDAR, type CalendarState } from '../calendarState';
import { CALENDAR_CONTROL_LABEL, PRIVACY_STATEMENT } from './CalendarControl';
import {
  CALENDAR_DISCLOSURE_LABEL,
  CalendarDisclosure,
  REMOVE_CALENDAR_LABEL,
  REPLACE_CALENDAR_LABEL,
} from './CalendarDisclosure';

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

function schedule(fileName = 'spring-2026.ics'): BusySchedule {
  return {
    fileName,
    loadedAt: '2026-02-09T12:00:00Z',
    blocks: [
      {
        weekday: 'Monday',
        startMinute: 570,
        endMinute: 620,
        summaries: ['CS 1332'],
      },
    ],
    truncated: false,
    discardedBlocks: 0,
  };
}

function loaded(fileName?: string): CalendarState {
  return {
    kind: 'loaded',
    schedule: schedule(fileName),
    persisted: true,
    notice: null,
  };
}

/**
 * Renders the disclosure and records every committed transition. `set` renders the
 * same component with the next `CalendarState`, which is what the shell does with a
 * commit, and keeps the disclosure's own local state — the way a real load does.
 */
function mount(
  initial: CalendarState = NO_CALENDAR,
  store: Storage = new MemoryStorage(),
): {
  readonly states: CalendarState[];
  readonly set: (next: CalendarState) => void;
} {
  const states: CalendarState[] = [];
  const onState = (next: CalendarState) => void states.push(next);
  const element = (state: CalendarState) => (
    <CalendarDisclosure state={state} store={store} onState={onState} />
  );

  const { rerender } = render(element(initial));

  return { states, set: next => rerender(element(next)) };
}

function toggle(): HTMLButtonElement {
  return screen.getByTestId('calendar-disclosure-toggle') as HTMLButtonElement;
}

/** The disclosed body, which the disclosure control's `aria-controls` names. */
function body(): HTMLElement {
  const id = toggle().getAttribute('aria-controls') ?? '';
  const element = document.getElementById(id);

  if (element === null)
    throw new Error('the disclosure body is not in the document');

  return element;
}

afterEach(cleanup);

describe('CalendarDisclosure', () => {
  it('starts collapsed, so the control displaces no Team_Card (Requirements 14.1, 11.10)', () => {
    mount();

    expect(toggle().textContent).toBe(CALENDAR_DISCLOSURE_LABEL);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    // The body is hidden, which is what keeps it out of the tab order and the
    // accessibility tree rather than merely out of sight.
    expect(body().hidden).toBe(true);
  });

  it('reveals the file control, the drop target, and the privacy statement when expanded (Requirements 14.1, 17.9)', () => {
    mount();

    fireEvent.click(toggle());

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(body().hidden).toBe(false);
    expect(screen.getByTestId('calendar-control')).toBeTruthy();
    expect(screen.getByTestId('calendar-control-privacy').textContent).toBe(
      PRIVACY_STATEMENT,
    );
  });

  it('keeps the privacy statement for as long as the control is expanded (Requirement 17.9)', () => {
    mount();

    fireEvent.click(toggle());
    fireEvent.dragOver(screen.getByTestId('calendar-control'));

    expect(screen.getByTestId('calendar-control-privacy')).toBeTruthy();
    expect(body().hidden).toBe(false);
  });

  it('offers no removal control and no summary while nothing is loaded (Requirement 17.6)', () => {
    mount();

    expect(screen.queryByTestId('calendar-status-schedule')).toBeNull();
    expect(screen.queryByTestId('calendar-remove')).toBeNull();
  });

  it('collapses to the summary and the replace affordance once a schedule is loaded (Requirement 14.18)', () => {
    const { set } = mount();

    fireEvent.click(toggle());
    set(loaded());

    expect(body().hidden).toBe(true);
    expect(toggle().textContent).toBe(REPLACE_CALENDAR_LABEL);
    expect(screen.getByTestId('calendar-status-file').textContent).toContain(
      'spring-2026.ics',
    );
    expect(screen.getByTestId('calendar-status-blocks').textContent).toContain(
      '1 busy time block',
    );
    // Requirement 14.18: the load time carries its own zone.
    expect(screen.getByTestId('calendar-status-loaded').textContent).toContain(
      'EST',
    );
  });

  it('reopens the file control through the replace affordance (Requirement 14.1)', () => {
    mount(loaded());

    fireEvent.click(toggle());

    expect(body().hidden).toBe(false);
    // The summary of what is still loaded stays while the replacement is chosen.
    expect(screen.getByTestId('calendar-status-schedule')).toBeTruthy();
  });

  it('keeps focus out of the collapsed body when a load collapses it (Requirement 11.10)', () => {
    const { set } = mount();

    fireEvent.click(toggle());
    screen.getByLabelText(CALENDAR_CONTROL_LABEL).focus();
    set(loaded());

    expect(document.activeElement).toBe(toggle());
  });

  it('removes the loaded and the stored Busy_Schedule (Requirements 17.4, 11.10)', () => {
    const store = new MemoryStorage();
    saveStoredSchedule(schedule(), store);
    const { states, set } = mount(loaded(), store);

    // The accessible name is the button's own text (Requirement 11.10).
    fireEvent.click(
      screen.getByRole('button', { name: REMOVE_CALENDAR_LABEL }),
    );

    // `none` withdraws the schedule, which is what clears every Conflict_State,
    // every Conflict_Detail, and the excluded count where they are derived.
    expect(states).toEqual([NO_CALENDAR]);
    expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();

    set(NO_CALENDAR);
    expect(screen.queryByTestId('calendar-remove')).toBeNull();
    expect(screen.queryByTestId('calendar-status-schedule')).toBeNull();
    expect(toggle().textContent).toBe(CALENDAR_DISCLOSURE_LABEL);
  });

  it('keeps offering removal while a rejected file leaves a schedule loaded (Requirements 17.4, 14.15)', () => {
    mount({
      kind: 'error',
      notice: 'invalidCalendar',
      schedule: schedule('kept.ics'),
    });

    expect(screen.getByTestId('calendar-remove')).toBeTruthy();
    expect(screen.getByTestId('calendar-status-file').textContent).toContain(
      'kept.ics',
    );
    // The failure notice sits beneath the summary it did not disturb.
    expect(screen.getByTestId('calendar-status-message')).toBeTruthy();
  });

  it('states that a loaded schedule could not be saved (Requirement 17.8)', () => {
    mount({
      kind: 'loaded',
      schedule: schedule(),
      persisted: false,
      notice: null,
    });

    expect(screen.getByTestId('calendar-status-not-saved')).toBeTruthy();
  });
});
