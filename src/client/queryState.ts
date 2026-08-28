/**
 * Query_State and its encoder (Requirements 8.1, 8.6, 8.9).
 *
 * Query_State is the client's single source of truth for browsing intent: the
 * Search_Query, the selected Filter values, the Sort_Option, the hide-conflicts
 * toggle setting, the page number, and the page size. `encodeQueryState` writes
 * it into an address-bar query string, and the encoding rules are chosen so
 * decoding is exactly inverse:
 *
 * - Parameters are `q`, `college`, `major`, `day`, `advisor`, `sort`, `hc`,
 *   `page`, `size`.
 * - Multi-valued Filters use repeated parameters (`college=A&college=B`) rather
 *   than a comma join, so a value containing a comma survives the round trip, and
 *   order within a Filter is preserved.
 * - A value equal to its default is omitted, so an absent parameter restores that
 *   same default (Requirement 8.6).
 * - `size=all` encodes the `'all'` page size; `12`, `24`, `48` encode as
 *   themselves.
 * - The hide-conflicts toggle encodes as `hc=1` when on and is omitted when off,
 *   so the two encoded values the Catalog_UI produces for it are `1` and absent
 *   (Requirement 16.5).
 * - `URLSearchParams` handles percent-encoding in both directions.
 *
 * Nothing calendar-derived is ever encoded (Requirement 8.9). That is enforced by
 * the type rather than by discipline: `encodeQueryState` reads only `QueryState`,
 * and `QueryState` holds no Busy_Schedule, no Busy_Block, and no Calendar_File
 * name, so there is no calendar value in scope at the encoder to leak — `hc` is
 * one bit saying whether the toggle is on. A shared link therefore carries
 * browsing intent and none of the visitor's schedule.
 */

import type { FilterName, FilterSelections } from './facets';
import {
  DEFAULT_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  type PageSize,
} from './paginate';
import { EMPTY_SELECTIONS } from './selections';
import type { SortOption } from './sort';

/** The Filters that encode as repeated parameters, in the order they are written. */
export const FILTER_PARAMS: readonly FilterName[] = [
  'college',
  'major',
  'day',
  'advisor',
];

/** Every parameter name the encoder may produce. */
export const QUERY_PARAMS: readonly string[] = [
  'q',
  ...FILTER_PARAMS,
  'sort',
  'hc',
  'page',
  'size',
];

/** The only `hc` value the encoder writes, and so the only one that means on. */
export const HIDE_CONFLICTS_ON = '1';

export interface QueryState {
  /** The Search_Query, at most `MAX_QUERY_LENGTH` characters (Requirement 5.8). */
  readonly query: string;
  readonly filters: FilterSelections;
  /** `null` when the visitor has selected no Sort_Option (Requirement 7.3). */
  readonly sort: SortOption | null;
  /** The hide-conflicts toggle; `false` is off, the default (Requirement 16.1). */
  readonly hideConflicts: boolean;
  /** An integer of 1 or greater (Requirement 4.6). */
  readonly pageNumber: number;
  readonly pageSize: PageSize;
}

/** The value applied for every parameter absent from the address (Requirement 8.6). */
export const DEFAULT_QUERY_STATE: QueryState = {
  query: '',
  filters: EMPTY_SELECTIONS,
  sort: null,
  hideConflicts: false,
  pageNumber: DEFAULT_PAGE_NUMBER,
  pageSize: DEFAULT_PAGE_SIZE,
};

/**
 * `qs` as a query string, `'?'`-prefixed, or `''` when every value is its default
 * so the default view has a bare address.
 */
export function encodeQueryState(qs: QueryState): string {
  const params = new URLSearchParams();

  if (qs.query !== DEFAULT_QUERY_STATE.query) params.set('q', qs.query);

  for (const filter of FILTER_PARAMS) {
    for (const value of qs.filters[filter]) params.append(filter, value);
  }

  if (qs.sort !== null) params.set('sort', qs.sort);
  if (qs.hideConflicts) params.set('hc', HIDE_CONFLICTS_ON);
  if (qs.pageNumber !== DEFAULT_PAGE_NUMBER) {
    params.set('page', String(qs.pageNumber));
  }
  if (qs.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set('size', String(qs.pageSize));
  }

  const encoded = params.toString();

  return encoded === '' ? '' : `?${encoded}`;
}
