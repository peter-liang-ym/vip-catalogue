import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import {
  registerCalendarTimezones,
  toAtlantaInterval,
  toAtlantaWallClock,
} from './toAtlanta';

/** A `VTIMEZONE` for Pacific time, so `TZID` resolution has a real zone to use. */
const PACIFIC_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'BEGIN:STANDARD',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
].join('\r\n');

function calendar(...lines: string[]): InstanceType<typeof ICAL.Component> {
  const text = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    ...lines,
    'END:VCALENDAR',
  ].join('\r\n');

  return new ICAL.Component(ICAL.parse(text));
}

/** The `DTSTART` of a VEVENT stated with the given value, read from a real file. */
function dtstart(dtstartLine: string, ...extra: string[]) {
  const vcalendar = calendar(
    ...extra,
    'BEGIN:VEVENT',
    'UID:1',
    'SUMMARY:Class',
    dtstartLine,
    'END:VEVENT',
  );
  registerCalendarTimezones(vcalendar);

  const vevent = vcalendar.getFirstSubcomponent('vevent')!;
  return vevent.getFirstPropertyValue('dtstart') as InstanceType<
    typeof ICAL.Time
  >;
}

function floating(value: string) {
  return ICAL.Time.fromDateTimeString(value);
}

function utc(value: string) {
  return ICAL.Time.fromDateTimeString(`${value}Z`);
}

describe('toAtlantaWallClock', () => {
  it('takes a floating time literally, without conversion (14.11)', () => {
    expect(toAtlantaWallClock(floating('2026-02-10T14:30:00'))).toEqual({
      weekday: 'Tuesday',
      minuteOfDay: 870,
      dayNumber: 20494,
    });
  });

  it('converts a UTC time to Atlanta, including across the weekday boundary (14.10)', () => {
    // 2026-02-10T02:00Z is 2026-02-09T21:00 in Atlanta: Monday, not Tuesday.
    const wall = toAtlantaWallClock(utc('2026-02-10T02:00:00'));

    expect(wall.weekday).toBe('Monday');
    expect(wall.minuteOfDay).toBe(21 * 60);
  });

  it('applies the Atlanta offset in force on the date, not a fixed one (14.10)', () => {
    // Same UTC clock time either side of the spring transition: EST then EDT.
    expect(toAtlantaWallClock(utc('2026-02-15T15:00:00')).minuteOfDay).toBe(
      600,
    );
    expect(toAtlantaWallClock(utc('2026-03-15T15:00:00')).minuteOfDay).toBe(
      660,
    );
  });

  it('converts a TZID time through the calendar VTIMEZONE (14.10)', () => {
    // 09:00 Pacific in February is PST (-0800), so 12:00 Atlanta (EST).
    const wall = toAtlantaWallClock(
      dtstart(
        'DTSTART;TZID=America/Los_Angeles:20260210T090000',
        PACIFIC_VTIMEZONE,
      ),
    );

    expect(wall).toMatchObject({ weekday: 'Tuesday', minuteOfDay: 720 });
  });

  it('converts a UTC-designated DTSTART read from a file', () => {
    const wall = toAtlantaWallClock(dtstart('DTSTART:20260210T140000Z'));

    expect(wall).toMatchObject({ weekday: 'Tuesday', minuteOfDay: 540 });
  });

  it('treats a DTSTART with no TZID and no Z as Atlanta local (14.11)', () => {
    const wall = toAtlantaWallClock(dtstart('DTSTART:20260210T140000'));

    expect(wall).toMatchObject({ weekday: 'Tuesday', minuteOfDay: 840 });
  });

  it('derives the weekday from the Atlanta calendar date', () => {
    const weekdays = [
      '2026-02-09T09:00:00',
      '2026-02-10T09:00:00',
      '2026-02-11T09:00:00',
      '2026-02-12T09:00:00',
      '2026-02-13T09:00:00',
      '2026-02-14T09:00:00',
      '2026-02-15T09:00:00',
    ].map(value => toAtlantaWallClock(floating(value)).weekday);

    expect(weekdays).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
  });
});

describe('registerCalendarTimezones', () => {
  it('makes the calendar VTIMEZONE available for TZID lookup', () => {
    registerCalendarTimezones(calendar(PACIFIC_VTIMEZONE));

    const time = ICAL.Time.fromData({
      year: 2026,
      month: 2,
      day: 10,
      hour: 9,
      minute: 0,
      second: 0,
      timezone: 'America/Los_Angeles',
    });

    expect(toAtlantaWallClock(time).minuteOfDay).toBe(720);
  });

  it('drops the zones of a previously parsed calendar', () => {
    registerCalendarTimezones(calendar(PACIFIC_VTIMEZONE));
    registerCalendarTimezones(calendar());

    // With no definition for the TZID, the time is floating and read literally.
    const time = ICAL.Time.fromData({
      year: 2026,
      month: 2,
      day: 10,
      hour: 9,
      minute: 0,
      second: 0,
      timezone: 'America/Los_Angeles',
    });

    expect(toAtlantaWallClock(time).minuteOfDay).toBe(540);
  });
});

describe('toAtlantaInterval', () => {
  it('computes the minutes of day of a same-day occurrence (14.7)', () => {
    expect(
      toAtlantaInterval(
        floating('2026-02-10T09:00:00'),
        floating('2026-02-10T10:20:00'),
      ),
    ).toEqual({ weekday: 'Tuesday', startMinute: 540, endMinute: 620 });
  });

  it('clamps to 1440 on the start weekday when the end falls on a later day (14.12)', () => {
    expect(
      toAtlantaInterval(
        floating('2026-02-10T23:00:00'),
        floating('2026-02-11T01:00:00'),
      ),
    ).toEqual({ weekday: 'Tuesday', startMinute: 1380, endMinute: 1440 });
  });

  it('clamps an end at exactly midnight (14.12)', () => {
    expect(
      toAtlantaInterval(
        floating('2026-02-10T22:00:00'),
        floating('2026-02-11T00:00:00'),
      ),
    ).toEqual({ weekday: 'Tuesday', startMinute: 1320, endMinute: 1440 });
  });

  it('clamps across a month boundary (14.12)', () => {
    expect(
      toAtlantaInterval(
        floating('2026-01-31T23:30:00'),
        floating('2026-02-01T00:30:00'),
      ),
    ).toEqual({ weekday: 'Saturday', startMinute: 1410, endMinute: 1440 });
  });

  it('clamps when only the Atlanta day differs, not the stated one (14.10, 14.12)', () => {
    // 2026-02-10T04:30Z ends 2026-02-09T23:30 Atlanta, the same Atlanta day as a
    // start of 2026-02-10T02:00Z (2026-02-09T21:00), so nothing is clamped.
    expect(
      toAtlantaInterval(utc('2026-02-10T02:00:00'), utc('2026-02-10T04:30:00')),
    ).toEqual({ weekday: 'Monday', startMinute: 1260, endMinute: 1410 });

    // 2026-02-10T06:00Z is 2026-02-10T01:00 Atlanta: a later Atlanta day.
    expect(
      toAtlantaInterval(utc('2026-02-10T02:00:00'), utc('2026-02-10T06:00:00')),
    ).toEqual({ weekday: 'Monday', startMinute: 1260, endMinute: 1440 });
  });

  it('yields no interval when the end does not follow the start', () => {
    expect(
      toAtlantaInterval(
        floating('2026-02-10T09:00:00'),
        floating('2026-02-10T09:00:00'),
      ),
    ).toBeNull();

    expect(
      toAtlantaInterval(
        floating('2026-02-10T09:00:00'),
        floating('2026-02-09T09:00:00'),
      ),
    ).toBeNull();
  });
});
