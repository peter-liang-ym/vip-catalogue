import { describe, expect, it } from 'vitest';
import { DATASET_SCHEMA_VERSION, type Dataset } from '../shared/types';
import { DEFAULT_QUERY_STATE, type QueryState } from './queryState';
import {
  decodeAddress,
  LISTING_ROUTE,
  parseRoute,
  routeHref,
  routePath,
} from './router';
import { buildIndex } from './search';

function query(over: Partial<QueryState>): QueryState {
  return { ...DEFAULT_QUERY_STATE, ...over };
}

describe('parseRoute', () => {
  it('routes the site root to the listing', () => {
    expect(parseRoute('/')).toEqual(LISTING_ROUTE);
  });

  it('routes /team/{entryId} to the detail view, with or without a trailing slash', () => {
    expect(parseRoute('/team/1248')).toEqual({ kind: 'team', entryId: '1248' });
    expect(parseRoute('/team/1248/')).toEqual({
      kind: 'team',
      entryId: '1248',
    });
  });

  it('decodes the entry id segment', () => {
    expect(parseRoute('/team/a%20b')).toEqual({ kind: 'team', entryId: 'a b' });
  });

  it('keeps a malformed escape verbatim instead of throwing', () => {
    expect(parseRoute('/team/%E0%A4%A')).toEqual({
      kind: 'team',
      entryId: '%E0%A4%A',
    });
  });

  it('routes every unrecognized path to the listing', () => {
    for (const pathname of [
      '/index.html',
      '/404.html',
      '/nope',
      '/team',
      '/team/',
      '/team/1248/extra',
    ]) {
      expect(parseRoute(pathname)).toEqual(LISTING_ROUTE);
    }
  });
});

describe('routePath and routeHref', () => {
  it('writes a bare listing path for the default Query_State', () => {
    expect(routePath(LISTING_ROUTE)).toBe('/');
    expect(routeHref(LISTING_ROUTE, DEFAULT_QUERY_STATE)).toBe('/');
  });

  it('appends the encoded Query_State to either route', () => {
    const qs = query({ query: 'robot', pageNumber: 2 });

    expect(routeHref(LISTING_ROUTE, qs)).toBe('/?q=robot&page=2');
    expect(routeHref({ kind: 'team', entryId: '1248' }, qs)).toBe(
      '/team/1248?q=robot&page=2',
    );
  });

  it('percent-encodes the entry id', () => {
    expect(routePath({ kind: 'team', entryId: 'a b' })).toBe('/team/a%20b');
  });
});

describe('decodeAddress', () => {
  it('reads the route and the Query_State from one address', () => {
    const address = decodeAddress('/team/1248', '?q=robot&page=3');

    expect(address.route).toEqual({ kind: 'team', entryId: '1248' });
    expect(address.queryState.query).toBe('robot');
    expect(address.queryState.pageNumber).toBe(3);
  });

  it('applies the defaults when the address carries no Query_State (Requirement 9.8)', () => {
    expect(decodeAddress('/team/1248', '').queryState).toEqual(
      DEFAULT_QUERY_STATE,
    );
  });

  it('round-trips a route and Query_State through the address it writes', () => {
    const route = { kind: 'team', entryId: '1248' } as const;
    const qs = query({
      query: 'robot arm',
      filters: { college: ['Engineering'], major: [], day: [], advisor: [] },
      sort: 'name-desc',
      hideConflicts: true,
      pageNumber: 4,
      pageSize: 48,
    });
    const href = routeHref(route, qs);
    const [pathname = '', search = ''] = href.split('?');

    expect(decodeAddress(pathname, search)).toEqual({
      route,
      queryState: qs,
    });
  });

  it('drops a Filter value the Dataset does not offer when facets are supplied', () => {
    const dataset: Dataset = {
      schemaVersion: DATASET_SCHEMA_VERSION,
      generatedAt: '2026-01-05T04:30:00Z',
      teamCount: 1,
      teams: [
        {
          entryId: '1248',
          sourceUrl: 'https://vip.gatech.edu/teams/entry/1248',
          name: 'Robotics',
          imageUrl: '',
          imagePath: '',
          imageAlt: '',
          goals: '',
          issuesAddressed: '',
          partnersSponsors: '',
          methodsTechnologies: '',
          majorsSought: [{ college: 'Engineering', major: 'ME' }],
          preferredInterests: '',
          advisors: [],
          meeting: { day: '', time: '', location: '' },
          meetingWindow: null,
        },
      ],
    };
    const facets = buildIndex(dataset).facetValues;

    const kept = decodeAddress('/', '?college=Engineering', facets);
    const dropped = decodeAddress('/', '?college=Nowhere', facets);

    expect(kept.queryState.filters.college).toEqual(['Engineering']);
    expect(dropped.queryState.filters.college).toEqual([]);
  });
});
