import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type Dataset,
  type TeamRecord,
} from '../shared/types';
import { buildIndex, clampQuery, search, terms } from './search';

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

const robots = team({
  entryId: '1',
  name: 'Robotics Swarm',
  goals: 'Build swarm robotics for search and rescue.',
  majorsSought: [{ college: 'Computing', major: 'Computer Science' }],
  advisors: [{ name: 'Ada Lovelace', affiliation: 'GTRI', email: '' }],
});
const reef = team({
  entryId: '2',
  name: 'Coral Reef Health',
  goals: 'Monitor reef ecosystems with autonomous sensors.',
  methodsTechnologies: 'Robotics platforms and computer vision.',
});
const index = buildIndex(dataset([robots, reef]));

describe('terms', () => {
  it('splits on whitespace, drops empties, and lowercases', () => {
    expect(terms('  Swarm   ROBOTICS \n rescue ')).toEqual([
      'swarm',
      'robotics',
      'rescue',
    ]);
    expect(terms('   ')).toEqual([]);
  });
});

describe('buildIndex', () => {
  it('lowercases the haystack and the name, and keys by entry id', () => {
    expect(index.nameText).toEqual(['robotics swarm', 'coral reef health']);
    expect(index.searchText[0]).toContain('ada lovelace');
    expect(index.searchText[0]).toContain('computer science');
    expect(index.byEntryId.get('2')).toBe(reef);
  });
});

describe('search', () => {
  it('returns every team with score 0 for a whitespace-only query', () => {
    const results = search(index, ' \t ');
    expect(results.map(r => r.team.entryId)).toEqual(['1', '2']);
    expect(results.every(r => r.score === 0 && !r.nameHit)).toBe(true);
  });

  it('is conjunctive and case-insensitive', () => {
    expect(search(index, 'ROBOTICS').map(r => r.team.entryId)).toEqual([
      '1',
      '2',
    ]);
    expect(search(index, 'robotics reef').map(r => r.team.entryId)).toEqual([
      '2',
    ]);
    expect(search(index, 'robotics nothing')).toEqual([]);
  });

  it('scores name hits above non-name hits, within 0..100', () => {
    const [swarm, coral] = [
      search(index, 'robotics')[0]!,
      search(index, 'robotics')[1]!,
    ];
    expect(swarm.nameHit).toBe(true);
    expect(coral.nameHit).toBe(false);
    expect(swarm.score).toBeGreaterThan(coral.score);
    expect(swarm.score).toBeLessThanOrEqual(100);
    expect(coral.score).toBeGreaterThanOrEqual(0);
    expect(swarm.score).toBeGreaterThanOrEqual(60);
    expect(coral.score).toBeLessThan(60);
  });
});

describe('clampQuery', () => {
  it('keeps the first 200 characters and is the identity below the cap', () => {
    expect(clampQuery('reef')).toBe('reef');
    const long = 'a'.repeat(250);
    expect(clampQuery(long)).toBe('a'.repeat(200));
  });
});
