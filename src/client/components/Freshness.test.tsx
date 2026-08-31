// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dataCurrency,
  Freshness,
  STALE_AFTER_MS,
  STALE_NOTICE_TEXT,
  UNKNOWN_CURRENCY_TEXT,
} from './Freshness';
import { SOURCE_SITE_URL } from './SiteChrome';

/** 2026-01-04 11:30 PM in Atlanta, which is where the timestamp is stated. */
const GENERATED_AT = '2026-01-05T04:30:00Z';
const GENERATED_MS = Date.parse(GENERATED_AT);

function mount(generatedAt: string | undefined, now: number) {
  render(<Freshness generatedAt={generatedAt} now={now} />);
}

function sourceLinks(): readonly (string | null)[] {
  return screen
    .queryAllByTestId('source-site-link')
    .map(link => link.getAttribute('href'));
}

afterEach(cleanup);

describe('Freshness', () => {
  it('displays the generation timestamp as a calendar date, a time of day, and an explicit time zone (Requirement 10.3)', () => {
    mount(GENERATED_AT, GENERATED_MS + 1000);

    const text = screen.getByTestId('freshness-generated').textContent ?? '';
    expect(text).toContain('January 4, 2026');
    expect(text).toContain('11:30');
    expect(text).toContain('PM');
    expect(text).toContain('EST');
  });

  it('shows no out-of-date notice and no unknown-currency indication for a current timestamp (Requirements 10.4, 10.6)', () => {
    mount(GENERATED_AT, GENERATED_MS + 1000);

    expect(screen.queryByTestId('freshness-stale')).toBeNull();
    expect(screen.queryByTestId('freshness-unknown')).toBeNull();
  });

  it('displays the out-of-date notice with a Source_Site link past 30 days, keeping the timestamp (Requirement 10.4)', () => {
    mount(GENERATED_AT, GENERATED_MS + STALE_AFTER_MS + 1);

    expect(screen.getByTestId('freshness-stale').textContent).toContain(
      STALE_NOTICE_TEXT,
    );
    expect(screen.getByTestId('freshness-generated')).toBeTruthy();
    expect(sourceLinks()).toEqual([SOURCE_SITE_URL]);
  });

  it('displays the unknown-currency indication with a Source_Site link and no timestamp when the value is absent (Requirement 10.6)', () => {
    mount(undefined, GENERATED_MS);

    expect(screen.getByTestId('freshness-unknown').textContent).toContain(
      UNKNOWN_CURRENCY_TEXT,
    );
    expect(screen.queryByTestId('freshness-generated')).toBeNull();
    expect(sourceLinks()).toEqual([SOURCE_SITE_URL]);
  });

  it('treats a value that is not a date as unknown currency (Requirement 10.6)', () => {
    mount('last Tuesday', GENERATED_MS);

    expect(screen.getByTestId('freshness-unknown')).toBeTruthy();
    expect(screen.queryByTestId('freshness-generated')).toBeNull();
  });
});

describe('dataCurrency', () => {
  it('is unknown for an absent, empty, or unreadable value (Requirement 10.6)', () => {
    for (const value of [undefined, '', '   ', 'not a date']) {
      expect(dataCurrency(value, GENERATED_MS).kind).toBe('unknown');
    }
  });

  it('is stale only past 30 days, not at exactly 30 days (Requirement 10.4)', () => {
    expect(dataCurrency(GENERATED_AT, GENERATED_MS + STALE_AFTER_MS).kind).toBe(
      'current',
    );
    expect(
      dataCurrency(GENERATED_AT, GENERATED_MS + STALE_AFTER_MS + 1).kind,
    ).toBe('stale');
  });

  it('is current for a timestamp ahead of the render time (Requirement 10.3)', () => {
    expect(dataCurrency(GENERATED_AT, GENERATED_MS - 60_000).kind).toBe(
      'current',
    );
  });
});
