import { describe, expect, it } from 'vitest';
import type { ConflictState, TeamRecord } from '../shared/types';
import type { ConflictMap } from './conflicts';
import type { ScoredTeam } from './search';
import { effectiveSort, sortResults } from './sort';

function scored(entryId: string, name: string, score = 0): ScoredTeam {
  const team: TeamRecord = {
    entryId,
    sourceUrl: `https://vip.gatech.edu/teams/entry/${entryId}`,
    name,
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
  };
  return { team, score, nameHit: false };
}

const ids = (rs: readonly ScoredTeam[]): readonly string[] =>
  rs.map(s => s.team.entryId);

const states = (entries: Record<string, ConflictState>): ConflictMap =>
  new Map(Object.entries(entries));

describe('effectiveSort', () => {
  it('defaults to name ascending with an empty query', () => {
    expect(effectiveSort(null, '')).toBe('name-asc');
    expect(effectiveSort(null, '   \t ')).toBe('name-asc');
  });

  it('defaults to relevance with a non-empty query', () => {
    expect(effectiveSort(null, 'robot')).toBe('relevance');
  });

  it('honors every explicit selection regardless of the query', () => {
    expect(effectiveSort('name-desc', '')).toBe('name-desc');
    expect(effectiveSort('relevance', '')).toBe('relevance');
    expect(effectiveSort('name-asc', 'robot')).toBe('name-asc');
    expect(effectiveSort('conflict-free', '')).toBe('conflict-free');
    expect(effectiveSort('conflict-free', 'robot')).toBe('conflict-free');
  });
});

describe('sortResults', () => {
  it('orders by name ignoring case and surrounding whitespace', () => {
    const rs = [
      scored('1', ' zebra '),
      scored('2', 'apple'),
      scored('3', 'Banana'),
    ];
    expect(ids(sortResults(rs, 'name-asc', '', null))).toEqual(['2', '3', '1']);
  });

  it('breaks equal names on entryId ascending, numerically', () => {
    const rs = [
      scored('14350', 'Team'),
      scored('9', ' team '),
      scored('1248', 'TEAM'),
    ];
    expect(ids(sortResults(rs, 'name-asc', '', null))).toEqual([
      '9',
      '1248',
      '14350',
    ]);
  });

  it('orders name-desc as the exact reverse of name-asc', () => {
    const rs = [
      scored('3', 'Beta'),
      scored('1', 'alpha'),
      scored('2', 'ALPHA'),
    ];
    const asc = sortResults(rs, 'name-asc', '', null);
    expect(ids(sortResults(rs, 'name-desc', '', null))).toEqual(
      [...ids(asc)].reverse(),
    );
  });

  it('orders relevance by score descending with an entryId tiebreak', () => {
    const rs = [
      scored('5', 'Alpha', 40),
      scored('2', 'Zulu', 90),
      scored('1', 'Mike', 40),
    ];
    expect(ids(sortResults(rs, 'relevance', 'robot', null))).toEqual([
      '2',
      '1',
      '5',
    ]);
  });

  it('collapses relevance to name ascending when the query is empty', () => {
    const rs = [scored('1', 'Zulu', 90), scored('2', 'Alpha', 10)];
    expect(ids(sortResults(rs, 'relevance', '  ', null))).toEqual(['2', '1']);
  });

  it('is a permutation that leaves the input untouched', () => {
    const rs = [scored('2', 'Beta'), scored('1', 'Alpha')];
    const before = ids(rs);
    expect(ids(sortResults(rs, 'name-desc', '', null))).toEqual(['2', '1']);
    expect(ids(rs)).toEqual(before);
  });

  it('is independent of the input order', () => {
    const a = [scored('2', 'Beta'), scored('1', 'Beta'), scored('3', 'Alpha')];
    const b = [a[2]!, a[0]!, a[1]!];
    expect(ids(sortResults(a, 'name-asc', '', null))).toEqual(
      ids(sortResults(b, 'name-asc', '', null)),
    );
  });

  it('orders conflict-free as clear, then unknown, then conflicting', () => {
    const rs = [
      scored('1', 'Alpha'),
      scored('2', 'Bravo'),
      scored('3', 'Charlie'),
    ];
    const conflicts = states({
      '1': 'conflicting',
      '2': 'unknown',
      '3': 'clear',
    });
    expect(ids(sortResults(rs, 'conflict-free', '', conflicts))).toEqual([
      '3',
      '2',
      '1',
    ]);
  });

  it('orders within each conflict group by name then entryId', () => {
    const rs = [
      scored('9', 'Zulu'),
      scored('14350', ' alpha '),
      scored('1248', 'ALPHA'),
      scored('7', 'Bravo'),
    ];
    const conflicts = states({
      '9': 'clear',
      '14350': 'clear',
      '1248': 'clear',
      '7': 'conflicting',
    });
    expect(ids(sortResults(rs, 'conflict-free', 'robot', conflicts))).toEqual([
      '1248',
      '14350',
      '9',
      '7',
    ]);
  });

  it('groups a team the conflict map omits with the unknown teams', () => {
    const rs = [
      scored('1', 'Alpha'),
      scored('2', 'Bravo'),
      scored('3', 'Charlie'),
    ];
    const conflicts = states({ '1': 'conflicting', '3': 'clear' });
    expect(ids(sortResults(rs, 'conflict-free', '', conflicts))).toEqual([
      '3',
      '2',
      '1',
    ]);
  });

  it('collapses conflict-free to name ascending with no schedule loaded', () => {
    const rs = [scored('1', 'Zulu'), scored('2', 'Alpha'), scored('3', 'Mike')];
    expect(ids(sortResults(rs, 'conflict-free', '', null))).toEqual(
      ids(sortResults(rs, 'name-asc', '', null)),
    );
  });

  it('orders conflict-free independently of the input order', () => {
    const a = [scored('2', 'Beta'), scored('1', 'beta'), scored('3', 'Alpha')];
    const b = [a[2]!, a[0]!, a[1]!];
    const conflicts = states({
      '1': 'clear',
      '2': 'clear',
      '3': 'conflicting',
    });
    expect(ids(sortResults(a, 'conflict-free', '', conflicts))).toEqual(
      ids(sortResults(b, 'conflict-free', '', conflicts)),
    );
  });
});
