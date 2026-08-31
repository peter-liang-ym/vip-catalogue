// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { BusySchedule } from '../../shared/types';
import type { CalendarState } from '../calendarState';
import {
  blockCountText,
  CalendarStatus,
  fileNameText,
  INVALID_CALENDAR_MESSAGE,
  loadTimeText,
  NOT_RESTORED_MESSAGE,
  NOT_SAVED_MESSAGE,
  NO_USABLE_EVENTS_MESSAGE,
  noticeMessage,
  PARSER_UNAVAILABLE_MESSAGE,
  retainedText,
  TIMEOUT_MESSAGE,
} from './CalendarStatus';

function schedule(overrides: Partial<BusySchedule> = {}): BusySchedule {
  return {
    fileName: 'spring-2026.ics',
    // 14:30 UTC on a standard-time date: 9:30 AM in Atlanta.
    loadedAt: '2026-01-12T14:30:00Z',
    blocks: [
      {
        weekday: 'Monday',
        startMinute: 570,
        endMinute: 620,
        summaries: ['CS 1332'],
      },
      {
        weekday: 'Wednesday',
        startMinute: 570,
        endMinute: 620,
        summaries: ['CS 1332'],
      },
    ],
    truncated: false,
    discardedBlocks: 0,
    ...overrides,
  };
}

function mount(state: CalendarState) {
  render(<CalendarStatus state={state} />);
}

afterEach(cleanup);

describe('CalendarStatus', () => {
  it('displays no file name, block count, or load time while none is loaded (Requirement 17.6)', () => {
    mount({ kind: 'none' });

    expect(screen.queryByTestId('calendar-status-schedule')).toBeNull();
    expect(screen.queryByTestId('calendar-status-message')).toBeNull();
  });

  it('displays the file name, the block count, and the load time with a time zone (Requirement 14.18)', () => {
    mount({
      kind: 'loaded',
      schedule: schedule(),
      persisted: true,
      notice: null,
    });

    expect(screen.getByTestId('calendar-status-file').textContent).toBe(
      fileNameText('spring-2026.ics'),
    );
    expect(screen.getByTestId('calendar-status-blocks').textContent).toBe(
      blockCountText(2),
    );

    const loaded = screen.getByTestId('calendar-status-loaded').textContent;
    expect(loaded).toContain('January 12, 2026');
    expect(loaded).toContain('9:30');
    // An explicit zone, not the visitor's implied one.
    expect(loaded).toContain('EST');
  });

  it('states the retained count and that further entries went unused (Requirement 14.14)', () => {
    mount({
      kind: 'loaded',
      schedule: schedule({ truncated: true, discardedBlocks: 7 }),
      persisted: true,
      notice: 'truncated',
    });

    expect(screen.getByTestId('calendar-status-truncated').textContent).toBe(
      retainedText(2),
    );
  });

  it('states that the calendar could not be saved and keeps the details (Requirement 17.8)', () => {
    mount({
      kind: 'loaded',
      schedule: schedule(),
      persisted: false,
      notice: null,
    });

    expect(screen.getByTestId('calendar-status-not-saved').textContent).toBe(
      NOT_SAVED_MESSAGE,
    );
    expect(screen.getByTestId('calendar-status-blocks').textContent).toBe(
      blockCountText(2),
    );
  });

  it('shows the retained-count and could-not-save messages together (Requirements 14.14, 17.8)', () => {
    mount({
      kind: 'loaded',
      schedule: schedule({ truncated: true, discardedBlocks: 3 }),
      persisted: false,
      notice: 'truncated',
    });

    expect(screen.getByTestId('calendar-status-truncated')).toBeTruthy();
    expect(screen.getByTestId('calendar-status-not-saved')).toBeTruthy();
  });

  it('shows no could-not-save message on a stored schedule (Requirement 17.1)', () => {
    mount({
      kind: 'loaded',
      schedule: schedule(),
      persisted: true,
      notice: null,
    });

    expect(screen.queryByTestId('calendar-status-not-saved')).toBeNull();
    expect(screen.queryByTestId('calendar-status-truncated')).toBeNull();
  });

  it.each([
    ['invalidCalendar', INVALID_CALENDAR_MESSAGE],
    ['noUsableEvents', NO_USABLE_EVENTS_MESSAGE],
    ['timeout', TIMEOUT_MESSAGE],
    ['parserUnavailable', PARSER_UNAVAILABLE_MESSAGE],
    ['notRestored', NOT_RESTORED_MESSAGE],
  ] as const)(
    'states one message for %s (Requirements 14.15, 14.16, 14.17, 17.7)',
    (notice, expected) => {
      mount({ kind: 'error', notice, schedule: null });

      const messages = screen.getAllByTestId('calendar-status-message');
      expect(messages).toHaveLength(1);
      expect(messages[0]!.textContent).toBe(expected);
      expect(screen.queryByTestId('calendar-status-schedule')).toBeNull();
    },
  );

  it('keeps the loaded schedule on display behind a rejection message (Requirement 14.15)', () => {
    mount({
      kind: 'error',
      notice: 'invalidCalendar',
      schedule: schedule({ fileName: 'kept.ics' }),
    });

    expect(screen.getByTestId('calendar-status-file').textContent).toBe(
      fileNameText('kept.ics'),
    );
    expect(screen.getByTestId('calendar-status-message').textContent).toBe(
      INVALID_CALENDAR_MESSAGE,
    );
  });

  it('announces a rejection through a live region (Requirement 11.12)', () => {
    mount({ kind: 'error', notice: 'timeout', schedule: null });

    expect(
      screen.getByTestId('calendar-status-message').getAttribute('role'),
    ).toBe('alert');
  });

  it('leaves the pre-parse rejections to the control that took the file (Requirements 14.3, 14.4)', () => {
    expect(noticeMessage('wrongType')).toBeNull();
    expect(noticeMessage('tooLarge')).toBeNull();

    mount({ kind: 'error', notice: 'wrongType', schedule: null });
    expect(screen.queryByTestId('calendar-status-message')).toBeNull();
  });

  it('keeps the details on display while a replacement parses (Requirement 14.18)', () => {
    mount({
      kind: 'parsing',
      fileName: 'new.ics',
      schedule: schedule({ fileName: 'old.ics' }),
    });

    expect(screen.getByTestId('calendar-status-file').textContent).toBe(
      fileNameText('old.ics'),
    );
  });

  it('states one block in the singular (Requirement 14.18)', () => {
    expect(blockCountText(1)).toBe('1 busy time block loaded.');
  });

  it('shows an unreadable stored load time as it stands (Requirement 17.2)', () => {
    expect(loadTimeText('not a date')).toBe('Loaded not a date');
  });
});
