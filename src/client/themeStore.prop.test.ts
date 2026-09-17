/**
 * Property 51: The theme store round-trips and the loader is total over
 * arbitrary stored values.
 *
 * **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.9**
 *
 * The domain the design fixes: the three settings; arbitrary strings, including
 * empty, truncated JSON, JSON arrays and numbers, correctly shaped values
 * carrying a storage version of `'0'`, `'2'`, and none at all, and settings
 * differing only in letter case; a storage stub that throws on `setItem`; both
 * values of the operating-system dark preference; and the Query_State generator
 * Property 25 uses, for the claim that nothing about the theme is ever encoded.
 *
 * The loader's expected answer is not restated as a table here. It is computed by
 * a deliberately separate oracle — "is this raw string a correctly shaped record
 * at this storage version naming one of the three settings?" — so the property
 * says what makes a stored value usable rather than which of the generated
 * strings happen to be.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbQueryState } from '../../test/arbitraries';
import { encodeQueryState, QUERY_PARAMS } from './queryState';
import {
  DEFAULT_THEME_PREFERENCE,
  loadTheme,
  removeTheme,
  resolveTheme,
  saveTheme,
  THEME_KEY,
  THEME_PREFERENCES,
  THEME_STORAGE_VERSION,
  type ThemePreference,
} from './themeStore';

/** In-memory `Storage`, so no run touches a real `localStorage`. */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

const arbPreference: fc.Arbitrary<ThemePreference> = fc.constantFrom(
  ...THEME_PREFERENCES,
);

/** Version fields worth generating: the current one, older, newer, and absent. */
const arbStoredVersion = fc.constantFrom<unknown>(
  THEME_STORAGE_VERSION,
  '0',
  '2',
  1,
  null,
  undefined,
);

/** Theme fields worth generating: the three settings and near misses. */
const arbStoredTheme = fc.constantFrom<unknown>(
  'light',
  'dark',
  'system',
  'Dark',
  'DARK',
  'auto',
  '',
  3,
  null,
  undefined,
);

/**
 * Whatever a key may hold: free-form strings, the shapes a version bump or a
 * hand-edit produces, and the shape this version writes.
 */
const arbStoredRaw: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.constantFrom(
    '',
    'dark',
    '"dark"',
    'null',
    '[]',
    '42',
    '{"storageVersion":"1","the',
    '{}',
  ),
  fc
    .tuple(arbStoredVersion, arbStoredTheme)
    .map(([storageVersion, theme]) => JSON.stringify({ storageVersion, theme })),
  fc
    .array(arbStoredTheme, { maxLength: 3 })
    .map(entries => JSON.stringify(entries)),
);

/**
 * The oracle: the setting a raw string carries, or `null` when it carries none
 * this version can read (Requirements 18.4, 18.5). Independent of the loader's
 * own branches on purpose.
 */
function storedPreference(raw: string): ThemePreference | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record.storageVersion !== THEME_STORAGE_VERSION) return null;

  return THEME_PREFERENCES.includes(record.theme as ThemePreference)
    ? (record.theme as ThemePreference)
    : null;
}

describe('Property 51: the theme store round-trips and the loader is total', () => {
  it('round-trips every setting, storing the version and the setting and nothing else (Requirements 18.3, 18.4)', () => {
    fc.assert(
      fc.property(arbPreference, preference => {
        const store = new MemoryStorage();

        expect(saveTheme(preference, store)).toEqual({ persisted: true });
        expect(loadTheme(store)).toBe(preference);

        // One key, and its value carries exactly the two fields.
        expect(store.length).toBe(1);
        expect(JSON.parse(store.getItem(THEME_KEY) ?? '')).toEqual({
          storageVersion: THEME_STORAGE_VERSION,
          theme: preference,
        });
      }),
    );
  });

  it('is total over arbitrary stored values, resolving the unusable to system and removing it (Requirements 18.1, 18.5)', () => {
    fc.assert(
      fc.property(arbStoredRaw, raw => {
        const store = new MemoryStorage();
        store.setItem(THEME_KEY, raw);

        const expected = storedPreference(raw);
        const loaded = loadTheme(store);

        expect(THEME_PREFERENCES).toContain(loaded);
        expect(loaded).toBe(expected ?? DEFAULT_THEME_PREFERENCE);
        // A usable value survives the read; an unusable one is gone.
        expect(store.getItem(THEME_KEY)).toBe(expected === null ? null : raw);
      }),
    );
  });

  it('never throws on a storage that throws on every operation', () => {
    fc.assert(
      fc.property(arbPreference, preference => {
        const store = new MemoryStorage();
        const fail = () => {
          throw new DOMException('access denied', 'SecurityError');
        };
        store.getItem = fail;
        store.setItem = fail;
        store.removeItem = fail;

        // Requirement 18.6: the write is reported as not persisted, and the
        // caller is free to apply the setting for the visit regardless.
        expect(saveTheme(preference, store)).toEqual({ persisted: false });
        expect(loadTheme(store)).toBe(DEFAULT_THEME_PREFERENCE);
        expect(() => removeTheme(store)).not.toThrow();
      }),
    );
  });

  it('resolves every setting against either operating-system preference (Requirement 18.1)', () => {
    fc.assert(
      fc.property(arbPreference, fc.boolean(), (preference, prefersDark) => {
        const resolved = resolveTheme(preference, prefersDark);

        expect(['light', 'dark']).toContain(resolved);
        // `system` is the only setting the operating system gets a say in.
        if (preference === 'system') {
          expect(resolved).toBe(prefersDark ? 'dark' : 'light');
        } else {
          expect(resolved).toBe(preference);
        }
      }),
    );
  });

  it('encodes no part of the setting into any Query_State parameter (Requirement 18.9)', () => {
    fc.assert(
      fc.property(arbQueryState(), arbPreference, (qs, preference) => {
        const store = new MemoryStorage();
        const before = encodeQueryState(qs);

        saveTheme(preference, store);
        loadTheme(store);

        // Selecting a setting is not a Query_State change, and no parameter name
        // the encoder produces belongs to the theme.
        expect(encodeQueryState(qs)).toBe(before);
        const params = new URLSearchParams(encodeQueryState(qs));
        for (const key of params.keys()) expect(QUERY_PARAMS).toContain(key);
        expect(params.has(THEME_KEY)).toBe(false);
        expect(params.has('theme')).toBe(false);
      }),
    );
  });
});
