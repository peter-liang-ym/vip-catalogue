import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type Dataset,
  type TeamRecord,
} from '../shared/types';
import type { FilterSelections } from './facets';
import { applyFilters } from './filters';
import { buildIndex, search, type ScoredTeam } from './search';

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

function selections(partial: Partial<FilterSelections>): FilterSelections {
  return { college: [], major: [], day: [], advisor: [], ...partial };
}

const robots = team({
  entryId: '1',
  name: 'Robotics Swarm',
  majorsSought: [
    { college: 'Computing', major: 'Computer Science' },
    { college: 'Engineering', major: 'Mechanical Engineering' },
  ],
  advisors: [{ name: 'Ada Lovelace', affiliation: 'GTRI', email: '' }],
  meeting: { day: 'Tue/Thu', time: '9:30-10:20', location: 'Baker 101E' },
});
const reef = team({
  entryId: '2',
  name: 'Coral Reef Health',
  majorsSought: [{ college: ' computing ', major: 'COMPUTER SCIENCE' }],
  advisors: [{ name: 'Grace Hopper', affiliation: 'CoC', email: '' }],
  meeting: { day: 'Monday, Wednesday', time: '3:30 - 4:20', location: '' },
});
const solar = team({
  entryId: '3',
  name: 'Solar Racing',
  majorsSought: [{ college: 'Engineering', major: 'Electrical Engineering' }],
  advisors: [],
  meeting: { day: '', time: '', location: '' },
});

const all = search(buildIndex(dataset([robots, reef, solar])), '');

function ids(results: readonly ScoredTeam[]): readonly string[] {
  return results.map(scored => scored.team.entryId);
}

describe('applyFilters', () => {
  it('returns its input when no filter has a selection', () => {
    expect(applyFilters(all, selections({}))).toBe(all);
  });

  it('ORs the values selected within one filter', () => {
    expect(
      ids(applyFilters(all, selections({ college: ['Computing'] }))),
    ).toEqual(['1', '2']);
    expect(
      ids(
        applyFilters(
          all,
          selections({ college: ['Computing', 'Engineering'] }),
        ),
      ),
    ).toEqual(['1', '2', '3']);
  });

  it('ANDs the filters that have a selection', () => {
    expect(
      ids(
        applyFilters(
          all,
          selections({ college: ['Computing'], advisor: ['Grace Hopper'] }),
        ),
      ),
    ).toEqual(['2']);
    expect(
      ids(
        applyFilters(
          all,
          selections({ college: ['Engineering'], advisor: ['Grace Hopper'] }),
        ),
      ),
    ).toEqual([]);
  });

  it('folds case and surrounding whitespace on both sides', () => {
    expect(
      ids(applyFilters(all, selections({ college: ['  cOmPuTiNg '] }))),
    ).toEqual(['1', '2']);
    expect(
      ids(applyFilters(all, selections({ major: ['computer science'] }))),
    ).toEqual(['1', '2']);
  });

  it('matches the day filter against the weekdays named in the meeting day text', () => {
    expect(ids(applyFilters(all, selections({ day: ['Thursday'] })))).toEqual([
      '1',
    ]);
    expect(ids(applyFilters(all, selections({ day: ['Wednesday'] })))).toEqual([
      '2',
    ]);
    expect(ids(applyFilters(all, selections({ day: ['Sunday'] })))).toEqual([]);
  });

  it('keeps the given order and passes the scored entries through unchanged', () => {
    const scored = search(
      buildIndex(dataset([robots, reef, solar])),
      'computer',
    );
    const kept = applyFilters(scored, selections({ college: ['Computing'] }));
    expect(ids(kept)).toEqual(ids(scored.filter(s => s.team.entryId !== '3')));
    expect(kept).toEqual(scored.filter(s => s.team.entryId !== '3'));
  });
});
