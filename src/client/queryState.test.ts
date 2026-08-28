import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUERY_STATE,
  QUERY_PARAMS,
  encodeQueryState,
  type QueryState,
} from './queryState';
import { EMPTY_SELECTIONS } from './selections';

const state = (over: Partial<QueryState> = {}): QueryState => ({
  ...DEFAULT_QUERY_STATE,
  ...over,
});

const paramNames = (encoded: string): readonly string[] => [
  ...new URLSearchParams(encoded).keys(),
];

describe('DEFAULT_QUERY_STATE', () => {
  it('is an empty query, no selections, no sort, the toggle off, page 1, and 24 cards', () => {
    expect(DEFAULT_QUERY_STATE).toEqual({
      query: '',
      filters: EMPTY_SELECTIONS,
      sort: null,
      hideConflicts: false,
      pageNumber: 1,
      pageSize: 24,
    });
  });
});

describe('encodeQueryState', () => {
  it('encodes the default Query_State as an empty string', () => {
    expect(encodeQueryState(DEFAULT_QUERY_STATE)).toBe('');
  });

  it('omits every parameter that holds its default value', () => {
    const encoded = encodeQueryState(
      state({ query: 'reef', sort: null, pageNumber: 1, pageSize: 24 }),
    );
    expect(encoded).toBe('?q=reef');
  });

  it('encodes non-default sort, page, and size', () => {
    expect(
      encodeQueryState(
        state({ sort: 'name-desc', pageNumber: 2, pageSize: 48 }),
      ),
    ).toBe('?sort=name-desc&page=2&size=48');
  });

  it('encodes the hide-conflicts toggle as hc=1 and omits it when off', () => {
    expect(encodeQueryState(state({ hideConflicts: true }))).toBe('?hc=1');
    expect(encodeQueryState(state({ hideConflicts: false }))).toBe('');
  });

  it('encodes the conflict-free Sort_Option', () => {
    expect(encodeQueryState(state({ sort: 'conflict-free' }))).toBe(
      '?sort=conflict-free',
    );
  });

  it('encodes the all page size as size=all', () => {
    expect(encodeQueryState(state({ pageSize: 'all' }))).toBe('?size=all');
    expect(encodeQueryState(state({ pageSize: 12 }))).toBe('?size=12');
  });

  it('repeats a multi-valued filter parameter, preserving order', () => {
    const encoded = encodeQueryState(
      state({
        filters: { ...EMPTY_SELECTIONS, college: ['Engineering', 'Computing'] },
      }),
    );
    expect(encoded).toBe('?college=Engineering&college=Computing');
    expect(new URLSearchParams(encoded).getAll('college')).toEqual([
      'Engineering',
      'Computing',
    ]);
  });

  it('keeps filter values verbatim through percent-encoding', () => {
    const values = ['Arts, Media & Design', '100% Design', 'Sciences—Bío'];
    const encoded = encodeQueryState(
      state({ filters: { ...EMPTY_SELECTIONS, major: values } }),
    );
    expect(new URLSearchParams(encoded).getAll('major')).toEqual(values);
  });

  it('writes each filter under its own parameter name', () => {
    const encoded = encodeQueryState(
      state({
        filters: {
          college: ['Computing'],
          major: ['CS'],
          day: ['Monday'],
          advisor: ['Ada Lovelace'],
        },
      }),
    );
    const params = new URLSearchParams(encoded);
    expect(params.get('college')).toBe('Computing');
    expect(params.get('major')).toBe('CS');
    expect(params.get('day')).toBe('Monday');
    expect(params.get('advisor')).toBe('Ada Lovelace');
  });

  it('produces only known parameter names (Requirement 8.9)', () => {
    const encoded = encodeQueryState(
      state({
        query: 'reef',
        filters: { ...EMPTY_SELECTIONS, day: ['Monday', 'Wednesday'] },
        sort: 'conflict-free',
        hideConflicts: true,
        pageNumber: 7,
        pageSize: 'all',
      }),
    );
    for (const name of paramNames(encoded)) {
      expect(QUERY_PARAMS).toContain(name);
    }
  });
});
