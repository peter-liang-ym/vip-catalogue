// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamRecord } from '../../shared/types';
import { terms } from '../search';
import { CONFLICT_TEXT, GOALS_EXCERPT_LENGTH, TeamCard } from './TeamCard';

function record(overrides: Partial<TeamRecord> = {}): TeamRecord {
  return {
    entryId: '1248',
    sourceUrl: 'https://vip.gatech.edu/teams/entry/1248',
    name: 'Robotic Musicianship',
    imageUrl: 'https://vip.gatech.edu/files/robot.png',
    imagePath: 'images/1248.png',
    imageAlt: 'A robot playing a marimba',
    goals: 'Build robots that improvise music with human players.',
    issuesAddressed: '',
    partnersSponsors: '',
    methodsTechnologies: '',
    majorsSought: [
      { college: 'Engineering', major: 'Mechanical Engineering' },
      { college: 'Engineering', major: 'Electrical Engineering' },
      { college: 'Computing', major: 'Computer Science' },
    ],
    preferredInterests: '',
    advisors: [],
    meeting: { day: 'Monday, Wednesday', time: '9:30-10:20', location: '' },
    meetingWindow: [{ weekday: 'Monday', startMinute: 570, endMinute: 620 }],
    ...overrides,
  };
}

function mount(props: Partial<Parameters<typeof TeamCard>[0]> = {}) {
  const onOpen = props.onOpen ?? vi.fn();
  render(
    <TeamCard
      team={props.team ?? record()}
      terms={props.terms ?? []}
      conflictState={props.conflictState ?? null}
      href={props.href ?? '/team/1248'}
      onOpen={onOpen}
    />,
  );
  return { onOpen };
}

function text(testId: string): string {
  return screen.getByTestId(testId).textContent ?? '';
}

afterEach(cleanup);

describe('TeamCard', () => {
  it('renders the name as the link to the Team_Detail_View (Requirement 4.2)', () => {
    const { onOpen } = mount();
    const link = screen.getByRole('link');

    expect(link.textContent).toBe('Robotic Musicianship');
    expect(link.getAttribute('href')).toBe('/team/1248');

    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders the image with the record alt text (Requirement 10.5)', () => {
    mount();
    const image = screen.getByRole('img');

    expect(image.getAttribute('src')).toBe('images/1248.png');
    expect(image.getAttribute('alt')).toBe('A robot playing a marimba');
  });

  it('falls back to alt text naming the team when the record alt is empty (Requirement 10.7)', () => {
    mount({ team: record({ imageAlt: '' }) });

    expect(screen.getByRole('img').getAttribute('alt')).toBe(
      'Robotic Musicianship',
    );
  });

  it('renders no image region when the record has no image (Requirement 4.2)', () => {
    mount({ team: record({ imagePath: '' }) });

    expect(screen.queryByRole('img')).toBeNull();
    expect(text('team-card-goals')).toContain('Build robots');
  });

  it('swaps in a placeholder on an image error and keeps every other field (Requirement 10.8)', () => {
    mount();

    fireEvent.error(screen.getByRole('img'));

    const placeholder = screen.getByTestId('team-card-image-placeholder');
    expect(placeholder.getAttribute('aria-label')).toBe(
      'A robot playing a marimba',
    );
    expect(screen.getByRole('link').textContent).toBe('Robotic Musicianship');
    expect(text('team-card-goals')).toContain('Build robots');
    expect(text('team-card-colleges')).toContain('Engineering');
    expect(text('team-card-meeting')).toContain('9:30-10:20');
  });

  it('renders at most the first 200 characters of the goals text (Requirement 4.2)', () => {
    const goals = 'g'.repeat(250);
    mount({ team: record({ goals }) });

    expect(text('team-card-goals')).toBe('g'.repeat(GOALS_EXCERPT_LENGTH));
  });

  it('lists each distinct College exactly once (Requirement 4.2)', () => {
    mount();

    const listed = screen
      .getAllByRole('listitem')
      .map(item => item.textContent);
    expect(listed).toEqual(['Engineering', 'Computing']);
  });

  it('folds case and surrounding whitespace when deciding which Colleges are distinct', () => {
    mount({
      team: record({
        majorsSought: [
          { college: 'Computing', major: 'CS' },
          { college: ' computing ', major: 'CM' },
        ],
      }),
    });

    expect(screen.getAllByRole('listitem').map(i => i.textContent)).toEqual([
      'Computing',
    ]);
  });

  it('renders the meeting day and time text (Requirement 4.2)', () => {
    mount();

    expect(text('team-card-meeting')).toBe(
      'Meets Monday, Wednesday 9:30-10:20',
    );
  });

  it('renders only the non-empty meeting component (Requirement 4.2)', () => {
    mount({
      team: record({ meeting: { day: '', time: '2 to 3', location: '' } }),
    });

    expect(text('team-card-meeting')).toBe('Meets 2 to 3');
  });

  it('omits the meeting text when both day and time are empty (Requirement 4.2)', () => {
    mount({
      team: record({ meeting: { day: '', time: '', location: 'Klaus' } }),
    });

    expect(screen.queryByTestId('team-card-meeting')).toBeNull();
  });

  it('marks every case-insensitive occurrence of every term in the card text (Requirement 5.5)', () => {
    mount({ team: record(), terms: terms('ROBOT engineering') });

    const marked = [...document.querySelectorAll('mark')];
    expect(marked.map(m => m.textContent)).toEqual([
      'Robot', // the name
      'robot', // the goals excerpt
      'Engineering', // the one College entry
    ]);
  });

  it('leaves the card text unchanged when the query has no terms (Requirement 5.5)', () => {
    mount({ terms: [] });

    expect(document.querySelectorAll('mark')).toHaveLength(0);
    expect(screen.getByRole('link').textContent).toBe('Robotic Musicianship');
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
});
