/**
 * Text normalization for the Parser (Requirements 2.6, 2.1).
 *
 * Every text value a Team_Record carries goes through `normalizeText`. The steps
 * are the ones the design fixes, in that order:
 *
 * 1. `<br>` and the end of each `p`, `li`, `div`, and heading become one `\n`.
 * 2. All remaining markup is dropped, keeping text nodes; entities are decoded.
 * 3. Every run of 2+ spaces or tabs collapses to one space.
 * 4. 3+ consecutive newlines collapse to 2, and trailing spaces are removed per line.
 * 5. Leading and trailing whitespace is trimmed.
 * 6. The result is capped at the field's character limit.
 *
 * Markup stripping happens before entity decoding, per the design's ordering, so
 * text that the source site escaped (`&lt;p&gt;`) stays content and is not
 * mistaken for structure on a later pass.
 */

import { load } from 'cheerio';
import { MAX_TEXT_LENGTH } from '../shared/types';

/** Elements whose end becomes one line break. */
const BREAK_AFTER = new Set([
  'p',
  'li',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

/**
 * The parts of a parsed node this walk reads. Declared structurally so the
 * module does not depend on cheerio's transitive DOM package.
 */
interface DomNode {
  readonly type: string;
  readonly name?: string;
  readonly data?: string;
  readonly children?: readonly DomNode[];
}

function collect(node: DomNode, out: string[]): void {
  if (node.type === 'text') {
    out.push(node.data ?? '');
    return;
  }
  // Comments, doctypes, and the contents of script/style elements are not text.
  if (
    node.type === 'comment' ||
    node.type === 'script' ||
    node.type === 'style' ||
    node.type === 'directive'
  ) {
    return;
  }

  const name = node.name?.toLowerCase();
  if (name === 'br') {
    out.push('\n');
    return;
  }

  for (const child of node.children ?? []) {
    collect(child, out);
  }

  if (name !== undefined && BREAK_AFTER.has(name)) {
    out.push('\n');
  }
}

/** Truncates without splitting a surrogate pair, then re-trims the cut end. */
function capLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  let cut = maxLength;
  const lastCode = text.charCodeAt(cut - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut -= 1;

  return text.slice(0, cut).trimEnd();
}

/**
 * Normalizes one HTML fragment into plain text.
 *
 * `maxLength` is the field's cap: `MAX_TEXT_LENGTH` for the long text sections,
 * `MAX_SHORT_TEXT_LENGTH` for College and Major names, advisor fields, and the
 * meeting day/time/location values.
 */
export function normalizeText(
  html: string,
  maxLength: number = MAX_TEXT_LENGTH,
): string {
  // Fragment mode: malformed or unbalanced markup is tolerated rather than
  // wrapped in an implied document structure.
  const $ = load(html, null, false);
  const root = $.root()[0] as unknown as DomNode | undefined;

  const parts: string[] = [];
  if (root !== undefined) collect(root, parts);

  const text = parts
    .join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +(?=\n)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return capLength(text, maxLength);
}
