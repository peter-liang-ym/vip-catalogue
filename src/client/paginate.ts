/**
 * Paginator: page size resolution, page counting, slicing, and page clamping
 * (Requirements 4.3, 4.4, 4.5, 4.6, 4.8).
 *
 * Pagination is pure arithmetic over the ordered Result_Set, so a page change is
 * a slice rather than a fetch. `clampPage` is total over arbitrary numbers
 * because the page number can arrive from the address bar, where anything at all
 * can be typed (Requirement 8.4 feeds Requirement 4.6).
 */

/** The page sizes on offer, `'all'` meaning the whole Result_Set (Requirement 4.4). */
export type PageSize = 12 | 24 | 48 | 'all';

/** The page size options, in the order the Catalog_UI presents them. */
export const PAGE_SIZE_OPTIONS: readonly PageSize[] = [12, 24, 48, 'all'];

/** The default page size (Requirement 4.3). */
export const DEFAULT_PAGE_SIZE: PageSize = 24;

/** The default page number, the page every Result_Set change returns to (Requirement 4.7). */
export const DEFAULT_PAGE_NUMBER = 1;

/**
 * `size` as a number of Team_Cards, with `'all'` resolving to the Result_Set
 * total (Requirement 4.4). An empty Result_Set therefore resolves `'all'` to 0,
 * which the page-count minimum turns into one page holding nothing.
 */
export function resolvePageSize(size: PageSize, resultTotal: number): number {
  return size === 'all' ? clampTotal(resultTotal) : size;
}

/**
 * A count as a non-negative integer. Counts are Result_Set lengths, so
 * non-integers, `NaN`, and infinities are nonsense rather than requests: `NaN`
 * and anything below zero clamp to 0, a fractional count truncates, and
 * `Infinity` clamps to the largest exact integer so every derived page count
 * stays a finite integer.
 */
function clampTotal(total: number): number {
  if (Number.isNaN(total) || total <= 0) return 0;
  if (total === Number.POSITIVE_INFINITY) return Number.MAX_SAFE_INTEGER;
  return Math.floor(total);
}

/**
 * The number of pages available for the current Result_Set: the total divided by
 * the resolved page size and rounded up, with a minimum of 1 (Requirement 4.8).
 *
 * `resultTotal` exists only to resolve the `'all'` page size and defaults to
 * `total`, which is what it equals whenever the count being paged is the
 * Result_Set itself.
 */
export function pageCount(
  total: number,
  size: PageSize,
  resultTotal: number = total,
): number {
  const clamped = clampTotal(total);
  const resolved = resolvePageSize(size, resultTotal);
  if (resolved <= 0) return 1;

  return Math.max(1, Math.ceil(clamped / resolved));
}

/**
 * An integer page number within 1..`count`, the nearest such page to
 * `pageNumber` (Requirement 4.6). Total over every number: a fractional page
 * rounds to the nearest, out-of-range and `NaN` and infinite values clamp to the
 * end they lie beyond, and a page already an integer in range is returned
 * unchanged.
 */
export function clampPage(pageNumber: number, count: number): number {
  const upper = Math.max(1, clampTotal(count));
  if (Number.isNaN(pageNumber)) return DEFAULT_PAGE_NUMBER;
  if (pageNumber <= DEFAULT_PAGE_NUMBER) return DEFAULT_PAGE_NUMBER;
  if (pageNumber >= upper) return upper;

  return Math.min(upper, Math.round(pageNumber));
}

/**
 * The Teams occupying positions ((N - 1) x size + 1) through the lesser of
 * (N x size) and the Result_Set total, where N is `pageNumber` clamped into
 * range (Requirements 4.5, 4.6).
 *
 * Concatenating the slices of pages 1..`pageCount` reproduces `rs` exactly once
 * in order, since the page bounds are contiguous multiples of the resolved size.
 */
export function pageSlice<T>(
  rs: readonly T[],
  pageNumber: number,
  size: PageSize,
): readonly T[] {
  const resolved = resolvePageSize(size, rs.length);
  if (resolved <= 0) return [];

  const page = clampPage(pageNumber, pageCount(rs.length, size));
  const start = (page - 1) * resolved;

  return rs.slice(start, start + resolved);
}
