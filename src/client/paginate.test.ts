import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  clampPage,
  pageCount,
  pageSlice,
  resolvePageSize,
} from './paginate';

const items = (n: number): readonly number[] =>
  Array.from({ length: n }, (_, i) => i + 1);

describe('page sizes', () => {
  it('defaults to 24 cards per page', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(24);
  });

  it("resolves 'all' to the result total", () => {
    expect(resolvePageSize('all', 112)).toBe(112);
    expect(resolvePageSize('all', 0)).toBe(0);
    expect(resolvePageSize(48, 112)).toBe(48);
  });
});

describe('pageCount', () => {
  it('rounds up to the next integer', () => {
    expect(pageCount(112, 24)).toBe(5);
    expect(pageCount(48, 24)).toBe(2);
    expect(pageCount(1, 12)).toBe(1);
  });

  it('yields one page for an empty Result_Set at every page size', () => {
    expect(pageCount(0, 12)).toBe(1);
    expect(pageCount(0, 24)).toBe(1);
    expect(pageCount(0, 48)).toBe(1);
    expect(pageCount(0, 'all')).toBe(1);
  });

  it("resolves 'all' to a single page of everything", () => {
    expect(pageCount(112, 'all')).toBe(1);
  });

  it('clamps non-integer, NaN, and infinite totals', () => {
    expect(pageCount(25.7, 24)).toBe(2);
    expect(pageCount(Number.NaN, 24)).toBe(1);
    expect(pageCount(-5, 24)).toBe(1);
    expect(pageCount(Number.NEGATIVE_INFINITY, 24)).toBe(1);
    expect(Number.isFinite(pageCount(Number.POSITIVE_INFINITY, 24))).toBe(true);
  });
});

describe('clampPage', () => {
  it('returns an in-range integer page unchanged', () => {
    expect(clampPage(1, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(5, 5)).toBe(5);
  });

  it('clamps to the nearest page in range', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-4, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(2.4, 5)).toBe(2);
    expect(clampPage(2.6, 5)).toBe(3);
  });

  it('is total over NaN and infinities', () => {
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(Number.POSITIVE_INFINITY, 5)).toBe(5);
    expect(clampPage(Number.NEGATIVE_INFINITY, 5)).toBe(1);
  });
});

describe('pageSlice', () => {
  it('displays positions ((N - 1) x size + 1) through N x size', () => {
    expect(pageSlice(items(30), 1, 12)).toEqual(items(12));
    expect(pageSlice(items(30), 2, 12)).toEqual([
      13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
  });

  it('stops the last page at the Result_Set total', () => {
    expect(pageSlice(items(30), 3, 12)).toEqual([25, 26, 27, 28, 29, 30]);
  });

  it('slices the clamped page for an out-of-range page number', () => {
    expect(pageSlice(items(30), 99, 12)).toEqual([25, 26, 27, 28, 29, 30]);
    expect(pageSlice(items(30), Number.NaN, 12)).toEqual(items(12));
  });

  it("returns the whole Result_Set for the 'all' page size", () => {
    expect(pageSlice(items(30), 1, 'all')).toEqual(items(30));
    expect(pageSlice(items(30), 4, 'all')).toEqual(items(30));
  });

  it('returns nothing for an empty Result_Set', () => {
    expect(pageSlice([], 1, 24)).toEqual([]);
    expect(pageSlice([], 1, 'all')).toEqual([]);
  });

  it('partitions the Result_Set across every page', () => {
    const rs = items(53);
    const pages = pageCount(rs.length, 12);
    const seen = Array.from({ length: pages }, (_, i) =>
      pageSlice(rs, i + 1, 12),
    ).flat();

    expect(pages).toBe(5);
    expect(seen).toEqual(rs);
  });
});
