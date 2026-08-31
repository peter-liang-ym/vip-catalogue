// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { TeamRecord } from '../../shared/types';
import { CONFLICT_TEXT } from './TeamCard';
import {
  APPLICATION_LINK_TEXT,
  APPLICATION_URL,
  groupMajorsByCollege,
  HEADINGS,
  SOURCE_LINK_TEXT,
  TeamDetail,
} from './TeamDetail';

function record(overrides: Partial<TeamRecord> = {}): TeamRecord {
  return {
    entryId: '1248',
    sourceUrl: 'https://vip.gatech.edu/teams/entry/1248',
    name: 'Robotic Musicianship',
    imageUrl: 'https://vip.gatech.edu/files/robot.png',
    imagePath: 'images/1248.png',
    imageAlt: 'A robot playing a marimba',
    goals: 'Build robots that improvise music with human players.',
    issuesAddressed: 'Human-machine creativity.',
    partnersSponsors: 'Georgia Tech Center for Music Technology',
    methodsTechnologies: 'Machine listening, embedded control',
    majorsSought: [
      { college: 'Engineering', major: 'Mechanical Engineering' },
      { college: 'Computing', major: 'Computer Science' },
      { college: 'Engineering', major: 'Electrical Engineering' },
    ],
    preferredInterests: 'Signal processing coursework helps.',
    advisors: [
      {
        name: 'Gil Weinberg',
        affiliation: 'School of Music',
        email: 'gil@gatech.edu',
      },
    ],
    meeting: {
      day: 'Monday, Wednesday',
      time: '9:30-10:20',
      location: 'Couch 101',
    },
    meetingWindow: [{ weekday: 'Monday', startMinute: 570, endMinute: 620 }],
    ...overrides,
  };
}

function mount(props: Partial<Parameters<typeof TeamDetail>[0]> = {}) {
  render(
    <TeamDetail
      team={props.team ?? record()}
      conflictState={props.conflictState ?? null}
    >
      {props.children}
    </TeamDetail>,
  );
}

/** The section for one Requirement 9.1 field, or `null` when it was omitted. */
function field(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-field="${name}"]`);
}

afterEach(cleanup);

describe('groupMajorsByCollege', () => {
  it('keeps the record order of Colleges and groups their Majors', () => {
    expect(groupMajorsByCollege(record().majorsSought)).toEqual([
      {
        college: 'Engineering',
        majors: ['Mechanical Engineering', 'Electrical Engineering'],
      },
      { college: 'Computing', majors: ['Computer Science'] },
    ]);
  });

  it('folds case and surrounding whitespace when grouping', () => {
    expect(
      groupMajorsByCollege([
        { college: 'Computing', major: 'CS' },
        { college: ' computing ', major: ' cs ' },
        { college: 'COMPUTING', major: 'CM' },
      ]),
    ).toEqual([{ college: 'Computing', majors: ['CS', 'CM'] }]);
  });

  it('drops entries that name no Major', () => {
    expect(groupMajorsByCollege([{ college: 'Sciences', major: '' }])).toEqual(
      [],
    );
  });
});

describe('TeamDetail', () => {
  it('renders every Requirement 9.1 field of a complete record', () => {
    mount();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Robotic Musicianship',
    );
    expect(screen.getByRole('img').getAttribute('src')).toBe('images/1248.png');
    expect(field('goals')?.textContent).toContain('Build robots');
    expect(field('issuesAddressed')?.textContent).toContain(
      'Human-machine creativity.',
    );
    expect(field('partnersSponsors')?.textContent).toContain(
      'Music Technology',
    );
    expect(field('methodsTechnologies')?.textContent).toContain(
      'Machine listening',
    );
    expect(field('preferredInterests')?.textContent).toContain(
      'Signal processing',
    );
    expect(field('meeting')?.textContent).toContain('Monday, Wednesday');
    expect(field('meeting')?.textContent).toContain('9:30-10:20');
    expect(field('meeting')?.textContent).toContain('Couch 101');
  });

  it('groups the Majors under their College (Requirement 9.1)', () => {
    mount();
    const colleges = [
      ...(field('majorsSought')?.querySelectorAll('.team-detail__college') ??
        []),
    ];

    expect(colleges).toHaveLength(2);
    expect(colleges[0]?.textContent).toBe(
      'EngineeringMechanical EngineeringElectrical Engineering',
    );
    expect(colleges[1]?.textContent).toBe('ComputingComputer Science');
  });

  it('omits an empty field together with its heading (Requirement 9.6)', () => {
    mount({
      team: record({
        goals: '',
        issuesAddressed: '',
        partnersSponsors: '',
        methodsTechnologies: '',
        preferredInterests: '',
        majorsSought: [],
        advisors: [],
        imagePath: '',
        meeting: { day: '', time: '', location: '' },
      }),
    });

    for (const name of [
      'goals',
      'issuesAddressed',
      'partnersSponsors',
      'methodsTechnologies',
      'preferredInterests',
      'majorsSought',
      'advisors',
      'meeting',
    ]) {
      expect(field(name)).toBeNull();
    }
    expect(screen.queryByRole('img')).toBeNull();
    expect(
      screen.queryAllByRole('heading', { level: 2 }).map(h => h.textContent),
    ).toEqual([]);

    // The name and the two fixed links are all that is left.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Robotic Musicianship',
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('omits only the empty meeting values (Requirement 9.6)', () => {
    mount({
      team: record({ meeting: { day: 'Thursday', time: '', location: '' } }),
    });

    const meeting = field('meeting');
    expect(meeting?.textContent).toBe(`${HEADINGS.meeting}DayThursday`);
  });

  it('renders every advisor with a mail link where an email exists (Requirements 9.2, 9.7)', () => {
    mount({
      team: record({
        advisors: [
          {
            name: 'Gil Weinberg',
            affiliation: 'School of Music',
            email: 'gil@gatech.edu',
          },
          { name: 'No Link Person', affiliation: 'GTRI', email: '' },
        ],
      }),
    });

    const advisors = [
      ...(field('advisors')?.querySelectorAll('.team-detail__advisor') ?? []),
    ];
    expect(advisors).toHaveLength(2);

    expect(advisors[0]?.textContent).toBe(
      'Gil WeinbergSchool of Musicgil@gatech.edu',
    );
    expect(advisors[0]?.querySelector('a')?.getAttribute('href')).toBe(
      'mailto:gil@gatech.edu',
    );

    expect(advisors[1]?.textContent).toBe('No Link PersonGTRI');
    expect(advisors[1]?.querySelector('a')).toBeNull();
  });

  it('links to the source page and the application page (Requirement 9.3)', () => {
    mount();

    expect(screen.getByText(SOURCE_LINK_TEXT).getAttribute('href')).toBe(
      'https://vip.gatech.edu/teams/entry/1248',
    );
    expect(screen.getByText(APPLICATION_LINK_TEXT).getAttribute('href')).toBe(
      APPLICATION_URL,
    );
  });

  it('falls back to alt text naming the team when the record alt is empty (Requirement 10.7)', () => {
    mount({ team: record({ imageAlt: '' }) });

    expect(screen.getByRole('img').getAttribute('alt')).toBe(
      'Robotic Musicianship',
    );
  });

  it('swaps in a placeholder on an image error and keeps every other field (Requirement 10.8)', () => {
    mount();

    fireEvent.error(screen.getByRole('img'));

    expect(
      screen
        .getByTestId('team-detail-image-placeholder')
        .getAttribute('aria-label'),
    ).toBe('A robot playing a marimba');
    expect(field('goals')?.textContent).toContain('Build robots');
  });

  it('states each Conflict_State as text while a schedule is loaded (Requirements 15.4, 11.11)', () => {
    for (const state of ['conflicting', 'clear', 'unknown'] as const) {
      mount({ conflictState: state });
      expect(screen.getByText(CONFLICT_TEXT[state])).toBeTruthy();
      cleanup();
    }
  });

  it('shows no Conflict_State while no schedule is loaded (Requirement 15.7)', () => {
    mount({ conflictState: null });

    for (const state of ['conflicting', 'clear', 'unknown'] as const) {
      expect(screen.queryByText(CONFLICT_TEXT[state])).toBeNull();
    }
  });

  it('renders the Conflict_Detail it is given (Requirement 9.1)', () => {
    mount({
      conflictState: 'conflicting',
      children: <p data-testid="detail-slot">Monday 9:00–10:00</p>,
    });

    expect(screen.getByTestId('detail-slot').textContent).toBe(
      'Monday 9:00–10:00',
    );
  });
});
