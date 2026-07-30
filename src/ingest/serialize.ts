/**
 * Dataset serialization (Requirements 3.1, 3.2).
 *
 * `serialize` writes the Dataset as one JSON document with `schemaVersion`,
 * a second-precision UTC `generatedAt`, `teamCount`, and one entry per
 * Team_Record. Every object is rebuilt field by field rather than handed to
 * `JSON.stringify` as-is, so the key order of the output depends only on this
 * module and not on the order in which the Parser happened to assign fields: a
 * re-run over unchanged source produces a byte-identical file.
 *
 * Array order is the input order throughout — teams, `majorsSought`, `advisors`,
 * and the `meetingWindow` entries the derivation already emitted in Monday..Sunday
 * order — which is what makes the round trip in Requirement 3.2 hold.
 */

import {
  DATASET_SCHEMA_VERSION,
  type Advisor,
  type Dataset,
  type MajorEntry,
  type MeetingInfo,
  type MeetingWindow,
  type MeetingWindowEntry,
  type TeamRecord,
} from '../shared/types';

/**
 * ISO 8601 in UTC with second precision: `2026-01-05T04:30:00Z`. Milliseconds are
 * dropped rather than rounded, so the timestamp never reads ahead of the clock.
 */
function formatGeneratedAt(generatedAt: Date): string {
  return generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function orderMajorEntry(entry: MajorEntry): MajorEntry {
  return { college: entry.college, major: entry.major };
}

function orderAdvisor(advisor: Advisor): Advisor {
  return {
    name: advisor.name,
    affiliation: advisor.affiliation,
    email: advisor.email,
  };
}

function orderMeeting(meeting: MeetingInfo): MeetingInfo {
  return {
    day: meeting.day,
    time: meeting.time,
    location: meeting.location,
  };
}

function orderMeetingWindowEntry(
  entry: MeetingWindowEntry,
): MeetingWindowEntry {
  return {
    weekday: entry.weekday,
    startMinute: entry.startMinute,
    endMinute: entry.endMinute,
  };
}

/** `null` stays `null`: unavailable is never spelled as an empty list. */
function orderMeetingWindow(window: MeetingWindow): MeetingWindow {
  return window === null ? null : window.map(orderMeetingWindowEntry);
}

function orderRecord(record: TeamRecord): TeamRecord {
  return {
    entryId: record.entryId,
    sourceUrl: record.sourceUrl,
    name: record.name,
    imageUrl: record.imageUrl,
    imagePath: record.imagePath,
    imageAlt: record.imageAlt,
    goals: record.goals,
    issuesAddressed: record.issuesAddressed,
    partnersSponsors: record.partnersSponsors,
    methodsTechnologies: record.methodsTechnologies,
    majorsSought: record.majorsSought.map(orderMajorEntry),
    preferredInterests: record.preferredInterests,
    advisors: record.advisors.map(orderAdvisor),
    meeting: orderMeeting(record.meeting),
    meetingWindow: orderMeetingWindow(record.meetingWindow),
  };
}

/** Builds the Dataset value that `serialize` writes. */
export function buildDataset(
  records: readonly TeamRecord[],
  generatedAt: Date,
): Dataset {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt: formatGeneratedAt(generatedAt),
    teamCount: records.length,
    teams: records.map(orderRecord),
  };
}

/**
 * Serializes the collection of Team_Records into the Dataset JSON document.
 *
 * Indented output with a trailing newline: the file is committed alongside the
 * site, so a readable diff is worth the handful of extra bytes before
 * compression.
 */
export function serialize(
  records: readonly TeamRecord[],
  generatedAt: Date,
): string {
  return `${JSON.stringify(buildDataset(records, generatedAt), null, 2)}\n`;
}

/**
 * Reads a Dataset back out of its JSON document.
 *
 * No checking happens here — `validateDataset` is what decides whether a parsed
 * Dataset is fit to publish or to render.
 */
export function deserialize(json: string): Dataset {
  return JSON.parse(json) as Dataset;
}
