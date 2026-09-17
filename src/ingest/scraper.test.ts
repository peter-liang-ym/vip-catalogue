/**
 * Unit tests for the Scraper request engine (Requirements 1.3, 1.4).
 *
 * A virtual clock stands in for wall time: `sleep` advances the clock and returns
 * immediately, so the 1s/2s/4s backoff and the 30-second crawl delay are asserted
 * from recorded timestamps rather than waited out.
 *
 * The backoff tests below pace with `NO_PACING`, because the retry wait and the
 * crawl delay both land in `clock.sleeps` and asserting the backoff sequence means
 * reading it without the delay interleaved. Pacing has its own test.
 */

import { describe, expect, it } from 'vitest';

import {
  createRequestRunner,
  DEFAULT_SCRAPER_CONFIG,
  fetchImage,
  fetchTeamPages,
  USER_AGENT,
  type Clock,
  type FetchResult,
} from './scraper';

interface VirtualClock extends Clock {
  readonly sleeps: number[];
}

function virtualClock(): VirtualClock {
  let time = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => time,
    sleep: ms => {
      sleeps.push(ms);
      time += ms;
      return Promise.resolve();
    },
  };
}

const readText = (response: Response): Promise<string> => response.text();

/** A zero-length window never fills, so the pacer never sleeps. */
const NO_PACING = { windowMs: 0 } as const;

describe('createRequestRunner', () => {
  it('returns the body on a first-attempt success', async () => {
    const runner = createRequestRunner({
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response('<html/>', { status: 200 })),
    });

    const outcome = await runner.request('https://vip.gatech.edu/', readText);

    expect(outcome).toEqual({
      ok: true,
      status: 200,
      body: '<html/>',
      attempts: 1,
    });
  });

  it('waits 1s, 2s, then 4s across at most 3 retries before failing', async () => {
    const clock = virtualClock();
    let calls = 0;
    const runner = createRequestRunner({
      clock,
      config: NO_PACING,
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response('', { status: 503 }));
      },
    });

    const outcome = await runner.request('https://vip.gatech.edu/', readText);

    expect(calls).toBe(4);
    expect(clock.sleeps).toEqual([1000, 2000, 4000]);
    expect(outcome).toEqual({
      ok: false,
      status: 503,
      failureReason: 'status 503',
      attempts: 4,
    });
  });

  it('stops retrying as soon as an attempt succeeds', async () => {
    const clock = virtualClock();
    let calls = 0;
    const runner = createRequestRunner({
      clock,
      config: NO_PACING,
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? new Response('', { status: 500 })
            : new Response('ok', { status: 200 }),
        );
      },
    });

    const outcome = await runner.request('https://vip.gatech.edu/', readText);

    expect(clock.sleeps).toEqual([1000]);
    expect(outcome.ok).toBe(true);
    expect(outcome.body).toBe('ok');
    expect(outcome.attempts).toBe(2);
  });

  it('reports an aborted attempt as a timeout with no status', async () => {
    const runner = createRequestRunner({
      clock: virtualClock(),
      fetch: () => {
        const error = new Error('The operation timed out.');
        error.name = 'TimeoutError';
        return Promise.reject(error);
      },
    });

    const outcome = await runner.request('https://vip.gatech.edu/', readText);

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBeUndefined();
    expect(outcome.failureReason).toBe('timeout');
    expect(outcome.attempts).toBe(4);
  });

  it('counts a stalled body read as a failed attempt', async () => {
    const runner = createRequestRunner({
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response('', { status: 200 })),
    });

    const outcome = await runner.request('https://vip.gatech.edu/', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.failureReason).toBe('timeout');
    expect(outcome.attempts).toBe(4);
  });

  it('passes an abort signal carrying the 30 second budget', async () => {
    let seen: AbortSignal | undefined;
    const runner = createRequestRunner({
      clock: virtualClock(),
      fetch: (_url, init) => {
        seen = init.signal ?? undefined;
        return Promise.resolve(new Response('ok', { status: 200 }));
      },
    });

    await runner.request('https://vip.gatech.edu/', readText);

    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
    expect(DEFAULT_SCRAPER_CONFIG.requestTimeoutMs).toBe(30_000);
  });

  it('holds to the crawl delay the source site asks for', async () => {
    const clock = virtualClock();
    const starts: number[] = [];
    const runner = createRequestRunner({
      clock,
      fetch: () => {
        starts.push(clock.now());
        return Promise.resolve(new Response('ok', { status: 200 }));
      },
    });

    for (let i = 0; i < 7; i += 1) {
      await runner.request(`https://vip.gatech.edu/teams/entry/${i}`, readText);
    }

    const { maxRequestsPerWindow, windowMs } = DEFAULT_SCRAPER_CONFIG;
    expect(starts).toHaveLength(7);
    for (const start of starts) {
      const inWindow = starts.filter(
        other => other >= start && other - start < windowMs,
      );
      expect(inWindow.length).toBeLessThanOrEqual(maxRequestsPerWindow);
    }
  });

  it('defaults to the 30 second crawl delay from the source robots.txt', () => {
    expect(DEFAULT_SCRAPER_CONFIG.maxRequestsPerWindow).toBe(1);
    expect(DEFAULT_SCRAPER_CONFIG.windowMs).toBe(30_000);
  });

  it('identifies itself with a contactable user agent on every request', async () => {
    const seen: (string | undefined)[] = [];
    const runner = createRequestRunner({
      clock: virtualClock(),
      config: NO_PACING,
      fetch: (_url, init) => {
        seen.push(new Headers(init.headers).get('user-agent') ?? undefined);
        return Promise.resolve(new Response('', { status: 503 }));
      },
    });

    await runner.request('https://vip.gatech.edu/', readText);

    // Every attempt, retries included.
    expect(seen).toHaveLength(4);
    expect(new Set(seen)).toEqual(new Set([USER_AGENT]));
  });
});

describe('fetchTeamPages', () => {
  it('yields one result per URL, in order, requesting each exactly once', async () => {
    const requested: string[] = [];
    const runner = createRequestRunner({
      clock: virtualClock(),
      fetch: url => {
        requested.push(url);
        return Promise.resolve(new Response(`<html>${url}</html>`));
      },
    });
    const urls = [
      'https://vip.gatech.edu/teams/entry/1',
      'https://vip.gatech.edu/teams/entry/2',
    ];

    const results: FetchResult[] = [];
    for await (const result of fetchTeamPages(runner, urls)) {
      results.push(result);
    }

    expect(requested).toEqual(urls);
    expect(results).toEqual([
      {
        url: urls[0],
        ok: true,
        status: 200,
        html: `<html>${urls[0]}</html>`,
        attempts: 1,
      },
      {
        url: urls[1],
        ok: true,
        status: 200,
        html: `<html>${urls[1]}</html>`,
        attempts: 1,
      },
    ]);
  });

  it('keeps going past a failed URL and records its reason', async () => {
    const runner = createRequestRunner({
      clock: virtualClock(),
      fetch: url => {
        if (url.endsWith('/2')) {
          return Promise.resolve(new Response('', { status: 404 }));
        }
        if (url.endsWith('/3')) {
          const error = new Error('timed out');
          error.name = 'TimeoutError';
          return Promise.reject(error);
        }
        return Promise.resolve(new Response('ok'));
      },
    });

    const results: FetchResult[] = [];
    for await (const result of fetchTeamPages(runner, [
      'https://vip.gatech.edu/teams/entry/1',
      'https://vip.gatech.edu/teams/entry/2',
      'https://vip.gatech.edu/teams/entry/3',
      'https://vip.gatech.edu/teams/entry/4',
    ])) {
      results.push(result);
    }

    expect(results.map(result => result.ok)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(results[1]).toEqual({
      url: 'https://vip.gatech.edu/teams/entry/2',
      ok: false,
      status: 404,
      failureReason: 'status 404',
      attempts: 4,
    });
    expect(results[2]).toEqual({
      url: 'https://vip.gatech.edu/teams/entry/3',
      ok: false,
      failureReason: 'timeout',
      attempts: 4,
    });
    expect(results[2]).not.toHaveProperty('status');
    expect(results[3]?.html).toBe('ok');
  });

  it('yields nothing for an empty URL list', async () => {
    const runner = createRequestRunner({
      clock: virtualClock(),
      fetch: () => Promise.reject(new Error('should not be called')),
    });

    const results: FetchResult[] = [];
    for await (const result of fetchTeamPages(runner, [])) {
      results.push(result);
    }

    expect(results).toEqual([]);
  });
});

describe('fetchImage', () => {
  it('returns the bytes and content type of a retrieved image', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const runner = createRequestRunner({
      clock: virtualClock(),
      fetch: () =>
        Promise.resolve(
          new Response(bytes, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        ),
    });

    const result = await fetchImage(
      runner,
      'https://vip.gatech.edu/files/formidable/team.png',
    );

    expect(result).toEqual({
      url: 'https://vip.gatech.edu/files/formidable/team.png',
      ok: true,
      status: 200,
      bytes,
      contentType: 'image/png',
      attempts: 1,
    });
  });

  it('reports failure after 3 retries without throwing', async () => {
    const clock = virtualClock();
    const runner = createRequestRunner({
      clock,
      config: NO_PACING,
      fetch: () => Promise.resolve(new Response('', { status: 500 })),
    });

    const result = await fetchImage(
      runner,
      'https://vip.gatech.edu/files/formidable/team.png',
    );

    expect(clock.sleeps).toEqual([1000, 2000, 4000]);
    expect(result.ok).toBe(false);
    expect(result.bytes).toBeUndefined();
    expect(result.failureReason).toBe('status 500');
    expect(result.attempts).toBe(4);
  });
});
