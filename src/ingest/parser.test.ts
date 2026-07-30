import { describe, expect, it } from 'vitest';
import { parseTeamPage } from './parser';

/** Wraps a body in the source site's shape: theme chrome outside `main #content`. */
const page = (body: string): string =>
  `<!doctype html><html><head><title>Teams</title></head><body>` +
  `<header><img src="/logo.png" alt="VIP"></header>` +
  `<main><div id="content">${body}</div></main>` +
  `<footer><img src="/footer.png" alt="footer"></footer></body></html>`;

const CANONICAL = 'https://vip.gatech.edu/teams/entry/1248';

const FULL_BODY = [
  '<h1>Aerial Robotics</h1>',
  '<img src="https://vip.gatech.edu/files/formidable/team.png" alt="Team banner">',
  '<h4>Goals</h4><p>Build drones.</p><p>Fly drones.</p>',
  '<h4>Issues Involved or Addressed</h4><p>Search and rescue.</p>',
  '<h4>Partners/Sponsors</h4><p>GTRI</p>',
  '<h4>Methods and Technologies</h4><p>Python  &amp; ROS</p>',
  '<h4>Majors Sought</h4><div>Computing: Computer Science, Computational Media<br>' +
    'Engineering: Electrical Engineering</div>',
  '<h4>Preferred Interests and Preparation</h4><p>Curiosity</p>',
  '<h4>Advisors</h4><div>' +
    '<div>Brent Wagner<br>Georgia Tech Research Institute<br>' +
    '<a href="mailto:brent.wagner@gtri.gatech.edu">brent.wagner@gtri.gatech.edu</a></div>' +
    '<div>Ada Lovelace<br>School of Mathematics<br>' +
    '<a href="mailto:ada@gatech.edu">ada@gatech.edu</a></div>' +
    '</div>',
  '<h4>Day, Time &amp; Location</h4>' +
    '<p>Full Team Meeting:</p><p>Thursday</p><p>9:30-10:20</p><p>Baker 101E</p>',
].join('');

describe('parseTeamPage', () => {
  it('extracts every field of a complete team page', () => {
    const { record, parseErrors } = parseTeamPage(page(FULL_BODY), CANONICAL);

    expect(parseErrors).toEqual([]);
    expect(record).toBeDefined();
    expect(record).toMatchObject({
      entryId: '1248',
      sourceUrl: CANONICAL,
      name: 'Aerial Robotics',
      imageUrl: 'https://vip.gatech.edu/files/formidable/team.png',
      imagePath: 'images/1248.png',
      imageAlt: 'Team banner',
      goals: 'Build drones.\nFly drones.',
      issuesAddressed: 'Search and rescue.',
      partnersSponsors: 'GTRI',
      methodsTechnologies: 'Python & ROS',
      preferredInterests: 'Curiosity',
      meeting: { day: 'Thursday', time: '9:30-10:20', location: 'Baker 101E' },
    });
    expect(record?.majorsSought).toEqual([
      { college: 'Computing', major: 'Computer Science' },
      { college: 'Computing', major: 'Computational Media' },
      { college: 'Engineering', major: 'Electrical Engineering' },
    ]);
    expect(record?.advisors).toEqual([
      {
        name: 'Brent Wagner',
        affiliation: 'Georgia Tech Research Institute',
        email: 'brent.wagner@gtri.gatech.edu',
      },
      {
        name: 'Ada Lovelace',
        affiliation: 'School of Mathematics',
        email: 'ada@gatech.edu',
      },
    ]);
    expect(record?.meetingWindow).toEqual([
      { weekday: 'Thursday', startMinute: 570, endMinute: 620 },
    ]);
  });

  it('accepts the documented heading alternates and ignores extra sections', () => {
    const body = [
      '<h1>Team Y</h1>',
      '<h4>Issues Addressed</h4><p>Noise pollution.</p>',
      '<h4>Partners and Sponsors</h4><p>Delta</p>',
      '<h4>Advisor</h4><div><p>Solo Advisor<br>School of ECE<br>' +
        '<a href="mailto:solo@gatech.edu">write</a></p></div>',
      '<h4>Day, Time and Location</h4>' +
        '<p>Full Team Meeting: Tuesday 3:30 \u2013 4:20 Klaus 1447</p>',
      '<h4>Link(s)</h4><p><a href="https://example.com/team">site</a></p>',
    ].join('');

    const { record } = parseTeamPage(page(body), CANONICAL);

    expect(record?.issuesAddressed).toBe('Noise pollution.');
    expect(record?.partnersSponsors).toBe('Delta');
    expect(record?.advisors).toEqual([
      {
        name: 'Solo Advisor',
        affiliation: 'School of ECE',
        email: 'solo@gatech.edu',
      },
    ]);
    expect(record?.meeting).toEqual({
      day: 'Tuesday',
      time: '3:30 \u2013 4:20',
      location: 'Klaus 1447',
    });
    // No header image element, and theme chrome outside the content container is
    // never picked up.
    expect(record?.imageUrl).toBe('');
    expect(record?.imagePath).toBe('');
    // The out-of-schema Link(s) section leaves no trace in the record.
    expect(JSON.stringify(record)).not.toContain('example.com');
  });

  it('deduplicates majors case-insensitively and skips lines with no colon', () => {
    const body =
      '<h1>Team Z</h1><h4>Majors Sought</h4>' +
      '<p>Computing: Computer Science, computer science, Computational Media</p>' +
      '<p>Engineering</p>' +
      '<p>Sciences: Physics</p>';

    const { record } = parseTeamPage(page(body), CANONICAL);

    expect(record?.majorsSought).toEqual([
      { college: 'Computing', major: 'Computer Science' },
      { college: 'Computing', major: 'Computational Media' },
      { college: 'Sciences', major: 'Physics' },
    ]);
  });

  it('retains an advisor block that carries no mail link', () => {
    const body =
      '<h1>Team A</h1><h4>Advisors</h4><div>' +
      '<div>A One<br>Aff One<br><a href="mailto:a@gatech.edu">a</a></div>' +
      '<div>No Link Person<br>Aff Two</div>' +
      '<div>C Three<br>Aff Three<br><a href="mailto:c@gatech.edu">c</a></div>' +
      '</div>';

    const { record } = parseTeamPage(page(body), CANONICAL);

    expect(record?.advisors).toEqual([
      { name: 'A One', affiliation: 'Aff One', email: 'a@gatech.edu' },
      { name: 'No Link Person', affiliation: 'Aff Two', email: '' },
      { name: 'C Three', affiliation: 'Aff Three', email: 'c@gatech.edu' },
    ]);
  });

  it('canonicalizes the source URL and resolves a relative image src', () => {
    const body =
      '<h1>Team B</h1><img src="/files/formidable/b.JPG" alt="">' +
      '<h4>Goals</h4><p>Goals text</p>';
    const allInOne = 'https://vip.gatech.edu/teams-all-in-one/entry/1248';

    const { record } = parseTeamPage(page(body), allInOne);

    expect(record?.sourceUrl).toBe(CANONICAL);
    expect(record?.imageUrl).toBe(
      'https://vip.gatech.edu/files/formidable/b.JPG',
    );
    expect(record?.imagePath).toBe('images/1248.jpg');
    expect(record?.imageAlt).toBe('');
  });

  it('leaves absent sections empty and an unresolvable meeting window null', () => {
    const { record } = parseTeamPage(page('<h1>Team C</h1>'), CANONICAL);

    expect(record).toMatchObject({
      goals: '',
      issuesAddressed: '',
      partnersSponsors: '',
      methodsTechnologies: '',
      preferredInterests: '',
      meeting: { day: '', time: '', location: '' },
      meetingWindow: null,
    });
    expect(record?.majorsSought).toEqual([]);
    expect(record?.advisors).toEqual([]);
  });

  it('produces no record when the team name is missing', () => {
    const { record } = parseTeamPage(
      page('<h4>Goals</h4><p>Goals text</p>'),
      CANONICAL,
    );

    expect(record).toBeUndefined();
  });
});

/** The omission `detail` strings, for readable assertions. */
const detailsOf = (html: string, url = CANONICAL): string[] =>
  parseTeamPage(html, url).omissions.map(omission => omission.detail);

describe('parseTeamPage degradation reporting', () => {
  it('records no omission for a complete page', () => {
    const { omissions, parseErrors } = parseTeamPage(
      page(FULL_BODY),
      CANONICAL,
    );

    expect(parseErrors).toEqual([]);
    expect(omissions).toEqual([]);
  });

  it('records each absent section with the source URL', () => {
    const { record, omissions } = parseTeamPage(
      page('<h1>Team C</h1>'),
      CANONICAL,
    );

    expect(record).toBeDefined();
    expect(omissions.map(omission => omission.sourceUrl)).toEqual(
      new Array(omissions.length).fill(CANONICAL),
    );
    expect(omissions.map(omission => omission.detail)).toEqual([
      'missing section: goals',
      'missing section: issuesAddressed',
      'missing section: partnersSponsors',
      'missing section: methodsTechnologies',
      'missing section: majorsSought',
      'missing section: preferredInterests',
      'missing section: advisors',
      'missing section: meeting',
    ]);
  });

  it('records a present but empty section without failing the record', () => {
    const body =
      '<h1>Team D</h1><h4>Goals</h4><p>   </p>' +
      '<h4>Majors Sought</h4><p></p>' +
      '<h4>Advisors</h4><div></div>';

    const { record } = parseTeamPage(page(body), CANONICAL);
    const details = detailsOf(page(body));

    expect(record?.goals).toBe('');
    expect(record?.majorsSought).toEqual([]);
    expect(record?.advisors).toEqual([]);
    expect(details).toContain('empty section: goals');
    // Requirement 2.3: an empty Majors Sought section is an empty list, not an error.
    expect(details).toContain('empty section: majorsSought');
    expect(details).toContain('empty section: advisors');
    expect(parseTeamPage(page(body), CANONICAL).parseErrors).toEqual([]);
  });

  it('records a majors line with no colon and keeps the other lines', () => {
    const body =
      '<h1>Team Z</h1><h4>Majors Sought</h4>' +
      '<p>Computing: Computer Science</p><p>Engineering</p>';

    const { record } = parseTeamPage(page(body), CANONICAL);

    expect(record?.majorsSought).toEqual([
      { college: 'Computing', major: 'Computer Science' },
    ]);
    expect(detailsOf(page(body))).toContain(
      'majors line with no colon: Engineering',
    );
  });

  it('records an advisor with no email and retains the entry', () => {
    const body =
      '<h1>Team A</h1><h4>Advisors</h4><div>' +
      '<div>A One<br>Aff One<br><a href="mailto:a@gatech.edu">a</a></div>' +
      '<div>No Link Person<br>Aff Two</div>' +
      '<div>C Three<br>Aff Three<br><a href="mailto:c@gatech.edu">c</a></div>' +
      '</div>';

    const { record } = parseTeamPage(page(body), CANONICAL);

    expect(record?.advisors).toHaveLength(3);
    expect(record?.advisors[1]).toEqual({
      name: 'No Link Person',
      affiliation: 'Aff Two',
      email: '',
    });
    expect(
      detailsOf(page(body)).filter(
        detail => detail === 'advisor with no email: No Link Person',
      ),
    ).toHaveLength(1);
  });

  it('records the unidentified meeting components individually', () => {
    const body =
      '<h1>Team E</h1><h4>Day, Time &amp; Location</h4>' +
      '<p>Full Team Meeting: Thursday, in a room to be announced</p>';

    const { record } = parseTeamPage(page(body), CANONICAL);

    expect(record?.meeting.day).toBe('Thursday');
    expect(record?.meeting.time).toBe('');
    expect(record?.meeting.location).toBe('in a room to be announced');
    expect(detailsOf(page(body))).toContain(
      'unidentified meeting values: time',
    );
  });

  it('records the meeting window failure with the day and time text', () => {
    const body =
      '<h1>Team F</h1><h4>Day, Time &amp; Location</h4>' +
      '<p>Full Team Meeting: Thursday 13:30 - 13:00 Klaus 1447</p>';

    const { record } = parseTeamPage(page(body), CANONICAL);

    expect(record?.meetingWindow).toBeNull();
    expect(record?.meeting).toEqual({
      day: 'Thursday',
      time: '13:30 - 13:00',
      location: 'Klaus 1447',
    });
    expect(
      detailsOf(page(body)).some(
        detail =>
          detail.startsWith('meeting window unavailable') &&
          detail.includes('day="Thursday"') &&
          detail.includes('time="13:30 - 13:00"'),
      ),
    ).toBe(true);
  });

  it('records exactly one parse error and no record for a whitespace-only name', () => {
    const body =
      '<h1> <span>\u200b</span> </h1><h4>Goals</h4><p>Goals text</p>';

    const { record, parseErrors, omissions } = parseTeamPage(
      page(body),
      CANONICAL,
    );

    expect(record).toBeUndefined();
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0]?.sourceUrl).toBe(CANONICAL);
    expect(parseErrors[0]?.message).toContain('name');
    expect(omissions).toEqual([]);
  });
});
