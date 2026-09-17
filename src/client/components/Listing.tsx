/**
 * The listing page (Requirements 4.1, 4.4, 4.5, 4.7, 4.9, 10.1, 11.4, 11.12).
 *
 * The listing is the composition surface: it renders the unofficial-mirror
 * notice, the filter rail with the Filter_Panel and the calendar disclosure, one
 * results toolbar, the Team_Cards of the current page, the empty state, and the
 * pagination controls. The search field is the masthead's — it is the site's
 * primary action and the chrome is where a primary action belongs — so the shell
 * hands the typing handler to `SiteChrome` instead of to this component.
 *
 * Everything that reports on or narrows the Result_Set is in that one toolbar,
 * directly above the grid it describes: the matching count and the page position
 * in the tabular numeric column, the sort control, the page-size control, the
 * hide-conflicts toggle, and the selected-value indicators with the clear-all
 * control beside them. Those controls were previously spread over three places —
 * the rail top, a row above the grid, and the pager at the foot of the page — so
 * reading a count and then changing what produced it meant crossing the whole
 * catalog. The bottom pager stays where it is, because stepping to the next page
 * is what a visitor wants at the end of the current one.
 *
 * The two calendar-facing surfaces are deliberately in different places, because
 * they change different things. The hide-conflicts toggle edits Query_State, like
 * the sort control, so it sits in the toolbar above the Result_Set it narrows.
 * Supplying a Calendar_File edits device state and never the Result_Set directly,
 * so it sits in the rail behind a collapsed disclosure, where it displaces no
 * Team_Card. Both read the one `CalendarState` this component is handed, and
 * neither derives from it.
 *
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
 *
 * A page-number or page-size change also scrolls the top of the results region
 * back into view, because the pager that caused it is at the foot of a page of
 * cards and the new page's first card is above the viewport when it lands. Only
 * those two changes scroll: typing into the search field moves nothing — no focus
 * and no scroll — so a burst of keystrokes leaves the field where it is
 * (Requirement 11.12), and the count's live region announces every Result_Set
 * change without anything moving.
 */

import { useRef } from 'preact/hooks';
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
import { CalendarDisclosure } from './CalendarDisclosure';
import { EmptyState } from './EmptyState';
import { FilterDrawer } from './FilterDrawer';
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
  'This is an unofficial catalog of Georgia Tech VIP team information. It is not operated by Georgia Tech.';

/** The pagination controls' labels (Requirement 11.7). */
export const PAGE_NUMBER_LABEL = 'Page number';
export const PAGE_SIZE_LABEL = 'Teams per page';
export const PREVIOUS_PAGE_LABEL = 'Previous page';
export const NEXT_PAGE_LABEL = 'Next page';

/** The pagination region's accessible name. */
export const PAGINATION_LABEL = 'Pagination';

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
  onCommit,
  onCalendarState,
  onOpenTeam,
  calendarStore,
}: ListingProps) {
  const queryTerms = terms(qs.query);

  /** The top of the results region: the toolbar that heads it. */
  const resultsRef = useRef<HTMLDivElement | null>(null);

  /**
   * Brings the head of the results region into view after a paging change. Guarded
   * because `scrollIntoView` is absent in jsdom and in any engine without it, and a
   * paging change must land regardless of whether the view can be scrolled.
   */
  const revealResults = () => {
    const region = resultsRef.current;
    if (typeof region?.scrollIntoView === 'function') {
      region.scrollIntoView({ block: 'start' });
    }
  };

  const goToPage = (pageNumber: number) => {
    onCommit({ ...qs, pageNumber });
    revealResults();
  };

  return (
    <main class="listing">
      {/* Requirement 10.1: above the first card, and above everything else on
          the page, so it is read before the catalog it qualifies. */}
      <p class="listing__notice" data-testid="mirror-notice">
        {UNOFFICIAL_MIRROR_NOTICE}
      </p>

      {/* The filter rail: the Filter_Panel and, above it, the collapsed calendar
          disclosure (Requirements 19.8, 14.1). The calendar surfaces are here
          rather than in the results column so the upload displaces no Team_Card,
          and one wrapper is what the sidebar layout floats, so both stick and
          scroll together. */}
      <div class="filter-rail" data-testid="filter-rail">
        <CalendarDisclosure
          state={calendar}
          onState={onCalendarState}
          store={calendarStore}
        />
        {/* Requirement 19.8: the Filter_Panel itself from 1000 CSS pixels up, and
            behind the control that states the selected-value count below that. */}
        <FilterDrawer facets={view.facets} qs={qs} onCommit={onCommit} />
      </div>

      {/* The results toolbar: what the Result_Set is, and every control that
          changes it, in one place directly above the grid. */}
      <div
        class="listing__toolbar"
        ref={resultsRef}
        data-testid="listing-toolbar"
      >
        <div class="listing__tally">
          {/* Requirements 11.4, 11.12: the count lives in a live region, so every
              Result_Set change announces it — zero included — without focus
              moving. */}
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
        </div>

        {/* Requirements 7.1, 7.4: the Sort_Option, every option offered. */}
        <SortControl qs={qs} onCommit={onCommit} />

        {/* Requirements 4.4, 4.9: one of the four sizes, and the page returns to
            1 with it, since a size change is not a Result_Set change and so
            `derive` will not reset it. */}
        <div class="listing__page-size">
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
              revealResults();
            }}
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={String(size)} value={String(size)}>
                {pageSizeLabel(size)}
              </option>
            ))}
          </select>
        </div>

        {/* Requirements 16.1, 16.3, 16.4: the toggle sits beside the sort control
            rather than with the calendar surfaces, because what it changes is the
            Result_Set on screen and not the Busy_Schedule. One instance per
            listing, so a change to it leaves focus where it was
            (Requirement 11.12). */}
        <HideConflictsToggle
          qs={qs}
          calendar={calendar}
          hiddenByToggle={view.hiddenByToggle}
          onCommit={onCommit}
        />

        {/* Requirements 5.6, 6.8, 6.9, 16.7: what is currently narrowing the
            listing, each value removable on its own, and the one clear-all control
            beside them. It renders nothing at all while nothing is narrowing. */}
        <SelectedValues qs={qs} onCommit={onCommit} />
      </div>

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
      </nav>
    </main>
  );
}
