/**
 * The hide-conflicts toggle (Requirements 16.1, 16.3, 16.4, 16.5, 16.7, 11.10).
 *
 * One native checkbox, which is exactly the two settings Requirement 16.1 asks
 * for — on and off, nothing else representable — sitting at off because
 * `DEFAULT_QUERY_STATE.hideConflicts` is `false` and this control renders
 * `qs.hideConflicts` rather than any state of its own. There is no third setting
 * to get into and no local copy to fall out of step with the address bar.
 *
 * Beside it goes the one thing worth saying about the setting in force, which
 * depends on whether a Busy_Schedule is loaded:
 *
 * - Loaded: the count of Teams the toggle excluded, zero included
 *   (Requirement 16.3). The count is `hiddenByToggle` from the derived view, so
 *   it states what the post-filter actually removed rather than a second count
 *   computed here.
 * - Not loaded: that a calendar file has to be loaded for the toggle to do
 *   anything (Requirement 16.4). The Result_Set is unaffected in that case —
 *   `hideConflicting` returns its input and 0 for a `null` schedule — so the
 *   message is the only visible difference between on and off, and it is what
 *   explains a shared `hc=1` link that appears to do nothing.
 *
 * Neither message renders while the toggle is off: both describe an effect of the
 * toggle being on.
 *
 * A change commits the new setting through `onCommit`, the shell's
 * discrete-change path, which is what encodes the resulting Query_State and gives
 * the change its own history entry (Requirements 16.5, 8.1). The page number goes
 * back to 1 with it, and the Search_Query, the selected Filter values, and the
 * Sort_Option are carried through untouched. The Busy_Schedule cannot be
 * disturbed from here at all: it lives in `CalendarState`, which this component
 * only reads (Requirement 16.5).
 *
 * Requirement 16.7's clear-all control is not rendered here. It is *the*
 * clear-all control of Requirement 5.6, one per listing, and `isNarrowed` in
 * `SelectedValues` already displays it whenever the toggle is on; a second copy
 * beside the checkbox would be a second control with the same job.
 *
 * Accessibility comes from the native checkbox: it is in the tab order and
 * operable with the space key without anything of ours, and its `label` is
 * associated by `for`, naming what the control does (Requirement 11.10).
 */

import { scheduleOf, type CalendarState } from '../calendarState';
import { DEFAULT_PAGE_NUMBER } from '../paginate';
import type { QueryState } from '../queryState';

/** The label naming the control's purpose (Requirements 16.1, 11.10). */
export const HIDE_CONFLICTS_LABEL = 'Hide conflicting teams';

/** The `input` id its `label` points at; the listing renders one toggle. */
export const HIDE_CONFLICTS_ID = 'hide-conflicts-toggle';

/** Requirement 16.3: the count of Teams the toggle excluded, stated as text. */
export function excludedText(count: number): string {
  return `${count} ${count === 1 ? 'team' : 'teams'} hidden by the hide-conflicts toggle.`;
}

/** Requirement 16.4: the toggle is on, but there is no calendar to hide against. */
export const NO_CALENDAR_MESSAGE =
  'Load an .ics calendar file for the hide-conflicts toggle to take effect. No teams are hidden until you do.';

export interface HideConflictsToggleProps {
  readonly qs: QueryState;
  /** Read only for whether a Busy_Schedule is loaded (Requirements 16.3, 16.4). */
  readonly calendar: CalendarState;
  /** `hiddenByToggle` from the derived view; 0 is displayed (Requirement 16.3). */
  readonly hiddenByToggle: number;
  /** The shell's discrete-change commit: one new Query_State, one history entry. */
  readonly onCommit: (qs: QueryState) => void;
}

export function HideConflictsToggle({
  qs,
  calendar,
  hiddenByToggle,
  onCommit,
}: HideConflictsToggleProps) {
  const loaded = scheduleOf(calendar) !== null;

  return (
    <div class="hide-conflicts" data-testid="hide-conflicts">
      <input
        id={HIDE_CONFLICTS_ID}
        class="hide-conflicts__checkbox"
        type="checkbox"
        checked={qs.hideConflicts}
        onChange={event =>
          onCommit({
            ...qs,
            hideConflicts: event.currentTarget.checked,
            // Requirement 16.5: back to the first page of the new Result_Set.
            pageNumber: DEFAULT_PAGE_NUMBER,
          })
        }
      />
      {/* Requirement 11.10: a visible label, associated by `for`. */}
      <label class="hide-conflicts__label" for={HIDE_CONFLICTS_ID}>
        {HIDE_CONFLICTS_LABEL}
      </label>

      {qs.hideConflicts && loaded && (
        // Ordinary text: the matching count is what gets announced, and the
        // listing's live region owns that (Requirement 11.4).
        <p class="hide-conflicts__excluded" data-testid="hide-conflicts-excluded">
          {excludedText(hiddenByToggle)}
        </p>
      )}

      {qs.hideConflicts && !loaded && (
        // Announced: it appears in response to turning the toggle on and is the
        // reason the listing did not change.
        <p
          class="hide-conflicts__notice"
          role="status"
          data-testid="hide-conflicts-no-calendar"
        >
          {NO_CALENDAR_MESSAGE}
        </p>
      )}
    </div>
  );
}
