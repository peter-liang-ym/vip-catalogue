/**
 * The Calendar_File control: file selection, the drop target, the two checks that
 * happen before any parse, the lazily imported parser, and the removal control
 * (Requirements 14.1, 14.2, 14.3, 14.4, 11.10, 17.4, 17.9).
 *
 * Removal lives here rather than beside the status display because Requirement
 * 17.9 states, adjacent to this control, that the file can be removed, and the
 * control that keeps that promise belongs where the promise is made. It is the
 * mirror of `supply`: one activation, one terminal `onState`, and the same
 * injected `store`.
 *
 * One `input[type=file]` inside a container that also accepts a dropped file, so
 * both ways of supplying a Calendar_File named in Requirement 14.1 reach the same
 * `supply` path. The `input` is a real form control rather than a styled
 * substitute, which is what makes it keyboard reachable and activatable and gives
 * it a `label`-associated name for free (Requirement 11.10). `dragover` is
 * prevented for the one reason it has to be — a target that does not cancel it
 * never receives the `drop`.
 *
 * Two rejections happen here, before the parser is even fetched: a file that is
 * neither named `.ics` nor declared as calendar content, and a file over the 5 MB
 * limit (Requirements 14.3, 14.4). Their messages live here too, because the
 * requirements place them beside this control and `CalendarStatus.noticeMessage`
 * deliberately returns `null` for both so one rejection never gets two messages.
 *
 * Everything else about a rejection is `CalendarState`'s doing: every failure
 * path returns an `error` carrying `scheduleOf` the state it started from, which
 * is the whole of "retain any Busy_Schedule that is already loaded" — the loaded
 * schedule, its Conflict_States, and the Result_Set are all derived from that one
 * value, so carrying it back leaves them untouched
 * (Requirements 14.3, 14.4, 14.15, 14.16, 14.17).
 *
 * The parser arrives through a dynamic `import()` resolved on the first
 * Calendar_File and never before (Requirement 11.10, and the 300 KB budget in
 * 12.2). It is reached through `typeof import(...)` in type position only: a value
 * import here would pull `ical.js` and the VTIMEZONE handling into the initial
 * chunk and defeat the split that `bun run check:payload` checks for. A chunk that
 * fails to download is a calendar failure like any other, reported as
 * `parserUnavailable` with the loaded schedule intact.
 *
 * While the chunk downloads and the parse runs the state is `parsing`, and the busy
 * affordance is rendered with `tabindex="0"` so it is reachable by keyboard rather
 * than announced only to a pointer. The `input` is not disabled during that
 * window, so the control itself stays keyboard-focusable and operable.
 *
 * `loadParser`, `clock`, `store`, and `yieldToPaint` are injected the same way the
 * Scraper's clock and the Busy_Schedule store are: the deadline, the 120-day
 * window, the chunk-load failure, and the storage failure are all reachable in a
 * test without a network, a real clock, or `localStorage`.
 */

import type { CalendarClock } from '../calendar/parseCalendar';
import {
  applyParseResult,
  removeCalendar,
  scheduleOf,
  type CalendarNotice,
  type CalendarState,
} from '../calendarState';

/**
 * The parser, as reached through the lazy chunk. A `typeof import(...)` type, so
 * nothing about `parseCalendar` or `ical.js` is imported as a value here
 * (Requirement 11.10).
 */
export type ParseCalendar =
  typeof import('../calendar/parseCalendar').parseCalendar;

/** Requirement 14.2: the largest Calendar_File that is read at all, in bytes. */
export const MAX_CALENDAR_BYTES = 5_242_880;

/** Requirement 14.2: the file name suffix that identifies a Calendar_File. */
export const CALENDAR_FILE_EXTENSION = '.ics';

/** Requirement 14.2: the declared media type that identifies a Calendar_File. */
export const CALENDAR_MEDIA_TYPE = 'text/calendar';

/** Requirement 14.17: the parse budget handed to the parser. */
const PARSE_DEADLINE_MS = 2_000;

/** Requirement 14.6: at most this many VEVENT entries are evaluated. */
const MAX_VEVENTS = 5_000;

/** Requirement 14.14: at most this many merged Busy_Blocks are retained. */
const MAX_BLOCKS = 200;

/** Requirement 14.9: the occurrence window, in days from the load time. */
const WINDOW_DAYS = 120;

/** The `input` id the label and the container point at; one control per page. */
export const CALENDAR_INPUT_ID = 'calendar-file';

const CALENDAR_HINT_ID = 'calendar-file-hint';
const CALENDAR_PRIVACY_ID = 'calendar-file-privacy';

/** The label identifying the control's purpose (Requirement 11.10). */
export const CALENDAR_CONTROL_LABEL = 'Load your class schedule (.ics file)';

/** Requirement 14.1: both ways of supplying the file, stated where it is taken. */
export const DROP_HINT_TEXT =
  'Choose an .ics calendar file, or drag one onto this area.';

/** Requirement 14.3: an .ics calendar file is required. */
export const WRONG_TYPE_MESSAGE =
  'An .ics calendar file is required. Your previously loaded calendar, if any, is unchanged.';

/** Requirement 14.4: the file is over the 5 megabyte limit. */
export const TOO_LARGE_MESSAGE =
  'That file exceeds the 5 megabyte limit. Your previously loaded calendar, if any, is unchanged.';

/**
 * Requirement 17.9: read on the visitor's device, not uploaded, removable. Stated
 * adjacent to the control that takes the file, and referenced by the `input`'s
 * `aria-describedby` so it is not visible-only.
 */
export const PRIVACY_STATEMENT =
  'Your calendar file is read on your device. It is not uploaded anywhere, and you can remove it at any time.';

/**
 * Requirement 17.4: the control that removes the loaded and the stored
 * Busy_Schedule. A `button` whose text content is its accessible name, so it is in
 * the tab order, activatable by keyboard, and named without anything of ours
 * (Requirement 11.10).
 */
export const REMOVE_CALENDAR_LABEL = 'Remove your loaded calendar';

/** What the busy affordance says while the chunk downloads and the parse runs. */
export function busyText(fileName: string): string {
  return `Reading ${fileName}…`;
}

/**
 * The message for a notice, or `null` when the notice is not this control's to
 * state.
 *
 * The mirror image of `CalendarStatus.noticeMessage`: exactly the two rejections
 * that happen here, before any parse, are stated here (Requirements 14.3, 14.4).
 */
export function controlNoticeMessage(notice: CalendarNotice): string | null {
  switch (notice) {
    case 'wrongType':
      return WRONG_TYPE_MESSAGE;
    case 'tooLarge':
      return TOO_LARGE_MESSAGE;
    case 'parserUnavailable':
    case 'invalidCalendar':
    case 'noUsableEvents':
    case 'timeout':
    case 'truncated':
    case 'notRestored':
      return null;
  }
}

/** Whether the file is one the parser is allowed to read (Requirement 14.2). */
export function isCalendarFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(CALENDAR_FILE_EXTENSION) ||
    file.type.toLowerCase() === CALENDAR_MEDIA_TYPE
  );
}

/**
 * Why this file is rejected without being read, or `null` when it is read
 * (Requirements 14.3, 14.4).
 *
 * The type check comes first, so a 6 MB PDF is reported as the wrong type rather
 * than as too large: both antecedents hold for it, and one rejected file gets one
 * message.
 */
export function rejectionOf(file: File): 'wrongType' | 'tooLarge' | null {
  if (!isCalendarFile(file)) return 'wrongType';

  return file.size > MAX_CALENDAR_BYTES ? 'tooLarge' : null;
}

/** The parser chunk, fetched on the first Calendar_File and never before. */
async function importParser(): Promise<ParseCalendar> {
  const chunk = await import('../calendar/parseCalendar');

  return chunk.parseCalendar;
}

/**
 * The text of one file, read through browser file interfaces on the visitor's
 * device and by nothing else — no request of any kind is issued
 * (Requirement 14.5).
 *
 * `FileReader` rather than `Blob.text()`: it is the file interface jsdom
 * implements, so the component suite exercises the real read instead of stubbing
 * it, and its `error` event is the failure this promise rejects with.
 */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/**
 * One turn of the event loop, so the busy affordance actually paints before the
 * main-thread parse starts.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

export interface CalendarControlProps {
  readonly state: CalendarState;
  /** Commits the next `CalendarState`; called once per transition. */
  readonly onState: (next: CalendarState) => void;
  /** Resolves the parser; defaults to the lazy chunk import. */
  readonly loadParser?: () => Promise<ParseCalendar>;
  /** Time source for the parse deadline and the occurrence window. */
  readonly clock?: CalendarClock;
  /** Storage the derived Busy_Schedule is saved to (Requirement 17.1). */
  readonly store?: Storage;
  /** The paint yield between showing the busy affordance and parsing. */
  readonly yieldToPaint?: () => Promise<void>;
}

export function CalendarControl({
  state,
  onState,
  loadParser = importParser,
  clock = { now: () => Date.now() },
  store,
  yieldToPaint = yieldToEventLoop,
}: CalendarControlProps) {
  /**
   * Everything one supplied file does, from the two pre-parse checks through the
   * chunk import to the finished `CalendarState`. Every path ends in exactly one
   * terminal `onState`, and every failing one carries `parsing.schedule` back.
   */
  async function supply(file: File): Promise<void> {
    const rejection = rejectionOf(file);
    if (rejection !== null) {
      onState({
        kind: 'error',
        notice: rejection,
        schedule: scheduleOf(state),
      });
      return;
    }

    // The schedule being replaced travels on the `parsing` state, so it is still
    // in hand on every path below without being read from `state` again.
    const parsing: CalendarState = {
      kind: 'parsing',
      fileName: file.name,
      schedule: scheduleOf(state),
    };
    onState(parsing);

    await yieldToPaint();

    let parse: ParseCalendar;
    try {
      parse = await loadParser();
    } catch {
      // Requirement 12.6 as it applies to the calendar path: the reader could not
      // be downloaded, and the loaded schedule is untouched.
      onState({
        kind: 'error',
        notice: 'parserUnavailable',
        schedule: parsing.schedule,
      });
      return;
    }

    let icsText: string;
    try {
      icsText = await readFileText(file);
    } catch {
      // The file is gone or unreadable from disk, which is "its content cannot be
      // read as iCalendar content" as far as the visitor can tell
      // (Requirement 14.15).
      onState({
        kind: 'error',
        notice: 'invalidCalendar',
        schedule: parsing.schedule,
      });
      return;
    }

    // `parseCalendar` is total and never throws, so its result needs no guard, and
    // `applyParseResult` names the state — saving on success, carrying
    // `parsing.schedule` back on every failure.
    const result = parse(icsText, {
      fileName: file.name,
      loadedAt: new Date(clock.now()),
      clock,
      deadlineMs: PARSE_DEADLINE_MS,
      maxEvents: MAX_VEVENTS,
      maxBlocks: MAX_BLOCKS,
      windowDays: WINDOW_DAYS,
    });

    onState(applyParseResult(result, parsing, store));
  }

  const notice =
    state.kind === 'error' ? controlNoticeMessage(state.notice) : null;
  // Requirement 17.4: the removal control is offered while a Busy_Schedule is
  // loaded, and there is nothing to remove when none is (Requirement 17.6).
  const loaded = scheduleOf(state) !== null;

  return (
    <div
      class="calendar-control"
      data-testid="calendar-control"
      // Requirement 14.1: a target that does not cancel `dragover` never gets the
      // `drop`, which is the only reason this handler exists.
      onDragOver={event => event.preventDefault()}
      onDrop={event => {
        event.preventDefault();

        const file = event.dataTransfer?.files[0];
        if (file !== undefined) void supply(file);
      }}
    >
      {/* Requirement 11.10: a visible label, associated by `for`. */}
      <label class="calendar-control__label" for={CALENDAR_INPUT_ID}>
        {CALENDAR_CONTROL_LABEL}
      </label>

      <input
        id={CALENDAR_INPUT_ID}
        class="calendar-control__input"
        type="file"
        accept={`${CALENDAR_FILE_EXTENSION},${CALENDAR_MEDIA_TYPE}`}
        aria-describedby={`${CALENDAR_HINT_ID} ${CALENDAR_PRIVACY_ID}`}
        // Never disabled: the control stays keyboard-focusable while the chunk
        // downloads and the parse runs (Requirement 11.10).
        aria-busy={state.kind === 'parsing'}
        onChange={event => {
          const input = event.currentTarget;
          const file = input.files?.[0];

          // Cleared so choosing the same file again fires another `change`, which
          // is what makes retrying after a failed chunk load possible.
          input.value = '';

          if (file !== undefined) void supply(file);
        }}
      />

      <p class="calendar-control__hint" id={CALENDAR_HINT_ID}>
        {DROP_HINT_TEXT}
      </p>

      {loaded && (
        // Requirements 17.4, 17.9: removal is offered beside the control that
        // took the file, which is where the privacy statement promises it. One
        // click clears storage and returns `none`, and the shell re-deriving
        // against no schedule is what removes every Conflict_State, every
        // Conflict_Detail, and the excluded count. Nothing here reads or writes
        // the Query_State, so the toggle setting survives (Requirement 17.5).
        <button
          class="calendar-control__remove"
          type="button"
          data-testid="calendar-remove"
          onClick={() => onState(removeCalendar(store))}
        >
          {REMOVE_CALENDAR_LABEL}
        </button>
      )}

      {state.kind === 'parsing' && (
        // Keyboard-focusable, so the busy state is reachable without a pointer.
        <p
          class="calendar-control__busy"
          role="status"
          aria-busy="true"
          tabIndex={0}
          data-testid="calendar-control-busy"
        >
          {busyText(state.fileName)}
        </p>
      )}

      {notice !== null && (
        // A file the visitor just supplied was rejected, so the message is
        // announced rather than left to be noticed.
        <p
          class="calendar-control__notice"
          role="alert"
          data-testid="calendar-control-notice"
        >
          {notice}
        </p>
      )}

      <p
        class="calendar-control__privacy"
        id={CALENDAR_PRIVACY_ID}
        data-testid="calendar-control-privacy"
      >
        {PRIVACY_STATEMENT}
      </p>
    </div>
  );
}
