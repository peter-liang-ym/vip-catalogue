/**
 * Team page parsing (Requirements 2.1, 2.2, 2.4, 2.5, 2.6).
 *
 * Extraction is heading-anchored: a section is located by its heading text, not by
 * its position or its generated wrapper class, so a reordered page still parses and
 * a renamed heading degrades to one empty field rather than a wrong one. The
 * documented heading alternates (`Issues Addressed`, `Partners and Sponsors`,
 * `Advisor` singular, `Day, Time and Location`) are accepted, and sections outside
 * the schema (`Link(s)`) are ignored.
 *
 * Every text value goes through `normalizeText`, and the Meeting_Window is derived
 * from the meeting day and time text without modifying either of them.
 */

import { load } from 'cheerio';
import {
  MAX_ADVISORS,
  MAX_MAJOR_ENTRIES,
  MAX_SHORT_TEXT_LENGTH,
  type Advisor,
  type MajorEntry,
  type MeetingInfo,
  type TeamRecord,
} from '../shared/types';
import { deriveMeetingWindow, WEEKDAY_WORD_SOURCE } from './meetingWindow';
import { normalizeText } from './normalize';

export interface ParseError {
  readonly sourceUrl: string;
  readonly message: string;
}

export interface Omission {
  readonly sourceUrl: string;
  readonly detail: string;
}

export interface ParseOutcome {
  readonly record?: TeamRecord;
  readonly parseErrors: readonly ParseError[];
  readonly omissions: readonly Omission[];
}

type CheerioApi = ReturnType<typeof load>;
/** A selection of elements: what `$(selector)`, `find`, `children`, and `eq` return. */
type Selection = ReturnType<ReturnType<CheerioApi['root']>['children']>;

const SOURCE_ORIGIN = 'https://vip.gatech.edu';

/** Containers tried in order; the first one holding a section heading wins. */
const CONTENT_SELECTORS = [
  'main #content',
  '#content',
  'main',
  'body',
] as const;

const MAILTO = 'a[href^="mailto:"]';

/** Section headings, with the documented alternates for each. */
const SECTION_ALIASES = {
  goals: ['goals'],
  issuesAddressed: ['issues involved or addressed', 'issues addressed'],
  partnersSponsors: ['partners/sponsors', 'partners and sponsors'],
  methodsTechnologies: ['methods and technologies'],
  majorsSought: ['majors sought'],
  preferredInterests: ['preferred interests and preparation'],
  advisors: ['advisor', 'advisors'],
  meeting: ['day, time & location', 'day, time and location'],
} as const satisfies Record<string, readonly string[]>;

type SectionKey = keyof typeof SECTION_ALIASES;

const ALIAS_TO_KEY = new Map<string, SectionKey>(
  (Object.keys(SECTION_ALIASES) as SectionKey[]).flatMap(key =>
    SECTION_ALIASES[key].map(alias => [alias, key] as [string, SectionKey]),
  ),
);

const HEADINGS = 'h1,h2,h3,h4,h5,h6';

/** Heading matching ignores case, non-breaking spaces, whitespace runs, and a trailing colon. */
function foldHeading(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
}

function sectionKeyOf(headingText: string): SectionKey | null {
  return ALIAS_TO_KEY.get(foldHeading(headingText)) ?? null;
}

/** Collapses, trims, and caps one of the 200-character fields (Requirements 2.2, 2.4, 2.5). */
function capShort(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= MAX_SHORT_TEXT_LENGTH
    ? collapsed
    : collapsed.slice(0, MAX_SHORT_TEXT_LENGTH).trimEnd();
}

/** `1`..`6` for a heading element, `null` for anything else. */
function headingRank(selection: Selection): number | null {
  for (let rank = 1; rank <= 6; rank += 1) {
    if (selection.is(`h${rank}`)) return rank;
  }
  return null;
}

function resolveContent($: CheerioApi): Selection {
  const candidates = CONTENT_SELECTORS.map(selector => $(selector)).filter(
    selection => selection.length > 0,
  );

  const withHeadings = candidates.find(selection => {
    const headings = selection.find(HEADINGS);
    for (let i = 0; i < headings.length; i += 1) {
      if (sectionKeyOf(headings.eq(i).text()) !== null) return true;
    }
    return false;
  });

  return withHeadings ?? candidates[0] ?? $('body');
}

/**
 * Section body: the sibling nodes following the heading, up to the next heading of
 * the same or higher rank. Returns the raw HTML per located section; a section that
 * is absent has no entry.
 */
function sectionBodies(
  $: CheerioApi,
  $content: Selection,
): Map<SectionKey, string> {
  const bodies = new Map<SectionKey, string>();
  const headings = $content.find(HEADINGS);

  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings.eq(i);
    const key = sectionKeyOf(heading.text());
    if (key === null || bodies.has(key)) continue;

    const rank = headingRank(heading) ?? 6;
    const siblings = heading.nextAll();
    const parts: string[] = [];

    for (let j = 0; j < siblings.length; j += 1) {
      const sibling = siblings.eq(j);
      const siblingRank = headingRank(sibling);
      if (siblingRank !== null && siblingRank <= rank) break;
      parts.push($.html(sibling));
    }

    bodies.set(key, parts.join(''));
  }

  return bodies;
}

/** Zero-width and bidi format characters, which carry no visible name text. */
const INVISIBLE = /[\u200b-\u200f\u2060\ufeff]/g;

/** True when the text holds no visible character (Requirement 2.8). */
function isBlank(text: string): boolean {
  return text.replace(INVISIBLE, '').trim() === '';
}

/** First `h1` inside the content container that is not the page title. */
function extractName($: CheerioApi, $content: Selection): string {
  const candidates = $content.find('h1');

  for (let i = 0; i < candidates.length; i += 1) {
    const text = normalizeText($.html(candidates.eq(i)));
    if (!isBlank(text) && foldHeading(text) !== 'teams') return text;
  }

  return '';
}

function absoluteUrl(src: string, base: string): string {
  try {
    return new URL(src, base).toString();
  } catch {
    return '';
  }
}

/**
 * The header image is the first `img` inside the content container that precedes
 * the first section heading, so theme chrome and in-section images are not picked
 * up. `find` returns document order, which is what the walk relies on.
 */
function extractImage(
  $content: Selection,
  sourceUrl: string,
): { imageUrl: string; imageAlt: string } {
  const nodes = $content.find('img, h2, h3, h4, h5, h6');

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes.eq(i);

    if (!node.is('img')) {
      if (sectionKeyOf(node.text()) !== null) break;
      continue;
    }

    const src = node.attr('src')?.trim() ?? '';
    if (src === '') continue;

    const imageUrl = absoluteUrl(src, sourceUrl);
    if (imageUrl === '') continue;

    return { imageUrl, imageAlt: normalizeText(node.attr('alt') ?? '') };
  }

  return { imageUrl: '', imageAlt: '' };
}

/**
 * The local cached copy the publish store writes for this record
 * (`images/{entryId}.{ext}`). Empty when there is no image or the source URL
 * carries no usable extension, in which case the UI falls back to `imageUrl`.
 */
function deriveImagePath(entryId: string, imageUrl: string): string {
  if (entryId === '' || imageUrl === '') return '';

  let pathname: string;
  try {
    pathname = new URL(imageUrl).pathname;
  } catch {
    return '';
  }

  const extension = /\.([a-z0-9]{1,5})$/i.exec(pathname)?.[1];
  return extension === undefined
    ? ''
    : `images/${entryId}.${extension.toLowerCase()}`;
}

/**
 * `College: Major, Major` per line. Lines with no colon are skipped and reported,
 * pairs are deduplicated case-insensitively, and the list is capped
 * (Requirements 2.2, 2.7).
 */
function parseMajors(bodyHtml: string): {
  entries: MajorEntry[];
  skippedLines: string[];
} {
  const entries: MajorEntry[] = [];
  const skippedLines: string[] = [];
  const seen = new Set<string>();

  for (const line of normalizeText(bodyHtml).split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) {
      if (line.trim() !== '') skippedLines.push(capShort(line));
      continue;
    }

    const college = capShort(line.slice(0, separator));
    if (college === '') continue;

    for (const part of line.slice(separator + 1).split(',')) {
      const major = capShort(part);
      if (major === '') continue;

      const key = `${college.toLowerCase()}\u0000${major.toLowerCase()}`;
      if (seen.has(key)) continue;

      seen.add(key);
      entries.push({ college, major });
      if (entries.length >= MAX_MAJOR_ENTRIES) return { entries, skippedLines };
    }
  }

  return { entries, skippedLines };
}

function mailLink(block: Selection): Selection {
  return block.is(MAILTO) ? block : block.find(MAILTO).first();
}

function mailtoAddress(href: string): string {
  const address = href.replace(/^mailto:/i, '').split('?')[0] ?? '';
  try {
    return capShort(decodeURIComponent(address));
  } catch {
    return capShort(address);
  }
}

function parseAdvisorBlock($b: CheerioApi, block: Selection): Advisor | null {
  const link = mailLink(block);
  const email = link.length > 0 ? mailtoAddress(link.attr('href') ?? '') : '';

  const withoutLink = block.clone();
  withoutLink.find(MAILTO).remove();

  const lines = normalizeText($b.html(withoutLink))
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');

  if (lines.length === 0 && email === '') return null;

  return {
    name: capShort(lines[0] ?? ''),
    affiliation: capShort(lines.slice(1).join(' ')),
    email,
  };
}

/**
 * One advisor per block. A block is an element carrying a `mailto:` link; a block
 * without one counts only when it sits between two mail-linked blocks, or when the
 * section carries no mail link at all (Requirement 2.4).
 */
function parseAdvisors(bodyHtml: string): Advisor[] {
  const $b = load(bodyHtml, null, false);

  // A single wrapper element holding every advisor is descended into, so the
  // blocks are the advisors rather than the wrapper.
  let blocks = $b.root().children();
  while (blocks.length === 1 && blocks.find(MAILTO).length > 1) {
    const inner = blocks.children();
    if (inner.length === 0) break;
    blocks = inner;
  }

  const mailed: number[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    if (mailLink(blocks.eq(i)).length > 0) mailed.push(i);
  }
  const first = mailed[0] ?? -1;
  const last = mailed[mailed.length - 1] ?? -1;

  const advisors: Advisor[] = [];
  for (let i = 0; i < blocks.length && advisors.length < MAX_ADVISORS; i += 1) {
    const block = blocks.eq(i);
    const hasMail = mailLink(block).length > 0;
    if (!hasMail && first >= 0 && !(i > first && i < last)) continue;

    const advisor = parseAdvisorBlock($b, block);
    if (advisor !== null) advisors.push(advisor);
  }

  return advisors;
}

const WEEKDAY_RUN = new RegExp(
  `(?:${WEEKDAY_WORD_SOURCE})\\b(?:[\\s,/&]*(?:and\\b\\s*)?(?:${WEEKDAY_WORD_SOURCE})\\b)*`,
  'i',
);
const MEETING_LABEL = /full\s*team\s*meeting\s*:?/i;
const MEETING_TIME =
  /\d{1,2}:\d{2}(?:\s*(?:-|\u2013|\u2014|to|until)\s*\d{1,2}(?::\d{2})?)?(?:\s*[ap]\.?m\.?)?/i;
const EDGE_SEPARATORS = /^[\s,;:|\u2013\u2014-]+|[\s,;:|\u2013\u2014-]+$/g;

/**
 * Splits the `Day, Time & Location` body into its three values (Requirement 2.5).
 * A component that cannot be identified is empty and the components that did match
 * are kept.
 */
function parseMeeting(bodyHtml: string): MeetingInfo {
  const text = normalizeText(bodyHtml).replace(MEETING_LABEL, ' ');

  const dayMatch = WEEKDAY_RUN.exec(text);
  const day = dayMatch === null ? '' : dayMatch[0];
  const afterDay =
    dayMatch === null
      ? text
      : `${text.slice(0, dayMatch.index)} ${text.slice(dayMatch.index + dayMatch[0].length)}`;

  const timeMatch = MEETING_TIME.exec(afterDay);
  const time = timeMatch === null ? '' : timeMatch[0];
  const afterTime =
    timeMatch === null
      ? afterDay
      : `${afterDay.slice(0, timeMatch.index)} ${afterDay.slice(timeMatch.index + timeMatch[0].length)}`;

  return {
    day: capShort(day),
    time: capShort(time),
    location: capShort(
      afterTime.replace(/\s+/g, ' ').replace(EDGE_SEPARATORS, ''),
    ),
  };
}

const MEETING_COMPONENTS = ['day', 'time', 'location'] as const;

/**
 * Converts one Source_Document into a Team_Record. Every field degrades on its own
 * — an unreadable section empties that one field and is recorded as an omission,
 * never as a failure of the record (Requirements 2.3, 2.7, 2.10, 2.11). A document
 * with no team name is the single exception: it yields a parse error and no record
 * (Requirement 2.8).
 */
export function parseTeamPage(html: string, sourceUrl: string): ParseOutcome {
  const parseErrors: ParseError[] = [];
  const omissions: Omission[] = [];
  const omit = (detail: string): void => {
    omissions.push({ sourceUrl, detail });
  };

  const $ = load(html);
  const $content = resolveContent($);

  const entryId = /entry\/(\d+)/.exec(sourceUrl)?.[1] ?? '';
  const canonicalUrl =
    entryId === '' ? sourceUrl : `${SOURCE_ORIGIN}/teams/entry/${entryId}`;

  const name = extractName($, $content);
  if (name === '') {
    parseErrors.push({ sourceUrl, message: 'missing team name' });
    return { parseErrors, omissions };
  }

  const bodies = sectionBodies($, $content);

  /** Records the absent and the present-but-empty case, and empties the field. */
  const textSection = (key: SectionKey): string => {
    const body = bodies.get(key);
    if (body === undefined) {
      omit(`missing section: ${key}`);
      return '';
    }

    const text = normalizeText(body);
    if (text === '') omit(`empty section: ${key}`);
    return text;
  };

  const goals = textSection('goals');
  const issuesAddressed = textSection('issuesAddressed');
  const partnersSponsors = textSection('partnersSponsors');
  const methodsTechnologies = textSection('methodsTechnologies');

  const majorsBody = bodies.get('majorsSought');
  let majorsSought: MajorEntry[] = [];
  if (majorsBody === undefined) {
    omit('missing section: majorsSought');
  } else {
    const { entries, skippedLines } = parseMajors(majorsBody);
    majorsSought = entries;
    for (const line of skippedLines) {
      omit(`majors line with no colon: ${line}`);
    }
    // Requirement 2.3: a present section with no majors is an empty list, not an error.
    if (entries.length === 0) omit('empty section: majorsSought');
  }

  const preferredInterests = textSection('preferredInterests');

  const advisorsBody = bodies.get('advisors');
  let advisors: Advisor[] = [];
  if (advisorsBody === undefined) {
    omit('missing section: advisors');
  } else {
    advisors = parseAdvisors(advisorsBody);
    if (advisors.length === 0) omit('empty section: advisors');
    for (const advisor of advisors) {
      // Requirement 2.10: the entry stays, only its email is empty.
      if (advisor.email === '') {
        omit(`advisor with no email: ${advisor.name}`);
      }
    }
  }

  const meetingBody = bodies.get('meeting');
  let meeting: MeetingInfo = { day: '', time: '', location: '' };
  if (meetingBody === undefined) {
    omit('missing section: meeting');
  } else {
    meeting = parseMeeting(meetingBody);
    // Requirement 2.11: name the components that could not be identified and keep
    // the ones that could.
    const unidentified = MEETING_COMPONENTS.filter(
      component => meeting[component] === '',
    );
    if (unidentified.length > 0) {
      omit(`unidentified meeting values: ${unidentified.join(', ')}`);
    }
  }

  const { window, failures } = deriveMeetingWindow(meeting.day, meeting.time);
  if (meetingBody !== undefined && failures.length > 0) {
    omit(
      `meeting window unavailable (${failures.join(', ')}): ` +
        `day="${meeting.day}" time="${meeting.time}"`,
    );
  }

  const { imageUrl, imageAlt } = extractImage($content, sourceUrl);

  const record: TeamRecord = {
    entryId,
    sourceUrl: canonicalUrl,
    name,
    imageUrl,
    imagePath: deriveImagePath(entryId, imageUrl),
    imageAlt,
    goals,
    issuesAddressed,
    partnersSponsors,
    methodsTechnologies,
    majorsSought,
    preferredInterests,
    advisors,
    meeting,
    meetingWindow: window,
  };

  return { record, parseErrors, omissions };
}
