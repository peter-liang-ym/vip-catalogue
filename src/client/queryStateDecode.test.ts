import { describe, expect, it } from 'vitest';
import type { FacetValues } from './facets';
import {
  DEFAULT_QUERY_STATE,
  encodeQueryState,
  type QueryState,
} from './queryState';
import { decodeQueryState } from './queryStateDecode';
import { EMPTY_SELECTIONS } from './selections';

const state = (over: Partial<QueryState> = {}): QueryState => ({
  ...DEFAULT_QUERY_STATE,
  ...over,
});

const facets: FacetValues = {
  college: ['Computing', 'Engineering'],
  major: ['Arts, Media & Design', 'Computer Science'],
  day: ['Monday', 'Wednesday'],
  advisor: ['Ada Lovelace'],
  majorsByCollege: new Map([['computing', ['Computer Science']]]),
};

describe('decodeQueryState', () => {
  it('decodes an empty address as the default Query_State', () => {
    expect(decodeQueryState('')).toEqual(DEFAULT_QUERY_STATE);
    expect(decodeQueryState('?')).toEqual(DEFAULT_QUERY_STATE);
  });

  it('applies the default for every absent parameter', () => {
    expect(decodeQueryState('?q=reef')).toEqual(state({ query: 'reef' }));
  });

  it('reads a query string with or without its leading question mark', () => {
    expect(decodeQueryState('page=3')).toEqual(state({ pageNumber: 3 }));
    expect(decodeQueryState('?page=3')).toEqual(state({ pageNumber: 3 }));
  });

  it('inverts encodeQueryState over a fully populated Query_State', () => {
    const original = state({
      query: 'coral reef',
      filters: {
        college: ['Engineering', 'Computing'],
        major: ['Arts, Media & Design', '100% Bío'],
        day: ['Monday'],
        advisor: ['Ada Lovelace'],
      },
      sort: 'name-desc',
      hideConflicts: true,
      pageNumber: 7,
      pageSize: 'all',
    });

    expect(decodeQueryState(encodeQueryState(original))).toEqual(original);
  });

  it('round-trips both toggle settings and the conflict-free Sort_Option', () => {
    for (const hideConflicts of [true, false]) {
      const original = state({ sort: 'conflict-free', hideConflicts });
      expect(decodeQueryState(encodeQueryState(original))).toEqual(original);
    }
  });

  it('reads hc=1 as on and every other spelling as off', () => {
    expect(decodeQueryState('?hc=1').hideConflicts).toBe(true);
    expect(decodeQueryState('?hc=0').hideConflicts).toBe(false);
    expect(decodeQueryState('?hc=true').hideConflicts).toBe(false);
    expect(decodeQueryState('?hc=false').hideConflicts).toBe(false);
    expect(decodeQueryState('?hc=yes').hideConflicts).toBe(false);
    expect(decodeQueryState('?hc=on').hideConflicts).toBe(false);
    expect(decodeQueryState('?hc=').hideConflicts).toBe(false);
    expect(decodeQueryState('?hc').hideConflicts).toBe(false);
    expect(decodeQueryState('?q=reef').hideConflicts).toBe(false);
  });

  it('applies the toggle alongside a rejected hc-free parameter', () => {
    expect(decodeQueryState('?hc=1&sort=sideways&page=zero')).toEqual(
      state({ hideConflicts: true }),
    );
  });

  it('decodes each page size option and rejects any other', () => {
    expect(decodeQueryState('?size=12').pageSize).toBe(12);
    expect(decodeQueryState('?size=48').pageSize).toBe(48);
    expect(decodeQueryState('?size=all').pageSize).toBe('all');
    expect(decodeQueryState('?size=25').pageSize).toBe(24);
    expect(decodeQueryState('?size=ALL').pageSize).toBe(24);
  });

  it('decodes each Sort_Option and rejects any other to no selection', () => {
    expect(decodeQueryState('?sort=name-asc').sort).toBe('name-asc');
    expect(decodeQueryState('?sort=relevance').sort).toBe('relevance');
    expect(decodeQueryState('?sort=conflict-free').sort).toBe('conflict-free');
    expect(decodeQueryState('?sort=newest').sort).toBeNull();
    expect(decodeQueryState('?sort=').sort).toBeNull();
  });

  it('accepts only an integer page number of 1 or greater', () => {
    expect(decodeQueryState('?page=1000').pageNumber).toBe(1000);
    expect(decodeQueryState('?page=0').pageNumber).toBe(1);
    expect(decodeQueryState('?page=-3').pageNumber).toBe(1);
    expect(decodeQueryState('?page=2.5').pageNumber).toBe(1);
    expect(decodeQueryState('?page=abc').pageNumber).toBe(1);
    expect(decodeQueryState('?page=1e3').pageNumber).toBe(1);
    expect(decodeQueryState('?page=99999999999999999999').pageNumber).toBe(1);
  });

  it('rejects a query longer than 200 characters to the empty default', () => {
    const long = 'a'.repeat(201);
    expect(decodeQueryState(`?q=${long}`).query).toBe('');
    expect(decodeQueryState(`?q=${'a'.repeat(200)}`).query).toBe(
      'a'.repeat(200),
    );
  });

  it('applies the remaining valid parameters alongside a rejected one', () => {
    const decoded = decodeQueryState(
      `?q=${'a'.repeat(201)}&sort=sideways&page=zero&size=7&day=Monday`,
    );

    expect(decoded).toEqual(
      state({ filters: { ...EMPTY_SELECTIONS, day: ['Monday'] } }),
    );
  });

  it('ignores unknown parameters', () => {
    expect(decodeQueryState('?utm_source=email&ref=twitter&q=reef')).toEqual(
      state({ query: 'reef' }),
    );
  });

  it('keeps filter values verbatim and ordered when no facets are supplied', () => {
    const decoded = decodeQueryState(
      '?major=Arts%2C+Media+%26+Design&major=100%25+B%C3%ADo&college=Nowhere',
    );

    expect(decoded.filters.major).toEqual(['Arts, Media & Design', '100% Bío']);
    expect(decoded.filters.college).toEqual(['Nowhere']);
  });

  it('drops filter values absent from the Dataset when facets are supplied', () => {
    const decoded = decodeQueryState(
      '?college=Computing&college=Nowhere&day=Monday&day=Funday&advisor=Nobody',
      facets,
    );

    expect(decoded.filters).toEqual({
      ...EMPTY_SELECTIONS,
      college: ['Computing'],
      day: ['Monday'],
    });
  });

  it('folds case and surrounding whitespace against the Dataset values', () => {
    const decoded = decodeQueryState('?college=+computing+', facets);

    expect(decoded.filters.college).toEqual([' computing ']);
  });

  it('drops duplicate and empty filter values', () => {
    const decoded = decodeQueryState('?day=Monday&day=monday&day=&day=+');

    expect(decoded.filters.day).toEqual(['Monday']);
  });

  it('never throws and always returns a well-formed Query_State', () => {
    const hostile = [
      '?',
      '&&&',
      '%',
      '?q=%E0%A4%A',
      '?=&=&',
      '?page=NaN&size=Infinity&sort=%00',
      '?hc=%00&hc=1',
      '?q',
      'not a query string at all',
    ];

    for (const search of hostile) {
      const decoded = decodeQueryState(search);
      expect(decoded.query.length).toBeLessThanOrEqual(200);
      expect(typeof decoded.hideConflicts).toBe('boolean');
      expect(Number.isSafeInteger(decoded.pageNumber)).toBe(true);
      expect(decoded.pageNumber).toBeGreaterThanOrEqual(1);
      expect([12, 24, 48, 'all']).toContain(decoded.pageSize);
    }
  });
});
