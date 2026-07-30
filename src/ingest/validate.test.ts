import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type Dataset,
  type TeamRecord,
} from '../shared/types';
import { checkPublishable, validateDataset } from './validate';

function record(overrides: Partial<TeamRecord> = {}): TeamRecord {
  return {
    entryId: '1248',
    sourceUrl: 'https://vip.gatech.edu/teams/entry/1248',
    name: 'Robotics',
    imageUrl: 'https://vip.gatech.edu/img/1248.png',
    imagePath: '',
    imageAlt: 'team photo',
    goals: 'build robots',
    issuesAddressed: '',
    partnersSponsors: '',
    methodsTechnologies: '',
    majorsSought: [{ college: 'Engineering', major: 'ME' }],
    preferredInterests: '',
    advisors: [],
    meeting: { day: 'Monday', time: '9:30-10:20', location: 'Klaus 1116' },
    meetingWindow: [{ weekday: 'Monday', startMinute: 570, endMinute: 620 }],
    ...overrides,
  };
}

function dataset(teams: readonly TeamRecord[]): Dataset {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt: '2026-01-05T04:30:00Z',
    teamCount: teams.length,
    teams,
  };
}

/** Drops a field the way a drifted Parser would, without loosening the types. */
function without(team: TeamRecord, field: string): TeamRecord {
  const copy: Record<string, unknown> = { ...team };
  delete copy[field];
  return copy as unknown as TeamRecord;
}

function checks(result: ReturnType<typeof validateDataset>): string[] {
  return result.ok ? [] : result.failures.map(failure => failure.check);
}

describe('validateDataset', () => {
  it('accepts a well-formed dataset', () => {
    expect(validateDataset(dataset([record()]))).toEqual({ ok: true });
  });

  it('accepts the unavailable Meeting_Window and a full week of entries', () => {
    expect(validateDataset(dataset([record({ meetingWindow: null })]))).toEqual(
      { ok: true },
    );
    expect(
      validateDataset(
        dataset([
          record({
            meetingWindow: [
              { weekday: 'Monday', startMinute: 0, endMinute: 1 },
              { weekday: 'Tuesday', startMinute: 1439, endMinute: 1440 },
              { weekday: 'Wednesday', startMinute: 540, endMinute: 600 },
              { weekday: 'Thursday', startMinute: 540, endMinute: 600 },
              { weekday: 'Friday', startMinute: 540, endMinute: 600 },
              { weekday: 'Saturday', startMinute: 540, endMinute: 600 },
              { weekday: 'Sunday', startMinute: 540, endMinute: 600 },
            ],
          }),
        ]),
      ),
    ).toEqual({ ok: true });
  });

  it('reports a missing schema version and generation timestamp', () => {
    const bad = {
      ...dataset([record()]),
      schemaVersion: '',
      generatedAt: '  ',
    };
    expect(checks(validateDataset(bad))).toEqual([
      'schemaVersionMissing',
      'generatedAtMissing',
    ]);
  });

  it('reports empty identity fields with the affected entry id', () => {
    const result = validateDataset(
      dataset([record({ name: '   ', sourceUrl: '' })]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toEqual([
      { check: 'nameEmpty', entryId: '1248' },
      { check: 'sourceUrlEmpty', entryId: '1248' },
    ]);
  });

  it('reports a duplicated source entry identifier once', () => {
    expect(checks(validateDataset(dataset([record(), record()])))).toEqual([
      'entryIdDuplicated',
    ]);
  });

  it('reports each absent text, list, and meeting field', () => {
    const result = validateDataset(
      dataset([without(without(record(), 'goals'), 'advisors')]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toEqual([
      { check: 'fieldMissing', entryId: '1248', detail: 'goals' },
      { check: 'fieldMissing', entryId: '1248', detail: 'advisors' },
    ]);
    expect(
      checks(validateDataset(dataset([without(record(), 'meeting')]))),
    ).toEqual(['fieldMissing']);
  });

  it('rejects every malformed Meeting_Window', () => {
    const cases: unknown[] = [
      [],
      [{ weekday: 'Monday', startMinute: 600, endMinute: 600 }],
      [{ weekday: 'Monday', startMinute: -1, endMinute: 600 }],
      [{ weekday: 'Monday', startMinute: 600, endMinute: 1441 }],
      [{ weekday: 'Monday', startMinute: 9.5, endMinute: 600 }],
      [{ weekday: 'Funday', startMinute: 540, endMinute: 600 }],
      [
        { weekday: 'Monday', startMinute: 540, endMinute: 600 },
        { weekday: 'Monday', startMinute: 700, endMinute: 800 },
      ],
    ];

    for (const meetingWindow of cases) {
      expect(
        checks(
          validateDataset(
            dataset([record({ meetingWindow: meetingWindow as never })]),
          ),
        ),
      ).toEqual(['meetingWindowInvalid']);
    }

    expect(
      checks(validateDataset(dataset([without(record(), 'meetingWindow')]))),
    ).toEqual(['meetingWindowInvalid']);
  });
});

describe('checkPublishable', () => {
  it('passes a valid dataset with no previous count', () => {
    expect(checkPublishable(dataset([record()]), undefined)).toEqual({
      ok: true,
    });
  });

  it('rejects a dataset with zero records', () => {
    expect(checks(checkPublishable(dataset([]), undefined))).toEqual([
      'zeroRecords',
    ]);
  });

  it('rejects a count below 80 percent of the previous count and accepts the line', () => {
    const teams = Array.from({ length: 80 }, (_, index) =>
      record({
        entryId: String(index),
        sourceUrl: `https://vip.gatech.edu/teams/entry/${index}`,
      }),
    );
    expect(checkPublishable(dataset(teams), 100)).toEqual({ ok: true });
    expect(checks(checkPublishable(dataset(teams.slice(0, 79)), 100))).toEqual([
      'countDrop',
    ]);
  });

  it('carries the Requirement 3.3 failures through', () => {
    expect(
      checks(checkPublishable(dataset([record({ name: '' })]), 1)),
    ).toEqual(['nameEmpty']);
  });
});
