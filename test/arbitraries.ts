/**
 * Shared `fast-check` generators (Requirements 2.1, 8.3).
 *
 * Every property test draws from this one module so a single definition of "a
 * legal Team_Record" or "a Query_State inside the Requirement 8.3 bounds" backs
 * all 49 properties. Three generators carry most of the weight:
 *
 * - `arbTeamRecord` produces records that already satisfy the published
 *   invariants of `TeamRecord` — trimmed and capped text, no missing field,
 *   unique College/Major pairs, and a `meetingWindow` that is `null` or 1..7
 *   entries with distinct weekdays in `WEEKDAYS` order (Requirement 2.1). A
 *   property that wants an invalid record builds it from a valid one, so
 *   invalidity is stated by the test rather than left to chance.
 * - `arbTeamPageHtml` renders a synthetic team model into markup and then
 *   applies a mutation plan (delete sections, rename headings to the documented
 *   alternates, strip mail links, corrupt meeting components, unbalance tags).
 *   The sample carries both the pristine and the mutated markup, so the pristine
 *   parse is available as the oracle for the "unaffected fields are
 *   byte-identical" claim.
 * - `arbQueryState` stays inside the Requirement 8.3 bounds — a Search_Query of
 *   at most `MAX_QUERY_LENGTH` characters, at most `MAX_SELECTED_FILTER_VALUES`
 *   selected Filter values in total, a page number of 1..`MAX_PAGE_NUMBER`, and
 *   one of the four page sizes — and deliberately draws Filter values holding
 *   commas, ampersands, `%`, and non-ASCII characters, the four shapes that break
 *   a comma-joined or hand-rolled encoding.
 *
 * The virtual `Clock` at the bottom stands in for wall time in the Scraper
 * properties: `sleep` advances a counter and records the wait instead of
 * suspending, so a hundred generated pacing and retry schedules cost no real
 * seconds.
 */

import fc from 'fast-check';
import {
  foldValue,
  type FilterName,
  type FilterSelections,
} from '../src/client/facets';
import { PAGE_SIZE_OPTIONS, type PageSize } from '../src/client/paginate';
import type { QueryState } from '../src/client/queryState';
import { MAX_QUERY_LENGTH } from '../src/client/search';
import { SORT_OPTIONS, type SortOption } from '../src/client/sort';
import type { Clock } from '../src/ingest/scraper';
import {
  DATASET_SCHEMA_VERSION,
  MAX_ADVISORS,
  MAX_BUSY_BLOCKS,
  MAX_MAJOR_ENTRIES,
  MAX_SHORT_TEXT_LENGTH,
  MAX_TEXT_LENGTH,
  MINUTES_PER_DAY,
  WEEKDAYS,
  type Advisor,
  type BusyBlock,
  type BusySchedule,
  type Dataset,
  type MajorEntry,
  type MeetingInfo,
  type MeetingWindow,
  type MeetingWindowEntry,
  type TeamRecord,
  type Weekday,
} from '../src/shared/types';

/** At most this many Filter values are selected across the four Filters (Requirement 8.3). */
export const MAX_SELECTED_FILTER_VALUES = 50;

/** The largest page number the Requirement 8.3 round trip covers. */
export const MAX_PAGE_NUMBER = 1000;

/** The four Filters, in the order `FilterSelections` names them. */
const FILTER_NAMES: readonly FilterName[] = [
  'college',
  'major',
  'day',
  'advisor',
];

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * The character pool every text value is drawn from. It holds the punctuation
 * that breaks naive encoders (`,`, `&`, `%`, `#`, `+`, `=`, `?`) and characters
 * outside ASCII (accents, CJK, Greek, an en dash, an emoji) alongside ordinary
 * letters, digits, and spaces, so case folding, percent-encoding, and
 * surrogate-pair handling are all exercised by the default draw.
 */
const TEXT_CHARS: readonly string[] = [
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  ' ',
  ' ',
  ',',
  '&',
  '%',
  '#',
  '+',
  '=',
  '?',
  '/',
  '-',
  '.',
  "'",
  '(',
  ')',
  'é',
  'ü',
  'ñ',
  'ß',
  'Ω',
  'ж',
  '大',
  '学',
  '\u2013',
  '\u{1f600}',
];

function joinChars(
  pool: readonly string[],
  minLength: number,
  maxLength: number,
): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...pool), { minLength, maxLength })
    .map(chars => chars.join(''));
}

/** Collapses whitespace runs, trims, and caps, which is the shape ingestion publishes. */
function normalized(raw: string, maxLength: number): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, maxLength).trimEnd();
}

/** A trimmed, whitespace-collapsed value of at most `maxLength` characters; `''` is possible. */
export function arbText(
  maxLength: number = MAX_SHORT_TEXT_LENGTH,
): fc.Arbitrary<string> {
  return joinChars(TEXT_CHARS, 0, Math.min(maxLength, 60)).map(raw =>
    normalized(raw, maxLength),
  );
}

/** The same, but never empty: the fields that must carry a value, and Filter values. */
export function arbNonEmptyText(
  maxLength: number = MAX_SHORT_TEXT_LENGTH,
): fc.Arbitrary<string> {
  return arbText(maxLength).filter(text => text !== '');
}

/** A long field value, capped at `MAX_TEXT_LENGTH` (Requirement 2.1). */
export function arbLongText(): fc.Arbitrary<string> {
  return arbText(MAX_TEXT_LENGTH);
}

// ---------------------------------------------------------------------------
// Team_Record and Dataset
// ---------------------------------------------------------------------------

const weekdayRank = new Map<Weekday, number>(
  WEEKDAYS.map((weekday, index) => [weekday, index]),
);

export function arbWeekday(): fc.Arbitrary<Weekday> {
  return fc.constantFrom(...WEEKDAYS);
}

/** `0 <= startMinute < endMinute <= MINUTES_PER_DAY`, both integers. */
function arbMinuteRange(): fc.Arbitrary<{
  startMinute: number;
  endMinute: number;
}> {
  return fc
    .tuple(
      fc.integer({ min: 0, max: MINUTES_PER_DAY - 1 }),
      fc.integer({ min: 1, max: MINUTES_PER_DAY }),
    )
    .map(([a, b]) => ({
      startMinute: Math.min(a, b === a ? a + 1 : b),
      endMinute: Math.max(b, a + 1),
    }));
}

export function arbMeetingWindowEntry(): fc.Arbitrary<MeetingWindowEntry> {
  return fc
    .tuple(arbWeekday(), arbMinuteRange())
    .map(([weekday, range]) => ({ weekday, ...range }));
}

/**
 * `null` or 1..`MAX_MEETING_WINDOW_ENTRIES` entries with distinct weekdays in
 * `WEEKDAYS` order. `null` is drawn often, since it is the value that makes a
 * Team's Conflict_State `unknown` (Requirement 15.1).
 */
export function arbMeetingWindow(): fc.Arbitrary<MeetingWindow> {
  const entries = fc
    .uniqueArray(arbMeetingWindowEntry(), {
      minLength: 1,
      maxLength: WEEKDAYS.length,
      selector: entry => entry.weekday,
    })
    .map(list =>
      [...list].sort(
        (a, b) =>
          (weekdayRank.get(a.weekday) ?? 0) - (weekdayRank.get(b.weekday) ?? 0),
      ),
    );

  return fc.oneof(
    { arbitrary: fc.constant(null), weight: 1 },
    { arbitrary: entries, weight: 3 },
  );
}

export function arbMajorEntry(): fc.Arbitrary<MajorEntry> {
  return fc.record({ college: arbNonEmptyText(), major: arbNonEmptyText() });
}

/** At most `MAX_MAJOR_ENTRIES` entries, College/Major pairs unique under case folding. */
export function arbMajorEntries(): fc.Arbitrary<readonly MajorEntry[]> {
  return fc.uniqueArray(arbMajorEntry(), {
    maxLength: Math.min(MAX_MAJOR_ENTRIES, 8),
    selector: entry =>
      `${foldValue(entry.college)}\u0000${foldValue(entry.major)}`,
  });
}

export function arbAdvisor(): fc.Arbitrary<Advisor> {
  return fc.record({
    name: arbNonEmptyText(),
    affiliation: arbText(),
    email: fc.oneof(
      fc.constant(''),
      fc
        .tuple(
          joinChars([...'abcdefghijklmnopqrstuvwxyz0123456789.'], 1, 12),
          fc.constantFrom('gatech.edu', 'example.org', 'mail.gatech.edu'),
        )
        .map(([local, domain]) => `${local}@${domain}`),
    ),
  });
}

export function arbAdvisors(): fc.Arbitrary<readonly Advisor[]> {
  return fc.array(arbAdvisor(), { maxLength: Math.min(MAX_ADVISORS, 4) });
}

export function arbMeetingInfo(): fc.Arbitrary<MeetingInfo> {
  return fc.record({
    day: arbText(),
    time: arbText(),
    location: arbText(),
  });
}

/** Digits, as `/entry/{id}` states them. */
export function arbEntryId(): fc.Arbitrary<string> {
  return fc.integer({ min: 1, max: 99_999 }).map(String);
}

/**
 * A Team_Record satisfying every published invariant: every field present, every
 * text value trimmed and capped, `entryId`/`sourceUrl`/`name` non-empty, and a
 * canonical `meetingWindow` (Requirement 2.1).
 */
export function arbTeamRecord(
  overrides: Partial<{ entryId: string }> = {},
): fc.Arbitrary<TeamRecord> {
  const entryId =
    overrides.entryId === undefined
      ? arbEntryId()
      : fc.constant(overrides.entryId);

  return entryId.chain(id =>
    fc.record({
      entryId: fc.constant(id),
      sourceUrl: fc.constant(`https://vip.gatech.edu/teams/entry/${id}`),
      name: arbNonEmptyText(),
      imageUrl: fc.oneof(
        fc.constant(''),
        fc.constant(`https://vip.gatech.edu/files/${id}.png`),
      ),
      imagePath: fc.oneof(fc.constant(''), fc.constant(`images/${id}.png`)),
      imageAlt: arbText(),
      goals: arbLongText(),
      issuesAddressed: arbLongText(),
      partnersSponsors: arbLongText(),
      methodsTechnologies: arbLongText(),
      majorsSought: arbMajorEntries(),
      preferredInterests: arbLongText(),
      advisors: arbAdvisors(),
      meeting: arbMeetingInfo(),
      meetingWindow: arbMeetingWindow(),
    }),
  );
}

/** ISO 8601 UTC at second precision, the form the Serializer writes. */
export function arbGeneratedAt(): fc.Arbitrary<string> {
  return fc
    .date({
      min: new Date('2020-01-01T00:00:00Z'),
      max: new Date('2035-12-31T23:59:59Z'),
      noInvalidDate: true,
    })
    .map(date => `${date.toISOString().slice(0, 19)}Z`);
}

/**
 * A Dataset whose `teamCount` matches its team list and whose `entryId` values
 * are unique, at the current `schemaVersion`.
 */
export function arbDataset(
  options: { minTeams?: number; maxTeams?: number } = {},
): fc.Arbitrary<Dataset> {
  const { minTeams = 0, maxTeams = 6 } = options;

  return fc
    .uniqueArray(arbEntryId(), { minLength: minTeams, maxLength: maxTeams })
    .chain(ids =>
      fc.tuple(
        arbGeneratedAt(),
        fc.tuple(...ids.map(id => arbTeamRecord({ entryId: id }))),
      ),
    )
    .map(([generatedAt, teams]) => ({
      schemaVersion: DATASET_SCHEMA_VERSION,
      generatedAt,
      teamCount: teams.length,
      teams,
    }));
}

// ---------------------------------------------------------------------------
// Query_State
// ---------------------------------------------------------------------------

/**
 * Selections that are deduped under `foldValue` within each Filter and never
 * hold a value that folds to empty, which is what `FilterSelections` promises
 * and what the decoder produces. The total across the four Filters is capped at
 * `MAX_SELECTED_FILTER_VALUES` (Requirement 8.3).
 */
export function arbFilterSelections(
  options: { maxPerFilter?: number } = {},
): fc.Arbitrary<FilterSelections> {
  const maxPerFilter = options.maxPerFilter ?? 6;

  const values = fc.uniqueArray(arbNonEmptyText(), {
    maxLength: maxPerFilter,
    selector: value => foldValue(value),
  });

  return fc
    .tuple(values, values, values, values)
    .map(lists => capTotal(lists, MAX_SELECTED_FILTER_VALUES));
}

/** Truncates the four lists so their combined length stays within `limit`. */
function capTotal(
  lists: readonly (readonly string[])[],
  limit: number,
): FilterSelections {
  const selections: Record<FilterName, readonly string[]> = {
    college: [],
    major: [],
    day: [],
    advisor: [],
  };

  let remaining = limit;
  FILTER_NAMES.forEach((filter, index) => {
    const list = lists[index] ?? [];
    const kept = list.slice(0, Math.max(0, remaining));
    remaining -= kept.length;
    selections[filter] = kept;
  });

  return selections;
}

export function arbSortOption(): fc.Arbitrary<SortOption | null> {
  return fc.oneof(fc.constant(null), fc.constantFrom(...SORT_OPTIONS));
}

export function arbPageSize(): fc.Arbitrary<PageSize> {
  return fc.constantFrom(...PAGE_SIZE_OPTIONS);
}

/** A Search_Query of at most `MAX_QUERY_LENGTH` characters, whitespace included. */
export function arbSearchQuery(): fc.Arbitrary<string> {
  return joinChars(TEXT_CHARS, 0, 40).map(raw =>
    raw.slice(0, MAX_QUERY_LENGTH),
  );
}

/**
 * A Query_State inside the Requirement 8.3 bounds: the Search_Query is at most
 * `MAX_QUERY_LENGTH` characters, at most `MAX_SELECTED_FILTER_VALUES` Filter
 * values are selected, the hide-conflicts toggle is on or off, the page number is
 * an integer of 1..`MAX_PAGE_NUMBER`, and the page size is one of the four
 * options.
 */
export function arbQueryState(): fc.Arbitrary<QueryState> {
  return fc.record({
    query: arbSearchQuery(),
    filters: arbFilterSelections(),
    sort: arbSortOption(),
    hideConflicts: fc.boolean(),
    pageNumber: fc.integer({ min: 1, max: MAX_PAGE_NUMBER }),
    pageSize: arbPageSize(),
  });
}

// ---------------------------------------------------------------------------
// Busy_Blocks and Busy_Schedules
// ---------------------------------------------------------------------------

function arbSummaries(): fc.Arbitrary<readonly string[]> {
  return fc.uniqueArray(arbText(), { maxLength: 3 });
}

/** One Busy_Block with a legal minute range; overlap with others is not excluded. */
export function arbBusyBlock(): fc.Arbitrary<BusyBlock> {
  return fc
    .tuple(arbWeekday(), arbMinuteRange(), arbSummaries())
    .map(([weekday, range, summaries]) => ({ weekday, ...range, summaries }));
}

/**
 * Blocks in canonical form: at most `MAX_BUSY_BLOCKS`, ordered by weekday in
 * `WEEKDAYS` order then `startMinute` ascending, and no two blocks on one weekday
 * overlapping or even touching — the fixed point `mergeBusyBlocks` returns
 * (Requirement 14.13).
 */
export function arbMergedBusyBlocks(
  options: { maxPerWeekday?: number } = {},
): fc.Arbitrary<readonly BusyBlock[]> {
  const maxPerWeekday = options.maxPerWeekday ?? 3;

  const perWeekday = WEEKDAYS.map(weekday =>
    fc
      .uniqueArray(fc.integer({ min: 0, max: MINUTES_PER_DAY }), {
        minLength: 0,
        maxLength: maxPerWeekday * 2,
      })
      .chain(cuts =>
        fc.tuple(
          fc.constant(weekday),
          fc.constant([...cuts].sort((a, b) => a - b)),
          fc.array(arbSummaries(), {
            minLength: maxPerWeekday,
            maxLength: maxPerWeekday,
          }),
        ),
      )
      .map(([day, cuts, summaryLists]) =>
        disjointBlocks(day, cuts, summaryLists),
      ),
  );

  return fc
    .tuple(...perWeekday)
    .map(days => days.flat().slice(0, MAX_BUSY_BLOCKS));
}

/**
 * Non-touching blocks built from sorted cut points: each block spans one pair of
 * cuts and the pair after it starts strictly later, so consecutive blocks are
 * separated by at least one minute.
 */
function disjointBlocks(
  weekday: Weekday,
  cuts: readonly number[],
  summaryLists: readonly (readonly string[])[],
): BusyBlock[] {
  const blocks: BusyBlock[] = [];

  for (let i = 0; i + 1 < cuts.length; i += 2) {
    const startMinute = cuts[i]!;
    const endMinute = cuts[i + 1]!;
    const previous = blocks[blocks.length - 1];

    if (startMinute >= endMinute) continue;
    if (previous !== undefined && startMinute <= previous.endMinute) continue;

    blocks.push({
      weekday,
      startMinute,
      endMinute,
      summaries: summaryLists[blocks.length] ?? [],
    });
  }

  return blocks;
}

/**
 * A Busy_Schedule satisfying the Requirement 14.13 invariants, with
 * `discardedBlocks` at 0 unless `truncated`.
 */
export function arbBusySchedule(): fc.Arbitrary<BusySchedule> {
  return fc
    .tuple(
      arbNonEmptyText().map(name => `${name}.ics`),
      arbGeneratedAt(),
      arbMergedBusyBlocks(),
      fc.boolean(),
      fc.integer({ min: 1, max: 500 }),
    )
    .map(([fileName, loadedAt, blocks, truncated, discarded]) => ({
      fileName: fileName.slice(0, MAX_SHORT_TEXT_LENGTH),
      loadedAt,
      blocks,
      truncated,
      discardedBlocks: truncated ? discarded : 0,
    }));
}

// ---------------------------------------------------------------------------
// Team page markup
// ---------------------------------------------------------------------------

/** The sections the Parser locates by heading text. */
export type SectionKey =
  | 'goals'
  | 'issuesAddressed'
  | 'partnersSponsors'
  | 'methodsTechnologies'
  | 'majorsSought'
  | 'preferredInterests'
  | 'advisors'
  | 'meeting';

/**
 * The heading spelling the Source_Site uses, and the documented alternate where
 * one exists. `renameHeading` swaps the first for the second, so a renamed
 * heading is still a heading the Parser accepts.
 */
const SECTION_HEADINGS = {
  goals: ['Goals'],
  issuesAddressed: ['Issues Involved or Addressed', 'Issues Addressed'],
  partnersSponsors: ['Partners/Sponsors', 'Partners and Sponsors'],
  methodsTechnologies: ['Methods and Technologies'],
  majorsSought: ['Majors Sought'],
  preferredInterests: ['Preferred Interests and Preparation'],
  advisors: ['Advisors', 'Advisor'],
  meeting: ['Day, Time &amp; Location', 'Day, Time and Location'],
} as const satisfies Record<SectionKey, readonly string[]>;

const SECTION_KEYS = Object.keys(SECTION_HEADINGS) as readonly SectionKey[];

/** The sections that have a documented alternate spelling to rename to. */
const RENAMEABLE_SECTIONS = SECTION_KEYS.filter(
  key => SECTION_HEADINGS[key].length > 1,
);

export type MeetingComponent = 'day' | 'time' | 'location';

export type Mutation =
  | { readonly kind: 'deleteSection'; readonly section: SectionKey }
  | { readonly kind: 'renameHeading'; readonly section: SectionKey }
  | { readonly kind: 'stripMailLinks' }
  | { readonly kind: 'corruptMeeting'; readonly component: MeetingComponent }
  | { readonly kind: 'unbalanceTags' };

export interface AdvisorModel {
  readonly name: string;
  readonly affiliation: string;
  readonly email: string;
}

export interface MajorsLineModel {
  readonly college: string;
  readonly majors: readonly string[];
}

/** The synthetic team the markup is rendered from. */
export interface TeamPageModel {
  readonly entryId: string;
  readonly name: string;
  readonly image: { readonly src: string; readonly alt: string } | null;
  readonly goals: string;
  readonly issuesAddressed: string;
  readonly partnersSponsors: string;
  readonly methodsTechnologies: string;
  readonly majorsSought: readonly MajorsLineModel[];
  readonly preferredInterests: string;
  readonly advisors: readonly AdvisorModel[];
  readonly meeting: {
    readonly weekdays: readonly Weekday[];
    readonly time: string;
    readonly location: string;
  };
  /** A `Link(s)` section, which is outside the schema and must leave no trace. */
  readonly extraLinkSection: boolean;
  /** Lays each section out as a heading column beside a body column. */
  readonly twoColumn: boolean;
}

export interface TeamPageSample {
  readonly sourceUrl: string;
  readonly model: TeamPageModel;
  /** The markup with no mutation applied: the oracle for the unaffected fields. */
  readonly pristineHtml: string;
  /** The same page with `mutations` applied; equal to `pristineHtml` when empty. */
  readonly html: string;
  readonly mutations: readonly Mutation[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Text safe to place in markup: no angle brackets, colons, or `&` to confuse a section body. */
const MARKUP_CHARS: readonly string[] = [
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  ' ',
  ' ',
  '-',
  '.',
  ',',
  "'",
  '/',
  'é',
  'ü',
  'ñ',
  'Ω',
  '大',
];

function arbMarkupText(
  minLength: number,
  maxLength = 40,
): fc.Arbitrary<string> {
  return joinChars(MARKUP_CHARS, minLength, maxLength)
    .map(raw => normalized(raw, MAX_SHORT_TEXT_LENGTH))
    .filter(text => (minLength === 0 ? true : text !== ''));
}

/**
 * Text for a Majors sought value. The source site separates Majors with commas,
 * so a comma inside a Major name is not representable in the markup and would
 * make the model a false oracle for the parsed list.
 */
function arbMajorText(): fc.Arbitrary<string> {
  return joinChars(
    MARKUP_CHARS.filter(char => char !== ','),
    1,
    20,
  )
    .map(raw => normalized(raw, MAX_SHORT_TEXT_LENGTH))
    .filter(text => text !== '');
}

const MEETING_LOCATIONS: readonly string[] = [
  'Klaus 1443',
  'TSRB 132',
  'Van Leer C240',
  'Online',
  'Marcus Nanotechnology 1116',
];

const MEETING_TIMES: readonly string[] = [
  '9:30 - 10:20',
  '3:30 \u2013 4:20',
  '11:00 - 1:00',
  '2:00 to 3:00',
  '9:00 - 10:30 AM',
];

export function arbTeamPageModel(): fc.Arbitrary<TeamPageModel> {
  return fc
    .tuple(
      arbEntryId(),
      arbMarkupText(1),
      fc.option(
        fc.record({
          src: fc.constantFrom('/files/header.png', 'header.jpg'),
          alt: arbMarkupText(0),
        }),
        { nil: null },
      ),
      fc.tuple(
        arbMarkupText(1),
        arbMarkupText(1),
        arbMarkupText(1),
        arbMarkupText(1),
        arbMarkupText(1),
      ),
      // Colleges are distinct across lines and Majors distinct within a line
      // under case folding, so the rendered list survives the Parser's pair
      // deduplication unchanged (Requirement 2.2) and the model stays the oracle.
      fc.uniqueArray(
        fc.record({
          college: arbMajorText(),
          majors: fc.uniqueArray(arbMajorText(), {
            minLength: 1,
            maxLength: 3,
            selector: major => foldValue(major),
          }),
        }),
        { maxLength: 3, selector: line => foldValue(line.college) },
      ),
      fc.array(
        fc.record({
          name: arbMarkupText(1, 20),
          affiliation: arbMarkupText(0, 20),
          email: fc
            .tuple(
              joinChars([...'abcdefghijklmnopqrstuvwxyz'], 1, 8),
              fc.constantFrom('gatech.edu', 'example.org'),
            )
            .map(([local, domain]) => `${local}@${domain}`),
        }),
        { maxLength: 3 },
      ),
      fc.record({
        weekdays: fc.uniqueArray(arbWeekday(), { minLength: 1, maxLength: 3 }),
        time: fc.constantFrom(...MEETING_TIMES),
        location: fc.constantFrom(...MEETING_LOCATIONS),
      }),
      fc.boolean(),
      fc.boolean(),
    )
    .map(
      ([
        entryId,
        name,
        image,
        [goals, issues, partners, methods, interests],
        majorsSought,
        advisors,
        meeting,
        extraLinkSection,
        twoColumn,
      ]) => ({
        entryId,
        name,
        image,
        goals,
        issuesAddressed: issues,
        partnersSponsors: partners,
        methodsTechnologies: methods,
        majorsSought,
        preferredInterests: interests,
        advisors,
        meeting: {
          weekdays: [...meeting.weekdays].sort(
            (a, b) => (weekdayRank.get(a) ?? 0) - (weekdayRank.get(b) ?? 0),
          ),
          time: meeting.time,
          location: meeting.location,
        },
        extraLinkSection,
        twoColumn,
      }),
    );
}

export function arbMutationPlan(): fc.Arbitrary<readonly Mutation[]> {
  const mutation = fc.oneof(
    fc
      .constantFrom(...SECTION_KEYS)
      .map(section => ({ kind: 'deleteSection', section }) as const),
    fc
      .constantFrom(...RENAMEABLE_SECTIONS)
      .map(section => ({ kind: 'renameHeading', section }) as const),
    fc.constant({ kind: 'stripMailLinks' } as const),
    fc
      .constantFrom<MeetingComponent[]>('day', 'time', 'location')
      .map(component => ({ kind: 'corruptMeeting', component }) as const),
    fc.constant({ kind: 'unbalanceTags' } as const),
  );

  return fc.uniqueArray<Mutation, string>(mutation, {
    maxLength: 4,
    selector: item => JSON.stringify(item),
  });
}

/**
 * A synthetic team page and its mutated form. The mutations are applied while
 * rendering rather than by editing the rendered string, so a deleted section is
 * genuinely absent and unbalanced markup is genuinely unbalanced rather than a
 * regular-expression accident.
 */
export function arbTeamPageHtml(
  options: { mutate?: boolean } = {},
): fc.Arbitrary<TeamPageSample> {
  const mutate = options.mutate ?? true;
  const plan = mutate
    ? arbMutationPlan()
    : fc.constant<readonly Mutation[]>([]);

  return fc.tuple(arbTeamPageModel(), plan).map(([model, mutations]) => ({
    sourceUrl: `https://vip.gatech.edu/teams/entry/${model.entryId}`,
    model,
    pristineHtml: renderTeamPage(model, []),
    html: renderTeamPage(model, mutations),
    mutations,
  }));
}

/** `model` as a team page with `mutations` applied. */
export function renderTeamPage(
  model: TeamPageModel,
  mutations: readonly Mutation[],
): string {
  const deleted = new Set(
    mutations.flatMap(m => (m.kind === 'deleteSection' ? [m.section] : [])),
  );
  const renamed = new Set(
    mutations.flatMap(m => (m.kind === 'renameHeading' ? [m.section] : [])),
  );
  const stripMail = mutations.some(m => m.kind === 'stripMailLinks');
  const corrupted = new Set(
    mutations.flatMap(m => (m.kind === 'corruptMeeting' ? [m.component] : [])),
  );
  const unbalance = mutations.some(m => m.kind === 'unbalanceTags');

  const section = (key: SectionKey, body: string): string => {
    if (deleted.has(key)) return '';

    const spellings = SECTION_HEADINGS[key];
    const heading =
      (renamed.has(key) ? spellings[1] : spellings[0]) ?? spellings[0]!;
    const headingHtml = `<h4>${heading}</h4>`;

    return model.twoColumn
      ? `<div class="row"><div class="col">${headingHtml}</div><div class="col">${body}</div></div>`
      : `${headingHtml}${body}`;
  };

  const paragraph = (text: string): string => `<p>${escapeHtml(text)}</p>`;

  const majorsBody = model.majorsSought
    .map(
      line =>
        `<p>${escapeHtml(line.college)}: ${line.majors
          .map(major => escapeHtml(major))
          .join(', ')}</p>`,
    )
    .join('');

  const advisorsBody = model.advisors
    .map(advisor => {
      const mail = stripMail
        ? `<span>${escapeHtml(advisor.email)}</span>`
        : `<a href="mailto:${escapeHtml(advisor.email)}">${escapeHtml(advisor.email)}</a>`;
      const affiliation =
        advisor.affiliation === ''
          ? ''
          : `<p>${escapeHtml(advisor.affiliation)}</p>`;

      return `<div class="advisor"><p>${escapeHtml(advisor.name)}</p>${affiliation}${mail}</div>`;
    })
    .join('');

  const meetingParts = [
    corrupted.has('day') ? '' : model.meeting.weekdays.join(', '),
    corrupted.has('time') ? '' : model.meeting.time,
    corrupted.has('location') ? '' : model.meeting.location,
  ].filter(part => part !== '');

  const image =
    model.image === null
      ? ''
      : `<img src="${escapeHtml(model.image.src)}" alt="${escapeHtml(model.image.alt)}">`;

  const linkSection = model.extraLinkSection
    ? '<h4>Link(s)</h4><p><a href="https://example.org/team">Team site</a></p>'
    : '';

  // An unclosed element and a stray closing tag, which the tolerant HTML parser
  // must recover from rather than reject (Requirement 2.9).
  const broken = unbalance ? '<div><p>trailing fragment</span>' : '';

  const body = [
    `<h1>${escapeHtml(model.name)}</h1>`,
    image,
    section('goals', paragraph(model.goals)),
    section('issuesAddressed', paragraph(model.issuesAddressed)),
    section('partnersSponsors', paragraph(model.partnersSponsors)),
    section('methodsTechnologies', paragraph(model.methodsTechnologies)),
    section('majorsSought', majorsBody),
    section('preferredInterests', paragraph(model.preferredInterests)),
    section('advisors', advisorsBody),
    section('meeting', `<p>${escapeHtml(meetingParts.join(' '))}</p>`),
    linkSection,
    broken,
  ].join('');

  return [
    '<!doctype html><html lang="en"><head><title>Teams</title></head><body>',
    '<header><h2>VIP</h2></header>',
    `<main><div id="content">${body}</div></main>`,
    '<footer><p>Georgia Tech</p></footer>',
    '</body></html>',
  ].join('');
}

// ---------------------------------------------------------------------------
// Virtual clock
// ---------------------------------------------------------------------------

export interface VirtualClock extends Clock {
  /** Every wait requested, in order, so pacing and backoff schedules can be asserted. */
  readonly waits: readonly number[];
}

/**
 * A `Clock` that advances instead of waiting: `sleep` records the wait and moves
 * `now` forward, so a generated pacing or retry schedule costs no real time.
 */
export function virtualClock(startMs = 0): VirtualClock {
  let time = startMs;
  const waits: number[] = [];

  return {
    now: () => time,
    sleep: ms => {
      waits.push(ms);
      time += ms;
      return Promise.resolve();
    },
    waits,
  };
}
