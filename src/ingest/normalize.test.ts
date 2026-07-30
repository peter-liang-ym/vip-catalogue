import { describe, expect, it } from 'vitest';
import { MAX_SHORT_TEXT_LENGTH, MAX_TEXT_LENGTH } from '../shared/types';
import { normalizeText } from './normalize';

describe('normalizeText', () => {
  it('turns br and block ends into single line breaks', () => {
    expect(normalizeText('<p>Goals</p><p>More goals</p>')).toBe(
      'Goals\nMore goals',
    );
    expect(normalizeText('first<br>second')).toBe('first\nsecond');
    expect(normalizeText('<ul><li>one</li><li>two</li></ul>')).toBe('one\ntwo');
    expect(normalizeText('<h4>Advisors</h4><div>Brent Wagner</div>')).toBe(
      'Advisors\nBrent Wagner',
    );
  });

  it('strips markup and decodes entities', () => {
    expect(
      normalizeText('<span class="x">Tom <em>&amp;</em> Jerry</span>'),
    ).toBe('Tom & Jerry');
    expect(normalizeText('<!-- hidden -->visible')).toBe('visible');
  });

  it('collapses runs of spaces and tabs into one space', () => {
    expect(normalizeText('a  b\t\tc \t d')).toBe('a b c d');
  });

  it('collapses three or more newlines to two and trims each line', () => {
    expect(normalizeText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
    expect(normalizeText('a  \nb')).toBe('a\nb');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('   \n <p>  padded  </p> \n  ')).toBe('padded');
    expect(normalizeText('')).toBe('');
    expect(normalizeText('   ')).toBe('');
  });

  it('caps the result at the field limit', () => {
    expect(normalizeText('x'.repeat(MAX_TEXT_LENGTH + 500))).toHaveLength(
      MAX_TEXT_LENGTH,
    );

    const short = normalizeText(
      `<p>${'ab '.repeat(200)}</p>`,
      MAX_SHORT_TEXT_LENGTH,
    );
    expect(short.length).toBeLessThanOrEqual(MAX_SHORT_TEXT_LENGTH);
    expect(short).toBe(short.trim());
  });

  it('tolerates unbalanced markup without throwing', () => {
    const out = normalizeText('<p>a<div>b<span>c');
    expect(out).not.toContain('<');
    expect(out.replace(/\s+/g, '')).toBe('abc');
  });

  it('is idempotent', () => {
    const input = '<div>  Goals: <b>build &amp; test</b><br><br><br>  done  ';
    const once = normalizeText(input);
    expect(normalizeText(once)).toBe(once);
  });
});
