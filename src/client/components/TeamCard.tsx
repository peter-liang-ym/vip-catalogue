/**
 * Team_Card (Requirements 4.2, 5.5, 10.5, 10.7, 10.8, 11.11, 15.4).
 *
 * One card renders exactly the fields Requirement 4.2 names: the team name, the
 * image, at most the first 200 characters of the goals text, each distinct
 * College once, the Meeting_Info day and time text when either is non-empty, and
 * — only while a Busy_Schedule is loaded — the Conflict_State.
 *
 * Every text run passes through `highlight`, so Requirement 5.5's marking covers
 * all of the displayed card text rather than the name alone, and the marking is
 * lossless: the characters rendered are the record's own.
 *
 * The card is presentational. It holds one piece of local state — whether the
 * `img` raised `error` — because that is a fact about this DOM node and nothing
 * above it can know it (Requirement 10.8).
 */

import { useState } from 'preact/hooks';
import type { ConflictState, TeamRecord } from '../../shared/types';
import { foldValue } from '../facets';
import { highlight } from '../highlight';

/** Requirement 4.2: a card shows at most this much of the goals text. */
export const GOALS_EXCERPT_LENGTH = 200;

/** The one character Requirement 4.2's excerpt ends with when it is a cut. */
const ELLIPSIS = '…';

/**
 * Requirement 4.2's goals excerpt: the whole goals text when it fits, and
 * otherwise the longest prefix that ends on a word boundary inside the bound,
 * followed by an ellipsis.
 *
 * The ellipsis is budgeted out of the 200 characters rather than added to them,
 * so the excerpt is at most 200 characters including it.
 *
 * The truncation is the text this function returns, not a CSS effect: the card's
 * three-line clamp is a second, visual bound over an already-bounded string, so a
 * render with no stylesheet still shows bounded text.
 *
 * A goals text with no whitespace inside the bound — one unbroken 200-character
 * run — has no word boundary to end on, and then the cut is where the bound is:
 * some excerpt is more useful than none, and the ellipsis still says it is a cut.
 */
export function goalsExcerpt(goals: string): string {
  if (goals.length <= GOALS_EXCERPT_LENGTH) return goals;

  const bounded = goals.slice(0, GOALS_EXCERPT_LENGTH - ELLIPSIS.length);
  /* Drop the trailing run of non-whitespace, which is the word the bound fell
     inside, together with the whitespace before it. */
  const toBoundary = bounded.replace(/\s+\S*$/u, '');

  return `${(toBoundary === '' ? bounded : toBoundary).trimEnd()}${ELLIPSIS}`;
}

/**
 * The Conflict_State as text (Requirements 15.4, 11.11). Text, not color, is what
 * carries the state, and being ordinary card text is what exposes it to assistive
 * technology. Exported so the Team_Detail_View states it the same way.
 */
export const CONFLICT_TEXT: Readonly<Record<ConflictState, string>> = {
  conflicting: 'Conflicts with your loaded calendar',
  clear: 'Does not conflict with your loaded calendar',
  unknown: 'Meeting time unknown',
};

export interface TeamCardProps {
  readonly team: TeamRecord;
  /** The Search_Query terms to mark, from `terms(query)`; empty marks nothing. */
  readonly terms: readonly string[];
  /** `null` whenever no Busy_Schedule is loaded, and then no state is shown (Requirement 15.7). */
  readonly conflictState: ConflictState | null;
  /** The Team_Detail_View address for this team. */
  readonly href: string;
  readonly onOpen: () => void;
}

/** `text` with every case-insensitive occurrence of every term marked (Requirement 5.5). */
function Highlighted({
  text,
  terms,
}: {
  readonly text: string;
  readonly terms: readonly string[];
}) {
  return (
    <>
      {highlight(text, terms).map((segment, i) =>
        segment.marked ? (
          <mark key={i}>{segment.text}</mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Each distinct College of `majorsSought`, once (Requirement 4.2), in the order
 * the record lists them and spelled the way it first spells them.
 *
 * Distinctness folds letter case and surrounding whitespace, the same comparison
 * the College Filter uses, so a record pairing `Computing` and ` computing ` with
 * different Majors names one College on the card and offers one Filter value.
 */
function distinctColleges(team: TeamRecord): readonly string[] {
  const byFolded = new Map<string, string>();

  for (const entry of team.majorsSought) {
    const folded = foldValue(entry.college);
    if (folded === '' || byFolded.has(folded)) continue;
    byFolded.set(folded, entry.college.trim());
  }

  return [...byFolded.values()];
}

export function TeamCard({
  team,
  terms,
  conflictState,
  href,
  onOpen,
}: TeamCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  /** Requirement 10.7: an empty `imageAlt` falls back to alt text naming the team. */
  const alt = team.imageAlt === '' ? team.name : team.imageAlt;

  /**
   * The published local copy is the only image the site serves, so its absence —
   * whether the source page had no image or the cached copy could not be
   * written — is the no-image case, and the card renders no image region rather
   * than a broken one (Requirement 4.2).
   */
  const hasImage = team.imagePath !== '';
  const colleges = distinctColleges(team);
  const goals = goalsExcerpt(team.goals);
  const { day, time } = team.meeting;

  /**
   * The placeholder's one character: the team's first, upper-cased. Split by code
   * point so a name beginning with an astral character is not halved. The name is
   * never empty in a valid Dataset, so this is a character in practice, but an
   * empty string renders an empty placeholder rather than throwing.
   */
  const initial = ([...team.name.trim()][0] ?? '').toUpperCase();

  return (
    // `surface rail` are the identity primitives: the flat bordered surface, and
    // the 4px left edge that takes its color from the `data-conflict` attribute on
    // the Conflict_State paragraph below. Both are decoration over the same
    // markup — the state is text either way (Requirement 11.11).
    <article class="team-card surface rail">
      {hasImage &&
        (imageFailed ? (
          // Requirement 10.8: the placeholder stands in for the image and every
          // other field of the record still renders. It carries the team's first
          // character rather than being an empty bordered box, so a card whose
          // image is missing still shows something at image size.
          //
          // The character is decoration: `role="img"` with the record's alt text
          // is the accessible name of this element, so the letter is never read
          // out and is hidden from assistive technology explicitly.
          <div
            class="team-card__image team-card__image--placeholder"
            role="img"
            aria-label={alt}
            data-testid="team-card-image-placeholder"
          >
            <span class="team-card__initial" aria-hidden="true">
              {initial}
            </span>
          </div>
        ) : (
          <img
            class="team-card__image"
            src={team.imagePath}
            alt={alt}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ))}

      <h2 class="team-card__name">
        <a
          href={href}
          onClick={event => {
            event.preventDefault();
            onOpen();
          }}
        >
          <Highlighted text={team.name} terms={terms} />
        </a>
      </h2>

      {conflictState !== null && (
        <p class="team-card__conflict" data-conflict={conflictState}>
          {CONFLICT_TEXT[conflictState]}
        </p>
      )}

      {goals !== '' && (
        <p class="team-card__goals" data-testid="team-card-goals">
          <Highlighted text={goals} terms={terms} />
        </p>
      )}

      {colleges.length > 0 && (
        // Chips on one wrapping row rather than a labeled list: at card density a
        // label on its own line above a stack of one College per line is most of
        // the card's height. Each chip is bounded, which is the job the
        // one-per-line list was doing — two Colleges cannot be read as one name —
        // and the label goes because a College name says which field it is.
        <ul
          class="team-card__colleges chip-list"
          data-testid="team-card-colleges"
        >
          {colleges.map(college => (
            <li key={college} class="chip">
              <Highlighted text={college} terms={terms} />
            </li>
          ))}
        </ul>
      )}

      {(day !== '' || time !== '') && (
        <p class="team-card__meeting" data-testid="team-card-meeting">
          {/* `field-row__label` is the shared field-label face, so `Meets` here
              and a field label in the Team_Detail_View read identically. */}
          <span class="team-card__meeting-label field-row__label">Meets</span>{' '}
          {day !== '' && <Highlighted text={day} terms={terms} />}
          {day !== '' && time !== '' && ' '}
          {time !== '' && <Highlighted text={time} terms={terms} />}
        </p>
      )}
    </article>
  );
}
