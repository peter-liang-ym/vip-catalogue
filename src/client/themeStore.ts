/**
 * Theme_Preference store (Requirements 18.3, 18.4, 18.5, 18.6).
 *
 * The same shape as `busyScheduleStore`: one `localStorage` key, a storage
 * version beside the value, a loader total over whatever the key happens to
 * hold, and a `persisted: boolean` on write. It is a *second* key rather than a
 * field of the Busy_Schedule's, so no theme write can touch calendar data and no
 * calendar write can be lost to a theme change, and so the claim in
 * Requirement 18.3 — this key holds the setting and the storage version and
 * nothing else — is checkable by reading one key.
 *
 * `loadTheme` is total over arbitrary stored strings and never throws: anything
 * that is not JSON, is JSON of the wrong shape, carries a different storage
 * version, or names something other than the three settings resolves to `system`
 * and the key is removed on the spot. There is no `unreadable` case to report,
 * because Requirement 18.5 asks for no message — an unusable value costs the
 * visitor their setting and nothing more.
 *
 * A throwing write returns `persisted: false`; the caller keeps applying the
 * setting for the visit and shows nothing that blocks browsing
 * (Requirement 18.6).
 *
 * The storage version is deliberately separate from the Busy_Schedule's and from
 * the Dataset `schemaVersion`: each describes a different artifact, and bumping
 * one must not force a bump of the others.
 */

export const THEME_KEY = 'vipmirror.theme';
export const THEME_STORAGE_VERSION = '1';

/** The three settings of Requirement 18.2, in the order the control offers them. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What the Catalog_UI actually applies; `system` is not one of these. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * The setting in force while the visitor has selected none and none is stored
 * (Requirement 18.1).
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/**
 * The `Storage` to use, or `null` when there is none to use. Reading
 * `globalThis.localStorage` is itself allowed to throw — a browser with storage
 * disabled does exactly that — so the lookup is guarded rather than assumed.
 */
function resolveStore(store?: Storage): Storage | null {
  if (store !== undefined) return store;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/**
 * The Resolved_Theme for a setting and the operating-system preference the
 * browser reports (Requirement 18.1). Total: `system` follows `prefersDark`, and
 * a browser reporting no preference is `prefersDark: false`, which is light.
 *
 * The stylesheet resolves `system` on its own through
 * `prefers-color-scheme`, so this is for code that needs the answer as a value
 * rather than as a matched selector.
 */
export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * The stored Theme_Preference, or `system` when the key holds nothing this
 * version can read (Requirements 18.4, 18.5).
 */
export function loadTheme(store?: Storage): ThemePreference {
  const storage = resolveStore(store);
  if (storage === null) return DEFAULT_THEME_PREFERENCE;

  let raw: string | null;
  try {
    raw = storage.getItem(THEME_KEY);
  } catch {
    // Storage that cannot be read holds nothing to apply and nothing to remove.
    return DEFAULT_THEME_PREFERENCE;
  }
  if (raw === null) return DEFAULT_THEME_PREFERENCE;

  const unusable = (): ThemePreference => {
    // A value that cannot be read once will not become readable later, and
    // leaving it would have every later visit re-examine it.
    removeTheme(storage);
    return DEFAULT_THEME_PREFERENCE;
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unusable();
  }

  if (typeof parsed !== 'object' || parsed === null) return unusable();
  const stored = parsed as Record<string, unknown>;
  if (stored.storageVersion !== THEME_STORAGE_VERSION) return unusable();
  if (!isThemePreference(stored.theme)) return unusable();

  return stored.theme;
}

/**
 * Stores the Theme_Preference under the single key, reporting whether it will
 * survive the visit.
 *
 * The written value is built here field by field rather than serialized from
 * anything a caller passed, so the key carries the setting and the storage
 * version and nothing else (Requirement 18.3).
 */
export function saveTheme(
  preference: ThemePreference,
  store?: Storage,
): { readonly persisted: boolean } {
  const storage = resolveStore(store);
  if (storage === null) return { persisted: false };

  try {
    storage.setItem(
      THEME_KEY,
      JSON.stringify({
        storageVersion: THEME_STORAGE_VERSION,
        theme: preference,
      }),
    );
    return { persisted: true };
  } catch {
    return { persisted: false };
  }
}

/** Removes the stored Theme_Preference. Never throws. */
export function removeTheme(store?: Storage): void {
  const storage = resolveStore(store);
  if (storage === null) return;

  try {
    storage.removeItem(THEME_KEY);
  } catch {
    // A removal that cannot happen leaves nothing for the caller to do.
  }
}
