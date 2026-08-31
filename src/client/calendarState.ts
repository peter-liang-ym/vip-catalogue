/**
 * Calendar session state: restoration, persistence, and removal
 * (Requirements 17.2, 17.4, 17.5, 17.6, 17.7).
 *
 * `CalendarState` lives beside `LoadState` and is independent of it. Every
 * calendar failure is additive — the worst outcome of any of them is a mirror
 * that behaves as though no calendar had been supplied — so no transition here
 * can move the Catalog_UI out of `loaded`.
 *
 * The state holds one thing the rest of the calendar feature reads: the
 * Busy_Schedule to derive against, through `scheduleOf`. Everything the removal
 * control has to clear — every Conflict_State, every Conflict_Detail, and the
 * excluded-Team count — is derived from that one value rather than stored
 * anywhere, so returning `none` clears all of them at once (Requirement 17.4).
 * Nothing here touches `QueryState`, which is what retains the hide-conflicts
 * toggle setting across a removal (Requirement 17.5).
 *
 * `CalendarParseResult` is imported as a type only. The parser is a lazily
 * imported chunk (Requirement 11.10), and a value import here would pull it into
 * the initial bundle.
 */

import type { BusySchedule } from '../shared/types';
import {
  loadStoredSchedule,
  removeStoredSchedule,
  saveStoredSchedule,
} from './busyScheduleStore';
import type { CalendarParseResult } from './calendar/parseCalendar';

/**
 * The one thing that went wrong, or the one thing worth saying, about the last
 * calendar attempt. One notice, one message (Requirements 14.3, 14.4, 14.14,
 * 14.15, 14.16, 14.17, 17.7, 12.6).
 *
 * A failed write is deliberately not a member: it is not a reason the attempt
 * failed, it costs persistence and nothing else, and it can coincide with
 * `truncated`. It travels as `persisted: false` on a `loaded` state instead, so
 * both messages can be shown at once (Requirement 17.8).
 */
export type CalendarNotice =
  /** The file is neither named `.ics` nor typed `text/calendar` (14.3). */
  | 'wrongType'
  /** The file is over the 5 MB limit (14.4). */
  | 'tooLarge'
  /** The parser chunk could not be imported (12.6, 14.3). */
  | 'parserUnavailable'
  /** Not readable as iCalendar content (14.15). */
  | 'invalidCalendar'
  /** Valid iCalendar content, no weekly recurring events (14.16). */
  | 'noUsableEvents'
  /** Parsing did not finish inside its budget (14.17). */
  | 'timeout'
  /** Blocks past the cap were discarded; a success path (14.14). */
  | 'truncated'
  /** A stored schedule was corrupt or of another version (17.7). */
  | 'notRestored';

/**
 * Where the calendar stands this visit.
 *
 * `parsing` and `error` both carry the Busy_Schedule that was already loaded, and
 * that single field is the whole mechanism behind "retain any Busy_Schedule that
 * is already loaded" in Requirements 14.3, 14.4, 14.15, 14.16, and 14.17: a
 * rejected file changes the notice and leaves the schedule where it was.
 */
export type CalendarState =
  | { readonly kind: 'none' }
  /** Chunk downloading or parse running; `schedule` is the one being replaced. */
  | {
      readonly kind: 'parsing';
      readonly fileName: string;
      readonly schedule: BusySchedule | null;
    }
  | {
      readonly kind: 'loaded';
      readonly schedule: BusySchedule;
      /** `false` when the write failed; the schedule still applies (17.8). */
      readonly persisted: boolean;
      /** `truncated`, or none. Not a failure — this state is a success. */
      readonly notice: CalendarNotice | null;
    }
  | {
      readonly kind: 'error';
      readonly notice: CalendarNotice;
      /** The schedule that stays loaded, or `null` when there was none. */
      readonly schedule: BusySchedule | null;
    };

/** No calendar: no file name, no block count, no load time (Requirement 17.6). */
export const NO_CALENDAR: CalendarState = { kind: 'none' };

/**
 * The Busy_Schedule to derive against, or `null` when none is loaded.
 *
 * The single seam between this state machine and `derive`. `null` reproduces the
 * pre-calendar behavior exactly: no Conflict_State, no Conflict_Detail, and an
 * excluded count of 0 (Requirements 15.7, 16.4).
 */
export function scheduleOf(state: CalendarState): BusySchedule | null {
  return state.kind === 'none' ? null : state.schedule;
}

/**
 * The state to start a visit in, read from browser-local storage
 * (Requirements 17.2, 17.6, 17.7).
 *
 * A readable stored schedule is applied as `loaded` — so the stored file name,
 * block count, and load time display and every Conflict_State is computed — and
 * is reported as `persisted`, since it demonstrably survived a previous visit. A
 * stored value this version cannot read has already been removed by
 * `loadStoredSchedule`, and becomes the could-not-restore notice with no schedule
 * applied (Requirement 17.7).
 *
 * A restored schedule carries no notice even when it was truncated when first
 * parsed: Requirement 17.2 names the file name, the block count, and the load
 * time as what a restore displays, and the retained-count message belongs to the
 * parse that discarded the blocks.
 */
export function restoreCalendar(store?: Storage): CalendarState {
  const stored = loadStoredSchedule(store);

  switch (stored.kind) {
    case 'loaded':
      return {
        kind: 'loaded',
        schedule: stored.schedule,
        persisted: true,
        notice: null,
      };
    case 'unreadable':
      return { kind: 'error', notice: 'notRestored', schedule: null };
    case 'none':
      return NO_CALENDAR;
  }
}

/**
 * The state a finished parse produces, storing the schedule on success
 * (Requirement 17.1).
 *
 * `ok` and `truncated` are the two success paths, and both save: `truncated` is a
 * schedule that was capped, not one that failed, and the visitor should not have
 * to re-upload it next visit. A write that throws yields `persisted: false`, and
 * the schedule still applies for this visit (Requirement 17.8).
 *
 * Every other result keeps the schedule `previous` was carrying, which is how a
 * rejected file leaves a working calendar working (Requirements 14.15, 14.16,
 * 14.17).
 */
export function applyParseResult(
  result: CalendarParseResult,
  previous: CalendarState,
  store?: Storage,
): CalendarState {
  switch (result.kind) {
    case 'ok':
    case 'truncated': {
      const { persisted } = saveStoredSchedule(result.schedule, store);

      return {
        kind: 'loaded',
        schedule: result.schedule,
        persisted,
        notice: result.kind === 'truncated' ? 'truncated' : null,
      };
    }
    case 'invalidCalendar':
    case 'noUsableEvents':
    case 'timeout':
      return {
        kind: 'error',
        notice: result.kind,
        schedule: scheduleOf(previous),
      };
  }
}

/**
 * Removes the stored Busy_Schedule and the loaded one
 * (Requirements 17.4, 17.5, 17.6).
 *
 * Storage is cleared first so the removal survives a reload, and the returned
 * `none` withdraws the schedule from the derivation, which is what removes every
 * displayed Conflict_State, every Conflict_Detail, and the excluded-Team count.
 * The hide-conflicts toggle setting is part of `QueryState` and is not touched,
 * so it stays as the visitor left it and takes the no-calendar-loaded path while
 * it is on (Requirements 17.5, 16.4).
 */
export function removeCalendar(store?: Storage): CalendarState {
  removeStoredSchedule(store);

  return NO_CALENDAR;
}
