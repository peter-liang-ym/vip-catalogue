// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTheme } from '../themeStore';
import { THEME_GROUP_LABEL, THEME_LABELS } from './ThemeToggle';
import {
  ATTRIBUTION_TEXT,
  SEARCH_LABEL,
  SITE_TITLE,
  SiteChrome,
  SOURCE_SITE_LINK_TEXT,
  SOURCE_SITE_URL,
} from './SiteChrome';

const LISTING_HREF = '/?q=robot';

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

function mount(children?: ComponentChildren, store: Storage = new MemoryStorage()) {
  const onListing = vi.fn();
  render(
    <SiteChrome
      listingHref={LISTING_HREF}
      onListing={onListing}
      store={store}
    >
      {children}
    </SiteChrome>,
  );
  return { onListing, store };
}

/** The chrome as the listing route renders it: the masthead carries the field. */
function mountSearchable(query = '', store: Storage = new MemoryStorage()) {
  const onListing = vi.fn();
  const onQuery = vi.fn();
  render(
    <SiteChrome
      listingHref={LISTING_HREF}
      onListing={onListing}
      store={store}
      query={query}
      onQuery={onQuery}
    >
      <p>listing</p>
    </SiteChrome>,
  );
  return { onListing, onQuery, store };
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe('SiteChrome', () => {
  it('displays the VIP program attribution and a Source_Site link in the footer (Requirement 10.2)', () => {
    mount(<p>listing</p>);

    const footer = screen.getByTestId('site-footer');
    expect(footer.textContent).toContain(ATTRIBUTION_TEXT);

    const link = screen.getByTestId('source-site-link');
    expect(footer.contains(link)).toBe(true);
    expect(link.getAttribute('href')).toBe(SOURCE_SITE_URL);
    expect(link.textContent).toBe(SOURCE_SITE_LINK_TEXT);
  });

  it('displays the footer for whatever page content it wraps (Requirement 10.2)', () => {
    mount(<p>the team was not found</p>);

    expect(screen.getByText('the team was not found')).toBeTruthy();
    expect(screen.getByTestId('site-footer')).toBeTruthy();
  });

  it('displays the footer with no page content at all (Requirement 10.2)', () => {
    mount();

    expect(screen.getByTestId('site-footer').textContent).toContain(
      ATTRIBUTION_TEXT,
    );
  });

  it('carries the labeled search field in the masthead and reports input (Requirements 8.8, 11.7)', () => {
    const { onQuery } = mountSearchable('robot');

    const field = screen.getByLabelText(SEARCH_LABEL) as HTMLInputElement;
    expect(field.value).toBe('robot');
    expect(field.closest('header')).toBeTruthy();

    fireEvent.input(field, { target: { value: 'robotics' } });
    expect(onQuery).toHaveBeenCalledWith('robotics');
  });

  it('offers no search field on a route that has no Search_Query', () => {
    mount(<p>the team was not found</p>);

    expect(screen.queryByLabelText(SEARCH_LABEL)).toBeNull();
  });

  it('carries the theme control in the masthead on every route (Requirement 18.2)', () => {
    mount(<p>the team was not found</p>);

    const control = screen.getByRole('group', { name: THEME_GROUP_LABEL });
    // The chrome renders on every route and in every load state, so a control
    // here is a control everywhere.
    expect(control.closest('header')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('applies a selected theme without reloading and leaves the page as it was (Requirement 18.3)', () => {
    const store = new MemoryStorage();
    const { onQuery } = mountSearchable('robot', store);
    const before = location.href;

    fireEvent.click(screen.getByLabelText(THEME_LABELS.dark));

    // Applied to every surface through the one attribute the stylesheet reads,
    // with no reload, no address write, and no Search_Query change.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(loadTheme(store)).toBe('dark');
    expect(location.href).toBe(before);
    expect(onQuery).not.toHaveBeenCalled();
    expect(screen.getByLabelText(SEARCH_LABEL)).toHaveProperty('value', 'robot');
    expect(screen.getByText('listing')).toBeTruthy();
    expect(screen.getByTestId('site-footer').textContent).toContain(
      ATTRIBUTION_TEXT,
    );
  });

  it('links the site name to the listing under the current Query_State (Requirement 9.4)', () => {
    const { onListing } = mount(<p>listing</p>);

    const brand = screen.getByText(SITE_TITLE);
    expect(brand.getAttribute('href')).toBe(LISTING_HREF);

    fireEvent.click(brand);
    expect(onListing).toHaveBeenCalledTimes(1);
  });
});
