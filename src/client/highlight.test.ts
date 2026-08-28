import { describe, expect, it } from 'vitest';

import { highlight } from './highlight';
import { terms } from './search';

describe('highlight', () => {
  it('marks occurrences that differ only in letter case', () => {
    expect(highlight('Robot Arm robotics', terms('ROBOT'))).toEqual([
      { text: 'Robot', marked: true },
      { text: ' Arm ', marked: false },
      { text: 'robot', marked: true },
      { text: 'ics', marked: false },
    ]);
  });

  it('merges overlapping and adjacent occurrences into one segment', () => {
    expect(highlight('aaa', ['aa'])).toEqual([{ text: 'aaa', marked: true }]);
    expect(highlight('smart city', ['smart', ' city'])).toEqual([
      { text: 'smart city', marked: true },
    ]);
  });

  it('is lossless and leaves non-occurring or empty terms without a mark', () => {
    const text = 'Autonomous Vehicles';
    expect(highlight(text, ['', 'drone'])).toEqual([{ text, marked: false }]);
    expect(highlight('', ['a'])).toEqual([]);
  });
});
