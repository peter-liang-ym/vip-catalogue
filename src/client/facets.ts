/**
 * Filter_Engine facet derivation (Requirements 6.1, 6.2).
 *
 * The four Filters are derived once from the whole Dataset. Comparison folds
 * letter case and surrounding whitespace, while the value shown to the visitor
 * keeps the Dataset's own spelling — the first one encountered while walking the
 * Dataset in order — so a Dataset holding `Computing` and ` computing ` offers one
 * selectable value that still reads the way the source site writes it.
 */

import { weekdaysInText } from '../ingest/meetingWindow';
import { WEEKDAYS, type Dataset, type Weekday } from '../shared/types';

export type FilterName = 'college' | 'major' | 'day' | 'advisor';

/** Selected values per Filter: deduped, order preserved. */
export type FilterSelections = {
  readonly [K in FilterName]: readonly string[];
};

export interface FacetValues {
  readonly college: readonly string[]; // locale-sorted ascending
  readonly major: readonly string[];
  readonly day: readonly string[]; // Monday..Sunday order
  readonly advisor: readonly string[];
  /**
   * The Majors the Dataset pairs with each College, keyed by the folded College
   * value and holding display spellings in locale order. `selectableMajors` reads
   * it, so callers fold their College values with `foldValue` before looking up.
   */
  readonly majorsByCollege: ReadonlyMap<string, readonly string[]>;
}

/**
 * The comparison form of a Filter value: letter case and surrounding whitespace
 * are not significant (Requirement 6.2). Interior whitespace runs were already
 * collapsed by `normalizeText` during ingestion, so trimming is enough here.
 */
export function foldValue(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Locale-aware ascending comparison. Base sensitivity matches the name ordering
 * used elsewhere; where it reports two distinct values as equal, the stable sort
 * leaves them in the order the Dataset presented them.
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * Distinct folded values in insertion order, each mapped to the first spelling
 * encountered for it. Empty values are never recorded (Requirement 6.2).
 */
class ValueSet {
  private readonly display = new Map<string, string>();

  add(raw: string): string | null {
    const folded = foldValue(raw);
    if (folded === '') return null;
    if (!this.display.has(folded)) this.display.set(folded, raw.trim());
    return folded;
  }

  /** The display spellings in ascending locale order. */
  sorted(): readonly string[] {
    return [...this.display.values()].sort((a, b) => collator.compare(a, b));
  }
}

/**
 * Derives the selectable values of all four Filters from the whole Dataset.
 *
 * College, Major, and Advisor come from a Team's `majorsSought` and `advisors`
 * lists. Meeting_Day comes from the weekdays named in `meeting.day`, using the
 * same spellings the Meeting_Window derivation accepts, so `Tue/Thu` contributes
 * the canonical `Tuesday` and `Thursday` values that Monday..Sunday ordering is
 * defined over.
 */
export function deriveFacetValues(dataset: Dataset): FacetValues {
  const colleges = new ValueSet();
  const majors = new ValueSet();
  const advisors = new ValueSet();
  const days = new Set<Weekday>();
  const majorsPerCollege = new Map<string, ValueSet>();

  for (const team of dataset.teams) {
    for (const entry of team.majorsSought) {
      const college = colleges.add(entry.college);
      const major = majors.add(entry.major);
      if (college === null || major === null) continue;

      let paired = majorsPerCollege.get(college);
      if (paired === undefined) {
        paired = new ValueSet();
        majorsPerCollege.set(college, paired);
      }
      paired.add(entry.major);
    }

    for (const advisor of team.advisors) advisors.add(advisor.name);

    for (const weekday of weekdaysInText(team.meeting.day)) days.add(weekday);
  }

  const majorsByCollege = new Map<string, readonly string[]>();
  for (const [college, paired] of majorsPerCollege) {
    majorsByCollege.set(college, paired.sorted());
  }

  return {
    college: colleges.sorted(),
    major: majors.sorted(),
    day: WEEKDAYS.filter(weekday => days.has(weekday)),
    advisor: advisors.sorted(),
    majorsByCollege,
  };
}
