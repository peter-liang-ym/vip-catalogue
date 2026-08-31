// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { BusyBlock, ConflictDetail, Weekday } from '../../shared/types';
import { conflictDetail } from '../conflictDetail';
import {
  CONFLICT_DETAIL_HEADING,
  ConflictDetailView,
  UNTITLED_EVENT_TEXT,
  formatClock,
} from './ConflictDetailView';

function block(
  weekday: Weekday,
  startMinute: number,
  endMinute: number,
  ...summaries: string[]
): BusyBlock {
  return { weekday, startMinute, endMinute, summaries };
}

function detailOf(...blocks: readonly BusyBlock[]): ConflictDetail {
  return { blocks: blocks.map(b => ({ block: b, summaries: b.summaries })) };
}

/** The rendered text of each block, with its summaries. */
function blockTexts(): readonly string[] {
  return screen
    .getAllByRole('listitem')
    .filter(item => item.classList.contains('conflict-detail__block'))
    .map(item => (item.textContent ?? '').trim());
}

afterEach(cleanup);

describe('ConflictDetailView', () => {
  it('shows each block with its weekday, clock times, and summaries (Requirement 15.5)', () => {
    render(
      <ConflictDetailView
        detail={detailOf(
          block('Monday', 540, 620, 'CS 1301', 'Office hours'),
          block('Friday', 780, 840, 'Lab'),
        )}
      />,
    );

    expect(screen.getByText(CONFLICT_DETAIL_HEADING)).toBeTruthy();
    expect(blockTexts()).toEqual([
      'Monday 9:00 AM to 10:20 AM' + 'CS 1301Office hours',
      'Friday 1:00 PM to 2:00 PM' + 'Lab',
    ]);
  });

  it('states an empty summary as the no-title text (Requirement 15.6)', () => {
    render(
      <ConflictDetailView detail={detailOf(block('Friday', 600, 660, ''))} />,
    );

    expect(screen.getByText(UNTITLED_EVENT_TEXT)).toBeTruthy();
  });

  it('displays at most 5 blocks and 5 summaries per block (Requirement 15.5)', () => {
    const summaries = Array.from({ length: 8 }, (_, i) => `Event ${i}`);
    const detail = detailOf(
      ...Array.from({ length: 7 }, (_, i) =>
        block('Monday', i * 60, i * 60 + 30, ...summaries),
      ),
    );

    render(<ConflictDetailView detail={detail} />);

    expect(blockTexts()).toHaveLength(5);
    expect(screen.queryByText('Event 5')).toBeNull();
    expect(screen.getAllByText('Event 4')).toHaveLength(5);
  });

  it('renders nothing when there is no Conflict_Detail to show (Requirement 15.7)', () => {
    const { container } = render(
      <ConflictDetailView detail={{ blocks: [] }} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a team that does not conflict (Requirement 15.7)', () => {
    const { container } = render(
      <ConflictDetailView
        detail={conflictDetail(
          [{ weekday: 'Monday', startMinute: 540, endMinute: 620 }],
          {
            fileName: 'me.ics',
            loadedAt: '2026-01-05T04:30:00Z',
            blocks: [block('Monday', 620, 680, 'CS 1301')],
            truncated: false,
            discardedBlocks: 0,
          },
        )}
      />,
    );

    expect(container.innerHTML).toBe('');
  });
});

describe('formatClock', () => {
  it('formats minutes of day as 12-hour Atlanta wall-clock times', () => {
    expect(formatClock(0)).toBe('12:00 AM');
    expect(formatClock(5)).toBe('12:05 AM');
    expect(formatClock(540)).toBe('9:00 AM');
    expect(formatClock(719)).toBe('11:59 AM');
    expect(formatClock(720)).toBe('12:00 PM');
    expect(formatClock(1439)).toBe('11:59 PM');
    expect(formatClock(1440)).toBe('12:00 AM');
  });
});
