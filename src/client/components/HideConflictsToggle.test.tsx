// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusySchedule } from '../../shared/types';
import type { CalendarState } from '../calendarState';
import { DEFAULT_QUERY_STATE, type QueryState } from '../queryState';
import {
  excludedText,
  HIDE_CONFLICTS_LABEL,
  HideConflictsToggle,
  NO_CALENDAR_MESSAGE,
} from './HideConflictsToggle';

const schedule: BusySchedule = {
  fileName: 'spring-2026.ics',
  loadedAt: '2026-01-12T14:30:00Z',
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

const LOADED: CalendarState = {
  kind: 'loaded',
  schedule,
  persisted: true,
  notice: null,
};

function mount(
  props: {
    readonly qs?: Partial<QueryState>;
    readonly calendar?: CalendarState;
    readonly hiddenByToggle?: number;
  } = {},
) {
  const onCommit = vi.fn();
  const qs = { ...DEFAULT_QUERY_STATE, ...props.qs };

  render(
    <HideConflictsToggle
      qs={qs}
      calendar={props.calendar ?? { kind: 'none' }}
      hiddenByToggle={props.hiddenByToggle ?? 0}
      onCommit={onCommit}
    />,
  );

  return { onCommit, qs, toggle: screen.getByRole('checkbox') as HTMLInputElement };
}

afterEach(cleanup);

describe('HideConflictsToggle', () => {
  it('offers one control with a programmatically associated label (Requirements 16.1, 11.10)', () => {
    const { toggle } = mount();

    expect(screen.getByLabelText(HIDE_CONFLICTS_LABEL)).toBe(toggle);
    expect(toggle.type).toBe('checkbox');
  });

  it('reads as off for the default Query_State (Requirement 16.1)', () => {
    const { toggle } = mount();

    expect(toggle.checked).toBe(false);
    expect(screen.queryByTestId('hide-conflicts-excluded')).toBeNull();
    expect(screen.queryByTestId('hide-conflicts-no-calendar')).toBeNull();
  });

  it('reads as on when the Query_State has it on (Requirement 16.1)', () => {
    const { toggle } = mount({
      qs: { hideConflicts: true },
      calendar: LOADED,
    });

    expect(toggle.checked).toBe(true);
  });

  it('displays the excluded-Team count while on with a schedule loaded (Requirement 16.3)', () => {
    mount({ qs: { hideConflicts: true }, calendar: LOADED, hiddenByToggle: 3 });

    expect(screen.getByTestId('hide-conflicts-excluded').textContent).toBe(
      excludedText(3),
    );
    expect(screen.queryByTestId('hide-conflicts-no-calendar')).toBeNull();
  });

  it('displays a count of zero (Requirement 16.3)', () => {
    mount({ qs: { hideConflicts: true }, calendar: LOADED, hiddenByToggle: 0 });

    expect(screen.getByTestId('hide-conflicts-excluded').textContent).toBe(
      '0 teams hidden by the hide-conflicts toggle.',
    );
  });

  it('states one excluded team in the singular (Requirement 16.3)', () => {
    mount({ qs: { hideConflicts: true }, calendar: LOADED, hiddenByToggle: 1 });

    expect(screen.getByTestId('hide-conflicts-excluded').textContent).toBe(
      '1 team hidden by the hide-conflicts toggle.',
    );
  });

  it('states that a calendar must be loaded while on with none (Requirement 16.4)', () => {
    mount({ qs: { hideConflicts: true } });

    expect(screen.getByTestId('hide-conflicts-no-calendar').textContent).toBe(
      NO_CALENDAR_MESSAGE,
    );
    expect(screen.queryByTestId('hide-conflicts-excluded')).toBeNull();
  });

  it('states neither message while off (Requirements 16.3, 16.4)', () => {
    mount({ calendar: LOADED, hiddenByToggle: 4 });

    expect(screen.queryByTestId('hide-conflicts-excluded')).toBeNull();
    expect(screen.queryByTestId('hide-conflicts-no-calendar')).toBeNull();
  });

  it('commits the new setting with the page back to 1 (Requirement 16.5)', () => {
    const { onCommit, toggle } = mount({
      qs: { pageNumber: 4 },
      calendar: LOADED,
    });

    toggle.checked = true;
    fireEvent.change(toggle);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      hideConflicts: true,
      pageNumber: 1,
    });
  });

  it('leaves the Search_Query, the Filter values, and the Sort_Option unchanged (Requirement 16.5)', () => {
    const { onCommit, qs, toggle } = mount({
      qs: {
        query: 'robotics',
        filters: {
          college: ['College of Computing'],
          major: [],
          day: ['Monday'],
          advisor: [],
        },
        sort: 'name-desc',
        hideConflicts: true,
      },
      calendar: LOADED,
    });

    toggle.checked = false;
    fireEvent.change(toggle);

    expect(onCommit).toHaveBeenCalledWith({
      ...qs,
      hideConflicts: false,
      pageNumber: 1,
    });
  });
});
