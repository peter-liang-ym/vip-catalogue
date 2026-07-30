/**
 * Unit tests for index discovery (Requirements 1.1, 1.7, 1.8).
 *
 * A virtual clock stands in for wall time so the 1s/2s/4s retry waits behind a
 * failed index fetch cost nothing, and an in-memory route table stands in for the
 * Source_Site so no test touches the network.
 */

import { describe, expect, it } from 'vitest';

import {
  ALL_IN_ONE_INDEX_URL,
  BATCHED_INDEX_URL,
  discoverEntryUrls,
} from './discover';
import { createRequestRunner, type Clock } from './scraper';

function virtualClock(): Clock {
  let time = 0;
  return {
    now: () => time,
    sleep: ms => {
      time += ms;
      return Promise.resolve();
    },
  };
}

/** Routes URLs to HTML; a URL with no route answers 503 on every attempt. */
function runnerOver(routes: Record<string, string>, requested: string[] = []) {
  return createRequestRunner({
    clock: virtualClock(),
    fetch: url => {
      requested.push(url);
      const html = routes[url];
      return Promise.resolve(
        html === undefined
          ? new Response('', { status: 503 })
          : new Response(html, { status: 200 }),
      );
    },
  });
}

const indexHtml = (body: string): string =>
  `<html><body><main>${body}</main></body></html>`;

const allInOneLinks = (ids: readonly number[]): string =>
  ids
    .map(id => `<a href="/teams-all-in-one/entry/${id}">Team ${id}</a>`)
    .join('');

describe('discoverEntryUrls', () => {
  it('canonicalizes, deduplicates, and keeps document order', async () => {
    const runner = runnerOver({
      [ALL_IN_ONE_INDEX_URL]: indexHtml(`
        <a href="/teams-all-in-one/entry/1248">Team A</a>
        <a href="https://vip.gatech.edu/teams/entry/14350">Team B</a>
        <a href="/teams-all-in-one/entry/1248">Team A again</a>
        <a href="/teams/">All teams</a>
        <a href="https://vip.gatech.edu/apply/">Apply</a>
      `),
    });

    const result = await discoverEntryUrls(runner);

    expect(result.urls).toEqual([
      'https://vip.gatech.edu/teams/entry/1248',
      'https://vip.gatech.edu/teams/entry/14350',
    ]);
    expect(result.indexUrlUsed).toBe(ALL_IN_ONE_INDEX_URL);
    expect(result.indexFailure).toBeUndefined();
    expect(result.omissions).toEqual([]);
  });

  it('reads the "{n} Teams" counter and reports no omission when it agrees', async () => {
    const runner = runnerOver({
      [ALL_IN_ONE_INDEX_URL]: indexHtml(
        `<p>2 Teams</p>${allInOneLinks([1, 2])}`,
      ),
    });

    const result = await discoverEntryUrls(runner);

    expect(result.reportedCount).toBe(2);
    expect(result.urls).toHaveLength(2);
    expect(result.omissions).toEqual([]);
  });

  it('records an omission naming both counts when the index exceeds its counter', async () => {
    const runner = runnerOver({
      [ALL_IN_ONE_INDEX_URL]: indexHtml(
        `<p>2 Teams</p>${allInOneLinks([1, 2, 3])}`,
      ),
    });

    const result = await discoverEntryUrls(runner);

    expect(result.urls).toHaveLength(3);
    expect(result.omissions).toHaveLength(1);
    expect(result.omissions[0]?.sourceUrl).toBe(ALL_IN_ONE_INDEX_URL);
    expect(result.omissions[0]?.detail).toContain('2');
    expect(result.omissions[0]?.detail).toContain('3');
  });

  it('falls back to the batched index when the all-in-one page is unavailable', async () => {
    const requested: string[] = [];
    const runner = runnerOver(
      {
        [BATCHED_INDEX_URL]: indexHtml(
          `<p>2 Teams</p><a href="/teams/entry/7">A</a><a href="/teams/entry/8">B</a>`,
        ),
        [`${BATCHED_INDEX_URL}page/2/`]: indexHtml(''),
      },
      requested,
    );

    const result = await discoverEntryUrls(runner);

    expect(result.indexUrlUsed).toBe(BATCHED_INDEX_URL);
    expect(result.urls).toEqual([
      'https://vip.gatech.edu/teams/entry/7',
      'https://vip.gatech.edu/teams/entry/8',
    ]);
    expect(result.indexFailure).toBeUndefined();
    expect(result.omissions).toHaveLength(1);
    expect(result.omissions[0]?.sourceUrl).toBe(ALL_IN_ONE_INDEX_URL);
    // Initial attempt plus 3 retries on the all-in-one index (Requirement 1.4).
    expect(requested.filter(url => url === ALL_IN_ONE_INDEX_URL)).toHaveLength(
      4,
    );
  });

  it('falls back when the all-in-one page yields fewer entries than its counter', async () => {
    const runner = runnerOver({
      [ALL_IN_ONE_INDEX_URL]: indexHtml(`<p>3 Teams</p>${allInOneLinks([1])}`),
      [BATCHED_INDEX_URL]: indexHtml(
        `<p>3 Teams</p><a href="/teams/entry/1">A</a><a href="/teams/entry/2">B</a><a href="/teams/entry/3">C</a>`,
      ),
      [`${BATCHED_INDEX_URL}page/2/`]: indexHtml(''),
    });

    const result = await discoverEntryUrls(runner);

    expect(result.indexUrlUsed).toBe(BATCHED_INDEX_URL);
    expect(result.urls).toHaveLength(3);
    expect(result.omissions).toHaveLength(1);
  });

  it('keeps the all-in-one entries when the fallback finds fewer', async () => {
    const runner = runnerOver({
      [ALL_IN_ONE_INDEX_URL]: indexHtml(
        `<p>5 Teams</p>${allInOneLinks([1, 2, 3])}`,
      ),
      [BATCHED_INDEX_URL]: indexHtml(`<a href="/teams/entry/1">A</a>`),
      [`${BATCHED_INDEX_URL}page/2/`]: indexHtml(''),
    });

    const result = await discoverEntryUrls(runner);

    expect(result.indexUrlUsed).toBe(ALL_IN_ONE_INDEX_URL);
    expect(result.urls).toHaveLength(3);
    expect(result.reportedCount).toBe(5);
    // The fallback notice plus the counter mismatch on the index that was used.
    expect(result.omissions).toHaveLength(2);
  });

  it('requests further batches until one adds no new entries', async () => {
    const requested: string[] = [];
    const runner = runnerOver(
      {
        [`${BATCHED_INDEX_URL}page/2/`]: indexHtml(
          `<a href="/teams/entry/2">B</a><a href="/teams/entry/1">A again</a>`,
        ),
        [`${BATCHED_INDEX_URL}page/3/`]: indexHtml(
          `<a href="/teams/entry/2">B again</a>`,
        ),
        [`${BATCHED_INDEX_URL}page/4/`]: indexHtml(
          `<a href="/teams/entry/9">never reached</a>`,
        ),
        [BATCHED_INDEX_URL]: indexHtml(`<a href="/teams/entry/1">A</a>`),
      },
      requested,
    );

    const result = await discoverEntryUrls(runner);

    expect(result.urls).toEqual([
      'https://vip.gatech.edu/teams/entry/1',
      'https://vip.gatech.edu/teams/entry/2',
    ]);
    expect(requested).not.toContain(`${BATCHED_INDEX_URL}page/4/`);
  });

  it('surfaces an index failure and no URLs when both indexes fail', async () => {
    const runner = runnerOver({});

    const result = await discoverEntryUrls(runner);

    expect(result.urls).toEqual([]);
    expect(result.indexFailure).toEqual({
      url: BATCHED_INDEX_URL,
      reason: 'status 503',
    });
  });

  it('surfaces the zero-URL case as an empty list without an index failure', async () => {
    const runner = runnerOver({
      [ALL_IN_ONE_INDEX_URL]: indexHtml(
        '<p>0 Teams</p><a href="/apply/">Go</a>',
      ),
    });

    const result = await discoverEntryUrls(runner);

    expect(result.urls).toEqual([]);
    expect(result.indexFailure).toBeUndefined();
    expect(result.indexUrlUsed).toBe(ALL_IN_ONE_INDEX_URL);
  });
});
