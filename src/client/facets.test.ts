import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type Dataset,
  type TeamRecord,
} from '../shared/types';
import { deriveFacetValues, foldValue } from './facets';

function team(
  overrides: Partial<TeamRecord> & { entryId: string },
): TeamRecord {
  return {
    sourceUrl: `https://vip.gatech.edu/teams/entry/${overrides.entryId}`,
    name: 'Team',
    imageUrl: '',
    imagePath: '',
    imageAlt: '',
    goals: '',
    issuesAddressed: '',
    partnersSponsors: '',
    methodsTechnologies: '',
    majorsSought: [],
    preferredInterests: '',
    advisors: [],
    meeting: { day: '', time: '', location: '' },
    meetingWindow: null,
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

const facets = deriveFacetValues(
  dataset([
    team({
      entryId: '1',
      majorsSought: [
        { college: 'Computing', major: 'Computer Science' },
        { college: 'Engineering', major: 'Mechanical Engineering' },
        { college: '', major: 'Orphan Major' },
      ],
      advisors: [{ name: 'Ada Lovelace', affiliation: '', email: '' }],
      meeting: { day: 'Wednesday, Monday', time: '', location: '' },
    }),
    team({
      entryId: '2',
      majorsSought: [
        { college: ' computing ', major: ' computer science ' },
        { college: 'COMPUTING', major: 'Computational Media' },
      ],
      advisors: [
        { name: ' ada lovelace ', affiliation: '', email: '' },
        { name: 'Alan Turing', affiliation: '', email: '' },
        { name: '  ', affiliation: '', email: '' },
      ],
      meeting: { day: 'Tue/Thu', time: '', location: '' },
    }),
  ]),
);

describe('foldValue', () => {
  it('folds case and surrounding whitespace', () => {
    expect(foldValue('  Computing ')).toBe('computing');
    expect(foldValue('   ')).toBe('');
  });
});

describe('deriveFacetValues', () => {
  it('keeps distinct folded values with the first spelling encountered', () => {
    expect(facets.college).toEqual(['Computing', 'Engineering']);
    expect(facets.advisor).toEqual(['Ada Lovelace', 'Alan Turing']);
  });

  it('orders college, major, and advisor ascending by locale comparison', () => {
    expect(facets.major).toEqual([
      'Computational Media',
      'Computer Science',
      'Mechanical Engineering',
      'Orphan Major',
    ]);
  });

  it('orders the day values Monday..Sunday over the named weekdays', () => {
    expect(facets.day).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday']);
  });

  it('pairs majors with their college, keyed by the folded college', () => {
    expect(facets.majorsByCollege.get('computing')).toEqual([
      'Computational Media',
      'Computer Science',
    ]);
    expect(facets.majorsByCollege.get('engineering')).toEqual([
      'Mechanical Engineering',
    ]);
    expect(facets.majorsByCollege.has('')).toBe(false);
  });
});
