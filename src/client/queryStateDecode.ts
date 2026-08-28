/**
 * The Query_State decoder (Requirements 8.2, 8.4, 8.6).
 *
 * `decodeQueryState` is the exact inverse of `encodeQueryState` over the
 * Requirement 8.3 bounds, and it is total everywhere else: the address bar is
 * visitor-editable, so every parameter is treated as an untrusted string. An
 * invalid, malformed, or unknown parameter is dropped in favor of that
 * parameter's default, the remaining valid parameters are still applied, and
 * nothing is reported to the visitor (Requirement 8.4) — an absent parameter and
 * a rejected one take the same path, which is what makes the defaults of
 * Requirement 8.6 fall out of the same code.
 *
 * Validity per parameter:
 *
 * - `q` — kept as written up to `MAX_QUERY_LENGTH` characters; a longer query is
 *   rejected to the empty default rather than truncated, because Requirement 8.4
 *   asks for the default and not for a repair.
 * - `college`, `major`, `day`, `advisor` — repeated parameters, order preserved,
 *   deduplicated under `foldValue` so the selections stay the deduped lists that
 *   `FilterSelections` promises. When `facets` is supplied, a value absent from
 *   the Dataset is dropped under the same folding the Filter_Engine compares
 *   with; when it is not — round-trip contexts and history restoration before the
 *   Dataset arrives — values are kept verbatim and pruned later by the facet
 *   check and `pruneOrphanMajors`.
 * - `sort` — one of the Sort_Options the Catalog_UI provides, including
 *   `conflict-free`, otherwise `null`. `conflict-free` decodes back to itself
 *   whether or not a Busy_Schedule is loaded, since the address is read before any
 *   stored schedule is.
 * - `hc` — `1` turns the hide-conflicts toggle on; `0`, `true`, and every other
 *   spelling are invalid and take the same path as absence, the default of off
 *   (Requirements 8.4, 16.5).
 * - `page` — an integer of 1 or greater, otherwise 1. Clamping against the actual
 *   page count belongs to `clampPage`, which sees the Result_Set.
 * - `size` — one of `12`, `24`, `48`, `all`, otherwise 24.
 *
 * A value that folds to empty is not a Filter value at all (Requirement 6.2
 * derives Filter values from the non-empty Dataset values), so it is dropped in
 * both modes.
 *
 * Nothing calendar-derived is decodable, since the encoder never writes any
 * (Requirement 8.9): `hc` is one bit saying whether the toggle is on, and it
 * carries no Busy_Schedule, no Busy_Block, and no Calendar_File name.
 */

import { foldValue, type FacetValues, type FilterName } from './facets';
import {
  DEFAULT_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  type PageSize,
} from './paginate';
import {
  DEFAULT_QUERY_STATE,
  HIDE_CONFLICTS_ON,
  type QueryState,
} from './queryState';
import { MAX_QUERY_LENGTH } from './search';
import { SORT_OPTIONS, type SortOption } from './sort';

/**
 * The Query_State encoded in `search`, which may be a query string with or
 * without its leading `'?'`, including the empty string.
 */
export function decodeQueryState(
  search: string,
  facets?: FacetValues,
): QueryState {
  const params = parseParams(search);
  if (params === null) return DEFAULT_QUERY_STATE;

  return {
    query: decodeQuery(params.get('q')),
    filters: {
      college: decodeFilter(params, 'college', facets),
      major: decodeFilter(params, 'major', facets),
      day: decodeFilter(params, 'day', facets),
      advisor: decodeFilter(params, 'advisor', facets),
    },
    sort: decodeSort(params.get('sort')),
    hideConflicts: decodeHideConflicts(params.get('hc')),
    pageNumber: decodePageNumber(params.get('page')),
    pageSize: decodePageSize(params.get('size')),
  };
}

/**
 * `search` as parameters, or `null` when it cannot be read as any. Query-string
 * parsing is lenient by specification — a stray `%`, `=`, or `&` yields odd
 * parameter names rather than an error — so this guard exists to keep the
 * totality claim a property of the code and not of a dependency.
 */
function parseParams(search: string): URLSearchParams | null {
  try {
    return new URLSearchParams(search);
  } catch {
    return null;
  }
}

function decodeQuery(raw: string | null): string {
  if (raw === null || raw.length > MAX_QUERY_LENGTH) {
    return DEFAULT_QUERY_STATE.query;
  }
  return raw;
}

/**
 * The values selected in one Filter: every occurrence of that parameter in
 * address order, minus the empty, the duplicated, and — when `facets` is
 * supplied — those the Dataset does not offer (Requirement 8.4).
 */
function decodeFilter(
  params: URLSearchParams,
  filter: FilterName,
  facets: FacetValues | undefined,
): readonly string[] {
  const offered =
    facets === undefined
      ? null
      : new Set(facets[filter].map(value => foldValue(value)));

  const selected: string[] = [];
  const seen = new Set<string>();

  for (const raw of params.getAll(filter)) {
    const folded = foldValue(raw);
    if (folded === '' || seen.has(folded)) continue;
    if (offered !== null && !offered.has(folded)) continue;

    seen.add(folded);
    selected.push(raw);
  }

  return selected;
}

function decodeSort(raw: string | null): SortOption | null {
  return raw !== null && SORT_OPTIONS.includes(raw as SortOption)
    ? (raw as SortOption)
    : DEFAULT_QUERY_STATE.sort;
}

/**
 * The hide-conflicts toggle setting. The encoder writes exactly one value for it,
 * so `HIDE_CONFLICTS_ON` is the only spelling that means on and every other one
 * decodes to off (Requirement 16.5).
 */
function decodeHideConflicts(raw: string | null): boolean {
  return raw === HIDE_CONFLICTS_ON ? true : DEFAULT_QUERY_STATE.hideConflicts;
}

/**
 * An integer of 1 or greater. The digits-only test rejects the spellings
 * `Number` would otherwise accept — signs, decimal points, exponents, hex,
 * `Infinity`, and surrounding whitespace — and the safe-integer test rejects a
 * run of digits too long to be an exact integer.
 */
function decodePageNumber(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) return DEFAULT_PAGE_NUMBER;

  const page = Number(raw);

  return Number.isSafeInteger(page) && page >= DEFAULT_PAGE_NUMBER
    ? page
    : DEFAULT_PAGE_NUMBER;
}

function decodePageSize(raw: string | null): PageSize {
  const option = PAGE_SIZE_OPTIONS.find(size => String(size) === raw);

  return option ?? DEFAULT_PAGE_SIZE;
}
