/**
 * Property 50: Token contrast and target sizes hold in both themes.
 *
 * **Validates: Requirements 11.3, 11.5, 11.9, 11.11, 18.7**
 *
 * The domain is finite and known at build time — two theme blocks parsed out of
 * `tokens.css`, crossed with the pairings the component stylesheets actually
 * declare — so it is enumerated exhaustively rather than sampled. Every case in
 * the domain runs on every test run, which is strictly stronger than a
 * generator over the same set.
 *
 * The two guards against passing by omission are in `pairings cover every color
 * token` and `every theme defines the same color tokens`: a token that exists in
 * `tokens.css` but appears in no pairing fails, and a token defined in one theme
 * only fails rather than being skipped.
 *
 * Per Task 28.2 and the design's note on the visual identity, the hex values in
 * `tokens.css` are proposals. A failing pairing here is fixed by moving the
 * token, never by lowering a threshold in this file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// --------------------------------------------------------------- stylesheets

const STYLES_DIR = import.meta.dirname;

/** Every stylesheet in the identity, `tokens.css` included. */
const SHEET_NAMES = [
  'tokens.css',
  'base.css',
  'layout.css',
  'primitives.css',
  'controls.css',
  'listing.css',
  'detail.css',
  'calendar.css',
  'load.css',
] as const;

/**
 * Comments are removed before anything below reads a stylesheet: these files
 * carry long rationale comments that quote token names and declarations, and a
 * quoted `outline: none` or a retired token named in prose is not a use of it.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const sheets: ReadonlyMap<string, string> = new Map(
  SHEET_NAMES.map(name => [
    name,
    stripComments(readFileSync(join(STYLES_DIR, name), 'utf8')),
  ]),
);

const tokensCss = sheets.get('tokens.css')!;

/** The stylesheets that reference tokens rather than define them. */
const componentSheets = [...sheets].filter(([name]) => name !== 'tokens.css');

// ------------------------------------------------------------ block parsing

/**
 * The body of the first brace-balanced block that starts at or after `marker`.
 * Brace counting rather than a regex, because the dark theme's media query
 * wraps a second block.
 */
function blockBody(css: string, marker: string): string {
  const at = css.indexOf(marker);
  if (at < 0) throw new Error(`no block found for marker: ${marker}`);
  const open = css.indexOf('{', at + marker.length - 1);
  if (open < 0) throw new Error(`no opening brace after marker: ${marker}`);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced block for marker: ${marker}`);
}

/** Every `--name: value` declaration in a block body, in source order. */
function declarations(body: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of body.matchAll(
    /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g,
  )) {
    found.set(name, value.trim());
  }
  return found;
}

/** Declarations whose value is a literal hex color. */
function colorsOf(body: string): ReadonlyMap<string, string> {
  return new Map(
    [...declarations(body)].filter(([, value]) =>
      /^#[0-9a-f]{6}$/i.test(value),
    ),
  );
}

const lightBody = blockBody(tokensCss, ':root {');
const darkBody = blockBody(tokensCss, "[data-theme='dark'] {");
const systemDarkBody = blockBody(tokensCss, ':root:where(');

const THEMES = {
  light: colorsOf(lightBody),
  dark: colorsOf(darkBody),
} as const;

type ThemeName = keyof typeof THEMES;
const THEME_NAMES = Object.keys(THEMES) as readonly ThemeName[];

/** The value of `--name` in `theme`, or a failure if the theme lacks it. */
function tokenValue(theme: ThemeName, name: string): string {
  const value = THEMES[theme].get(name);
  if (value === undefined) {
    throw new Error(`token ${name} is not defined in the ${theme} theme`);
  }
  return value;
}

// ------------------------------------------------------------ color science

function channels(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** sRGB channel to linear light. */
function linear(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG 2 contrast ratio, 1 to 21. */
function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** CIELAB, D65, for the perceptual distance the state triad is held to. */
function lab(hex: string): readonly [number, number, number] {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIE76 color difference. This is the metric for "mutually distinguishable",
 * not the WCAG ratio: the state triad is green, gray, and red at deliberately
 * similar lightness, so a luminance ratio would report three colors that are
 * obviously different as identical. Requirement 11.11 is met by the state text
 * regardless; this only keeps the decoration from collapsing.
 */
function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// ---------------------------------------------------------------- pairings

/**
 * `text` carries the Requirement 11.3 and 18.7 floor of 4.5:1: every run of
 * text in the identity is below 24px, or below 19px where it is bold.
 *
 * `large-text` and `boundary` carry 3:1.
 */
type PairingKind = 'text' | 'large-text' | 'boundary';

const THRESHOLD: Record<PairingKind, number> = {
  text: 4.5,
  'large-text': 3,
  boundary: 3,
};

interface Pairing {
  /** Ink for a text pairing, border color for a boundary. */
  readonly fg: string;
  /** The background the pairing is measured against. */
  readonly bg: string;
  readonly kind: PairingKind;
  /** Where the stylesheets declare it, so a failure names a surface. */
  readonly where: string;
}

const SURFACES = ['--bg', '--surface', '--surface-sunken'] as const;

/** Every pairing the component stylesheets declare. */
const PAIRINGS: readonly Pairing[] = [
  // Body text, headings, field values, and the state badges' own text.
  ...SURFACES.map(
    (bg): Pairing => ({
      fg: '--ink',
      bg,
      kind: 'text',
      where: `body text on ${bg}`,
    }),
  ),
  // Field labels and the freshness notices.
  ...SURFACES.map(
    (bg): Pairing => ({
      fg: '--ink-muted',
      bg,
      kind: 'text',
      where: `field labels on ${bg}`,
    }),
  ),
  // Not-selectable values: a zero-count facet value, a value the record does
  // not supply, and the selected-count in a collapsed Filter group. Live text,
  // not only disabled controls, so it takes the text floor rather than an
  // exemption.
  ...SURFACES.map(
    (bg): Pairing => ({
      fg: '--ink-faint',
      bg,
      kind: 'text',
      where: `not-selectable values on ${bg}`,
    }),
  ),
  ...SURFACES.map(
    (bg): Pairing => ({
      fg: '--accent',
      bg,
      kind: 'text',
      where: `links on ${bg}`,
    }),
  ),
  ...SURFACES.map(
    (bg): Pairing => ({
      fg: '--accent-hover',
      bg,
      kind: 'text',
      where: `hovered links on ${bg}`,
    }),
  ),
  // The drop target while a Calendar_File is over it: an accent wash carrying
  // the target's own text and its hint.
  {
    fg: '--ink',
    bg: '--accent-subtle',
    kind: 'text',
    where: 'drop-active target text',
  },
  {
    fg: '--ink-muted',
    bg: '--accent-subtle',
    kind: 'text',
    where: 'drop-active target hint',
  },
  // A search-term `mark`.
  {
    fg: '--highlight-ink',
    bg: '--highlight',
    kind: 'text',
    where: 'search-term highlight',
  },
  // The load-failure retry control: the one filled control, so the pairing
  // inverts.
  {
    fg: '--bg',
    bg: '--ink',
    kind: 'text',
    where: 'retry control label on its fill',
  },
  // The masthead site name, at `--text-2xl`, the one run of text above the
  // Requirement 11.3 size threshold. It shares the body pairing, which is held
  // to the stricter floor above.
  {
    fg: '--ink',
    bg: '--bg',
    kind: 'large-text',
    where: 'masthead site name',
  },

  // Boundaries: card edges, control boundaries, the masthead band, and the
  // unloaded state rail.
  ...SURFACES.map(
    (bg): Pairing => ({
      fg: '--border-strong',
      bg,
      kind: 'boundary',
      where: `card and control boundaries on ${bg}`,
    }),
  ),
  // The focus indicator, restated as a boundary pairing so it is covered by the
  // sweep as well as by its own test below.
  ...SURFACES.map(
    (bg): Pairing => ({
      fg: '--ink',
      bg,
      kind: 'boundary',
      where: `focus ring on ${bg}`,
    }),
  ),
  // The state rail and the Team_Card state badge, on a card and on the field.
  ...(
    ['--state-clear', '--state-unknown', '--state-conflict'] as const
  ).flatMap((fg): Pairing[] =>
    (['--surface', '--bg'] as const).map(bg => ({
      fg,
      bg,
      kind: 'boundary',
      where: `state rail and badge (${fg}) on ${bg}`,
    })),
  ),
  // The retry control's hover and focus edge, and the drop target's active
  // edge. Both are measured against the field the control sits on: the fill
  // behind the edge is what separates the control from the page, and it is
  // `--ink`, which the focus-ring assertion already holds to 3:1 there.
  {
    fg: '--accent',
    bg: '--bg',
    kind: 'boundary',
    where: 'retry control hover edge',
  },
  {
    fg: '--ink',
    bg: '--accent-subtle',
    kind: 'boundary',
    where: 'drop-active target edge',
  },
];

/**
 * `--border` is absent from `PAIRINGS` by design and by contract: it is the
 * divider *inside* an already-bordered surface, the one place the design
 * permits a sub-3:1 rule, so no boundary meaning rests on it.
 */
const UNPAIRED_BY_CONTRACT = new Set(['--border']);

// -------------------------------------------------------------------- tests

describe('Property 50: token contrast and target sizes hold in both themes', () => {
  describe('the token set itself', () => {
    it('defines the same color tokens in both themes', () => {
      expect([...THEMES.dark.keys()].sort()).toEqual(
        [...THEMES.light.keys()].sort(),
      );
    });

    it('states the dark theme identically for the attribute and the system preference', () => {
      expect(Object.fromEntries(colorsOf(systemDarkBody))).toEqual(
        Object.fromEntries(THEMES.dark),
      );
      // `color-scheme` per theme, so form controls and scrollbars follow.
      expect(systemDarkBody).toMatch(/color-scheme:\s*dark;/);
      expect(darkBody).toMatch(/color-scheme:\s*dark;/);
      expect(lightBody).toMatch(/color-scheme:\s*light;/);
    });

    it('pairs every color token, so none passes by omission', () => {
      const paired = new Set(PAIRINGS.flatMap(p => [p.fg, p.bg]));
      const unpaired = [...THEMES.light.keys()].filter(
        name => !paired.has(name) && !UNPAIRED_BY_CONTRACT.has(name),
      );
      expect(unpaired).toEqual([]);
    });

    it('defines every token the component stylesheets reference', () => {
      const defined = new Set(declarations(lightBody).keys());
      const missing = new Map<string, string[]>();
      for (const [name, css] of componentSheets) {
        // Tokens a stylesheet defines for itself, such as `--control-border`.
        const local = new Set(declarations(css).keys());
        const unknown = [
          ...new Set(
            [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map(([, token]) => token),
          ),
        ].filter(token => !defined.has(token) && !local.has(token));
        if (unknown.length > 0) missing.set(name, unknown);
      }
      expect(Object.fromEntries(missing)).toEqual({});
    });
  });

  describe('contrast, in both themes', () => {
    for (const theme of THEME_NAMES) {
      for (const pairing of PAIRINGS) {
        const floor = THRESHOLD[pairing.kind];
        it(`${theme}: ${pairing.where} (${pairing.fg} on ${pairing.bg}) clears ${floor}:1`, () => {
          const ratio = contrastRatio(
            tokenValue(theme, pairing.fg),
            tokenValue(theme, pairing.bg),
          );
          expect(
            Number(ratio.toFixed(2)),
            `${pairing.fg} ${tokenValue(theme, pairing.fg)} on ${pairing.bg} ${tokenValue(theme, pairing.bg)}`,
          ).toBeGreaterThanOrEqual(floor);
        });
      }
    }
  });

  describe('Requirement 11.5: the focus indicator', () => {
    it('is drawn in --ink at --focus-width, and no stylesheet removes it', () => {
      const controls = sheets.get('controls.css')!;
      expect(controls).toMatch(
        /:focus-visible\s*\{[^}]*outline:\s*var\(--focus-width\)\s+solid\s+var\(--ink\)\s*!important/,
      );
      for (const [name, css] of sheets) {
        expect(css, `${name} removes a focus indicator`).not.toMatch(
          /outline:\s*(none|0)/,
        );
      }
    });

    for (const theme of THEME_NAMES) {
      for (const surface of SURFACES) {
        it(`${theme}: clears 3:1 against ${surface}`, () => {
          const ratio = contrastRatio(
            tokenValue(theme, '--ink'),
            tokenValue(theme, surface),
          );
          expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(3);
        });
      }
    }
  });

  describe('Requirement 11.11: the Conflict_State triad', () => {
    const STATES = [
      ['clear', '--state-clear'],
      ['unknown', '--state-unknown'],
      ['conflicting', '--state-conflict'],
    ] as const;

    /**
     * A CIE76 distance of 20 is well past the ~2.3 just-noticeable difference
     * and past the range in which two colors read as shades of one hue.
     */
    const MIN_DELTA_E = 20;

    for (const theme of THEME_NAMES) {
      for (let i = 0; i < STATES.length; i += 1) {
        for (let j = i + 1; j < STATES.length; j += 1) {
          const [, a] = STATES[i]!;
          const [, b] = STATES[j]!;
          it(`${theme}: ${a} and ${b} are mutually distinguishable`, () => {
            expect(
              Number(
                deltaE(tokenValue(theme, a), tokenValue(theme, b)).toFixed(1),
              ),
            ).toBeGreaterThanOrEqual(MIN_DELTA_E);
          });
        }
      }
    }

    for (const [state, token] of STATES) {
      it(`pairs ${token} with state text on the card and in the detail view`, () => {
        const listing = sheets.get('listing.css')!;
        const detail = sheets.get('detail.css')!;
        // The hue is only ever reached through a rule keyed on the state, and
        // the element carrying that rule is the paragraph or badge whose text
        // states the same thing in `--ink`.
        expect(listing).toMatch(
          new RegExp(
            `\\.team-card__conflict\\[data-conflict='${state}'\\]\\s*\\{[^}]*var\\(${token}\\)`,
          ),
        );
        expect(detail).toMatch(
          new RegExp(
            `\\.team-detail__conflict\\[data-conflict='${state}'\\]\\s*\\{[^}]*var\\(${token}\\)`,
          ),
        );
      });
    }

    it('sets the state text itself in --ink, so color is never the only carrier', () => {
      expect(sheets.get('listing.css')!).toMatch(
        /\.team-card__conflict\s*\{[^}]*color:\s*var\(--ink\)/,
      );
      expect(sheets.get('detail.css')!).toMatch(
        /\.team-detail__conflict\s*\{[^}]*color:\s*var\(--ink\)/,
      );
    });
  });

  describe('Requirement 11.9: target sizes', () => {
    const controls = sheets.get('controls.css')!;

    it('floors every control at 24 by 24 CSS pixels', () => {
      // The rule that declares the floor, and the selector list it applies to.
      const at = controls.indexOf('--target-min:');
      expect(at).toBeGreaterThan(-1);
      const open = controls.lastIndexOf('{', at);
      const body = controls.slice(open + 1, controls.indexOf('}', at));
      const selector = controls.slice(
        controls.lastIndexOf('}', open) + 1,
        open,
      );

      expect(declarations(controls).get('--target-min')).toBe('24px');
      expect(body).toMatch(/min-height:\s*var\(--target-min\)/);
      expect(body).toMatch(/min-width:\s*var\(--target-min\)/);
      for (const control of [
        'button',
        'select',
        'textarea',
        "input:not([type='checkbox'], [type='radio'])",
        'label',
      ]) {
        expect(selector).toContain(control);
      }
    });

    it('extends the checkbox and radio target through the label, and the link target vertically', () => {
      expect(controls).toMatch(
        /:where\(label\)\s*\{[^}]*display:\s*inline-flex[^}]*padding-block:\s*var\(--space-1\)/,
      );
      expect(controls).toMatch(
        /:where\(a\)\s*\{[^}]*padding-block:\s*var\(--space-1\)/,
      );
    });

    it('is not undercut by a per-view minimum below the floor', () => {
      for (const [name, css] of componentSheets) {
        for (const [, property, px] of css.matchAll(
          /(min-height|min-width|min-block-size|min-inline-size):\s*(\d+)px/g,
        )) {
          const value = Number(px);
          expect(
            value === 0 || value >= 24,
            `${name} sets ${property}: ${px}px`,
          ).toBe(true);
        }
      }
    });
  });

  describe('Task 28.2: the retired token names', () => {
    // Retired by 28.2: the three 24.1 palette names and the two extra faces.
    const RETIRED = [
      '--field',
      '--accent-link',
      '--rule',
      '--font-display',
      '--font-time',
    ] as const;

    for (const token of RETIRED) {
      it(`leaves no use of ${token} anywhere in the stylesheets`, () => {
        const pattern = new RegExp(`(?<![\\w-])${token}(?![\\w-])`);
        const survivors = [...sheets]
          .filter(([, css]) => pattern.test(css))
          .map(([name]) => name);
        expect(survivors).toEqual([]);
      });
    }
  });
});
