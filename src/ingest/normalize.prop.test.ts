/**
 * Property 5: `normalizeText` is idempotent and bounded.
 *
 * **Validates: Requirements 2.6, 2.1**
 *
 * The domain is the one the design fixes: fragments assembled from random text
 * (non-ASCII, entities, and very long runs of whitespace) wrapped in random
 * nestings of `p`, `li`, `div`, `br`, `span`, and heading elements, plus
 * deliberately unbalanced tags.
 *
 * The generated leaf text carries no raw `<`, `>`, `&`, or `;`. Angle brackets are
 * withheld so "the output contains no markup" can be asserted directly rather
 * than through a second parse, and `&`/`;` are withheld so entities only ever
 * enter as whole tokens — random text cannot accidentally spell the tail of one
 * (`&amp;` + `amp;`), which would decode twice and is a separate question from
 * this property.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_SHORT_TEXT_LENGTH, MAX_TEXT_LENGTH } from '../shared/types';
import { normalizeText } from './normalize';

/** Leaf characters: letters, digits, punctuation, and non-ASCII including a surrogate pair. */
const LEAF_CHARS: readonly string[] = [
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  ' ',
  ',',
  '.',
  '-',
  '/',
  ':',
  "'",
  '(',
  ')',
  '%',
  '#',
  'é',
  'ü',
  'ñ',
  'Ω',
  'ж',
  '大',
  '\u2013',
  '\u{1f600}',
];

/** Entity tokens, none of which decodes to an angle bracket. */
const ENTITIES: readonly string[] = [
  '&amp;',
  '&nbsp;',
  '&eacute;',
  '&quot;',
  '&#8212;',
  '&#x27;',
];

/** A very long run of one whitespace character, the input the collapsing rules exist for. */
const arbWhitespaceRun = fc
  .tuple(fc.constantFrom(' ', '\t', '\n', '\r\n'), fc.integer({ min: 1, max: 30 }))
  .map(([character, count]) => character.repeat(count));

const arbLeafText = fc
  .array(
    fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom(...LEAF_CHARS) },
      { weight: 1, arbitrary: fc.constantFrom(...ENTITIES) },
      { weight: 1, arbitrary: arbWhitespaceRun },
    ),
    { minLength: 0, maxLength: 25 },
  )
  .map(pieces => pieces.join(''));

const CONTAINERS: readonly string[] = [
  'p',
  'li',
  'div',
  'span',
  'h2',
  'h3',
  'h4',
];

/** How one generated node is rendered: well formed, open tag only, or a stray close tag. */
type Balance = 'closed' | 'unclosed' | 'strayClose';

const { fragment } = fc.letrec<{ fragment: string }>(tie => ({
  fragment: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    arbLeafText,
    fc.constant('<br>'),
    fc.constant('<br/>'),
    fc.constant('<!-- comment -->'),
    fc
      .tuple(
        fc.constantFrom(...CONTAINERS),
        fc.array(tie('fragment'), { minLength: 0, maxLength: 3 }),
        fc.constantFrom<Balance>('closed', 'closed', 'unclosed', 'strayClose'),
      )
      .map(([tag, children, balance]) => {
        const inner = children.join('');
        if (balance === 'unclosed') return `<${tag}>${inner}`;
        if (balance === 'strayClose') return `${inner}</${tag}>`;
        return `<${tag}>${inner}</${tag}>`;
      }),
  ),
}));

/** A whole fragment: a sequence of generated nodes concatenated. */
const arbHtmlFragment = fc
  .array(fragment, { minLength: 0, maxLength: 8 })
  .map(nodes => nodes.join(''));

/** The caps the Parser actually passes, plus small caps that force truncation. */
const arbMaxLength = fc.oneof(
  fc.integer({ min: 1, max: 40 }),
  fc.constant(MAX_SHORT_TEXT_LENGTH),
  fc.constant(MAX_TEXT_LENGTH),
);

describe('Property 5: normalizeText is idempotent and bounded', () => {
  it('produces trimmed, markup-free, collapsed text within the cap, idempotently', () => {
    fc.assert(
      fc.property(arbHtmlFragment, arbMaxLength, (html, maxLength) => {
        const once = normalizeText(html, maxLength);

        // No markup survives.
        expect(once).not.toMatch(/[<>]/);
        // No run of 2 or more spaces or tabs (Requirement 2.6).
        expect(once).not.toMatch(/[ \t]{2}/);
        // No leading or trailing whitespace (Requirements 2.6, 2.1).
        expect(once).toBe(once.trim());
        // At most the field's character cap (Requirement 2.1).
        expect(once.length).toBeLessThanOrEqual(maxLength);
        // Idempotent.
        expect(normalizeText(once, maxLength)).toBe(once);
      }),
      { numRuns: 300 },
    );
  });
});
