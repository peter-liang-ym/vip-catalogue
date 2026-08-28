import { describe, expect, it } from 'vitest';
import type {
  BusyBlock,
  BusySchedule,
  MeetingWindowEntry,
  Weekday,
} from '../shared/types';
import { conflictDetail } from './conflictDetail';

function entry(
  weekday: Weekday,
  startMinute: number,
  endMinute: number,
): MeetingWindowEntry {
  return { weekday, startMinute, endMinute };
}

function block(
  weekday: Weekday,
  startMinute: number,
  endMinute: number,
  ...summaries: string[]
): BusyBlock {
  return { weekday, startMinute, endMinute, summaries };
}

function schedule(blocks: readonly BusyBlock[]): BusySchedule {
  return {
    fileName: 'schedule.ics',
    loadedAt: '2026-01-05T04:30:00Z',
    blocks,
    truncated: false,
    discardedBlocks: 0,
  };
}

describe('conflictDetail', () => {
  it('reports only the overlapping blocks with their summaries', () => {
    const detail = conflictDetail(
      [entry('Monday', 540, 620)],
      schedule([
        block('Monday', 480, 530, 'CS 1301'),
        block('Monday', 600, 660, 'MATH 2551', 'Office hours'),
        block('Tuesday', 540, 620, 'PHYS 2211'),
      ]),
    );

    expect(detail.blocks).toHaveLength(1);
    expect(detail.blocks[0]?.block.startMinute).toBe(600);
    expect(detail.blocks[0]?.summaries).toEqual(['MATH 2551', 'Office hours']);
  });

  it('reports nothing for a clear team', () => {
    expect(
      conflictDetail(
        [entry('Monday', 540, 620)],
        schedule([block('Monday', 620, 680, 'CS 1301')]),
      ).blocks,
    ).toEqual([]);
  });

  it('reports nothing for an unavailable Meeting_Window', () => {
    expect(
      conflictDetail(null, schedule([block('Monday', 0, 1440, 'Busy')])).blocks,
    ).toEqual([]);
  });

  it('keeps an empty summary rather than dropping it', () => {
    const detail = conflictDetail(
      [entry('Friday', 540, 620)],
      schedule([block('Friday', 600, 660, '')]),
    );

    expect(detail.blocks[0]?.summaries).toEqual(['']);
  });

  it('returns at most 5 blocks in canonical order', () => {
    const blocks = [
      block('Wednesday', 540, 600, 'c'),
      block('Monday', 600, 660, 'b'),
      block('Monday', 540, 600, 'a'),
      block('Thursday', 540, 600, 'd'),
      block('Friday', 540, 600, 'e'),
      block('Saturday', 540, 600, 'f'),
      block('Sunday', 540, 600, 'g'),
    ];
    const window = blocks.map(b =>
      entry(b.weekday, b.startMinute, b.endMinute),
    );

    const detail = conflictDetail(window, schedule(blocks));

    expect(detail.blocks).toHaveLength(5);
    expect(
      detail.blocks.map(({ block: b }) => [b.weekday, b.startMinute]),
    ).toEqual([
      ['Monday', 540],
      ['Monday', 600],
      ['Wednesday', 540],
      ['Thursday', 540],
      ['Friday', 540],
    ]);
  });

  it('caps summaries at 5 per block and 200 characters each', () => {
    const long = 'x'.repeat(250);
    const detail = conflictDetail(
      [entry('Tuesday', 540, 620)],
      schedule([
        block('Tuesday', 600, 660, long, 's2', 's3', 's4', 's5', 's6'),
      ]),
    );

    const summaries = detail.blocks[0]?.summaries ?? [];
    expect(summaries).toHaveLength(5);
    expect(summaries[0]).toBe('x'.repeat(200));
    expect(summaries).not.toContain('s6');
  });
});
