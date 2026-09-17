// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadTheme,
  saveTheme,
  THEME_KEY,
  type ThemePreference,
} from '../themeStore';
import { THEME_GROUP_LABEL, THEME_LABELS, ThemeToggle } from './ThemeToggle';

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

function mount(store: Storage = new MemoryStorage()) {
  render(<ThemeToggle store={store} />);

  const setting = (preference: ThemePreference) =>
    screen.getByLabelText(THEME_LABELS[preference]) as HTMLInputElement;

  return { store, setting };
}

function appliedTheme(): string | undefined {
  return document.documentElement.dataset.theme;
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe('ThemeToggle', () => {
  it('offers exactly three mutually exclusive settings under a group label (Requirements 18.2, 11.7)', () => {
    const { setting } = mount();

    const group = screen.getByRole('group', { name: THEME_GROUP_LABEL });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];

    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(group.contains(radio)).toBe(true);
    // One shared name is what makes the browser keep one selected at a time.
    expect(new Set(radios.map(radio => radio.name)).size).toBe(1);
    expect(radios.filter(radio => radio.checked)).toEqual([setting('system')]);
  });

  it('exposes each setting through an associated label (Requirements 18.2, 11.7)', () => {
    const { setting } = mount();

    for (const preference of ['light', 'dark', 'system'] as const) {
      expect(setting(preference).value).toBe(preference);
    }
  });

  it('applies system and selects it while nothing is stored (Requirement 18.1)', () => {
    const { setting } = mount();

    expect(setting('system').checked).toBe(true);
    expect(appliedTheme()).toBe('system');
  });

  it('applies and selects the stored setting (Requirement 18.4)', () => {
    const store = new MemoryStorage();
    saveTheme('dark', store);

    const { setting } = mount(store);

    expect(setting('dark').checked).toBe(true);
    expect(setting('light').checked).toBe(false);
    expect(appliedTheme()).toBe('dark');
  });

  it('applies a selected setting without reloading and stores it (Requirement 18.3)', () => {
    const { store, setting } = mount();

    fireEvent.click(setting('dark'));

    expect(appliedTheme()).toBe('dark');
    expect(setting('dark').checked).toBe(true);
    expect(loadTheme(store)).toBe('dark');

    fireEvent.click(setting('light'));

    expect(appliedTheme()).toBe('light');
    expect(loadTheme(store)).toBe('light');
  });

  it('returns to following the system preference (Requirement 18.1)', () => {
    const store = new MemoryStorage();
    saveTheme('dark', store);

    const { setting } = mount(store);
    fireEvent.click(setting('system'));

    // `tokens.css` treats `system` as "follow prefers-color-scheme", the same as
    // no attribute at all.
    expect(appliedTheme()).toBe('system');
    expect(loadTheme(store)).toBe('system');
  });

  it('applies system with no message when the stored value is unreadable (Requirement 18.5)', () => {
    const store = new MemoryStorage();
    store.setItem(THEME_KEY, '{"storageVersion":"0","theme":"dark"}');

    const { setting } = mount(store);

    expect(setting('system').checked).toBe(true);
    expect(appliedTheme()).toBe('system');
    expect(store.getItem(THEME_KEY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('applies the setting for the visit when the write throws (Requirement 18.6)', () => {
    const store = new MemoryStorage();
    store.setItem = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    };

    const { setting } = mount(store);
    fireEvent.click(setting('dark'));

    expect(appliedTheme()).toBe('dark');
    expect(setting('dark').checked).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('writes no address and no history entry (Requirement 18.9)', () => {
    const before = location.href;
    const entries = history.length;

    const { setting } = mount();
    fireEvent.click(setting('dark'));

    expect(location.href).toBe(before);
    expect(history.length).toBe(entries);
  });
});
