// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusySchedule, Dataset, TeamRecord } from '../../shared/types';
import { NO_CALENDAR, scheduleOf, type CalendarState } from '../calendarState';
import { derive, type DerivedView } from '../derive';
import { DEFAULT_QUERY_STATE, type QueryState } from '../queryState';
import { buildIndex } from '../search';
import {
  CALENDAR_CONTROL_LABEL,
  REMOVE_CALENDAR_LABEL,
} from './CalendarControl';
import { HIDE_CONFLICTS_LABEL } from './HideConflictsToggle';
import {
  Listing,
  matchCountText,
  PAGE_NUMBER_LABEL,
  PAGE_SIZE_LABEL,
  UNOFFICIAL_MIRROR_NOTICE,
} from './Listing';

function record(entryId: string, name: string): TeamRecord {
  return {
    entryId,
    sourceUrl: `https://vip.gatech.edu/teams/entry/${entryId}`,
    name,
    imageUrl: '',
    imagePath: '',
    imageAlt: '',
    goals: '',
    issuesAddressed: '',
    partnersSponsors: '',
    methodsTechnologies: '',
    majorsSought: [{ college: 'Engineering', major: 'ME' }],
    preferredInterests: '',
    advisors: [],
    meeting: { day: 'Monday', time: '9:30-10:20', location: '' },
    meetingWindow: [{ weekday: 'Monday', startMinute: 570, endMinute: 620 }],
  };
}

/**
 * 30 Teams, so the default page size of 24 yields two pages and every size on
 * offer yields a different page count. Names are zero-padded, so the default
 * name-ascending order is the numeric one.
 */
const TEAMS = Array.from({ length: 30 }, (_, i) =>
  record(String(1000 + i), `Team ${String(i + 1).padStart(2, '0')}`),
);

/** A schedule covering the Monday 9:30-10:20 meeting every Team in `TEAMS` holds. */
const SCHEDULE: BusySchedule = {
  fileName: 'spring-2026.ics',
  loadedAt: '2026-01-12T14:30:00Z',
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
};

const LOADED: CalendarState = {
  kind: 'loaded',
  schedule: SCHEDULE,
  persisted: true,
  notice: null,
};

function dataset(teams: readonly TeamRecord[] = TEAMS): Dataset {
  return {
    schemaVersion: '2',
    generatedAt: '2026-01-05T04:30:00Z',
    teamCount: teams.length,
    teams: [...teams],
  };
}

function queryState(overrides: Partial<QueryState> = {}): QueryState {
  return { ...DEFAULT_QUERY_STATE, ...overrides };
}

/**
 * The listing over a real derived view, since every number it renders and every
 * page it slices comes from `derive`.
 */
function mount(
  qs: QueryState = queryState(),
  teams: readonly TeamRecord[] = TEAMS,
  calendar: CalendarState = NO_CALENDAR,
) {
  const index = buildIndex(dataset(teams));
  const view: DerivedView = derive(index, qs, scheduleOf(calendar));
  const onCommit = vi.fn();
  const onQuery = vi.fn();
  const onOpenTeam = vi.fn();
  const onCalendarState = vi.fn();

  render(
    <Listing
      view={view}
      qs={qs}
      calendar={calendar}
      onQuery={onQuery}
      onCommit={onCommit}
      onCalendarState={onCalendarState}
      onOpenTeam={onOpenTeam}
    />,
  );

  return { view, onCommit, onQuery, onOpenTeam, onCalendarState };
}

function cardNames(): readonly string[] {
  return [...screen.getByTestId('listing-cards').children].map(
    card => card.querySelector('.team-card__name')?.textContent ?? '',
  );
}

afterEach(cleanup);

describe('Listing', () => {
  it('displays the total count, the current page, and the page count (Requirement 4.1)', () => {
    mount();

    expect(screen.getByTestId('result-count').textContent).toBe(
      '30 matching teams',
    );
    expect(screen.getByTestId('page-position').textContent).toBe('Page 1 of 2');
  });

  it('renders the first page at the default page size (Requirements 4.1, 4.5)', () => {
    mount();

    const names = cardNames();
    expect(names).toHaveLength(24);
    expect(names[0]).toBe('Team 01');
    expect(names[23]).toBe('Team 24');
  });

  it('renders the positions of the selected page (Requirement 4.5)', () => {
    mount(queryState({ pageNumber: 2 }));

    expect(cardNames()).toEqual([
      'Team 25',
      'Team 26',
      'Team 27',
      'Team 28',
      'Team 29',
      'Team 30',
    ]);
    expect(screen.getByTestId('page-position').textContent).toBe('Page 2 of 2');
  });

  it('commits the page a visitor selects (Requirement 4.5)', () => {
    const { onCommit } = mount();

    fireEvent.change(screen.getByLabelText(PAGE_NUMBER_LABEL), {
      target: { value: '2' },
    });

    expect(onCommit).toHaveBeenCalledWith(queryState({ pageNumber: 2 }));
  });

  it('offers a page number for every page and no more (Requirement 4.1)', () => {
    mount();

    const options = [...screen.getByLabelText(PAGE_NUMBER_LABEL).children];
    expect(options.map(option => option.textContent)).toEqual(['1', '2']);
  });

  it('steps to the neighbouring page, disabling the step at each end', () => {
    const { onCommit } = mount();

    expect(screen.getByText('Previous page')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByText('Next page'));

    expect(onCommit).toHaveBeenCalledWith(queryState({ pageNumber: 2 }));

    cleanup();
    mount(queryState({ pageNumber: 2 }));
    expect(screen.getByText('Next page')).toHaveProperty('disabled', true);
  });

  it('offers the four page sizes and resets the page number on a change (Requirements 4.4, 4.9)', () => {
    const { onCommit } = mount(queryState({ pageNumber: 2 }));
    const control = screen.getByLabelText(PAGE_SIZE_LABEL);

    expect([...control.children].map(option => option.textContent)).toEqual([
      '12',
      '24',
      '48',
      'All results',
    ]);

    fireEvent.change(control, { target: { value: '12' } });

    expect(onCommit).toHaveBeenCalledWith(
      queryState({ pageSize: 12, pageNumber: 1 }),
    );
  });

  it('displays at most the selected page size per page (Requirement 4.4)', () => {
    mount(queryState({ pageSize: 12 }));

    expect(cardNames()).toHaveLength(12);
    expect(screen.getByTestId('page-position').textContent).toBe('Page 1 of 3');
  });

  it('applies the all-results page size as the Result_Set total (Requirement 4.4)', () => {
    mount(queryState({ pageSize: 'all' }));

    expect(cardNames()).toHaveLength(30);
    expect(screen.getByTestId('page-position').textContent).toBe('Page 1 of 1');
  });

  it('shows the page the derived view settled on rather than the one requested (Requirements 4.6, 4.7)', () => {
    mount(queryState({ pageNumber: 99 }));

    expect(screen.getByTestId('page-position').textContent).toBe('Page 2 of 2');
    expect(screen.getByLabelText(PAGE_NUMBER_LABEL)).toHaveProperty(
      'value',
      '2',
    );
  });

  it('steps from the page on screen, not from the requested page (Requirement 4.7)', () => {
    const { onCommit } = mount(queryState({ pageNumber: 99 }));

    fireEvent.click(screen.getByText('Previous page'));

    expect(onCommit).toHaveBeenCalledWith(queryState({ pageNumber: 1 }));
  });

  it('displays the unofficial-mirror notice above the first Team_Card (Requirement 10.1)', () => {
    mount();

    const notice = screen.getByTestId('mirror-notice');
    expect(notice.textContent).toBe(UNOFFICIAL_MIRROR_NOTICE);
    expect(
      notice.compareDocumentPosition(screen.getByTestId('listing-cards')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('announces the matching count through a live region (Requirements 11.4, 11.12)', () => {
    mount();
    const region = screen.getByTestId('result-count');

    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe(matchCountText(30));
  });

  it('announces a matching count of zero (Requirement 11.4)', () => {
    mount(queryState({ query: 'nothing matches this' }));

    expect(screen.getByTestId('result-count').textContent).toBe(
      '0 matching teams',
    );
    expect(screen.queryByTestId('listing-cards')).toBeNull();
  });

  it('reports search-field input to the shell', () => {
    const { onQuery } = mount();

    fireEvent.input(screen.getByLabelText('Search teams'), {
      target: { value: 'robot' },
    });

    expect(onQuery).toHaveBeenCalledWith('robot');
  });

  it('opens the team whose card was activated', () => {
    const { onOpenTeam } = mount();

    fireEvent.click(screen.getByText('Team 01'));

    expect(onOpenTeam).toHaveBeenCalledWith('1000');
  });

  it('mounts the Calendar_File control and the toggle with no calendar loaded (Requirements 14.1, 16.1, 17.6)', () => {
    mount();

    expect(screen.getByLabelText(CALENDAR_CONTROL_LABEL)).toBeTruthy();
    expect(
      (screen.getByLabelText(HIDE_CONFLICTS_LABEL) as HTMLInputElement).checked,
    ).toBe(false);
    // Requirement 17.6: no file name, no block count, no load time, and no
    // removal control while nothing is loaded.
    expect(screen.queryByTestId('calendar-status-schedule')).toBeNull();
    expect(screen.queryByTestId('calendar-remove')).toBeNull();
  });

  it('displays the loaded calendar and its removal control (Requirements 14.18, 17.4)', () => {
    mount(queryState(), TEAMS, LOADED);

    expect(screen.getByTestId('calendar-status-file').textContent).toContain(
      'spring-2026.ics',
    );
    expect(screen.getByTestId('calendar-status-blocks').textContent).toContain(
      '1 busy time block',
    );
    expect(screen.getByTestId('calendar-remove').textContent).toBe(
      REMOVE_CALENDAR_LABEL,
    );
  });

  it('commits a toggle change through the discrete-change path (Requirements 16.5, 8.1)', () => {
    const { onCommit } = mount(queryState({ pageNumber: 2 }), TEAMS, LOADED);
    const toggle = screen.getByLabelText(
      HIDE_CONFLICTS_LABEL,
    ) as HTMLInputElement;

    toggle.checked = true;
    fireEvent.change(toggle);

    expect(onCommit).toHaveBeenCalledWith(
      queryState({ hideConflicts: true, pageNumber: 1 }),
    );
  });

  it('states the count the toggle excluded from the derived view (Requirement 16.3)', () => {
    // Every Team meets Monday 9:30-10:20, which the loaded schedule covers, so
    // the toggle removes all 30 and the listing is the all-conflict empty state.
    mount(queryState({ hideConflicts: true }), TEAMS, LOADED);

    expect(screen.getByTestId('hide-conflicts-excluded').textContent).toBe(
      '30 teams hidden by the hide-conflicts toggle.',
    );
    expect(screen.queryByTestId('listing-cards')).toBeNull();
    expect(screen.getByTestId('empty-state-excluded').textContent).toBe(
      '30 teams hidden by the hide-conflicts toggle.',
    );
  });

  it('renders exactly one hide-conflicts toggle in the all-conflict empty state (Requirement 16.8)', () => {
    mount(queryState({ hideConflicts: true }), TEAMS, LOADED);

    expect(screen.getAllByLabelText(HIDE_CONFLICTS_LABEL)).toHaveLength(1);
  });
});
