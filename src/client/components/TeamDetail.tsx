/**
 * Team_Detail_View (Requirements 9.1, 9.2, 9.3, 9.6, 9.7).
 *
 * The full presentation of one Team_Record: every field Requirement 9.1 names, in
 * the order that requirement names them, with the Majors grouped by College, one
 * block per Advisor, and the two fixed links Requirement 9.3 requires — the
 * Source_Site page for this team and the official VIP application page.
 *
 * Requirement 9.6 is the shape of the whole component: a field whose value is
 * `''` or `[]` renders neither its heading nor its value. That is one condition per
 * section rather than a filtered list, because the sections are heterogeneous —
 * text, grouped Majors, Advisor blocks, the three meeting values — and every one of
 * them has to answer the same question about its own emptiness.
 *
 * The view is presentational and derives nothing. The Conflict_State arrives as a
 * prop and is `null` whenever no Busy_Schedule is loaded, which is what shows no
 * conflict information at all (Requirement 15.7), and it is stated with the text
 * the Team_Card uses so both surfaces word the same state the same way
 * (Requirements 15.4, 11.11). The Conflict_Detail that Requirement 9.1 asks for
 * where the state is `conflicting` comes in through `children`: the blocks and
 * their event summaries are calendar rendering, not record rendering, so they stay
 * with the rest of the calendar surfaces rather than being spelled a second time
 * here.
 *
 * The one piece of local state is whether the `img` raised `error`, for the same
 * reason the Team_Card holds it: nothing above this component can know it
 * (Requirement 10.8).
 */

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { ConflictState, MajorEntry, TeamRecord } from '../../shared/types';
import { foldValue } from '../facets';
import { CONFLICT_TEXT } from './TeamCard';

/** Requirement 9.3: the official VIP application page, as the Source_Site links it. */
export const APPLICATION_URL = 'https://vip.gatech.edu/application/';

/**
 * Where an Advisor address would have been. Names the destination and says what
 * is there, so a visitor looking for contact details knows one click reaches them.
 */
export const ADVISOR_CONTACT_TEXT =
  'Advisor contact details are on the official VIP team page';

/** The two fixed links (Requirement 9.3). Each names where it goes, not "click here". */
export const SOURCE_LINK_TEXT = 'View this team on the official VIP site';
export const APPLICATION_LINK_TEXT = 'Apply to VIP on the official VIP site';

/** How each Requirement 9.1 field is headed. */
export const HEADINGS = {
  goals: 'Goals',
  issuesAddressed: 'Issues involved or addressed',
  partnersSponsors: 'Partners and sponsors',
  methodsTechnologies: 'Methods and technologies',
  majorsSought: 'Majors sought',
  preferredInterests: 'Preferred interests and preparation',
  advisors: 'Advisors',
  meeting: 'Meeting',
} as const;

/** The three Meeting_Info values, each labeled and each omitted when empty. */
export const MEETING_LABELS = {
  day: 'Day',
  time: 'Time',
  location: 'Location',
} as const;

/** One College and the Majors the record pairs with it. */
export interface MajorGroup {
  /** The College as the record first spells it; `''` when the record states none. */
  readonly college: string;
  readonly majors: readonly string[];
}

/**
 * `majorsSought` grouped by College (Requirement 9.1).
 *
 * Colleges keep the order the record lists them in and the spelling it first uses,
 * folding letter case and surrounding whitespace to decide which entries belong to
 * the same College — the same comparison the College Filter makes, so the groups a
 * visitor reads here and the Filter values they can select agree. Majors are
 * deduplicated the same way within a group, and an entry naming no Major
 * contributes nothing.
 */
export function groupMajorsByCollege(
  entries: readonly MajorEntry[],
): readonly MajorGroup[] {
  const groups = new Map<string, { college: string; majors: string[] }>();

  for (const entry of entries) {
    const major = entry.major.trim();
    if (major === '') continue;

    const key = foldValue(entry.college);
    const group = groups.get(key) ?? {
      college: entry.college.trim(),
      majors: [],
    };
    groups.set(key, group);

    if (!group.majors.some(seen => foldValue(seen) === foldValue(major))) {
      group.majors.push(major);
    }
  }

  return [...groups.values()];
}

export interface TeamDetailProps {
  readonly team: TeamRecord;
  /** `null` whenever no Busy_Schedule is loaded, and then no state is shown (Requirement 15.7). */
  readonly conflictState: ConflictState | null;
  /** The Conflict_Detail for a conflicting team (Requirement 9.1); nothing otherwise. */
  readonly children?: ComponentChildren;
}

/** One text field with its heading, both omitted when the value is empty (Requirement 9.6). */
function TextSection({
  field,
  heading,
  text,
}: {
  readonly field: string;
  readonly heading: string;
  readonly text: string;
}) {
  if (text === '') return null;

  return (
    <section class="team-detail__section" data-field={field}>
      <h2 class="team-detail__heading">{heading}</h2>
      {/* The record's text keeps the line breaks `normalizeText` left in it. */}
      <p class="team-detail__text">{text}</p>
    </section>
  );
}

export function TeamDetail({ team, conflictState, children }: TeamDetailProps) {
  const [imageFailed, setImageFailed] = useState(false);

  /** Requirement 10.7: an empty `imageAlt` falls back to alt text naming the team. */
  const alt = team.imageAlt === '' ? team.name : team.imageAlt;
  const hasImage = team.imagePath !== '';
  const majorGroups = groupMajorsByCollege(team.majorsSought);
  const { day, time, location } = team.meeting;
  const hasMeeting = day !== '' || time !== '' || location !== '';

  return (
    <main class="team-detail" data-testid="team-detail">
      <h1 class="team-detail__name">{team.name}</h1>

      {hasImage &&
        (imageFailed ? (
          // Requirement 10.8: the placeholder stands in for the image and every
          // other field of the record still renders.
          <div
            class="team-detail__image team-detail__image--placeholder"
            role="img"
            aria-label={alt}
            data-testid="team-detail-image-placeholder"
          />
        ) : (
          <img
            class="team-detail__image"
            src={team.imagePath}
            alt={alt}
            onError={() => setImageFailed(true)}
          />
        ))}

      {conflictState !== null && (
        <p class="team-detail__conflict" data-conflict={conflictState}>
          {CONFLICT_TEXT[conflictState]}
        </p>
      )}

      {children}

      <TextSection field="goals" heading={HEADINGS.goals} text={team.goals} />
      <TextSection
        field="issuesAddressed"
        heading={HEADINGS.issuesAddressed}
        text={team.issuesAddressed}
      />
      <TextSection
        field="partnersSponsors"
        heading={HEADINGS.partnersSponsors}
        text={team.partnersSponsors}
      />
      <TextSection
        field="methodsTechnologies"
        heading={HEADINGS.methodsTechnologies}
        text={team.methodsTechnologies}
      />

      {majorGroups.length > 0 && (
        <section class="team-detail__section" data-field="majorsSought">
          <h2 class="team-detail__heading">{HEADINGS.majorsSought}</h2>
          <ul class="team-detail__colleges">
            {majorGroups.map(group => (
              <li class="team-detail__college" key={group.college}>
                {group.college !== '' && (
                  <h3 class="team-detail__college-name">{group.college}</h3>
                )}
                <ul class="team-detail__majors">
                  {group.majors.map(major => (
                    <li key={major}>{major}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TextSection
        field="preferredInterests"
        heading={HEADINGS.preferredInterests}
        text={team.preferredInterests}
      />

      {/* Requirement 9.2: every Advisor entry, with its name and affiliation.
          Advisor addresses are not published (see `parseAdvisors` in the Parser),
          so contact goes through the Source_Site page rather than a mail link. */}
      {team.advisors.length > 0 && (
        <section class="team-detail__section" data-field="advisors">
          <h2 class="team-detail__heading">{HEADINGS.advisors}</h2>
          <ul class="team-detail__advisors">
            {team.advisors.map(advisor => (
              <li class="team-detail__advisor" key={advisor.name}>
                <span class="team-detail__advisor-name">{advisor.name}</span>
                {advisor.affiliation !== '' && (
                  <span class="team-detail__advisor-affiliation">
                    {advisor.affiliation}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p class="team-detail__advisor-contact">
            <a href={team.sourceUrl} rel="noreferrer">
              {ADVISOR_CONTACT_TEXT}
            </a>
          </p>
        </section>
      )}

      {hasMeeting && (
        <section class="team-detail__section" data-field="meeting">
          <h2 class="team-detail__heading">{HEADINGS.meeting}</h2>
          <dl class="team-detail__meeting">
            {(['day', 'time', 'location'] as const)
              .filter(part => team.meeting[part] !== '')
              .map(part => (
                <div class="team-detail__meeting-part" key={part}>
                  <dt>{MEETING_LABELS[part]}</dt>
                  <dd>{team.meeting[part]}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}

      {/* Requirement 9.3: the source page for this team, and the application page.
          Both leave the mirror, so both are ordinary external links. */}
      <p class="team-detail__links">
        <a
          class="team-detail__source-link"
          href={team.sourceUrl}
          rel="noreferrer"
        >
          {SOURCE_LINK_TEXT}
        </a>
        <a
          class="team-detail__application-link"
          href={APPLICATION_URL}
          rel="noreferrer"
        >
          {APPLICATION_LINK_TEXT}
        </a>
      </p>
    </main>
  );
}
