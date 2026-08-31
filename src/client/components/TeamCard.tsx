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
  const goals = team.goals.slice(0, GOALS_EXCERPT_LENGTH);
  const { day, time } = team.meeting;

  return (
    <article class="team-card">
      {hasImage &&
        (imageFailed ? (
          // Requirement 10.8: the placeholder stands in for the image and every
          // other field of the record still renders.
          <div
            class="team-card__image team-card__image--placeholder"
            role="img"
            aria-label={alt}
            data-testid="team-card-image-placeholder"
          />
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
        <ul class="team-card__colleges" data-testid="team-card-colleges">
          {colleges.map(college => (
            <li key={college}>
              <Highlighted text={college} terms={terms} />
            </li>
          ))}
        </ul>
      )}

      {(day !== '' || time !== '') && (
        <p class="team-card__meeting" data-testid="team-card-meeting">
          <span class="team-card__meeting-label">Meets</span>{' '}
          {day !== '' && <Highlighted text={day} terms={terms} />}
          {day !== '' && time !== '' && ' '}
          {time !== '' && <Highlighted text={time} terms={terms} />}
        </p>
      )}
    </article>
  );
}
