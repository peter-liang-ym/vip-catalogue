import { describe, expect, it } from 'vitest';
import { DATASET_SCHEMA_VERSION, type TeamRecord } from '../shared/types';
import { deserialize, serialize } from './serialize';

const record: TeamRecord = {
  entryId: '1248',
  sourceUrl: 'https://vip.gatech.edu/teams/entry/1248',
  name: 'Additive Manufacturing',
  imageUrl: 'https://vip.gatech.edu/files/formidable/am.png',
  imagePath: 'images/1248.png',
  imageAlt: 'Team photo',
  goals: 'Line one\nLine "two" \\ three',
  issuesAddressed: 'Issues',
  partnersSponsors: 'GTRI',
  methodsTechnologies: 'Métodos 🚀',
  majorsSought: [
    { college: 'Engineering', major: 'Mechanical Engineering' },
    { college: 'Computing', major: 'Computer Science' },
  ],
  preferredInterests: 'Interests',
  advisors: [
    {
      name: 'Brent Wagner',
      affiliation: 'Georgia Tech Research Institute',
      email: 'brent.wagner@gtri.gatech.edu',
    },
  ],
  meeting: { day: 'Thursday', time: '9:30-10:20', location: 'Baker 101E' },
  meetingWindow: [{ weekday: 'Thursday', startMinute: 570, endMinute: 620 }],
};

const unavailable: TeamRecord = {
  ...record,
  entryId: '14350',
  sourceUrl: 'https://vip.gatech.edu/teams/entry/14350',
  name: 'Robotics',
  imageUrl: '',
  imagePath: '',
  imageAlt: '',
  majorsSought: [],
  advisors: [],
  meeting: { day: '', time: '', location: '' },
  meetingWindow: null,
};

const generatedAt = new Date('2026-01-05T04:30:00.789Z');

describe('serialize', () => {
  it('writes the schema version, second-precision UTC timestamp, and count', () => {
    const dataset = deserialize(serialize([record, unavailable], generatedAt));

    expect(dataset.schemaVersion).toBe(DATASET_SCHEMA_VERSION);
    expect(dataset.generatedAt).toBe('2026-01-05T04:30:00Z');
    expect(dataset.teamCount).toBe(2);
    expect(dataset.teams).toHaveLength(2);
  });

  it('writes an empty collection with a zero count', () => {
    const dataset = deserialize(serialize([], generatedAt));

    expect(dataset.teamCount).toBe(0);
    expect(dataset.teams).toEqual([]);
  });

  it('round-trips every field, element order, and the unavailable window', () => {
    const dataset = deserialize(serialize([record, unavailable], generatedAt));

    expect(dataset.teams[0]).toEqual(record);
    expect(dataset.teams[1]).toEqual(unavailable);
    expect(dataset.teams[1]?.meetingWindow).toBeNull();
  });

  it('orders fields and arrays deterministically regardless of input key order', () => {
    const reordered: TeamRecord = {
      meetingWindow: record.meetingWindow,
      meeting: record.meeting,
      advisors: record.advisors,
      preferredInterests: record.preferredInterests,
      majorsSought: record.majorsSought,
      methodsTechnologies: record.methodsTechnologies,
      partnersSponsors: record.partnersSponsors,
      issuesAddressed: record.issuesAddressed,
      goals: record.goals,
      imageAlt: record.imageAlt,
      imagePath: record.imagePath,
      imageUrl: record.imageUrl,
      name: record.name,
      sourceUrl: record.sourceUrl,
      entryId: record.entryId,
    };

    expect(serialize([reordered], generatedAt)).toBe(
      serialize([record], generatedAt),
    );
  });
});
