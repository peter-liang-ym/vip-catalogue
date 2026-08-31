/**
 * The listing page (Requirements 4.1, 4.4, 4.5, 4.7, 4.9, 10.1, 11.4, 11.12).
 *
 * The listing is the composition surface: it renders the unofficial-mirror
 * notice, the search field, the selected-value indicators, the Filter_Panel, the
 * sort control, the calendar surfaces, the matching count, the page position, the
 * Team_Cards of the current page, the empty state, and the pagination controls.
 * The calendar surfaces are the listing's because the toggle is a Query_State
 * control like the sort control and commits the same way, and because the file
 * control, what is loaded, and the toggle read one `CalendarState` between them.
 * It derives nothing
 * — `derive` has already decided the Result_Set, which page of it is shown, how
 * many pages there are, and why the Result_Set is empty when it is — so every
 * rule those answers encode has exactly one definition, tested without a DOM.
 *
 * Requirement 4.1's three numbers all come from that derived view: `totalCount`
 * is the Teams in the Result_Set, `pageNumber` is the page actually shown, which
 * is the requested page clamped into range (Requirement 4.6), and `pageCount` is
 * the pages available. The card list is `view.page`, the slice Requirement 4.5
 * defines, so the positions rendered are the ones that requirement names without
 * this component computing an index.
 *
 * The count sits in an ARIA live region, which is what announces it whenever the
 * Result_Set changes, including a count of zero and including the change a loaded,
 * replaced, or removed Busy_Schedule causes (Requirements 11.4, 11.12). A live
 * region announces by having its text change, so nothing here moves focus and the
 * visitor keeps using the control they were using.
 *
 * The page number and the page size are Query_State, so both controls commit
 * through the shell's discrete-change path: one history entry each
 * (Requirement 8.1). A page-size change resets the page number to 1 from here
 * (Requirement 4.9), because changing the size is not a Result_Set change and so
 * `derive` will not reset it; every reset that follows a Result_Set change —
 * typing, a Filter value, the toggle — belongs to `derive` instead
 * (Requirement 4.7), which is why a page-number change commits the page alone.
 *
 * The controls read `view.pageNumber` rather than `qs.pageNumber`, so stepping
 * from a page that `derive` reset or clamped steps from the page on screen.
 */

import type { CalendarState } from '../calendarState';
import type { DerivedView } from '../derive';
import {
  DEFAULT_PAGE_NUMBER,
  PAGE_SIZE_OPTIONS,
  type PageSize,
} from '../paginate';
import type { QueryState } from '../queryState';
import { routeHref } from '../router';
import { terms } from '../search';
import { CLEAR_ALL_RESET } from '../selections';
import { CalendarControl } from './CalendarControl';
import { CalendarStatus } from './CalendarStatus';
import { EmptyState } from './EmptyState';
import { FilterPanel } from './FilterPanel';
import { HideConflictsToggle } from './HideConflictsToggle';
import { SelectedValues } from './SelectedValues';
import { SortControl } from './SortControl';
import { TeamCard } from './TeamCard';

/**
 * Requirement 10.1: the notice stating what this site is and is not. Rendered
 * above the first Team_Card as ordinary page text, so it is visible without any
 * visitor interaction.
 */
export const UNOFFICIAL_MIRROR_NOTICE =
  'This is an unofficial mirror of Georgia Tech VIP team information. It is not operated by Georgia Tech.';

/** The search field's label (Requirement 11.7). */
export const SEARCH_LABEL = 'Search teams';

/** The pagination controls' labels (Requirement 11.7). */
export const PAGE_NUMBER_LABEL = 'Page number';
export const PAGE_SIZE_LABEL = 'Teams per page';
export const PREVIOUS_PAGE_LABEL = 'Previous page';
export const NEXT_PAGE_LABEL = 'Next page';

/** The pagination region's accessible name. */
export const PAGINATION_LABEL = 'Pagination';

const SEARCH_ID = 'listing-search';
const PAGE_NUMBER_ID = 'page-number-control';
const PAGE_SIZE_ID = 'page-size-control';

/**
 * The count of matching Teams as the live region states it, including a count of
 * zero (Requirements 4.1, 11.4).
 */
export function matchCountText(total: number): string {
  return `${total} matching ${total === 1 ? 'team' : 'teams'}`;
}

/** The current page number and the pages available (Requirement 4.1). */
export function pagePositionText(
  pageNumber: number,
  pageCount: number,
): string {
  return `Page ${pageNumber} of ${pageCount}`;
}

/** How each page size is offered, `'all'` reading as the whole Result_Set (Requirement 4.4). */
export function pageSizeLabel(size: PageSize): string {
  return size === 'all' ? 'All results' : String(size);
}

export interface ListingProps {
  readonly view: DerivedView;
  readonly qs: QueryState;
  /** The calendar the surfaces render and the toggle reads (Requirements 14.18, 16.3). */
  readonly calendar: CalendarState;
  /** Search-field input: the debounced, replacing address write (Requirement 8.8). */
  readonly onQuery: (raw: string) => void;
  /** A discrete Query_State change: one history entry (Requirement 8.1). */
  readonly onCommit: (qs: QueryState) => void;
  /** A calendar transition: the shell re-derives against the new schedule (15.8). */
  readonly onCalendarState: (next: CalendarState) => void;
  readonly onOpenTeam: (entryId: string) => void;
  /** Storage the Busy_Schedule is saved to and removed from (Requirements 17.1, 17.4). */
  readonly calendarStore?: Storage;
}

export function Listing({
  view,
  qs,
  calendar,
  onQuery,
  onCommit,
  onCalendarState,
  onOpenTeam,
  calendarStore,
}: ListingProps) {
  const queryTerms = terms(qs.query);
  const goToPage = (pageNumber: number) => onCommit({ ...qs, pageNumber });

  return (
    <main class="listing">
      {/* Requirement 10.1: above the first card, and above everything else on
          the page, so it is read before the catalog it qualifies. */}
      <p class="listing__notice" data-testid="mirror-notice">
        {UNOFFICIAL_MIRROR_NOTICE}
      </p>

      <div class="listing__search">
        <label class="listing__search-label" for={SEARCH_ID}>
          {SEARCH_LABEL}
        </label>
        <input
          id={SEARCH_ID}
          class="listing__search-input"
          type="search"
          value={qs.query}
          onInput={event => onQuery(event.currentTarget.value)}
        />
      </div>

      <SelectedValues qs={qs} onCommit={onCommit} />
      <SortControl qs={qs} onCommit={onCommit} />
      <FilterPanel facets={view.facets} qs={qs} onCommit={onCommit} />

      {/* The calendar surfaces: the control that takes the file with its privacy
          statement and its removal control, what is loaded now, and the toggle
          (Requirements 14.1, 14.18, 16.1, 17.4, 17.6, 17.9). They sit with the
          other controls that change the Result_Set and above the count they
          change, and the toggle keeps one instance per listing so a change to it
          leaves focus where it was (Requirement 11.12). */}
      <div class="listing__calendar" data-testid="listing-calendar">
        <CalendarControl
          state={calendar}
          onState={onCalendarState}
          store={calendarStore}
        />
        <CalendarStatus state={calendar} />
        <HideConflictsToggle
          qs={qs}
          calendar={calendar}
          hiddenByToggle={view.hiddenByToggle}
          onCommit={onCommit}
        />
      </div>

      {/* Requirements 11.4, 11.12: the count lives in a live region, so every
          Result_Set change announces it — zero included — without focus moving. */}
      <p
        class="listing__count"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="result-count"
      >
        {matchCountText(view.totalCount)}
      </p>

      <p class="listing__position" data-testid="page-position">
        {pagePositionText(view.pageNumber, view.pageCount)}
      </p>

      {view.page.length > 0 && (
        <ul class="listing__cards" data-testid="listing-cards">
          {view.page.map(({ team }) => (
            <li class="listing__card" key={team.entryId}>
              <TeamCard
                team={team}
                terms={queryTerms}
                conflictState={view.conflicts?.get(team.entryId) ?? null}
                href={routeHref({ kind: 'team', entryId: team.entryId }, qs)}
                onOpen={() => onOpenTeam(team.entryId)}
              />
            </li>
          ))}
        </ul>
      )}

      <EmptyState
        reason={view.emptyReason}
        hiddenByToggle={view.hiddenByToggle}
        onClearAll={() => onCommit({ ...qs, ...CLEAR_ALL_RESET })}
      />

      <nav class="listing__pagination" aria-label={PAGINATION_LABEL}>
        <button
          class="listing__page-step"
          type="button"
          disabled={view.pageNumber <= DEFAULT_PAGE_NUMBER}
          onClick={() => goToPage(view.pageNumber - 1)}
        >
          {PREVIOUS_PAGE_LABEL}
        </button>

        {/* Requirement 4.5: selecting page N displays that page's positions. */}
        <label class="listing__page-label" for={PAGE_NUMBER_ID}>
          {PAGE_NUMBER_LABEL}
        </label>
        <select
          id={PAGE_NUMBER_ID}
          class="listing__page-select"
          value={String(view.pageNumber)}
          onChange={event => goToPage(Number(event.currentTarget.value))}
        >
          {Array.from({ length: view.pageCount }, (_, i) => i + 1).map(page => (
            <option key={page} value={String(page)}>
              {String(page)}
            </option>
          ))}
        </select>

        <button
          class="listing__page-step"
          type="button"
          disabled={view.pageNumber >= view.pageCount}
          onClick={() => goToPage(view.pageNumber + 1)}
        >
          {NEXT_PAGE_LABEL}
        </button>

        {/* Requirements 4.4, 4.9: one of the four sizes, and the page returns to
            1 with it, since a size change is not a Result_Set change. */}
        <label class="listing__size-label" for={PAGE_SIZE_ID}>
          {PAGE_SIZE_LABEL}
        </label>
        <select
          id={PAGE_SIZE_ID}
          class="listing__size-select"
          value={String(qs.pageSize)}
          onChange={event => {
            const raw = event.currentTarget.value;
            const pageSize: PageSize =
              raw === 'all' ? 'all' : (Number(raw) as PageSize);
            onCommit({ ...qs, pageSize, pageNumber: DEFAULT_PAGE_NUMBER });
          }}
        >
          {PAGE_SIZE_OPTIONS.map(size => (
            <option key={String(size)} value={String(size)}>
              {pageSizeLabel(size)}
            </option>
          ))}
        </select>
      </nav>
    </main>
  );
}
