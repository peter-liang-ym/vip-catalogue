/**
 * `parseTeamPage` against the saved Source_Documents (task 4.6).
 *
 * `parser.test.ts` builds its markup inline, which keeps each degradation rule
 * readable but shares one shape: the heading followed by its own content. The live
 * pages do not. Only three of the eight sections are laid out that way; the rest sit
 * in a two-column grid whose first column holds nothing but the heading. A parser
 * that only walks the heading's own siblings passes every inline test and still
 * returns five empty fields for every real page, which is what happened — the
 * published Dataset carried no majors, no advisors, and no meeting for any team, so
 * all four Filters offered nothing and every Meeting_Window was null.
 *
 * These tests read the captured files, so the layouts the parser actually meets are
 * the ones under assertion. `grid-shaped section bodies` additionally pins the shape
 * with synthetic markup, because `bun run ingest:fixtures` overwrites the captured
 * files: if a future capture drifts, that test still fails for the right reason.
 *
 * _Requirements: 2.1, 2.2, 2.4, 2.5, 2.7, 2.10, 2.11_
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTeamPage } from './parser';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../fixtures/html/${name}`, import.meta.url)),
    'utf8',
  );

const entryUrl = (entryId: string): string =>
  `https://vip.gatech.edu/teams/entry/${entryId}`;

const parseFixture = (name: string, entryId: string) =>
  parseTeamPage(fixture(name), entryUrl(entryId));

describe('parseTeamPage over entry-1248.html', () => {
  const { record, parseErrors, omissions } = parseFixture(
    'entry-1248.html',
    '1248',
  );

  it('reports no parse error and no omission', () => {
    expect(parseErrors).toEqual([]);
    expect(omissions).toEqual([]);
  });

  it('extracts the identity, name, and header image', () => {
    expect(record).toMatchObject({
      entryId: '1248',
      sourceUrl: entryUrl('1248'),
      name: '2D Heterostructure Synthesis',
      imageUrl:
        'https://vip.gatech.edu/files/formidable/18/2025-10-31/2D-Heterostructure-Synthesis.Resized-Pic-1-c6bc52-300x224.png',
      imagePath: 'images/1248.png',
      imageAlt:
        'Large scientific laboratory instrument with metal chambers, tubes, and wiring.',
    });
  });

  it('extracts the sections laid out flat under one parent', () => {
    expect(record?.goals).toBe(
      'To develop 2-D to 2-D tunneling structures to enable for smaller, faster, ' +
        'more capable microelectronic devices applied to a broad range of ' +
        'applications such as energy, RF, and sensing.',
    );
    expect(record?.issuesAddressed).toMatch(
      /^GT has a unique opportunity to apply significant experience/,
    );
    expect(record?.partnersSponsors).toBe('MKS Instruments, DTRA');
  });

  it('extracts the sections laid out in a two-column grid', () => {
    expect(record?.methodsTechnologies).toBe(
      [
        'Molecular Beam Epitaxy',
        'Cleanroom Microfabrication',
        'Electron Microscopy',
        'Electrical Characterization',
        'Chemical Vapor Deposition',
        'Nanomaterial Synthesis',
        'Raman/Optical Spectroscopy',
        'Electrical Design',
      ].join('\n\n'),
    );
    expect(record?.preferredInterests).toBe(
      'MSE, ECE, ME \u2013 Background/interest in materials and device design, ' +
        'synthesis and characterization. Cleanroom and microscopy skills helpful ' +
        'but not required.',
    );
  });

  it('extracts every college and major pair', () => {
    expect(record?.majorsSought).toEqual([
      { college: 'Engineering', major: 'Computer Engineering' },
      { college: 'Engineering', major: 'Electrical Engineering' },
      { college: 'Engineering', major: 'Materials Science and Engineering' },
      { college: 'Engineering', major: 'Mechanical Engineering' },
      { college: 'Sciences', major: 'Biology' },
      { college: 'Sciences', major: 'Mathematics' },
      { college: 'Sciences', major: 'Physics' },
    ]);
  });

  it('extracts one entry per advisor block', () => {
    expect(record?.advisors).toEqual([
      {
        name: 'Brent Wagner',
        affiliation: 'Georgia Tech Research Institute',
        email: '',
      },
      {
        name: 'Eric Vogel',
        affiliation: 'Georgia Tech Research Institute',
        email: '',
      },
      {
        name: 'Hunter Chan',
        affiliation: 'Georgia Tech Research Institute',
        email: '',
      },
    ]);
  });

  it('splits the meeting components and derives the Meeting_Window', () => {
    expect(record?.meeting.day).toBe('Thursday');
    expect(record?.meeting.time).toBe('9:30-10:20');
    expect(record?.meeting.location).toMatch(/^Baker 101E/);
    expect(record?.meetingWindow).toEqual([
      { weekday: 'Thursday', startMinute: 570, endMinute: 620 },
    ]);
  });
});

describe('parseTeamPage over entry-14350.html', () => {
  const { record, parseErrors, omissions } = parseFixture(
    'entry-14350.html',
    '14350',
  );

  it('reports no parse error and no omission', () => {
    expect(parseErrors).toEqual([]);
    expect(omissions).toEqual([]);
  });

  it('takes the first header image and its empty alt', () => {
    expect(record).toMatchObject({
      entryId: '14350',
      name: 'AA-NEW TEAM: Tactile Media Alliance',
      imageUrl:
        'https://vip.gatech.edu/files/formidable/18/2026-02-16/Student-Competition-Fidget-Group-81d9fd-300x198.png',
      imagePath: 'images/14350.png',
      imageAlt: '',
    });
  });

  it('extracts the flat and the grid-laid-out text sections', () => {
    expect(record?.goals).toMatch(
      /^A collaborative hub advancing touch-based, physical\u2013digital interactions/,
    );
    expect(record?.issuesAddressed).toMatch(
      /^Touch shapes how people learn, navigate, and build skill/,
    );
    expect(record?.partnersSponsors).toBe(
      'Center for Inclusive Design and Innovation, Tools for Life, 100+ TMA members',
    );
    expect(record?.methodsTechnologies).toMatch(/^Participatory Co-Design:/);
    expect(record?.preferredInterests).toMatch(
      /^Interest in hands-on making and interaction design/,
    );
  });

  it('extracts all six colleges and all 44 major pairs', () => {
    expect(record?.majorsSought).toHaveLength(44);
    expect([
      ...new Set(record?.majorsSought.map(entry => entry.college)),
    ]).toEqual([
      'Business',
      'Computing',
      'Design',
      'Engineering',
      'Liberal Arts',
      'Sciences',
    ]);
    expect(record?.majorsSought[0]).toEqual({
      college: 'Business',
      major: 'Accounting',
    });
    expect(record?.majorsSought.at(-1)).toEqual({
      college: 'Sciences',
      major: 'Statistics',
    });
  });

  it('keeps the one advisor and skips the empty sibling columns', () => {
    expect(record?.advisors).toEqual([
      {
        name: 'Abigale Stangl',
        affiliation: 'Industrial Design',
        email: '',
      },
    ]);
  });

  it('splits the meeting components and derives the Meeting_Window', () => {
    expect(record?.meeting.day).toBe('Wednesday');
    expect(record?.meeting.time).toBe('3:30 \u2013 4:20');
    expect(record?.meeting.location).toMatch(
      /^CIDI Ground Floor Tactile Technology Lab/,
    );
    expect(record?.meetingWindow).toEqual([
      { weekday: 'Wednesday', startMinute: 930, endMinute: 980 },
    ]);
  });

  it('leaves the out-of-schema Link(s) grid section out of the record', () => {
    expect(JSON.stringify(record)).not.toContain('tactilemediaalliance');
    expect(JSON.stringify(record)).not.toContain('multisense.id.gatech.edu');
  });
});

describe('parseTeamPage over entry-drifted.html', () => {
  const { record, parseErrors, omissions } = parseFixture(
    'entry-drifted.html',
    '99001',
  );

  it('produces a record and no parse error', () => {
    expect(parseErrors).toEqual([]);
    expect(record?.name).toBe('Drifted Fixture Team');
  });

  it('records exactly the drift the fixture carries, in document order', () => {
    expect(omissions.map(omission => omission.sourceUrl)).toEqual(
      new Array(omissions.length).fill(entryUrl('99001')),
    );
    expect(omissions.map(omission => omission.detail)).toEqual([
      // Requirement 2.7: `Project Goals` is not a documented alternate.
      'missing section: goals',
      // Requirement 2.10, report side.
      'majors line with no colon: Computing and Sciences all in one line with no separator',
      // Requirement 2.7: `Preferred Interests & Preparation` is not one either.
      'missing section: preferredInterests',
      // Requirement 2.10: the entry stays, only the email is empty.
      'advisor with no email: Dr. Ben Sample',
      // Requirement 2.11: the day and location survive, the time does not.
      'unidentified meeting values: time',
      'meeting window unavailable (noStartTime, noEndTime): day="Wednesday" time=""',
    ]);
  });

  it('degrades per field, leaving the renamed sections empty and the rest whole', () => {
    expect(record?.goals).toBe('');
    expect(record?.preferredInterests).toBe('');
    expect(record?.issuesAddressed).toBe(
      'Panel fatigue is expensive to characterize, and small teams rarely get ' +
        'instrument time.',
    );
    expect(record?.partnersSponsors).toBe('Example Materials Cooperative');
  });

  it('resolves the documented alternates and the reordered advisor section', () => {
    expect(record?.advisors).toEqual([
      {
        name: 'Dr. Ada Placeholder',
        affiliation: 'School of Electrical and Computer Engineering',
        email: '',
      },
      {
        name: 'Dr. Ben Sample',
        affiliation: 'School of Materials Science and Engineering',
        email: '',
      },
      {
        name: 'Dr. Cleo Stand-In',
        affiliation: 'School of Physics',
        email: '',
      },
    ]);
  });

  it('keeps the well-formed majors lines and drops the one with no colon', () => {
    expect(record?.majorsSought).toEqual([
      { college: 'Engineering', major: 'Electrical Engineering' },
      { college: 'Engineering', major: 'Mechanical Engineering' },
      { college: 'Sciences', major: 'Physics' },
    ]);
  });

  it('keeps the identified meeting components and derives no window', () => {
    expect(record?.meeting).toEqual({
      day: 'Wednesday',
      time: '',
      location: 'time to be announced, Klaus 1116',
    });
    expect(record?.meetingWindow).toBeNull();
  });

  it('leaves the out-of-schema Link(s) section out of the record', () => {
    expect(JSON.stringify(record)).not.toContain('example.gatech.edu/drifted');
  });
});

/**
 * The layout itself, pinned without the captured files. `bun run ingest:fixtures`
 * overwrites `entry-1248.html` and `entry-14350.html` from the live site, so these
 * synthetic pages are what keeps the regression from returning if a capture drifts.
 */
describe('grid-shaped section bodies', () => {
  const grid = (rows: string): string =>
    `<!doctype html><html><body><main><div id="content">` +
    `<h1>Grid Team</h1>${rows}</div></main></body></html>`;

  const row = (columns: string): string =>
    `<div class="frm_grid_container">${columns}</div>`;

  it('reads a body from the column beside the heading, not after it', () => {
    const html = grid(
      row('<div class="frm3"><h4>Majors Sought</h4></div>') +
        row(
          '<div class="frm3"><h4>Preferred Interests and Preparation</h4></div>' +
            '<div class="frm9"><p>Curiosity</p></div>',
        ),
    );

    // The Majors row has no second column at all, so the section is genuinely
    // empty; it must not reach across into the row that follows.
    const { record } = parseTeamPage(html, entryUrl('1'));

    expect(record?.majorsSought).toEqual([]);
    expect(record?.preferredInterests).toBe('Curiosity');
  });

  it('reads every sibling column of a multi-column section', () => {
    const html = grid(
      row(
        '<div class="frm3"><h4>Advisors</h4></div>' +
          '<div class="frm3"><p>One Advisor<br>Aff One<br>' +
          '<a href="mailto:one@gatech.edu">one</a></p></div>' +
          '<div class="frm3"><p>Two Advisor<br>Aff Two<br>' +
          '<a href="mailto:two@gatech.edu">two</a></p></div>',
      ),
    );

    const { record } = parseTeamPage(html, entryUrl('2'));

    expect(record?.advisors).toEqual([
      { name: 'One Advisor', affiliation: 'Aff One', email: '' },
      { name: 'Two Advisor', affiliation: 'Aff Two', email: '' },
    ]);
  });

  it('stops a grid section at the row holding the next section heading', () => {
    const html = grid(
      row(
        '<div class="frm3"><h4>Majors Sought</h4></div>' +
          '<div class="frm9"><p>Computing: Computer Science</p></div>',
      ) +
        row(
          '<div class="frm3"><h4>Day, Time &amp; Location</h4></div>' +
            '<div class="frm9"><p>Thursday 9:30-10:20 Baker 101E</p></div>',
        ),
    );

    const { record } = parseTeamPage(html, entryUrl('3'));

    expect(record?.majorsSought).toEqual([
      { college: 'Computing', major: 'Computer Science' },
    ]);
    expect(record?.meeting).toEqual({
      day: 'Thursday',
      time: '9:30-10:20',
      location: 'Baker 101E',
    });
  });

  it('skips a spacer row that holds no section heading', () => {
    const html = grid(
      row(
        '<div class="frm3"><h4>Majors Sought</h4></div>' +
          '<div class="frm9"><p>Computing: Computer Science</p></div>',
      ) +
        row('<div class="frm3"></div><div class="frm9"></div>') +
        row(
          '<div class="frm3"><h4>Advisors</h4></div>' +
            '<div class="frm3"><p>Solo<br>Aff<br>' +
            '<a href="mailto:solo@gatech.edu">solo</a></p></div>',
        ),
    );

    const { record } = parseTeamPage(html, entryUrl('4'));

    expect(record?.majorsSought).toEqual([
      { college: 'Computing', major: 'Computer Science' },
    ]);
    expect(record?.advisors).toEqual([
      { name: 'Solo', affiliation: 'Aff', email: '' },
    ]);
  });
});
