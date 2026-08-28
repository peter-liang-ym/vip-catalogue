import { describe, expect, it } from 'vitest';
import type { BusyBlock, Weekday } from '../../shared/types';
import { mergeBusyBlocks } from './merge';

function block(
  weekday: Weekday,
  startMinute: number,
  endMinute: number,
  ...summaries: string[]
): BusyBlock {
  return { weekday, startMinute, endMinute, summaries };
}

describe('mergeBusyBlocks', () => {
  it('returns an empty list for no blocks', () => {
    expect(mergeBusyBlocks([])).toEqual([]);
  });

  it('merges overlapping same-weekday blocks into the least start and greatest end', () => {
    const merged = mergeBusyBlocks([
      block('Monday', 540, 620, 'CS 1301'),
      block('Monday', 600, 700, 'MATH 1554'),
    ]);

    expect(merged).toEqual([block('Monday', 540, 700, 'CS 1301', 'MATH 1554')]);
  });

  it('merges touching blocks', () => {
    const merged = mergeBusyBlocks([
      block('Tuesday', 540, 600, 'Lecture'),
      block('Tuesday', 600, 660, 'Lab'),
    ]);

    expect(merged).toEqual([block('Tuesday', 540, 660, 'Lecture', 'Lab')]);
  });

  it('keeps disjoint blocks separate', () => {
    const merged = mergeBusyBlocks([
      block('Friday', 700, 760, 'Studio'),
      block('Friday', 540, 600, 'Lecture'),
    ]);

    expect(merged).toEqual([
      block('Friday', 540, 600, 'Lecture'),
      block('Friday', 700, 760, 'Studio'),
    ]);
  });

  it('never merges across weekdays', () => {
    const merged = mergeBusyBlocks([
      block('Wednesday', 540, 600, 'Wed'),
      block('Monday', 570, 630, 'Mon'),
    ]);

    expect(merged).toEqual([
      block('Monday', 570, 630, 'Mon'),
      block('Wednesday', 540, 600, 'Wed'),
    ]);
  });

  it('absorbs a contained block without shrinking the stretch', () => {
    const merged = mergeBusyBlocks([
      block('Thursday', 540, 780, 'Seminar'),
      block('Thursday', 600, 660, 'Recitation'),
    ]);

    expect(merged).toEqual([
      block('Thursday', 540, 780, 'Seminar', 'Recitation'),
    ]);
  });

  it('merges a chain joined only through a middle block', () => {
    const merged = mergeBusyBlocks([
      block('Monday', 540, 600, 'A'),
      block('Monday', 700, 760, 'C'),
      block('Monday', 590, 710, 'B'),
    ]);

    expect(merged).toEqual([block('Monday', 540, 760, 'A', 'B', 'C')]);
  });

  it('deduplicates summaries in first-seen order', () => {
    const merged = mergeBusyBlocks([
      block('Monday', 540, 600, 'CS 1301', 'Lab'),
      block('Monday', 600, 660, 'Lab', 'CS 1301'),
    ]);

    expect(merged).toEqual([block('Monday', 540, 660, 'CS 1301', 'Lab')]);
  });

  it('orders the result by weekday Monday..Sunday then start minute', () => {
    const merged = mergeBusyBlocks([
      block('Sunday', 60, 120),
      block('Monday', 300, 360),
      block('Monday', 120, 180),
      block('Saturday', 0, 30),
    ]);

    expect(merged.map(b => [b.weekday, b.startMinute])).toEqual([
      ['Monday', 120],
      ['Monday', 300],
      ['Saturday', 0],
      ['Sunday', 60],
    ]);
  });

  it('is idempotent', () => {
    const blocks = [
      block('Monday', 540, 600, 'A'),
      block('Monday', 600, 660, 'B'),
      block('Monday', 900, 960, 'C'),
      block('Friday', 0, 1440, 'All day'),
    ];

    const once = mergeBusyBlocks(blocks);
    expect(mergeBusyBlocks(once)).toEqual(once);
  });
});
