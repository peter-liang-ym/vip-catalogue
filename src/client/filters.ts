/**
 * Filter_Engine composition (Requirements 6.3, 6.4).
 *
 * Values selected inside one Filter are OR-ed, and the Filters that hold at least
 * one selected value are AND-ed; a Filter with no selections imposes no
 * constraint. Comparison goes through `foldValue`, the same folding the facet
 * derivation uses, so a selected value always matches the Teams it was derived
 * from regardless of the spelling the Dataset happens to use.
 */

import { weekdaysInText } from '../ingest/meetingWindow';
import type { TeamRecord } from '../shared/types';
import { foldValue, type FilterName, type FilterSelections } from './facets';
import type { ScoredTeam } from './search';

const FILTER_NAMES: readonly FilterName[] = [
  'college',
  'major',
  'day',
  'advisor',
];

/**
 * The folded values of the field a Filter matches against (Requirement 6.1).
 * Meeting_Day reads the weekdays named in the meeting day text rather than the
 * text itself, so `Tue/Thu` matches the canonical `Tuesday` and `Thursday` values
 * the day facet offers.
 */
function foldedValues(team: TeamRecord, filter: FilterName): readonly string[] {
  switch (filter) {
    case 'college':
      return team.majorsSought.map(entry => foldValue(entry.college));
    case 'major':
      return team.majorsSought.map(entry => foldValue(entry.major));
    case 'day':
      return weekdaysInText(team.meeting.day).map(weekday =>
        foldValue(weekday),
      );
    case 'advisor':
      return team.advisors.map(advisor => foldValue(advisor.name));
  }
}

function matchesFilter(
  team: TeamRecord,
  filter: FilterName,
  selected: readonly string[],
): boolean {
  const values = foldedValues(team, filter);
  return selected.some(value => values.includes(foldValue(value)));
}

/**
 * The Teams satisfying every Filter that has at least one selected value, in the
 * order they were given. Match_Score and the name-hit flag pass through untouched:
 * filtering only removes Teams.
 */
export function applyFilters(
  teams: readonly ScoredTeam[],
  sel: FilterSelections,
): readonly ScoredTeam[] {
  const active = FILTER_NAMES.filter(filter => sel[filter].length > 0);
  if (active.length === 0) return teams;

  return teams.filter(scored =>
    active.every(filter => matchesFilter(scored.team, filter, sel[filter])),
  );
}
