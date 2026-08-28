/**
 * Sorter: Sort_Option resolution and Result_Set ordering (Requirements 7.1, 7.2,
 * 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11).
 *
 * Ordering is a pure function of the Result_Set, the resolved Sort_Option, the
 * Search_Query, and — for `conflict-free` — the Conflict_States, so re-sorting
 * never touches the Search_Query or the selected Filter values (Requirement 7.2);
 * the page reset that accompanies a Sort_Option change belongs to the caller.
 *
 * Every comparator ends in the `entryId` ascending tiebreak, which makes each
 * ordering a deterministic total order rather than a sort that depends on the
 * order its input happened to arrive in.
 */

import type { ConflictMap } from './conflicts';
import { terms, type ScoredTeam } from './search';

export type SortOption =
  | 'name-asc'
  | 'name-desc'
  | 'relevance'
  | 'conflict-free';

/** The four mutually exclusive Sort_Options (Requirement 7.1). */
export const SORT_OPTIONS: readonly SortOption[] = [
  'name-asc',
  'name-desc',
  'relevance',
  'conflict-free',
];

/**
 * A Search_Query counts as empty when it holds no non-whitespace character,
 * which is the same notion of emptiness the Search_Engine uses (Requirement 5.2)
 * — a whitespace-only query selects nothing and scores every Team 0, so ordering
 * by relevance would be ordering by nothing.
 */
function isEmptyQuery(query: string): boolean {
  return terms(query).length === 0;
}

/**
 * The one Sort_Option applied to the Result_Set (Requirement 7.1).
 *
 * An explicit selection is always honored, including `conflict-free` and
 * including `relevance` with an empty query, which stays selected while ordering
 * by name (Requirements 7.4, 7.9). With no explicit selection the default is
 * name ascending for an empty query and relevance for a non-empty one
 * (Requirements 7.3, 7.8); `conflict-free` is never chosen implicitly.
 */
export function effectiveSort(
  selected: SortOption | null,
  query: string,
): SortOption {
  if (selected !== null) return selected;
  return isEmptyQuery(query) ? 'name-asc' : 'relevance';
}

/**
 * Locale-aware, case-insensitive name comparison over trimmed names
 * (Requirement 7.7). Base sensitivity is the same setting the facet ordering
 * uses, so a name orders the same way wherever it is compared.
 */
const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  usage: 'sort',
});

function compareName(a: ScoredTeam, b: ScoredTeam): number {
  return collator.compare(a.team.name.trim(), b.team.name.trim());
}

/**
 * `entryId` ascending, the tiebreak for every Sort_Option (Requirement 7.6).
 *
 * Ids are the digits taken from `/entry/{id}`, so the comparison is numeric;
 * a non-numeric id falls back to code-unit order, which keeps the comparator
 * total over arbitrary ids instead of reporting them equal.
 */
function compareEntryId(a: ScoredTeam, b: ScoredTeam): number {
  const left = a.team.entryId;
  const right = b.team.entryId;
  const asNumbers = Number(left) - Number(right);
  if (Number.isFinite(asNumbers) && asNumbers !== 0) return asNumbers;
  return left < right ? -1 : left > right ? 1 : 0;
}

function nameAscending(a: ScoredTeam, b: ScoredTeam): number {
  return compareName(a, b) || compareEntryId(a, b);
}

/** Match_Score highest to lowest (Requirement 7.5), then `entryId` ascending. */
function byScore(a: ScoredTeam, b: ScoredTeam): number {
  return b.score - a.score || compareEntryId(a, b);
}

/**
 * The group a team sorts into under `conflict-free`: clear first, then unknown,
 * then conflicting (Requirement 7.10).
 *
 * A team the ConflictMap says nothing about ranks with `unknown`, the group for
 * teams whose Conflict_State cannot be shown, which keeps the rank total over
 * any Result_Set rather than only over the Dataset the map was built from.
 */
function groupRank(team: ScoredTeam, conflicts: ConflictMap): number {
  switch (conflicts.get(team.team.entryId)) {
    case 'clear':
      return 0;
    case 'conflicting':
      return 2;
    default:
      return 1;
  }
}

/**
 * The `(groupRank, name, entryId)` key of Requirement 7.10, built from the same
 * collator-based name comparison and the same `entryId` tiebreak every other
 * ordering uses, so the group boundaries hold by construction and the whole
 * ordering is a deterministic total order.
 */
function byConflictGroup(conflicts: ConflictMap) {
  return (a: ScoredTeam, b: ScoredTeam): number =>
    groupRank(a, conflicts) - groupRank(b, conflicts) || nameAscending(a, b);
}

/**
 * The Result_Set in the order the Sort_Option specifies. The input is never
 * mutated, and the result is always a permutation of it.
 *
 * `name-desc` is the exact reverse of `name-asc` (Requirement 7.7), so it is
 * produced by reversing that order rather than by negating the comparator: with
 * names that compare equal, an exact reverse necessarily reverses the `entryId`
 * tiebreak too.
 *
 * `relevance` orders by Match_Score descending while the Search_Query is
 * non-empty and collapses to `name-asc` when it is empty, remaining the selected
 * option (Requirements 7.5, 7.9).
 */
export function sortResults(
  rs: readonly ScoredTeam[],
  sort: SortOption,
  query: string,
  conflicts: ConflictMap | null,
): readonly ScoredTeam[] {
  switch (sort) {
    case 'name-asc':
      return [...rs].sort(nameAscending);
    case 'name-desc':
      return [...rs].sort(nameAscending).reverse();
    case 'relevance':
      return isEmptyQuery(query)
        ? [...rs].sort(nameAscending)
        : [...rs].sort(byScore);
    case 'conflict-free':
      // With no Busy_Schedule loaded the three groups collapse into one and the
      // ordering is exactly name ascending (Requirement 7.11).
      return conflicts === null
        ? [...rs].sort(nameAscending)
        : [...rs].sort(byConflictGroup(conflicts));
  }
}
