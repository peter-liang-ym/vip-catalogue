/**
 * Major selectability and orphan pruning (Requirements 6.6, 6.10).
 *
 * The Major Filter is the only one whose selectable values depend on another
 * Filter: selecting a College narrows the Majors on offer to the ones the
 * Dataset actually pairs with it. Orphan pruning is the same rule read the other
 * way round — a Major that survives no longer being offered is deselected — so
 * both functions are defined over one notion of selectability and cannot drift
 * apart.
 */

import { foldValue, type FilterSelections } from './facets';
import type { SearchIndex } from './search';

/**
 * The Majors the Dataset pairs with at least one of `colleges`, in the Major
 * facet's locale-ascending order and with the facet's display spellings; every
 * distinct Major in the Dataset when `colleges` is empty (Requirement 6.6).
 *
 * A selected College the Dataset does not know contributes no Majors, which is
 * the same as it pairing with none.
 */
export function selectableMajors(
  index: SearchIndex,
  colleges: readonly string[],
): readonly string[] {
  const { major, majorsByCollege } = index.facetValues;
  if (colleges.length === 0) return major;

  const paired = new Set<string>();
  for (const college of colleges) {
    for (const value of majorsByCollege.get(foldValue(college)) ?? []) {
      paired.add(foldValue(value));
    }
  }

  return major.filter(value => paired.has(foldValue(value)));
}

/**
 * The same selections with exactly the orphaned Major values removed: those the
 * current College selection no longer offers (Requirement 6.10). No other
 * Filter's selections are read or rewritten, and a second application removes
 * nothing further, since pruning cannot change which Majors are selectable.
 */
export function pruneOrphanMajors(
  index: SearchIndex,
  sel: FilterSelections,
): FilterSelections {
  const selectable = new Set(
    selectableMajors(index, sel.college).map(foldValue),
  );
  const major = sel.major.filter(value => selectable.has(foldValue(value)));

  return major.length === sel.major.length ? sel : { ...sel, major };
}
