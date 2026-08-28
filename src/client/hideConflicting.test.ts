import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type ConflictState,
  type Dataset,
  type TeamRecord,
} from '../shared/types';
import type { ConflictMap } from './conflicts';
import { hideConflicting } from './hideConflicting';
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

function conflictMap(entries: Record<string, ConflictState>): ConflictMap {
  return new Map(Object.entries(entries));
}

function ids(results: readonly ScoredTeam[]): readonly string[] {
  return results.map(scored => scored.team.entryId);
}

const clear = team({ entryId: '1', name: 'Robotics Swarm' });
const conflicting = team({ entryId: '2', name: 'Coral Reef Health' });
const unknown = team({ entryId: '3', name: 'Solar Racing' });
const conflictingToo = team({ entryId: '4', name: 'Wind Tunnel' });

const all = search(
  buildIndex(dataset([clear, conflicting, unknown, conflictingToo])),
  '',
);

const conflicts = conflictMap({
  '1': 'clear',
  '2': 'conflicting',
  '3': 'unknown',
  '4': 'conflicting',
});

describe('hideConflicting', () => {
  it('removes exactly the conflicting teams and reports the count', () => {
    const { kept, removed } = hideConflicting(all, conflicts, true);
    expect(ids(kept)).toEqual(['1', '3']);
    expect(removed).toBe(2);
  });

  it('reports zero and keeps everything when nothing conflicts', () => {
    const { kept, removed } = hideConflicting(
      all,
      conflictMap({ '1': 'clear', '2': 'clear', '3': 'unknown', '4': 'clear' }),
      true,
    );
    expect(ids(kept)).toEqual(['1', '2', '3', '4']);
    expect(removed).toBe(0);
  });

  it('is a no-op returning its input and 0 when the toggle is off', () => {
    const { kept, removed } = hideConflicting(all, conflicts, false);
    expect(kept).toBe(all);
    expect(removed).toBe(0);
  });

  it('is a no-op returning its input and 0 when no schedule is loaded', () => {
    const { kept, removed } = hideConflicting(all, null, true);
    expect(kept).toBe(all);
    expect(removed).toBe(0);
  });

  it('keeps a team that the conflict map does not mention', () => {
    const { kept, removed } = hideConflicting(
      all,
      conflictMap({ '2': 'conflicting' }),
      true,
    );
    expect(ids(kept)).toEqual(['1', '3', '4']);
    expect(removed).toBe(1);
  });

  it('keeps the given order and passes the scored entries through unchanged', () => {
    const scored = search(
      buildIndex(dataset([clear, conflicting, unknown, conflictingToo])),
      'r',
    );
    const { kept } = hideConflicting(scored, conflicts, true);
    expect(kept).toEqual(
      scored.filter(s => conflicts.get(s.team.entryId) !== 'conflicting'),
    );
  });

  it('handles an empty result set', () => {
    expect(hideConflicting([], conflicts, true)).toEqual({
      kept: [],
      removed: 0,
    });
  });
});
