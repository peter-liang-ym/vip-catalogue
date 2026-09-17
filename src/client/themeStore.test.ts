import { describe, expect, it } from 'vitest';
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

/** In-memory `Storage`, so no test touches a real `localStorage`. */
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

/** Puts a raw string under the key, bypassing `saveTheme`. */
function seed(store: Storage, raw: string): void {
  store.setItem(THEME_KEY, raw);
}

describe('saveTheme', () => {
  it.each(THEME_PREFERENCES)('round-trips %s', preference => {
    const store = new MemoryStorage();

    expect(saveTheme(preference, store)).toEqual({ persisted: true });
    expect(loadTheme(store)).toBe(preference);
  });

  it('writes the storage version and the setting, and nothing else (Requirement 18.3)', () => {
    const store = new MemoryStorage();
    saveTheme('dark', store);

    expect(JSON.parse(store.getItem(THEME_KEY) ?? '')).toEqual({
      storageVersion: THEME_STORAGE_VERSION,
      theme: 'dark',
    });
    expect(store.length).toBe(1);
  });

  it('reports persisted: false when the write throws, and stores nothing (Requirement 18.6)', () => {
    const store = new MemoryStorage();
    store.setItem = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    };

    expect(saveTheme('light', store)).toEqual({ persisted: false });
    expect(loadTheme(store)).toBe(DEFAULT_THEME_PREFERENCE);
  });
});

describe('loadTheme', () => {
  it('resolves to system when the key holds nothing (Requirement 18.1)', () => {
    expect(loadTheme(new MemoryStorage())).toBe('system');
  });

  it.each([
    ['not JSON at all', 'dark'],
    ['truncated JSON', '{"storageVersion":"1","the'],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON number', '42'],
    ['an empty string', ''],
    ['a bare setting as JSON', '"dark"'],
  ])(
    'resolves %s to system and removes the key (Requirement 18.5)',
    (_label, raw) => {
      const store = new MemoryStorage();
      seed(store, raw);

      expect(loadTheme(store)).toBe('system');
      expect(store.getItem(THEME_KEY)).toBeNull();
    },
  );

  it.each(['0', '2', 1, undefined])(
    'resolves storage version %s to system and removes the key (Requirement 18.5)',
    version => {
      const store = new MemoryStorage();
      seed(store, JSON.stringify({ storageVersion: version, theme: 'dark' }));

      expect(loadTheme(store)).toBe('system');
      expect(store.getItem(THEME_KEY)).toBeNull();
    },
  );

  it.each(['Dark', 'DARK', 'auto', '', 3, null, undefined])(
    'resolves the unrecognized setting %s to system and removes the key (Requirement 18.5)',
    theme => {
      const store = new MemoryStorage();
      seed(
        store,
        JSON.stringify({ storageVersion: THEME_STORAGE_VERSION, theme }),
      );

      expect(loadTheme(store)).toBe('system');
      expect(store.getItem(THEME_KEY)).toBeNull();
    },
  );

  it('is total over a storage that throws on read', () => {
    const store = new MemoryStorage();
    store.getItem = () => {
      throw new DOMException('access denied', 'SecurityError');
    };

    expect(loadTheme(store)).toBe('system');
  });
});

describe('removeTheme', () => {
  it('removes the stored setting and never throws', () => {
    const store = new MemoryStorage();
    saveTheme('dark', store);

    removeTheme(store);
    expect(store.getItem(THEME_KEY)).toBeNull();

    store.removeItem = () => {
      throw new DOMException('access denied', 'SecurityError');
    };
    expect(() => removeTheme(store)).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it.each<[ThemePreference, boolean, string]>([
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ])(
    '%s with prefersDark %s resolves to %s (Requirement 18.1)',
    (preference, prefersDark, expected) => {
      expect(resolveTheme(preference, prefersDark)).toBe(expected);
    },
  );
});
