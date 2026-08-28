import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMA_VERSION,
  type Dataset,
  type MajorEntry,
  type TeamRecord,
} from '../shared/types';
import type { FilterSelections } from './facets';
import { pruneOrphanMajors, selectableMajors } from './majors';
import { buildIndex } from './search';

function team(
  entryId: string,
  majorsSought: readonly MajorEntry[],
): TeamRecord {
  return {
    entryId,
    sourceUrl: `https://vip.gatech.edu/teams/entry/${entryId}`,
    name: `Team ${entryId}`,
    imageUrl: '',
    imagePath: '',
    imageAlt: '',
    goals: '',
    issuesAddressed: '',
    partnersSponsors: '',
    methodsTechnologies: '',
    majorsSought,
    preferredInterests: '',
    advisors: [],
    meeting: { day: '', time: '', location: '' },
    meetingWindow: null,
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

const index = buildIndex(
  dataset([
    team('1', [
      { college: 'Computing', major: 'Computer Science' },
      { college: 'Engineering', major: 'Aerospace Engineering' },
    ]),
    team('2', [
      { college: ' computing ', major: 'Computational Media' },
      { college: 'Sciences', major: 'Biology' },
    ]),
  ]),
);

function selections(over: Partial<FilterSelections>): FilterSelections {
  return { college: [], major: [], day: [], advisor: [], ...over };
}

describe('selectableMajors', () => {
  it('offers every distinct major when no college is selected', () => {
    expect(selectableMajors(index, [])).toEqual([
      'Aerospace Engineering',
      'Biology',
      'Computational Media',
      'Computer Science',
    ]);
  });

  it('restricts to the majors paired with the selected colleges, in facet order', () => {
    expect(selectableMajors(index, ['Computing'])).toEqual([
      'Computational Media',
      'Computer Science',
    ]);
    expect(selectableMajors(index, ['Sciences', 'Engineering'])).toEqual([
      'Aerospace Engineering',
      'Biology',
    ]);
  });

  it('folds case and surrounding whitespace on the selected college', () => {
    expect(selectableMajors(index, ['  COMPUTING '])).toEqual([
      'Computational Media',
      'Computer Science',
    ]);
  });

  it('offers nothing for a college the dataset does not pair with majors', () => {
    expect(selectableMajors(index, ['Design'])).toEqual([]);
  });
});

describe('pruneOrphanMajors', () => {
  it('removes exactly the majors no selected college pairs with', () => {
    const pruned = pruneOrphanMajors(
      index,
      selections({
        college: ['Computing'],
        major: ['Computer Science', 'Biology'],
        day: ['Monday'],
        advisor: ['Ada Lovelace'],
      }),
    );

    expect(pruned.major).toEqual(['Computer Science']);
    expect(pruned.college).toEqual(['Computing']);
    expect(pruned.day).toEqual(['Monday']);
    expect(pruned.advisor).toEqual(['Ada Lovelace']);
  });

  it('keeps every dataset major while no college is selected', () => {
    const sel = selections({ major: ['Biology', 'Computer Science'] });
    expect(pruneOrphanMajors(index, sel)).toBe(sel);
  });

  it('drops a selected major the dataset does not hold', () => {
    expect(
      pruneOrphanMajors(index, selections({ major: ['Basket Weaving'] })).major,
    ).toEqual([]);
  });

  it('is idempotent', () => {
    const once = pruneOrphanMajors(
      index,
      selections({
        college: ['Sciences'],
        major: ['Biology', 'Computer Science'],
      }),
    );
    expect(pruneOrphanMajors(index, once)).toEqual(once);
    expect(once.major).toEqual(['Biology']);
  });
});
