/**
 * Term highlighting: splits displayed card text into ordered marked and
 * unmarked segments so the Catalog_UI can mark every case-insensitive
 * occurrence of every Search_Query term (Requirement 5.5).
 *
 * The function is pure and lossless: concatenating `text` over the returned
 * segments reproduces the input exactly, so the view never has to reconstruct
 * the original characters or casing. Overlapping and adjacent occurrences merge
 * into a single marked segment, which keeps the marked/unmarked alternation and
 * avoids nested marks in the rendered output.
 */

export interface HighlightSegment {
  readonly text: string;
  readonly marked: boolean;
}

/** A half-open `[start, end)` range of source-text indices. */
type Range = readonly [number, number];

/**
 * `text` lowercased without changing its length, so an index into the result is
 * the same index into the source text.
 *
 * A handful of characters lowercase to more than one code unit (`'İ'` being the
 * common one). Those are left as they are rather than shifting every later
 * index, which costs a missed match on an exotic character and buys exact
 * position alignment everywhere else.
 */
function foldPreservingLength(text: string): string {
  const lowered = text.toLowerCase();
  if (lowered.length === text.length) return lowered;

  let out = '';
  for (const char of text) {
    const loweredChar = char.toLowerCase();
    out += loweredChar.length === char.length ? loweredChar : char;
  }
  return out;
}

/**
 * Every occurrence of `term` in `haystack`, including overlapping ones: the
 * search resumes one character past each hit rather than past the whole match.
 */
function occurrences(haystack: string, term: string): Range[] {
  const found: Range[] = [];
  let from = 0;

  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at === -1) return found;
    found.push([at, at + term.length]);
    from = at + 1;
  }
}

/** The input ranges as the fewest disjoint, non-touching ranges covering the same indices. */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];

  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

/**
 * `text` as an ordered run of segments where a segment is marked exactly when
 * its characters fall inside a case-insensitive occurrence of some term.
 *
 * Empty terms are ignored, and no empty segment is ever emitted, so an empty
 * text or an empty term list yields the text as a single unmarked segment (or
 * nothing at all when the text itself is empty).
 */
export function highlight(
  text: string,
  termList: readonly string[],
): readonly HighlightSegment[] {
  const searchTerms = termList
    .map(term => term.toLowerCase())
    .filter(term => term.length > 0);

  if (text.length === 0) return [];
  if (searchTerms.length === 0) return [{ text, marked: false }];

  const haystack = foldPreservingLength(text);
  const hits = mergeRanges(
    searchTerms.flatMap(term => occurrences(haystack, term)),
  );

  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const [start, end] of hits) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), marked: false });
    }
    segments.push({ text: text.slice(start, end), marked: true });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), marked: false });
  }

  return segments;
}
