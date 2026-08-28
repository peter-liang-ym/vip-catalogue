/**
 * Calendar parsing: VEVENT filtering, occurrence expansion, and the result cases
 * (Requirements 14.6, 14.8, 14.9, 14.14, 14.15, 14.16, 14.17).
 *
 * This is the walk that turns the VEVENT entries of one calendar into unmerged
 * Busy_Blocks: at most the first `maxEvents` entries are evaluated, only weekly
 * interval-1 recurrences that carry a start and an end or duration contribute,
 * and every entry that contributes nothing — ineligible, or with every in-window
 * occurrence removed by `EXDATE` or exhausted by `UNTIL`/`COUNT` — is counted once
 * as skipped.
 *
 * `scanVevents` is a generator that yields one outcome per evaluated entry so the
 * caller can check its deadline at each VEVENT boundary; `parseCalendar` at the
 * bottom of the file walks it, merges, caps, and names the result case.
 *
 * Nothing here throws: a malformed recurrence rule yields no occurrence, the same
 * as an exhausted one.
 */

import ICAL from 'ical.js';
import {
  MAX_SHORT_TEXT_LENGTH,
  type BusyBlock,
  type BusySchedule,
} from '../../shared/types';
import { mergeBusyBlocks } from './merge';
import {
  registerCalendarTimezones,
  toAtlantaInterval,
  toAtlantaWallClock,
} from './toAtlanta';

type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalRecur = InstanceType<typeof ICAL.Recur>;
type IcalDuration = InstanceType<typeof ICAL.Duration>;

/**
 * Loop bound for one recurrence expansion. Occurrences of a weekly rule are at
 * least a day apart, so reaching the end of a 120-day window from any plausible
 * `DTSTART` takes a few thousand steps at most; the bound only stops a malformed
 * rule that fails to advance from spinning the tab.
 */
const MAX_OCCURRENCE_STEPS = 100_000;

export interface EventScanOptions {
  /** Start of the evaluation window; occurrences are expanded over the following `windowDays`. */
  readonly loadedAt: Date;
  /** At most this many VEVENT entries are evaluated (5,000). */
  readonly maxEvents: number;
  /** Length of the evaluation window in days (120). */
  readonly windowDays: number;
}

/** What one evaluated VEVENT entry contributed. */
export interface VeventOutcome {
  /**
   * The blocks derived from that entry's in-window occurrences, unmerged and
   * deduplicated within the entry; empty exactly when the entry is skipped.
   */
  readonly blocks: readonly BusyBlock[];
  /** True when the entry contributed nothing (Requirements 14.8, 14.9). */
  readonly skipped: boolean;
}

/** The half-open range of Atlanta calendar days occurrences are expanded over. */
interface DayWindow {
  readonly firstDay: number;
  readonly lastDayExclusive: number;
}

/**
 * The Atlanta day range `[loadedAt, loadedAt + windowDays)`.
 *
 * The window is measured in whole Atlanta calendar days rather than instants: a
 * Busy_Block is a weekly wall-clock pattern, so which side of the load *time* an
 * occurrence on the load *date* falls is not information the schedule carries.
 */
function dayWindow(options: EventScanOptions): DayWindow {
  const firstDay = toAtlantaWallClock(
    ICAL.Time.fromJSDate(options.loadedAt, true),
  ).dayNumber;

  return {
    firstDay,
    lastDayExclusive: firstDay + Math.max(0, Math.trunc(options.windowDays)),
  };
}

/**
 * The recurrence rule of an eligible entry, or `null` when the entry carries no
 * `RRULE`, a non-weekly `FREQ`, or an `INTERVAL` above 1 (Requirement 14.8).
 *
 * A file that states more than one `RRULE` — deprecated, and not something an
 * export produces — is judged by its first.
 */
function weeklyRule(vevent: IcalComponent): IcalRecur | null {
  const rrule = vevent.getFirstPropertyValue('rrule');
  if (!(rrule instanceof ICAL.Recur)) return null;
  if (rrule.freq !== 'WEEKLY') return null;

  // `ical.js` defaults a missing INTERVAL to 1, so "absent or 1" is one check.
  return rrule.interval === 1 ? rrule : null;
}

/**
 * The occurrence duration: `DTEND` minus `DTSTART`, or the stated `DURATION`.
 *
 * `null` when the entry carries neither, and when either endpoint is a date with
 * no time of day: Requirement 14.6 asks for a start *time* and an end time or
 * duration, and an all-day entry states no clock time to derive minutes from.
 */
function occurrenceDuration(
  vevent: IcalComponent,
  dtstart: IcalTime,
): IcalDuration | null {
  const dtend = vevent.getFirstPropertyValue('dtend');
  if (dtend instanceof ICAL.Time) {
    return dtend.isDate ? null : dtend.subtractDate(dtstart);
  }

  const duration = vevent.getFirstPropertyValue('duration');
  return duration instanceof ICAL.Duration ? duration : null;
}

/**
 * The `EXDATE` values of one entry, split by value type.
 *
 * Date-time exclusions are keyed by instant (or by literal wall clock when
 * floating, which is the only frame a floating time has); a date-only `EXDATE`
 * excludes every occurrence on that calendar day, as RFC 5545 intends.
 */
function exclusions(vevent: IcalComponent): {
  readonly instants: ReadonlySet<string>;
  readonly days: ReadonlySet<string>;
} {
  const instants = new Set<string>();
  const days = new Set<string>();

  for (const property of vevent.getAllProperties('exdate')) {
    for (const value of property.getValues()) {
      if (!(value instanceof ICAL.Time)) continue;
      if (value.isDate) days.add(dayKey(value));
      else instants.add(instantKey(value));
    }
  }

  return { instants, days };
}

function instantKey(time: IcalTime): string {
  return time.zone.tzid === ICAL.Timezone.localTimezone.tzid
    ? `floating:${time.toString()}`
    : `utc:${time.toUnixTime()}`;
}

function dayKey(time: IcalTime): string {
  return `${time.year}-${time.month}-${time.day}`;
}

/** The event summary as a Busy_Block summary: trimmed and capped, `''` when absent. */
function summaryOf(vevent: IcalComponent): string {
  const summary = vevent.getFirstPropertyValue('summary');
  return typeof summary === 'string'
    ? summary.trim().slice(0, MAX_SHORT_TEXT_LENGTH)
    : '';
}

/**
 * The blocks one VEVENT entry contributes: one per distinct weekday and minute
 * range its in-window occurrences land on (Requirement 14.7).
 *
 * Occurrences repeat weekly, so the same weekday and minutes recur throughout the
 * window and are emitted once. They are not always identical, which is why the
 * whole window is walked rather than one week: a UTC-stated time shifts by an hour
 * of Atlanta wall clock across a daylight-saving transition, and both readings are
 * real busy minutes.
 */
function blocksFromVevent(
  vevent: IcalComponent,
  window: DayWindow,
): readonly BusyBlock[] {
  const dtstart = vevent.getFirstPropertyValue('dtstart');
  if (!(dtstart instanceof ICAL.Time) || dtstart.isDate) return [];

  const duration = occurrenceDuration(vevent, dtstart);
  if (duration === null) return [];

  const rule = weeklyRule(vevent);
  if (rule === null) return [];

  const excluded = exclusions(vevent);
  const summary = summaryOf(vevent);
  const blocks: BusyBlock[] = [];
  const seen = new Set<string>();

  try {
    const iterator = rule.iterator(dtstart);

    for (let step = 0; step < MAX_OCCURRENCE_STEPS; step += 1) {
      const occurrence = iterator.next();
      // `UNTIL` and `COUNT` are exhausted: the rule has no further occurrence.
      if (!(occurrence instanceof ICAL.Time)) break;

      const wall = toAtlantaWallClock(occurrence);
      if (wall.dayNumber >= window.lastDayExclusive) break;
      if (wall.dayNumber < window.firstDay) continue;
      if (
        excluded.instants.has(instantKey(occurrence)) ||
        excluded.days.has(dayKey(occurrence))
      ) {
        continue;
      }

      const end = occurrence.clone();
      end.addDuration(duration);

      const interval = toAtlantaInterval(occurrence, end);
      if (interval === null) continue;

      const key = `${interval.weekday}:${interval.startMinute}:${interval.endMinute}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ ...interval, summaries: [summary] });
    }
  } catch {
    // A rule `ical.js` cannot expand yields no occurrence, like an exhausted one.
    return blocks;
  }

  return blocks;
}

/**
 * One outcome per evaluated VEVENT entry, in file order, for at most the first
 * `maxEvents` entries (Requirement 14.6).
 *
 * Entries beyond the cap are not evaluated and so are not counted as skipped;
 * every evaluated entry that contributes no block is (Requirements 14.8, 14.9).
 */
export function* scanVevents(
  vcalendar: IcalComponent,
  options: EventScanOptions,
): Generator<VeventOutcome> {
  // Time values are read below, so the file's own zones must be resolvable first.
  registerCalendarTimezones(vcalendar);

  const window = dayWindow(options);
  const vevents = vcalendar
    .getAllSubcomponents('vevent')
    .slice(0, Math.max(0, Math.trunc(options.maxEvents)));

  for (const vevent of vevents) {
    const blocks = blocksFromVevent(vevent, window);
    yield { blocks, skipped: blocks.length === 0 };
  }
}

/**
 * Injected time source, read at each VEVENT boundary to enforce the parse
 * deadline. The project's `Clock` satisfies it; only `now()` is needed here
 * because parsing never waits.
 */
export interface CalendarClock {
  now(): number;
}

export interface CalendarParseOptions extends EventScanOptions {
  /** Calendar_File name carried into the Busy_Schedule. */
  readonly fileName: string;
  readonly clock: CalendarClock;
  /** Parse budget in milliseconds (2,000). */
  readonly deadlineMs: number;
  /** At most this many merged blocks are retained (200). */
  readonly maxBlocks: number;
}

/**
 * The outcome of parsing one Calendar_File: a Busy_Schedule, or one of the four
 * failure cases the Catalog_UI reports (Requirements 14.15, 14.16, 14.17).
 *
 * Only `ok` and `truncated` carry a schedule. Every other case carries none, which
 * is what lets the caller keep the schedule it already has (Requirement 14.2).
 */
export type CalendarParseResult =
  | {
      readonly kind: 'ok';
      readonly schedule: BusySchedule;
      readonly skippedEvents: number;
    }
  | {
      readonly kind: 'truncated';
      readonly schedule: BusySchedule;
      readonly skippedEvents: number;
      readonly discardedBlocks: number;
    }
  | { readonly kind: 'invalidCalendar' }
  | { readonly kind: 'noUsableEvents'; readonly skippedEvents: number }
  | { readonly kind: 'timeout'; readonly elapsedMs: number };

/**
 * The calendar this text states, or `null` when it states none: no
 * `BEGIN:VCALENDAR` line, content `ical.js` cannot read, or a root component that
 * is not a calendar (Requirement 14.15).
 */
function readVcalendar(icsText: string): IcalComponent | null {
  if (!/BEGIN:VCALENDAR/i.test(icsText)) return null;

  try {
    const root = new ICAL.Component(ICAL.parse(icsText));
    return root.name === 'vcalendar' ? root : null;
  } catch {
    return null;
  }
}

/**
 * The Busy_Schedule one Calendar_File yields, or the failure case that explains why
 * it yields none (Requirements 14.2, 14.14, 14.15, 14.16, 14.17).
 *
 * Total: every path returns a result and nothing throws.
 *
 * The walk is the generator above, one step per evaluated VEVENT, with elapsed time
 * read at each of those boundaries; crossing `deadlineMs` ends it and discards the
 * partial work rather than running a pathological file to completion
 * (Requirement 14.17). The blocks that survive are merged into canonical order —
 * weekday Monday..Sunday, then `startMinute` ascending — and only then capped, so
 * the retained 200 are a prefix of a deterministic order (Requirement 14.14).
 */
export function parseCalendar(
  icsText: string,
  options: CalendarParseOptions,
): CalendarParseResult {
  const vcalendar = readVcalendar(icsText);
  if (vcalendar === null) return { kind: 'invalidCalendar' };

  const startedAt = options.clock.now();
  const derived: BusyBlock[] = [];
  let skippedEvents = 0;

  for (const outcome of scanVevents(vcalendar, options)) {
    const elapsedMs = options.clock.now() - startedAt;
    if (elapsedMs >= options.deadlineMs) return { kind: 'timeout', elapsedMs };

    if (outcome.skipped) skippedEvents += 1;
    derived.push(...outcome.blocks);
  }

  // `mergeBusyBlocks` returns canonical order, which is the order the cap is a
  // prefix of.
  const merged = mergeBusyBlocks(derived);
  if (merged.length === 0) return { kind: 'noUsableEvents', skippedEvents };

  const maxBlocks = Math.max(0, Math.trunc(options.maxBlocks));
  const retained = merged.slice(0, maxBlocks);
  const discardedBlocks = merged.length - retained.length;

  const schedule: BusySchedule = {
    fileName: options.fileName.slice(0, MAX_SHORT_TEXT_LENGTH),
    loadedAt: options.loadedAt.toISOString(),
    blocks: retained,
    truncated: discardedBlocks > 0,
    discardedBlocks,
  };

  return discardedBlocks > 0
    ? { kind: 'truncated', schedule, skippedEvents, discardedBlocks }
    : { kind: 'ok', schedule, skippedEvents };
}
