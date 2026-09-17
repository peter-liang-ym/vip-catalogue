/**
 * Where the calendar surfaces sit: a disclosure in the filter rail, collapsed until
 * the visitor asks for it (Requirements 14.1, 14.18, 17.4, 17.6, 17.9, 11.10).
 *
 * This component owns *placement and state of disclosure only*. `CalendarControl`
 * still takes the file, runs the two pre-parse checks, imports the parser chunk,
 * and reports every transition, and `CalendarStatus` still says what is loaded and
 * what went wrong; the parse and classify path behind them is untouched, and the
 * lazy `import()` boundary is still the one inside `CalendarControl`, so nothing
 * about this disclosure pulls the parser into the initial chunk.
 *
 * Why a disclosure. The control used to sit in the results column above the first
 * Team_Card, so every visit paid for a capability most visits never use: a file
 * input, a drop target the height of a paragraph, and a privacy statement, ahead of
 * the catalog the visitor came for. Collapsed to one control in the rail it
 * displaces no card at all, and the body — the input, the drop target, and the
 * Requirement 17.9 privacy statement, which is visible for exactly as long as the
 * body is — is one activation away.
 *
 * Once a Busy_Schedule is loaded the body collapses on its own and the summary
 * takes over: the file name, the block count, and the load time with its zone, on
 * one line, with removal beside them (Requirements 14.18, 17.4). The disclosure
 * control becomes the replace affordance, because replacing *is* reopening the body
 * to supply another file — a separate "replace" button would be a second control
 * with the same job.
 *
 * Collapsing takes focus with it. The body is `hidden`, so an activated file input
 * inside it would leave focus on a hidden element; when a load collapses a body the
 * visitor was in, focus moves to the disclosure control, which is the surface the
 * body collapsed into. Every other collapse is the visitor pressing that control,
 * which keeps its own focus.
 *
 * The body is `hidden` rather than unmounted, so `CalendarControl`'s own state — a
 * drag in progress, the notice for a file it just rejected — is not discarded by a
 * collapse, and so the collapsed body is out of the tab order and out of the
 * accessibility tree.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import {
  removeCalendar,
  scheduleOf,
  type CalendarState,
} from '../calendarState';
import { CalendarControl } from './CalendarControl';
import { CalendarStatus } from './CalendarStatus';

/** The disclosure control while nothing is loaded: what the body is for. */
export const CALENDAR_DISCLOSURE_LABEL = 'Load your class schedule';

/**
 * The disclosure control once a Busy_Schedule is loaded: the same control, now the
 * replace affordance, since the body it opens is where another file is supplied.
 */
export const REPLACE_CALENDAR_LABEL = 'Replace your loaded calendar';

/**
 * Requirement 17.4: the control that removes the loaded and the stored
 * Busy_Schedule. A `button` whose text content is its accessible name, so it is in
 * the tab order, activatable by keyboard, and named without anything of ours
 * (Requirement 11.10).
 */
export const REMOVE_CALENDAR_LABEL = 'Remove your loaded calendar';

/** The id the disclosure control's `aria-controls` names; one control per page. */
const CALENDAR_BODY_ID = 'calendar-disclosure-body';

export interface CalendarDisclosureProps {
  readonly state: CalendarState;
  /** Commits the next `CalendarState`: a supplied file, or a removal. */
  readonly onState: (next: CalendarState) => void;
  /** Storage the Busy_Schedule is saved to and removed from (Requirements 17.1, 17.4). */
  readonly store?: Storage;
}

export function CalendarDisclosure({
  state,
  onState,
  store,
}: CalendarDisclosureProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /**
   * Which loaded Busy_Schedule this is. A schedule's load time changes with every
   * load, so watching it collapses the body once per load and not once per render
   * — and a restored schedule collapses nothing, because the body was never open.
   */
  const loadedAt = state.kind === 'loaded' ? state.schedule.loadedAt : null;

  useEffect(() => {
    if (loadedAt === null) return;

    // The body is about to be hidden, so focus cannot stay inside it.
    if (bodyRef.current?.contains(document.activeElement) === true) {
      toggleRef.current?.focus();
    }
    setOpen(false);
  }, [loadedAt]);

  return (
    <section class="calendar-disclosure" data-testid="calendar-disclosure">
      {/* Requirement 11.10: a `button`, so it is reachable and activatable from
          the keyboard, named by its own text, and its state is `aria-expanded`
          rather than anything visual. */}
      <button
        class="calendar-disclosure__toggle"
        type="button"
        ref={toggleRef}
        aria-expanded={open}
        aria-controls={CALENDAR_BODY_ID}
        data-testid="calendar-disclosure-toggle"
        onClick={() => setOpen(current => !current)}
      >
        {scheduleOf(state) === null
          ? CALENDAR_DISCLOSURE_LABEL
          : REPLACE_CALENDAR_LABEL}
      </button>

      {/* Requirement 14.18: what is loaded, on one line, with removal beside it —
          and beneath it whichever notices the last attempt produced. `CalendarStatus`
          renders the affordance only while a Busy_Schedule is loaded, so there is no
          removal control offered when there is nothing to remove
          (Requirement 17.6). One click clears storage and returns `none`, and the
          shell re-deriving against no schedule is what withdraws every
          Conflict_State, every Conflict_Detail, and the excluded count. Nothing here
          reads or writes the Query_State, so the toggle setting survives
          (Requirement 17.5). */}
      <CalendarStatus state={state}>
        <button
          class="calendar-disclosure__remove"
          type="button"
          data-testid="calendar-remove"
          onClick={() => onState(removeCalendar(store))}
        >
          {REMOVE_CALENDAR_LABEL}
        </button>
      </CalendarStatus>

      <div
        class="calendar-disclosure__body"
        id={CALENDAR_BODY_ID}
        ref={bodyRef}
        hidden={!open}
      >
        <CalendarControl state={state} onState={onState} store={store} />
      </div>
    </section>
  );
}
