/**
 * Search_Engine: index construction, term splitting, conjunctive matching, and
 * Match_Score (Requirements 5.1, 5.2, 5.4, 5.8).
 *
 * Everything here is pure. The index is built once when the Dataset loads; a
 * query is then a per-term case-insensitive substring test over pre-lowercased
 * text, which is what keeps the recompute local and instant.
 */

import type { Dataset, TeamRecord } from '../shared/types';
import { deriveFacetValues, type FacetValues } from './facets';

/** The Search_Query is limited to this many characters (Requirement 5.8). */
export const MAX_QUERY_LENGTH = 200;

/**
 * The searchable fields named in Requirement 5.1, in a fixed order. Match_Score
 * coverage is a fraction over this list, so its length is part of the scoring
 * contract rather than an implementation detail.
 */
export const SEARCHABLE_FIELDS = [
  'name',
  'goals',
  'issuesAddressed',
  'methodsTechnologies',
  'majorsSought',
  'preferredInterests',
  'advisorNames',
] as const;

export const SEARCHABLE_FIELD_COUNT = SEARCHABLE_FIELDS.length;

/** Index of the team-name field within a `fieldText` row. */
const NAME_FIELD = 0;

export interface SearchIndex {
  readonly teams: readonly TeamRecord[];
  readonly byEntryId: ReadonlyMap<string, TeamRecord>;
  /**
   * The lowercased searchable text of each field, index-aligned with `teams` and
   * ordered by `SEARCHABLE_FIELDS`. Match_Score coverage counts the rows'
   * entries, so the per-field split is retained rather than only the join.
   */
  readonly fieldText: readonly (readonly string[])[];
  /** Lowercased haystack per team: every searchable field joined. */
  readonly searchText: readonly string[];
  /** Lowercased team name per team. */
  readonly nameText: readonly string[];
  /** The selectable Filter values derived from the whole Dataset. */
  readonly facetValues: FacetValues;
}

export interface ScoredTeam {
  readonly team: TeamRecord;
  readonly score: number;
  readonly nameHit: boolean;
}

/** Field separator in `searchText`: never part of a term, since terms split on whitespace. */
const FIELD_SEPARATOR = '\n';

function searchableFieldText(team: TeamRecord): readonly string[] {
  const majors = team.majorsSought
    .map(entry => `${entry.college} ${entry.major}`)
    .join(' ');
  const advisors = team.advisors.map(advisor => advisor.name).join(' ');

  return [
    team.name,
    team.goals,
    team.issuesAddressed,
    team.methodsTechnologies,
    majors,
    team.preferredInterests,
    advisors,
  ].map(text => text.toLowerCase());
}

export function buildIndex(dataset: Dataset): SearchIndex {
  const teams = dataset.teams;
  const byEntryId = new Map<string, TeamRecord>();
  const fieldText: readonly string[][] = teams.map(team => {
    byEntryId.set(team.entryId, team);
    return searchableFieldText(team) as string[];
  });

  return {
    teams,
    byEntryId,
    fieldText,
    searchText: fieldText.map(fields => fields.join(FIELD_SEPARATOR)),
    nameText: fieldText.map(fields => fields[NAME_FIELD] ?? ''),
    facetValues: deriveFacetValues(dataset),
  };
}

/**
 * The query terms: the non-empty sequences produced by splitting on whitespace,
 * lowercased so every comparison against the index ignores letter case
 * (Requirement 5.1).
 */
export function terms(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(term => term.length > 0);
}

/** The first `MAX_QUERY_LENGTH` characters of the raw field text (Requirement 5.8). */
export function clampQuery(raw: string): string {
  return raw.length <= MAX_QUERY_LENGTH ? raw : raw.slice(0, MAX_QUERY_LENGTH);
}

function containsEveryTerm(
  haystack: string,
  queryTerms: readonly string[],
): boolean {
  return queryTerms.every(term => haystack.includes(term));
}

/**
 * Every team whose searchable text contains every term (AND across terms,
 * substring per term), each with its Match_Score.
 *
 * The two score bands are disjoint by construction: a name hit scores 60..100
 * and a non-name hit scores 0..51 — the team name is itself one of the seven
 * searchable fields, so a team that is returned without a name hit can cover at
 * most six of them — which is what makes Requirement 5.4's strict ordering hold
 * without tuning.
 *
 * An empty or whitespace-only query returns every team with `score = 0` and
 * `nameHit = false`, so relevance ordering has no effect (Requirement 5.2).
 */
export function search(
  index: SearchIndex,
  query: string,
): readonly ScoredTeam[] {
  const queryTerms = terms(query);

  if (queryTerms.length === 0) {
    return index.teams.map(team => ({ team, score: 0, nameHit: false }));
  }

  const results: ScoredTeam[] = [];

  index.teams.forEach((team, i) => {
    if (!containsEveryTerm(index.searchText[i] ?? '', queryTerms)) return;

    const fields = index.fieldText[i] ?? [];
    const matchedFields = fields.filter(field =>
      containsEveryTerm(field, queryTerms),
    ).length;
    const coverage = matchedFields / SEARCHABLE_FIELD_COUNT;
    const nameHit = containsEveryTerm(index.nameText[i] ?? '', queryTerms);

    results.push({
      team,
      nameHit,
      score: nameHit
        ? 60 + Math.round(40 * coverage)
        : Math.round(59 * coverage),
    });
  });

  return results;
}
