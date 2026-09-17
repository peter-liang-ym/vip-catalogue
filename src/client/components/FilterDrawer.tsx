/**
 * The Filter_Panel's placement: beside the listing from 1000 CSS pixels up, and
 * behind an opening control below it (Requirements 19.8, 11.1, 11.2, 11.6, 11.15).
 *
 * This component owns *where* the panel is, never what it shows. `FilterPanel`
 * still renders the four Filters, their disclosures, their caps, and their
 * Value_Filters, and it is the same element in both placements, so nothing about
 * the panel's behavior — and none of its local disclosure, reveal, or
 * Value_Filter state (Requirement 19.9) — depends on which side of the breakpoint
 * the viewport is on. The panel is kept mounted while the sheet is closed, hidden
 * rather than unmounted, so opening the sheet a second time finds the groups the
 * visitor left open.
 *
 * The breakpoint is the same 1000 CSS pixels `layout.css` floats the rail at,
 * stated once here as `DRAWER_MEDIA_QUERY` and read through `matchMedia`, so the
 * arrangement and the behavior cannot drift apart.
 *
 * Below the breakpoint:
 *
 *   - The panel sits behind a control stating the count of Filter values selected
 *     across every Filter, including zero (Requirement 19.8).
 *   - Opening moves keyboard focus into the sheet, and `Escape` from anywhere
 *     inside it closes the sheet and puts focus back on the control that opened
 *     it (Requirement 11.15). The `Escape` handler is on the sheet, not on the
 *     document, so it fires only while focus is genuinely inside it.
 *   - The page behind does not scroll: the document element carries
 *     `SCROLL_LOCK_CLASS` for exactly as long as the sheet is open, and the sheet
 *     scrolls itself.
 *
 * Focus is deliberately *not* trapped. Requirement 11.2 says focus must be able
 * to leave the panel by sequential navigation without a reload, so the sheet
 * takes no `aria-modal` and installs no wrap-around: the opening control, the
 * close control, and every Filter control follow one another in DOM order, which
 * is the order they are presented in (Requirement 11.1), and tabbing past the
 * last of them continues into the page.
 *
 * When `matchMedia` is unavailable there is no sheet at all and the panel renders
 * in place, which is the single-column stacking the layout already gives it at
 * 360 (Requirement 11.6). That is the fallback the sheet is measured against: the
 * panel is never behind a control that cannot be operated, because the control
 * only exists once the media query it depends on has answered.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { FacetView } from '../facetView';
import { FILTER_PARAMS, type QueryState } from '../queryState';
import { FilterPanel, selectedCountText } from './FilterPanel';

export interface FilterDrawerProps {
  /** The four Filters' values, counts, and selectability, from `derive`. */
  readonly facets: FacetView;
  readonly qs: QueryState;
  /** The shell's discrete-change commit: one new Query_State, one history entry. */
  readonly onCommit: (qs: QueryState) => void;
}

/**
 * Below this width the panel moves behind the opening control. 62.5rem is the
 * 1000 CSS pixels `layout.css` floats the rail at, and the query is the exact
 * complement of that one, so at no width are both the rail and the sheet in
 * force.
 */
export const DRAWER_MEDIA_QUERY = '(max-width: 62.4375rem)';

/** The class the document element carries while the sheet is open. */
export const SCROLL_LOCK_CLASS = 'filter-drawer-open';

const SHEET_ID = 'filter-drawer-sheet';

/**
 * The opening control's text: what it opens and how many Filter values are
 * selected across every Filter, including zero (Requirement 19.8).
 */
export function openLabel(selected: number): string {
  return `Filters (${selectedCountText(selected)})`;
}

/** The control that closes the sheet with a pointer (Requirement 11.7). */
export const CLOSE_LABEL = 'Close filters';

/** The Filter values selected across every Filter (Requirement 19.8). */
export function selectedTotal(qs: QueryState): number {
  return FILTER_PARAMS.reduce(
    (total, filter) => total + qs.filters[filter].length,
    0,
  );
}

/** Whether the viewport is currently below the breakpoint, as `matchMedia` sees it. */
function matchesNow(): boolean {
  return globalThis.matchMedia?.(DRAWER_MEDIA_QUERY).matches === true;
}

/**
 * Whether the panel belongs behind the opening control. Read once before the
 * first paint so the sheet is not preceded by a full panel on a phone, then kept
 * current by the media query's own change events; an engine whose
 * `MediaQueryList` predates `addEventListener` simply keeps the answer it was
 * mounted with.
 */
function useBelowBreakpoint(): boolean {
  const [below, setBelow] = useState(matchesNow);

  useEffect(() => {
    const query = globalThis.matchMedia?.(DRAWER_MEDIA_QUERY);
    if (query === undefined) return;

    setBelow(query.matches);
    if (typeof query.addEventListener !== 'function') return;

    const onChange = (event: MediaQueryListEvent) => setBelow(event.matches);
    query.addEventListener('change', onChange);

    return () => query.removeEventListener('change', onChange);
  }, []);

  return below;
}

export function FilterDrawer({ facets, qs, onCommit }: FilterDrawerProps) {
  const below = useBelowBreakpoint();
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  /** Whether the sheet was open on the previous render, so closing can restore focus. */
  const wasOpen = useRef(false);

  const opened = below && open;

  /*
   * Requirement 11.15, both halves. Opening moves focus into the sheet; closing
   * puts it back on the control that opened it. The `isConnected` guard is for
   * the one close that is not the visitor's: a viewport widened past the
   * breakpoint takes the sheet and its opening control away together, and focus
   * belongs where the browser leaves it rather than on a detached element.
   */
  useEffect(() => {
    if (opened) {
      wasOpen.current = true;
      sheetRef.current?.focus();
      return;
    }

    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (openerRef.current?.isConnected === true) openerRef.current.focus();
  }, [opened]);

  /* The page behind the sheet does not scroll while the sheet is open. */
  useEffect(() => {
    if (!opened) return;

    const root = document.documentElement;
    root.classList.add(SCROLL_LOCK_CLASS);

    return () => root.classList.remove(SCROLL_LOCK_CLASS);
  }, [opened]);

  const panel = <FilterPanel facets={facets} qs={qs} onCommit={onCommit} />;

  // Above the breakpoint, and wherever `matchMedia` cannot answer, the panel is
  // the page's own block: the rail from 1000 up, stacked above the listing below
  // it (Requirement 11.6).
  if (!below) return panel;

  return (
    <div class="filter-drawer" data-testid="filter-drawer">
      <button
        class="filter-drawer__open"
        type="button"
        ref={openerRef}
        aria-expanded={opened}
        aria-controls={SHEET_ID}
        onClick={() => setOpen(current => !current)}
      >
        {openLabel(selectedTotal(qs))}
      </button>

      {/*
        The sheet is hidden rather than unmounted while closed, which is what
        keeps it out of the tab order and out of the accessibility tree without
        discarding the panel's local reading state.

        `tabindex="-1"` makes it the focus target on open — focus lands in the
        sheet, ahead of the close control and the Filter controls, so sequential
        navigation from there runs through them in the order they are presented
        (Requirement 11.1) and then out of the panel entirely (Requirement 11.2).
      */}
      <div
        class="filter-drawer__sheet"
        id={SHEET_ID}
        ref={sheetRef}
        hidden={!opened}
        tabIndex={-1}
        onKeyDown={event => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          setOpen(false);
        }}
      >
        <button
          class="filter-drawer__close"
          type="button"
          onClick={() => setOpen(false)}
        >
          {CLOSE_LABEL}
        </button>

        {panel}
      </div>
    </div>
  );
}
