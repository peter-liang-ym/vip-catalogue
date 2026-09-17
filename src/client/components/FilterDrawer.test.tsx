// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type Dataset,
  type TeamRecord,
} from '../../shared/types';
import { facetView } from '../facetView';
import { DEFAULT_QUERY_STATE, type QueryState } from '../queryState';
import { buildIndex } from '../search';
import {
  CLOSE_LABEL,
  DRAWER_MEDIA_QUERY,
  FilterDrawer,
  openLabel,
  SCROLL_LOCK_CLASS,
} from './FilterDrawer';
import { FILTER_PANEL_LABEL, toggleLabel } from './FilterPanel';

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

function dataset(teams: readonly TeamRecord[]): Dataset {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt: '2026-01-05T04:30:00Z',
    teamCount: teams.length,
    teams,
  };
}

const index = buildIndex(
  dataset([
    team({
      entryId: '1',
      name: 'Robotics Swarm',
      majorsSought: [{ college: 'Computing', major: 'Computer Science' }],
      advisors: [{ name: 'Ada Lovelace', affiliation: '', email: '' }],
      meeting: { day: 'Monday', time: '', location: '' },
    }),
    team({
      entryId: '2',
      name: 'Coral Reef Health',
      majorsSought: [{ college: 'Sciences', major: 'Biology' }],
      advisors: [{ name: 'Grace Hopper', affiliation: '', email: '' }],
      meeting: { day: 'Tuesday', time: '', location: '' },
    }),
  ]),
);

function state(overrides: Partial<QueryState> = {}): QueryState {
  return { ...DEFAULT_QUERY_STATE, ...overrides };
}

/**
 * A `matchMedia` that answers the drawer's query with `matches` and can be moved
 * across the breakpoint afterwards, which is the only way a jsdom viewport
 * changes width.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list = {
    matches,
    media: DRAWER_MEDIA_QUERY,
    addEventListener: (
      _type: string,
      listener: (e: MediaQueryListEvent) => void,
    ) => void listeners.add(listener),
    removeEventListener: (
      _type: string,
      listener: (e: MediaQueryListEvent) => void,
    ) => void listeners.delete(listener),
  };

  vi.stubGlobal('matchMedia', (query: string) => {
    expect(query).toBe(DRAWER_MEDIA_QUERY);
    return list as unknown as MediaQueryList;
  });

  return {
    /** Crosses the breakpoint, the way a resize or an orientation change would. */
    set(next: boolean) {
      list.matches = next;
      act(() => {
        for (const listener of listeners) {
          listener({ matches: next } as MediaQueryListEvent);
        }
      });
    },
  };
}

function mount(qs: QueryState = state()) {
  const onCommit = vi.fn();
  render(
    <FilterDrawer
      facets={facetView(index, qs, null)}
      qs={qs}
      onCommit={onCommit}
    />,
  );
  return { onCommit };
}

const panel = () => screen.queryByRole('region', { name: FILTER_PANEL_LABEL });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove(SCROLL_LOCK_CLASS);
});

describe('FilterDrawer', () => {
  it('renders the Filter_Panel in place above the breakpoint (Requirement 19.8)', () => {
    stubMatchMedia(false);
    mount();

    expect(panel()).not.toBeNull();
    expect(screen.queryByText(openLabel(0))).toBeNull();
  });

  it('renders the Filter_Panel in place when matchMedia is unavailable (Requirement 11.6)', () => {
    vi.stubGlobal('matchMedia', undefined);
    mount();

    // The 24.5 stacking is the fallback: no opening control exists, so the panel
    // cannot be behind one that is never rendered.
    expect(panel()).not.toBeNull();
    expect(screen.queryByText(openLabel(0))).toBeNull();
  });

  it('puts the panel behind a control stating the selected count, including zero (Requirement 19.8)', () => {
    stubMatchMedia(true);
    mount();

    const opener = screen.getByRole('button', { name: openLabel(0) });
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
  });

  it('states the count of values selected across every Filter (Requirement 19.8)', () => {
    stubMatchMedia(true);
    mount(
      state({
        filters: {
          college: ['Computing'],
          major: ['Computer Science'],
          day: ['Monday'],
          advisor: [],
        },
      }),
    );

    expect(screen.getByRole('button', { name: openLabel(3) })).not.toBeNull();
  });

  it('moves focus into the panel on open and holds the page still (Requirements 11.15, 19.8)', () => {
    stubMatchMedia(true);
    mount();

    fireEvent.click(screen.getByRole('button', { name: openLabel(0) }));

    const sheet = document.querySelector('.filter-drawer__sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.contains(document.activeElement)).toBe(true);
    expect(panel()).not.toBeNull();
    expect(document.documentElement.classList.contains(SCROLL_LOCK_CLASS)).toBe(
      true,
    );
  });

  it('closes on Escape and returns focus to the opening control (Requirement 11.15)', () => {
    stubMatchMedia(true);
    mount();

    const opener = screen.getByRole('button', { name: openLabel(0) });
    fireEvent.click(opener);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.classList.contains(SCROLL_LOCK_CLASS)).toBe(
      false,
    );
  });

  it('closes on Escape pressed on a control inside the panel (Requirement 11.15)', () => {
    stubMatchMedia(true);
    mount();

    const opener = screen.getByRole('button', { name: openLabel(0) });
    fireEvent.click(opener);
    fireEvent.keyDown(
      screen.getByRole('button', { name: toggleLabel('college', 0) }),
      { key: 'Escape' },
    );

    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('leaves the sheet keyboard-reachable in the order it presents its controls (Requirements 11.1, 11.2)', () => {
    stubMatchMedia(true);
    mount();

    fireEvent.click(screen.getByRole('button', { name: openLabel(0) }));

    // The sheet takes the focus, the close control follows it, and the Filter
    // disclosures follow that — no control is removed from the tab order and none
    // is trapped, so sequential navigation runs out of the panel as well as
    // through it.
    const sheet = document.querySelector('.filter-drawer__sheet');
    const focusable = [
      ...(sheet?.querySelectorAll('button, input') ?? []),
    ].filter(control => control.getAttribute('tabindex') !== '-1');

    expect(sheet?.getAttribute('tabindex')).toBe('-1');
    expect(focusable[0]?.textContent).toBe(CLOSE_LABEL);
    expect(focusable[1]?.textContent).toContain('College');
    expect(
      focusable.some(control => control.getAttribute('tabindex') === '-1'),
    ).toBe(false);
  });

  it('closes on the close control and returns the focus (Requirement 11.15)', () => {
    stubMatchMedia(true);
    mount();

    const opener = screen.getByRole('button', { name: openLabel(0) });
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: CLOSE_LABEL }));

    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('returns the panel to the page when the viewport crosses the breakpoint (Requirement 19.8)', () => {
    const media = stubMatchMedia(true);
    mount();

    fireEvent.click(screen.getByRole('button', { name: openLabel(0) }));
    media.set(false);

    expect(panel()).not.toBeNull();
    expect(screen.queryByText(openLabel(0))).toBeNull();
    expect(document.documentElement.classList.contains(SCROLL_LOCK_CLASS)).toBe(
      false,
    );
  });
});
