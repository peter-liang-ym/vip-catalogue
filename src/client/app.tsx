/**
 * The app shell: the two routes, the one Query_State every view derives from, and
 * address-bar sync (Requirements 5.9, 8.1, 8.2, 8.5, 8.7, 8.8, 9.4, 9.8).
 *
 * Every interaction takes the same path: event -> new Query_State -> derived view
 * -> render -> address write. The derivation is `derive`, which is pure and
 * synchronous, so a Result_Set is never in flight: the view rendered is always the
 * one derived from the current Search_Query, and there is no earlier Result_Set
 * that could arrive late and overwrite it (Requirement 5.9).
 *
 * Address writes come in two kinds, which is the whole of Requirements 8.1 and
 * 8.8. Search-field typing updates the view immediately and writes the address
 * with `replaceState` debounced at `SEARCH_SYNC_MS`, so a burst of keystrokes
 * adds no history entry at all and the address still catches up well inside the
 * 500 ms of Requirement 8.1. Every discrete change — a Filter value, the
 * Sort_Option, the hide-conflicts toggle, the page, the page size, opening a team,
 * returning to the listing — writes immediately with `pushState`, so back and
 * forward step through exactly those changes.
 *
 * `popstate` re-derives from the address instead of reloading (Requirements 8.5,
 * 8.7), and the first render decodes the address before deriving anything
 * (Requirement 8.2).
 *
 * The shell holds the `CalendarState` alongside the Query_State and hands
 * `scheduleOf` it to `derive` as the third argument. That single seam is the whole
 * of Requirement 15.8's recompute: a restored schedule, a replacement, a rejected
 * file, and a removal all arrive as one new `CalendarState`, and re-deriving moves
 * every Conflict_State, every Conflict_Detail, the excluded count, and the
 * Result_Set together. Unlike a Query_State change, a calendar change writes no
 * address at all, because the Busy_Schedule is device state that is never encoded
 * (Requirement 8.9).
 *
 * The two kinds of derivation differ in one way. A derivation the visitor caused
 * passes the previous view to `derive`, which is what applies Requirement 4.7's
 * page reset when the Result_Set changed. A derivation the address caused — the
 * first render, a `popstate`, or the pass that runs when the Dataset arrives —
 * passes none, so the page number written in the address is honored as given,
 * which is what makes Requirements 8.2, 8.5, and 8.7 restore a page rather than
 * reset it.
 */

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  restoreCalendar,
  scheduleOf,
  type CalendarState,
} from './calendarState';
import { ConflictDetailView } from './components/ConflictDetailView';
import { Freshness } from './components/Freshness';
import { Listing } from './components/Listing';
import { NotFound } from './components/NotFound';
import { SiteChrome } from './components/SiteChrome';
import { TeamDetail } from './components/TeamDetail';
import { conflictDetail } from './conflictDetail';
import {
  createDatasetLoader,
  type DatasetLoader,
  type LoadState,
} from './datasetLoader';
import { derive, type DerivedView } from './derive';
import { pruneOrphanMajors } from './majors';
import { encodeQueryState, type QueryState } from './queryState';
import { decodeQueryState } from './queryStateDecode';
import { decodeAddress, LISTING_ROUTE, routeHref, type Route } from './router';
import { clampQuery, type SearchIndex } from './search';

/**
 * The debounce on the address write for search typing. Consecutive changes closer
 * together than this share one write (Requirement 8.8), and because that write is
 * a `replaceState` the burst adds no history entry.
 */
export const SEARCH_SYNC_MS = 300;

/** Which history method an address write uses. */
type Sync = 'push' | 'replace';

interface AppState {
  readonly route: Route;
  readonly qs: QueryState;
  readonly load: LoadState;
  /**
   * Where the visitor's calendar stands. It is device state, not browsing intent,
   * so it lives here beside the Query_State and is never encoded into the address
   * (Requirement 8.9). `scheduleOf` is the only thing read out of it for the
   * derivation, and `null` is exactly the pre-calendar behavior.
   */
  readonly calendar: CalendarState;
  /** `null` until a Dataset is loaded; there is nothing to derive from before that. */
  readonly view: DerivedView | null;
}

export interface AppProps {
  /** Injected for tests; the browser's `fetch` otherwise. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * The render time in epoch milliseconds, read once per render and handed to the
   * freshness notices. Injected for tests, so Requirement 10.4's 30-day rule can
   * be exercised at a chosen render time rather than only at the real one.
   */
  readonly now?: () => number;
  /**
   * The storage the Busy_Schedule is restored from, saved to, and removed from.
   * Injected for tests the same way the clock is, so the restore, the corrupt
   * value, and the removal are reachable without a real `localStorage`
   * (Requirements 17.1, 17.2, 17.4, 17.7).
   */
  readonly store?: Storage;
}

/**
 * `qs` reduced to what this Dataset can honor: Filter values the Dataset does not
 * offer are dropped (Requirement 8.4) and Majors orphaned by the selected
 * Colleges are deselected (Requirement 6.10).
 *
 * Re-decoding the encoded form against the facet values reuses the decoder's own
 * facet check, so the address bar and this pass cannot disagree about which values
 * exist.
 */
function sanitize(index: SearchIndex, qs: QueryState): QueryState {
  const decoded = decodeQueryState(encodeQueryState(qs), index.facetValues);
  const filters = pruneOrphanMajors(index, decoded.filters);

  return filters === decoded.filters ? decoded : { ...decoded, filters };
}

/**
 * The next state with its view derived. `fromAddress` selects which derivation
 * this is: the address honors the page number it carries, an interaction gets the
 * Requirement 4.7 reset by being compared against the view it replaces.
 */
function derived(
  previous: AppState,
  next: Omit<AppState, 'view'>,
  fromAddress: boolean,
): AppState {
  if (next.load.kind !== 'loaded') return { ...next, view: null };

  return {
    ...next,
    view: derive(
      next.load.index,
      next.qs,
      scheduleOf(next.calendar),
      fromAddress ? null : previous.view,
    ),
  };
}

function initialState(store: Storage | undefined): AppState {
  // Requirement 8.2: the address is decoded before anything is derived or drawn.
  // Filter values are not checked against the Dataset yet, since it has not
  // arrived; `sanitize` does that when it does.
  const address = decodeAddress(location.pathname, location.search);

  return {
    route: address.route,
    qs: address.queryState,
    load: { kind: 'loading' },
    // Requirements 17.2, 17.7: a readable stored Busy_Schedule is applied before
    // the first derivation, so its Conflict_States are computed with the first
    // Result_Set rather than one render later, and an unreadable one becomes the
    // could-not-restore notice.
    calendar: restoreCalendar(store),
    view: null,
  };
}

export function App({ fetch: fetchImpl, now: nowImpl, store }: AppProps = {}) {
  const [state, setState] = useState<AppState>(() => initialState(store));

  /**
   * The authoritative state. Handlers read it directly instead of closing over
   * the rendered value, so a click that follows another in the same frame builds
   * on the state that click produced.
   */
  const stateRef = useRef(state);
  const loaderRef = useRef<DatasetLoader | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((transition: (previous: AppState) => AppState) => {
    const next = transition(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  const cancelPendingSync = useCallback(() => {
    if (syncTimer.current === null) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = null;
  }, []);

  /**
   * Writes the address for one state. An address equal to the current one is not
   * written at all, so a control activated at the value it already holds adds no
   * history entry.
   */
  const writeAddress = useCallback(
    (route: Route, qs: QueryState, sync: Sync) => {
      const href = routeHref(route, qs);
      if (href === `${location.pathname}${location.search}`) return;

      if (sync === 'push') history.pushState(null, '', href);
      else history.replaceState(null, '', href);
    },
    [],
  );

  /** Re-derives from the address: the first `popstate` handler and nothing else. */
  const applyAddress = useCallback(() => {
    apply(previous => {
      const address = decodeAddress(location.pathname, location.search);
      const qs =
        previous.load.kind === 'loaded'
          ? sanitize(previous.load.index, address.queryState)
          : address.queryState;

      // The calendar is carried through: it is device state, so no address
      // navigation can load, replace, or remove it (Requirement 8.9).
      return derived(
        previous,
        {
          route: address.route,
          qs,
          load: previous.load,
          calendar: previous.calendar,
        },
        true,
      );
    });
  }, [apply]);

  /**
   * Search-field typing (Requirements 5.8, 8.1, 8.8). The view updates now; the
   * address catches up after the debounce, by replacement.
   */
  const setQuery = useCallback(
    (raw: string) => {
      const query = clampQuery(raw);
      apply(previous =>
        derived(
          previous,
          { ...previous, qs: { ...previous.qs, query } },
          false,
        ),
      );

      cancelPendingSync();
      syncTimer.current = setTimeout(() => {
        syncTimer.current = null;
        const current = stateRef.current;
        writeAddress(current.route, current.qs, 'replace');
      }, SEARCH_SYNC_MS);
    },
    [apply, cancelPendingSync, writeAddress],
  );

  /**
   * Every discrete Query_State change: a Filter value, the Sort_Option, the
   * hide-conflicts toggle, the page, the page size. One history entry each
   * (Requirement 8.1). A pending typing write is dropped, since this write
   * carries the Search_Query too.
   */
  const commit = useCallback(
    (qs: QueryState) => {
      cancelPendingSync();
      apply(previous => derived(previous, { ...previous, qs }, false));
      writeAddress(stateRef.current.route, qs, 'push');
    },
    [apply, cancelPendingSync, writeAddress],
  );

  /**
   * Every calendar transition: a restored schedule replaced, a file rejected, a
   * parse finished, the schedule removed (Requirements 15.8, 15.9, 16.2, 17.4).
   *
   * Re-deriving is the whole of the recompute: `derive` reads the schedule this
   * state carries, so one assignment moves every Conflict_State, every
   * Conflict_Detail, the excluded count, and the Result_Set at once. Nothing here
   * touches the Query_State, which is why the Search_Query, the selected Filter
   * values, the Sort_Option, the page size, and the hide-conflicts setting come
   * through a load or a removal unchanged (Requirements 15.9, 17.5).
   *
   * No address is written. The Busy_Schedule is device state and is never encoded
   * (Requirement 8.9), so a calendar change is not a history entry.
   */
  const setCalendar = useCallback(
    (calendar: CalendarState) => {
      apply(previous => derived(previous, { ...previous, calendar }, false));
    },
    [apply],
  );

  /**
   * Opens a Team_Detail_View. The listing's derived view is carried unchanged, so
   * the address holds the Query_State that was active when the card was opened and
   * returning to the listing costs no re-derivation (Requirement 9.4).
   */
  const openTeam = useCallback(
    (entryId: string) => {
      cancelPendingSync();
      const route: Route = { kind: 'team', entryId };
      apply(previous => ({ ...previous, route }));
      writeAddress(route, stateRef.current.qs, 'push');
    },
    [apply, cancelPendingSync, writeAddress],
  );

  /**
   * The listing link in the detail and not-found views. The Query_State applied is
   * the one the current address holds, which is the one that was active when the
   * card was opened (Requirement 9.4), or the defaults when the detail view was
   * reached directly and the address carried none (Requirement 9.8).
   */
  const showListing = useCallback(() => {
    cancelPendingSync();
    apply(previous => ({ ...previous, route: LISTING_ROUTE }));
    writeAddress(LISTING_ROUTE, stateRef.current.qs, 'push');
  }, [apply, cancelPendingSync, writeAddress]);

  useEffect(() => {
    const loader = createDatasetLoader({
      fetch: fetchImpl,
      onStateChange: load => {
        apply(previous =>
          load.kind === 'loaded'
            ? derived(
                previous,
                {
                  route: previous.route,
                  qs: sanitize(load.index, previous.qs),
                  load,
                  calendar: previous.calendar,
                },
                true,
              )
            : derived(previous, { ...previous, load }, true),
        );

        // The applied Query_State is now what the address shows, so a parameter
        // the Dataset rejected stops being advertised (Requirement 8.4). A
        // replacement, so no history entry appears for it — and nothing is
        // written on a failed load, which is how the address keeps the
        // Query_State across a failure (Requirement 12.6).
        const current = stateRef.current;
        if (current.load.kind === 'loaded') {
          writeAddress(current.route, current.qs, 'replace');
        }
      },
    });
    loaderRef.current = loader;
    void loader.load();

    const onPopState = () => {
      cancelPendingSync();
      applyAddress();
    };
    addEventListener('popstate', onPopState);

    return () => {
      removeEventListener('popstate', onPopState);
      cancelPendingSync();
    };
    // Mounted once: the loader issues the first Dataset request and the popstate
    // listener lives for as long as the shell does.
  }, []);

  const retry = useCallback(() => {
    void loaderRef.current?.retry();
  }, []);

  const { load, view, qs, route, calendar } = state;

  /** The loaded Busy_Schedule, or `null` when none is (Requirement 15.7). */
  const schedule = scheduleOf(calendar);

  /**
   * The address every listing link and the site name point at: the current
   * Query_State, which on a detail route is the one that was active when the
   * Team_Card was opened (Requirements 9.4, 9.8).
   */
  const listingHref = routeHref(LISTING_ROUTE, qs);

  /**
   * The chrome wraps every state and every route, so the footer attribution and
   * the Source_Site link are on every page, including the not-found page and a
   * failed load (Requirements 9.5, 10.2, 12.6).
   */
  const chrome = (children: ComponentChildren) => (
    <SiteChrome listingHref={listingHref} onListing={showListing}>
      {children}
    </SiteChrome>
  );

  if (load.kind === 'failed') return chrome(<LoadFailure onRetry={retry} />);
  if (load.kind === 'loading' || view === null) return chrome(<Loading />);

  if (route.kind === 'team') {
    const team = load.index.byEntryId.get(route.entryId);

    return chrome(
      team === undefined ? (
        <NotFound listingHref={listingHref} onListing={showListing} />
      ) : (
        <>
          <TeamDetail
            team={team}
            conflictState={view.conflicts?.get(route.entryId) ?? null}
          >
            {/* Requirements 9.1, 15.5: which Busy_Blocks this meeting lands on.
                `conflictDetail` reports none for a team that is not conflicting
                and `ConflictDetailView` renders nothing for none, so the only
                branch needed here is the one the signature forces. */}
            {schedule !== null && (
              <ConflictDetailView
                detail={conflictDetail(team.meetingWindow, schedule)}
              />
            )}
          </TeamDetail>
          {/* Requirement 9.4: the listing link belongs to the shell, which is
              what holds the Query_State the detail address carries. */}
          <p class="team-detail__listing">
            <ListingLink qs={qs} onListing={showListing} />
          </p>
        </>
      ),
    );
  }

  return chrome(
    <>
      {/* Requirements 10.3, 10.4, 10.6: the timestamp and, where they apply, the
          out-of-date and unknown-currency notices, above the first Team_Card and
          beside the Result_Set rather than in place of it. */}
      <Freshness
        generatedAt={load.dataset.generatedAt}
        now={(nowImpl ?? Date.now)()}
      />
      <Listing
        view={view}
        qs={qs}
        calendar={calendar}
        onQuery={setQuery}
        onCommit={commit}
        onCalendarState={setCalendar}
        onOpenTeam={openTeam}
        calendarStore={store}
      />
    </>,
  );
}

/** Requirement 12.4: the loading indicator, and no cards, message, or retry. */
function Loading() {
  return <p role="status">Loading teams…</p>;
}

/** Requirements 12.5, 12.6: the failure message and a retry control. */
function LoadFailure({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div>
      <p role="alert">The team data failed to load.</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/**
 * The link back to the listing shown with the Team_Detail_View
 * (Requirements 9.4, 9.8). It lives here rather than in `TeamDetail`, which
 * renders one record and knows nothing of the Query_State the address carries.
 */
function ListingLink({
  qs,
  onListing,
}: {
  readonly qs: QueryState;
  readonly onListing: () => void;
}) {
  return (
    <a
      href={routeHref(LISTING_ROUTE, qs)}
      onClick={event => {
        event.preventDefault();
        onListing();
      }}
    >
      Back to all teams
    </a>
  );
}
