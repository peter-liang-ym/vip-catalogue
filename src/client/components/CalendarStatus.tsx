/**
 * What the mirror says about the loaded calendar, and what went wrong with the
 * last attempt (Requirements 14.14, 14.15, 14.16, 14.17, 14.18, 17.7, 17.8).
 *
 * Two independent halves, read off one `CalendarState`:
 *
 * - The status display: the Calendar_File name, the count of Busy_Blocks, and the
 *   load time with an explicit time zone (Requirements 14.18, 17.2). It renders
 *   whenever a Busy_Schedule is loaded, which is exactly `scheduleOf(state)` being
 *   non-`null` — so a rejected file leaves the previous schedule's details on
 *   screen, which is the visible half of "retain any Busy_Schedule that is already
 *   loaded", and `none` displays no name, no count, and no load time
 *   (Requirements 14.3, 14.4, 14.15, 14.16, 14.17, 17.6).
 * - The notices: one message per outcome worth stating. A `loaded` state can carry
 *   two at once — the retained-count message and the could-not-save message — so
 *   the notice and `persisted` are rendered independently rather than as one
 *   either-or slot (Requirements 14.14, 17.8).
 *
 * `wrongType` and `tooLarge` are deliberately absent from `noticeMessage`. Those
 * two rejections happen before any parse, in the control that took the file, and
 * Requirements 14.3 and 14.4 place their messages there; stating them here as well
 * would give one rejection two messages.
 *
 * The load time is formatted rather than shown raw, and the zone is named rather
 * than implied by the visitor's locale, so it can be compared against the meeting
 * times on the cards without changing frames.
 */

import type { ComponentChildren } from 'preact';
import type { BusySchedule } from '../../shared/types';
import {
  scheduleOf,
  type CalendarNotice,
  type CalendarState,
} from '../calendarState';
import { DISPLAY_TIME_ZONE } from './Freshness';

/**
 * Requirements 14.18, 17.2: a calendar date, a time of day, and an explicit time
 * zone. Same zone and same shape as the Dataset timestamp, for the same reason.
 */
const loadTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

/** Requirement 14.18: the Calendar_File name the Busy_Schedule came from. */
export function fileNameText(fileName: string): string {
  return `Calendar file: ${fileName}`;
}

/** Requirement 14.18: the count of Busy_Blocks in the Busy_Schedule. */
export function blockCountText(count: number): string {
  return `${count} busy time ${count === 1 ? 'block' : 'blocks'} loaded.`;
}

/**
 * Requirement 14.18: the load time, stated with its zone.
 *
 * `loadedAt` is a stored string, and the store only guarantees that it is a
 * string — a schedule written by another build could carry something
 * `Date.parse` cannot read. Such a value is shown as it stands rather than as
 * "Invalid Date", which keeps the load time displayed in every case.
 */
export function loadTimeText(loadedAt: string): string {
  const ms = Date.parse(loadedAt);

  return `Loaded ${Number.isNaN(ms) ? loadedAt : loadTimeFormat.format(new Date(ms))}`;
}

/**
 * Requirement 14.14: the count of retained Busy_Blocks, and that the rest of the
 * calendar went unused. The count comes from the schedule that was kept, not from
 * the cap, so the message states what is actually in effect.
 */
export function retainedText(retainedBlocks: number): string {
  return `Only the first ${retainedBlocks} calendar entries were used. Further calendar entries were not used.`;
}

/** Requirement 14.15: the file could not be read as iCalendar content. */
export const INVALID_CALENDAR_MESSAGE =
  'That file is not a valid iCalendar file. Your previously loaded calendar, if any, is unchanged.';

/** Requirement 14.16: valid iCalendar content with nothing weekly in it. */
export const NO_USABLE_EVENTS_MESSAGE =
  'No weekly recurring events were found in that file. Your previously loaded calendar, if any, is unchanged.';

/** Requirement 14.17: the parse did not finish inside its budget. */
export const TIMEOUT_MESSAGE =
  'That calendar file could not be processed. Your previously loaded calendar, if any, is unchanged.';

/** Requirement 12.6: the calendar reader itself could not be downloaded. */
export const PARSER_UNAVAILABLE_MESSAGE =
  'The calendar reader could not be loaded. Check your connection and try loading the file again.';

/** Requirement 17.7: a stored calendar this version cannot read has been discarded. */
export const NOT_RESTORED_MESSAGE =
  'Your previously loaded calendar could not be restored. You can load an .ics calendar file again.';

/** Requirement 17.8: the schedule applies to this visit only. */
export const NOT_SAVED_MESSAGE =
  'This calendar could not be saved for later visits. It still applies for this visit.';

/**
 * The message for a notice, or `null` when the notice is not this component's to
 * state.
 *
 * `truncated` returns `null` because its message carries the retained count and
 * comes from `retainedText`; `wrongType` and `tooLarge` because the control that
 * rejected the file states those (Requirements 14.3, 14.4).
 */
export function noticeMessage(notice: CalendarNotice): string | null {
  switch (notice) {
    case 'invalidCalendar':
      return INVALID_CALENDAR_MESSAGE;
    case 'noUsableEvents':
      return NO_USABLE_EVENTS_MESSAGE;
    case 'timeout':
      return TIMEOUT_MESSAGE;
    case 'parserUnavailable':
      return PARSER_UNAVAILABLE_MESSAGE;
    case 'notRestored':
      return NOT_RESTORED_MESSAGE;
    case 'wrongType':
    case 'tooLarge':
    case 'truncated':
      return null;
  }
}

export interface CalendarStatusProps {
  /** The whole calendar state; both halves of this component read from it. */
  readonly state: CalendarState;
  /**
   * Affordances that act on the schedule being summarized — removal, and anything
   * else that only makes sense once one is loaded. They render on the summary line
   * itself, and only while a Busy_Schedule is there to act on
   * (Requirements 17.4, 17.6), which is why they are handed here rather than
   * placed beside this component.
   */
  readonly children?: ComponentChildren;
}

/** The Busy_Schedule details, rendered whenever one is loaded (Requirement 14.18). */
function ScheduleDetails({
  schedule,
  children,
}: {
  readonly schedule: BusySchedule;
  readonly children?: ComponentChildren;
}) {
  return (
    <div
      class="calendar-status__schedule"
      data-testid="calendar-status-schedule"
    >
      <p class="calendar-status__file" data-testid="calendar-status-file">
        {fileNameText(schedule.fileName)}
      </p>
      <p class="calendar-status__blocks" data-testid="calendar-status-blocks">
        {blockCountText(schedule.blocks.length)}
      </p>
      <p class="calendar-status__loaded" data-testid="calendar-status-loaded">
        {loadTimeText(schedule.loadedAt)}
      </p>
      {children}
    </div>
  );
}

export function CalendarStatus({ state, children }: CalendarStatusProps) {
  const schedule = scheduleOf(state);
  const notice =
    state.kind === 'loaded' || state.kind === 'error' ? state.notice : null;
  const message = notice === null ? null : noticeMessage(notice);
  // The retained count, or `null` when nothing was discarded (Requirement 14.14).
  const retainedBlocks =
    state.kind === 'loaded' && state.notice === 'truncated'
      ? state.schedule.blocks.length
      : null;
  const notSaved = state.kind === 'loaded' && !state.persisted;

  // Nothing loaded and nothing to say: no file name, no block count, no load
  // time, and no empty container to read past (Requirement 17.6).
  if (
    schedule === null &&
    message === null &&
    retainedBlocks === null &&
    !notSaved
  ) {
    return null;
  }

  return (
    <div class="calendar-status" data-calendar-state={state.kind}>
      {schedule !== null && (
        <ScheduleDetails schedule={schedule}>{children}</ScheduleDetails>
      )}

      {retainedBlocks !== null && (
        <p
          class="calendar-status__notice notice"
          role="status"
          data-testid="calendar-status-truncated"
        >
          {retainedText(retainedBlocks)}
        </p>
      )}

      {notSaved && (
        <p
          class="calendar-status__notice notice"
          role="status"
          data-testid="calendar-status-not-saved"
        >
          {NOT_SAVED_MESSAGE}
        </p>
      )}

      {message !== null && (
        // An `error` state is a rejected file the visitor just supplied, so it is
        // announced rather than left to be noticed, like the Dataset failure
        // message.
        <p
          class="calendar-status__notice notice"
          role={state.kind === 'error' ? 'alert' : 'status'}
          data-testid="calendar-status-message"
        >
          {message}
        </p>
      )}
    </div>
  );
}
