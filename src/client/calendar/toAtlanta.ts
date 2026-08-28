/**
 * Atlanta wall-clock normalization (Requirements 14.7, 14.10, 14.11, 14.12).
 *
 * Meeting_Window minutes are Atlanta wall-clock minutes read from pages that state
 * no zone, so `America/New_York` local time is the only frame in which a
 * Meeting_Window and a Busy_Block are comparable. Every occurrence is normalized
 * into that frame here, once, when the calendar is parsed.
 *
 * Three cases, from the iCalendar value the occurrence carries:
 *
 * - An explicit `TZID`: the instant is resolved through the file's own `VTIMEZONE`
 *   (`registerCalendarTimezones` below is what makes that possible), then expressed
 *   in Atlanta with `Intl.DateTimeFormat` (Requirement 14.10).
 * - A UTC (`Z`) time: the same offset conversion, from a zero offset
 *   (Requirement 14.10).
 * - A floating time — neither `TZID` nor `Z`: the stated hour and minute are taken
 *   literally as Atlanta local, with no conversion and no dependence on the
 *   visitor's own time zone (Requirement 14.11).
 */

import ICAL from 'ical.js';
import { MINUTES_PER_DAY, WEEKDAYS, type Weekday } from '../../shared/types';

type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalComponent = InstanceType<typeof ICAL.Component>;

export const ATLANTA_TIME_ZONE = 'America/New_York';

const MS_PER_DAY = 86_400_000;

/** 1970-01-01 was a Thursday, index 3 in `WEEKDAYS` (Monday..Sunday). */
const EPOCH_WEEKDAY_INDEX = 3;

const atlantaFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: ATLANTA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** One instant expressed as Atlanta wall time. */
export interface AtlantaWallClock {
  readonly weekday: Weekday;
  /** Integer 0..1439. `1440` is an end-of-day clamp, never a wall-clock reading. */
  readonly minuteOfDay: number;
  /**
   * The Atlanta calendar day as a count of days since 1970-01-01, so that "the end
   * falls on a later Atlanta day" is a plain comparison across month and year
   * boundaries.
   */
  readonly dayNumber: number;
}

/** The minutes one occurrence occupies on the weekday of its start. */
export interface AtlantaInterval {
  readonly weekday: Weekday;
  readonly startMinute: number; // integer 0..1439
  readonly endMinute: number; // integer 1..1440, strictly greater than startMinute
}

/**
 * Makes every `VTIMEZONE` this calendar defines available for `TZID` resolution,
 * and only those.
 *
 * `ical.js` resolves a `TZID` through a process-wide registry that knows nothing
 * but UTC until a `VTIMEZONE` is registered; an unregistered `TZID` silently
 * degrades to a floating time. Resetting first and registering this file's
 * definitions means one file's zones never colour another's, so the same file
 * always parses to the same schedule.
 *
 * Call this before reading any time value out of the calendar.
 */
export function registerCalendarTimezones(vcalendar: IcalComponent): void {
  ICAL.TimezoneService.reset();

  for (const vtimezone of vcalendar.getAllSubcomponents('vtimezone')) {
    const tzid = vtimezone.getFirstPropertyValue('tzid');
    if (typeof tzid !== 'string' || tzid === '') continue;
    ICAL.TimezoneService.register(vtimezone);
  }
}

/** True when the time states neither a `TZID` nor a UTC designator. */
function isFloating(time: IcalTime): boolean {
  return time.zone.tzid === ICAL.Timezone.localTimezone.tzid;
}

function wallClock(
  year: number,
  month: number, // 1..12
  day: number,
  hour: number,
  minute: number,
): AtlantaWallClock {
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
  const index = (((dayNumber + EPOCH_WEEKDAY_INDEX) % 7) + 7) % 7;

  return {
    // `index` is 0..6 by construction, so the lookup always lands.
    weekday: WEEKDAYS[index]!,
    minuteOfDay: hour * 60 + minute,
    dayNumber,
  };
}

/** The Atlanta wall time of an absolute instant, via `Intl.DateTimeFormat`. */
export function atlantaWallClockOf(instant: Date): AtlantaWallClock {
  const parts = new Map(
    atlantaFormat.formatToParts(instant).map(part => [part.type, part.value]),
  );
  const read = (type: Intl.DateTimeFormatPart['type']): number =>
    Number(parts.get(type));

  return wallClock(
    read('year'),
    read('month'),
    read('day'),
    read('hour'),
    read('minute'),
  );
}

/**
 * The Atlanta wall time of one occurrence time: converted for a `TZID` or UTC
 * value, taken literally for a floating one.
 */
export function toAtlantaWallClock(time: IcalTime): AtlantaWallClock {
  if (isFloating(time)) {
    return wallClock(time.year, time.month, time.day, time.hour, time.minute);
  }

  return atlantaWallClockOf(time.toJSDate());
}

/**
 * The Busy_Block minutes for one occurrence, on the weekday of its Atlanta start,
 * or `null` when the occurrence cannot yield a well-formed block.
 *
 * When the end falls on a later Atlanta calendar day, `endMinute` is clamped to
 * `1440` on the start weekday and nothing is derived on any later weekday, so a
 * Tuesday 23:00–01:00 event is Tuesday 1380–1440 and nothing on Wednesday
 * (Requirement 14.12).
 *
 * `null` covers the occurrences that no interval can represent: an end at or
 * before the start on the same Atlanta day, which would violate the Busy_Block
 * invariant `startMinute < endMinute`.
 */
export function toAtlantaInterval(
  start: IcalTime,
  end: IcalTime,
): AtlantaInterval | null {
  const from = toAtlantaWallClock(start);
  const to = toAtlantaWallClock(end);

  if (to.dayNumber > from.dayNumber) {
    return {
      weekday: from.weekday,
      startMinute: from.minuteOfDay,
      endMinute: MINUTES_PER_DAY,
    };
  }

  if (to.dayNumber < from.dayNumber || to.minuteOfDay <= from.minuteOfDay) {
    return null;
  }

  return {
    weekday: from.weekday,
    startMinute: from.minuteOfDay,
    endMinute: to.minuteOfDay,
  };
}
