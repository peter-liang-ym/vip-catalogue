// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { serialize } from '../ingest/serialize';
import type { BusySchedule, TeamRecord } from '../shared/types';
import { App } from './app';
import { BUSY_SCHEDULE_KEY, saveStoredSchedule } from './busyScheduleStore';
import { REMOVE_CALENDAR_LABEL } from './components/CalendarControl';
import { NOT_RESTORED_MESSAGE } from './components/CalendarStatus';
import {
  HIDE_CONFLICTS_LABEL,
  NO_CALENDAR_MESSAGE,
} from './components/HideConflictsToggle';
import { CONFLICT_TEXT } from './components/TeamCard';

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
 * 30 teams, so the default page size of 24 yields two pages and paging is a
 * discrete change worth pushing a history entry for. Names are zero-padded, so
 * the default name-ascending order is the numeric one.
 */
const TEAMS = Array.from({ length: 30 }, (_, i) =>
  record(String(1000 + i), `Team ${String(i + 1).padStart(2, '0')}`),
);

const DATASET_JSON = serialize(TEAMS, new Date('2026-01-05T04:30:00Z'));

/** Answers every Dataset request with the same body, or with `status` when given. */
function stubFetch(status = 200): typeof globalThis.fetch {
  return (async (_input: RequestInfo | URL) =>
    new Response(status === 200 ? DATASET_JSON : '', {
      status,
    })) as typeof globalThis.fetch;
}

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
 * A schedule covering the Monday 9:00-11:00 stretch, so every Team in `TEAMS`
 * conflicts with it and the recompute is observable from any card.
 */
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

/** Renders the shell at `href` and waits for the Dataset to arrive. */
async function mountAt(href: string, fetchImpl = stubFetch()) {
  history.replaceState(null, '', href);
  render(<App fetch={fetchImpl} />);
  await screen.findByTestId('result-count');
}

/**
 * Renders the shell at `href` over the given storage, so the restore, the
 * could-not-restore notice, and the removal are exercised without a real
 * `localStorage` (Requirements 17.2, 17.4, 17.7).
 */
async function mountWithStore(href: string, store: Storage) {
  history.replaceState(null, '', href);
  render(<App fetch={stubFetch()} store={store} />);
  await screen.findByTestId('result-count');
}

/** Storage holding a readable Busy_Schedule from a previous visit. */
function storedSchedule(): Storage {
  const store = new MemoryStorage();
  saveStoredSchedule(SCHEDULE, store);

  return store;
}

function resultCount(): string {
  return screen.getByTestId('result-count').textContent ?? '';
}

function hideConflictsToggle(): HTMLInputElement {
  return screen.getByLabelText(HIDE_CONFLICTS_LABEL) as HTMLInputElement;
}

function address(): string {
  return `${location.pathname}${location.search}`;
}

function pagePosition(): string {
  return screen.getByTestId('page-position').textContent ?? '';
}

/** Real browser back, waiting for the `popstate` the shell re-derives from. */
async function goBack(): Promise<void> {
  const popped = new Promise<void>(resolve => {
    addEventListener('popstate', () => resolve(), { once: true });
  });
  history.back();
  await popped;
}

afterEach(cleanup);

describe('App', () => {
  it('applies the Query_State in the address before the first render (Requirement 8.2)', async () => {
    await mountAt('/?q=team+03');

    expect(screen.getByTestId('result-count').textContent).toBe(
      '1 matching team',
    );
    expect(screen.getByLabelText('Search teams')).toHaveProperty(
      'value',
      'team 03',
    );
  });

  it('honors the page number the address carries rather than resetting it', async () => {
    await mountAt('/?page=2');

    expect(pagePosition()).toBe('Page 2 of 2');
    expect(screen.getByText('Team 25')).toBeTruthy();
  });

  it('writes search typing to the address by replacement, adding no history entry (Requirements 8.1, 8.8)', async () => {
    await mountAt('/');
    const entries = history.length;

    fireEvent.input(screen.getByLabelText('Search teams'), {
      target: { value: 'team 03' },
    });

    // The Result_Set updates without waiting for the address (Requirement 5.9).
    expect(screen.getByTestId('result-count').textContent).toBe(
      '1 matching team',
    );

    await waitFor(() => expect(address()).toBe('/?q=team+03'));
    expect(history.length).toBe(entries);
  });

  it('pushes one history entry for a discrete change (Requirement 8.1)', async () => {
    await mountAt('/');
    const entries = history.length;

    fireEvent.click(screen.getByText('Next page'));

    expect(address()).toBe('/?page=2');
    expect(history.length).toBe(entries + 1);
    expect(pagePosition()).toBe('Page 2 of 2');
  });

  it('re-derives from the address on back navigation without reloading (Requirement 8.5)', async () => {
    await mountAt('/');
    fireEvent.click(screen.getByText('Next page'));
    expect(pagePosition()).toBe('Page 2 of 2');

    await goBack();

    await waitFor(() => expect(pagePosition()).toBe('Page 1 of 2'));
    expect(address()).toBe('/');
  });

  it('opens a team carrying the listing Query_State and restores it from the listing link (Requirement 9.4)', async () => {
    await mountAt('/?page=2');

    fireEvent.click(screen.getByText('Team 25'));

    expect(address()).toBe('/team/1024?page=2');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Team 25',
    );

    fireEvent.click(screen.getByText('Back to all teams'));

    expect(address()).toBe('/?page=2');
    expect(pagePosition()).toBe('Page 2 of 2');
  });

  it('restores the listing Query_State on back navigation from a team (Requirement 9.4)', async () => {
    await mountAt('/?page=2');
    fireEvent.click(screen.getByText('Team 25'));

    await goBack();

    await waitFor(() => expect(pagePosition()).toBe('Page 2 of 2'));
    expect(address()).toBe('/?page=2');
  });

  it('applies the defaults from a team opened with no Query_State (Requirement 9.8)', async () => {
    history.replaceState(null, '', '/team/1024');
    render(<App fetch={stubFetch()} />);

    fireEvent.click(await screen.findByText('Back to all teams'));

    expect(address()).toBe('/');
    expect(pagePosition()).toBe('Page 1 of 2');
  });

  it('renders the not-found view for an entry id absent from the Dataset (Requirement 9.5)', async () => {
    history.replaceState(null, '', '/team/9999');
    render(<App fetch={stubFetch()} />);

    expect(await screen.findByText('That team was not found.')).toBeTruthy();
  });

  it('displays the out-of-date notice above the cards and keeps rendering the Result_Set (Requirement 10.4)', async () => {
    history.replaceState(null, '', '/');
    const renderedAt =
      Date.parse('2026-01-05T04:30:00Z') + 31 * 24 * 60 * 60 * 1000;
    render(<App fetch={stubFetch()} now={() => renderedAt} />);
    await screen.findByTestId('result-count');

    const notice = screen.getByTestId('freshness-stale');
    const cards = screen.getByTestId('listing-cards');
    expect(
      notice.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('Team 01')).toBeTruthy();
  });

  it('displays the unknown-currency indication and keeps rendering the Result_Set (Requirement 10.6)', async () => {
    const withoutTimestamp = { ...JSON.parse(DATASET_JSON) };
    delete withoutTimestamp.generatedAt;
    const fetchImpl = (async (_input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(withoutTimestamp),
      )) as typeof globalThis.fetch;

    history.replaceState(null, '', '/');
    render(<App fetch={fetchImpl} />);
    await screen.findByTestId('result-count');

    expect(screen.getByTestId('freshness-unknown')).toBeTruthy();
    expect(screen.queryByTestId('freshness-generated')).toBeNull();
    expect(screen.getByText('Team 01')).toBeTruthy();
  });

  it('restores a stored Busy_Schedule and states every Conflict_State (Requirements 17.2, 15.8)', async () => {
    await mountWithStore('/', storedSchedule());

    expect(screen.getByTestId('calendar-status-file').textContent).toContain(
      'spring-2026.ics',
    );
    expect(screen.getByTestId('calendar-status-blocks').textContent).toContain(
      '1 busy time block',
    );
    expect(screen.getByTestId('calendar-status-loaded').textContent).toContain(
      'EST',
    );
    // Every card carries the state the restored schedule implies, and the
    // Query_State is untouched by the recompute (Requirement 15.9).
    expect(
      screen.getAllByText(CONFLICT_TEXT.conflicting).length,
    ).toBeGreaterThan(0);
    expect(resultCount()).toBe('30 matching teams');
  });

  it('states that a corrupt stored calendar could not be restored (Requirement 17.7)', async () => {
    const store = new MemoryStorage();
    store.setItem(BUSY_SCHEDULE_KEY, 'not a stored schedule');

    await mountWithStore('/', store);

    expect(screen.getByTestId('calendar-status-message').textContent).toBe(
      NOT_RESTORED_MESSAGE,
    );
    expect(screen.queryByTestId('calendar-status-schedule')).toBeNull();
    expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();
    expect(screen.queryByText(CONFLICT_TEXT.conflicting)).toBeNull();
  });

  it('displays the Conflict_Detail of a conflicting team (Requirements 9.1, 15.5)', async () => {
    await mountWithStore('/', storedSchedule());

    fireEvent.click(screen.getByText('Team 01'));

    const detail = screen.getByTestId('conflict-detail');
    expect(detail.textContent).toContain('Monday');
    expect(detail.textContent).toContain('9:00 AM to 11:00 AM');
    expect(detail.textContent).toContain('CS 1332');
  });

  it('shows no Conflict_Detail with no calendar loaded (Requirement 15.7)', async () => {
    await mountAt('/');

    fireEvent.click(screen.getByText('Team 01'));

    expect(screen.queryByTestId('conflict-detail')).toBeNull();
  });

  it('pushes one history entry encoding a toggle change (Requirements 16.5, 8.1)', async () => {
    await mountWithStore('/', storedSchedule());
    const entries = history.length;

    const toggle = hideConflictsToggle();
    toggle.checked = true;
    fireEvent.change(toggle);

    expect(address()).toBe('/?hc=1');
    expect(history.length).toBe(entries + 1);
    expect(resultCount()).toBe('0 matching teams');
  });

  it('removing the calendar withdraws every Conflict_State and the excluded count, keeping the toggle setting (Requirements 17.4, 17.5)', async () => {
    const store = storedSchedule();
    await mountWithStore('/?hc=1', store);

    // Every Team conflicts, so the toggle on empties the Result_Set.
    expect(resultCount()).toBe('0 matching teams');
    expect(screen.getByTestId('hide-conflicts-excluded').textContent).toContain(
      '30 teams hidden',
    );

    fireEvent.click(screen.getByText(REMOVE_CALENDAR_LABEL));

    expect(resultCount()).toBe('30 matching teams');
    expect(screen.queryByText(CONFLICT_TEXT.conflicting)).toBeNull();
    expect(screen.queryByTestId('calendar-status-schedule')).toBeNull();
    expect(screen.queryByTestId('hide-conflicts-excluded')).toBeNull();
    expect(store.getItem(BUSY_SCHEDULE_KEY)).toBeNull();

    // Requirement 17.5: the toggle setting is Query_State and survives, taking
    // the no-calendar-loaded path while it is on (Requirement 16.4).
    expect(hideConflictsToggle().checked).toBe(true);
    expect(screen.getByTestId('hide-conflicts-no-calendar').textContent).toBe(
      NO_CALENDAR_MESSAGE,
    );
    expect(address()).toBe('/?hc=1');
  });

  it('renders the failure message and a retry control, keeping the address (Requirements 12.5, 12.6)', async () => {
    let status = 500;
    const fetchImpl = (async (_input: RequestInfo | URL) =>
      new Response(status === 200 ? DATASET_JSON : '', {
        status,
      })) as typeof globalThis.fetch;

    history.replaceState(null, '', '/?q=team+03');
    render(<App fetch={fetchImpl} />);

    expect(
      await screen.findByText('The team data failed to load.'),
    ).toBeTruthy();
    expect(address()).toBe('/?q=team+03');

    status = 200;
    fireEvent.click(screen.getByText('Try again'));

    await screen.findByTestId('result-count');
    expect(screen.getByTestId('result-count').textContent).toBe(
      '1 matching team',
    );
  });
});
