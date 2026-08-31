/**
 * The empty-state surfaces (Requirements 5.7, 16.8, 16.9).
 *
 * An empty Result_Set has two shapes, and `derive` has already decided which one
 * this is: `allConflict` when the hide-conflicts toggle is what emptied it
 * (Requirement 16.8), `noMatch` for every other empty Result_Set — including one
 * where nothing matching conflicts at all, which Requirement 16.9 sends to the
 * same no-match message Requirement 5.7 defines. Selecting on `emptyReason` here
 * rather than re-deriving the distinction keeps the two rules in one place.
 *
 * Both states render the clear-all control, because clear-all is the affordance
 * that recovers the view in either case; the all-conflict state adds the excluded
 * count, which is what names the narrower recovery.
 *
 * The hide-conflicts toggle Requirement 16.8 also names is not rendered here. It
 * is *the* toggle of Requirement 16.1, which the listing displays for every
 * Result_Set, empty or not, and a second checkbox for the same setting would be a
 * second control with the same job — the reason `HideConflictsToggle` gives for
 * not restating clear-all beside itself. It would also mean two elements sharing
 * `HIDE_CONFLICTS_ID`, and the toggle unmounting under the visitor as the
 * Result_Set stops being empty, which is exactly the focus loss Requirement 11.12
 * forbids.
 *
 * The component renders no Team_Cards by construction — it is what the listing
 * renders instead of them. The matching count of zero belongs to the listing's
 * live region (Requirement 11.4), so the messages here are ordinary text.
 */

import type { EmptyReason } from '../derive';
import { excludedText } from './HideConflictsToggle';
import { CLEAR_ALL_LABEL } from './SelectedValues';

/** Requirements 5.7, 16.9: the message for an empty Result_Set that no toggle caused. */
export const NO_MATCH_MESSAGE =
  'No teams match your search and selected filters.';

/** Requirement 16.8: the message for a Result_Set the hide-conflicts toggle emptied. */
export const ALL_CONFLICT_MESSAGE =
  'Every team matching your search and selected filters conflicts with your loaded calendar.';

/**
 * Requirements 5.7 and 16.8 both name *the* clear-all control of Requirement 5.6,
 * so the label is the indicator strip's one definition rather than a second
 * spelling of the same control. The excluded count is the toggle's own definition
 * for the same reason (Requirement 16.3): the all-conflict state states the same
 * count, not a second wording of it.
 */
export { CLEAR_ALL_LABEL, excludedText };

export interface EmptyStateProps {
  /** From `derive`; `none` is the non-empty Result_Set and renders nothing. */
  readonly reason: EmptyReason;
  /** `hiddenByToggle` from the derived view (Requirement 16.3). */
  readonly hiddenByToggle: number;
  readonly onClearAll: () => void;
}

export function EmptyState({
  reason,
  hiddenByToggle,
  onClearAll,
}: EmptyStateProps) {
  if (reason === 'none') return null;

  const allConflict = reason === 'allConflict';

  return (
    <div class="empty-state" data-empty-reason={reason}>
      <p class="empty-state__message" data-testid="empty-state-message">
        {allConflict ? ALL_CONFLICT_MESSAGE : NO_MATCH_MESSAGE}
      </p>

      {allConflict && (
        <p class="empty-state__excluded" data-testid="empty-state-excluded">
          {excludedText(hiddenByToggle)}
        </p>
      )}

      <button type="button" class="empty-state__clear" onClick={onClearAll}>
        {CLEAR_ALL_LABEL}
      </button>
    </div>
  );
}
