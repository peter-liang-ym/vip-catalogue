import { describe, expect, it } from 'vitest';
import type { FilterSelections } from './facets';
import {
  CLEAR_ALL_RESET,
  EMPTY_SELECTIONS,
  addSelection,
  clearAllSelections,
  removeSelection,
} from './selections';

function selections(over: Partial<FilterSelections>): FilterSelections {
  return { college: [], major: [], day: [], advisor: [], ...over };
}

describe('addSelection', () => {
  it('appends the value and leaves every other filter untouched', () => {
    const added = addSelection(
      selections({ college: ['Computing'], day: ['Monday'] }),
      'college',
      'Sciences',
    );

    expect(added.college).toEqual(['Computing', 'Sciences']);
    expect(added.day).toEqual(['Monday']);
    expect(added.major).toEqual([]);
    expect(added.advisor).toEqual([]);
  });

  it('is a no-op for a value already selected under another spelling', () => {
    const sel = selections({ major: ['Computer Science'] });
    expect(addSelection(sel, 'major', ' COMPUTER science ')).toBe(sel);
  });
});

describe('removeSelection', () => {
  it('deselects only that value and retains every other selection', () => {
    const removed = removeSelection(
      selections({
        college: ['Computing', 'Sciences'],
        major: ['Biology'],
        day: ['Monday', 'Wednesday'],
        advisor: ['Ada Lovelace'],
      }),
      'day',
      'Monday',
    );

    expect(removed.day).toEqual(['Wednesday']);
    expect(removed.college).toEqual(['Computing', 'Sciences']);
    expect(removed.major).toEqual(['Biology']);
    expect(removed.advisor).toEqual(['Ada Lovelace']);
  });

  it('folds case and surrounding whitespace on the removed value', () => {
    const removed = removeSelection(
      selections({ advisor: ['Ada Lovelace', 'Alan Turing'] }),
      'advisor',
      '  alan TURING ',
    );

    expect(removed.advisor).toEqual(['Ada Lovelace']);
  });

  it('is a no-op when the value is not selected', () => {
    const sel = selections({ college: ['Computing'] });
    expect(removeSelection(sel, 'college', 'Design')).toBe(sel);
    expect(removeSelection(sel, 'major', 'Computing')).toBe(sel);
  });
});

describe('clear-all', () => {
  it('deselects every value in every filter', () => {
    expect(clearAllSelections()).toEqual(EMPTY_SELECTIONS);
    expect(EMPTY_SELECTIONS).toEqual({
      college: [],
      major: [],
      day: [],
      advisor: [],
    });
  });

  it('resets the query and the hide-conflicts toggle with the selections', () => {
    expect(CLEAR_ALL_RESET).toEqual({
      query: '',
      filters: EMPTY_SELECTIONS,
      hideConflicts: false,
    });
  });

  it('leaves the fields it does not name for the caller to keep', () => {
    const current = {
      query: 'robot',
      filters: selections({ college: ['Computing'] }),
      sort: 'name-desc',
      hideConflicts: true,
      pageNumber: 3,
      pageSize: 48,
    };

    expect({ ...current, ...CLEAR_ALL_RESET }).toEqual({
      query: '',
      filters: EMPTY_SELECTIONS,
      sort: 'name-desc',
      hideConflicts: false,
      pageNumber: 3,
      pageSize: 48,
    });
  });
});
