import { describe, expect, it } from 'vitest';
import { serialize } from '../ingest/serialize';
import type { TeamRecord } from '../shared/types';
import {
  DATASET_URL,
  createDatasetLoader,
  type LoadState,
} from './datasetLoader';

function record(entryId: string, name: string): TeamRecord {
  return {
    entryId,
    sourceUrl: `https://vip.gatech.edu/teams/entry/${entryId}`,
    name,
    imageUrl: '',
    imagePath: '',
    imageAlt: '',
    goals: 'Build a robot.',
    issuesAddressed: '',
    partnersSponsors: '',
    methodsTechnologies: '',
    majorsSought: [{ college: 'College of Engineering', major: 'CS' }],
    preferredInterests: '',
    advisors: [],
    meeting: { day: 'Monday', time: '9:30-10:20', location: '' },
    meetingWindow: [{ weekday: 'Monday', startMinute: 570, endMinute: 620 }],
  };
}

const DATASET_JSON = serialize(
  [record('1248', 'Robotics')],
  new Date('2026-01-05T04:30:00Z'),
);

/**
 * A `fetch` that answers each call with the next queued body, recording the URLs
 * it was asked for so request counts are observable.
 */
function stubFetch(
  outcomes: readonly (
    | { readonly body: string; readonly status?: number }
    | { readonly throws: true }
  )[],
): { fetch: typeof globalThis.fetch; urls: string[] } {
  const urls: string[] = [];
  let call = 0;

  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const outcome = outcomes[Math.min(call, outcomes.length - 1)]!;
    call += 1;
    if ('throws' in outcome) throw new Error('network down');
    return new Response(outcome.body, { status: outcome.status ?? 200 });
  }) as typeof globalThis.fetch;

  return { fetch: fetchImpl, urls };
}

describe('createDatasetLoader', () => {
  it('starts in loading and requests dataset.json once', async () => {
    const { fetch, urls } = stubFetch([{ body: DATASET_JSON }]);
    const seen: LoadState[] = [];
    const loader = createDatasetLoader({
      fetch,
      onStateChange: state => seen.push(state),
    });

    expect(loader.state.kind).toBe('loading');
    const state = await loader.load();

    expect(urls).toEqual([DATASET_URL]);
    expect(state.kind).toBe('loaded');
    expect(loader.state).toBe(state);
    expect(seen.map(s => s.kind)).toEqual(['loading', 'loaded']);
  });

  it('exposes the Dataset and its search index when loaded', async () => {
    const { fetch } = stubFetch([{ body: DATASET_JSON }]);
    const state = await createDatasetLoader({ fetch }).load();

    expect(state.kind === 'loaded' && state.dataset.teamCount).toBe(1);
    expect(state.kind === 'loaded' && state.index.teams[0]?.name).toBe(
      'Robotics',
    );
  });

  it('fails on a non-ok response', async () => {
    const { fetch } = stubFetch([{ body: 'not found', status: 404 }]);

    expect((await createDatasetLoader({ fetch }).load()).kind).toBe('failed');
  });

  it('fails on a network error', async () => {
    const { fetch } = stubFetch([{ throws: true }]);

    expect((await createDatasetLoader({ fetch }).load()).kind).toBe('failed');
  });

  it('fails on a document that is not JSON', async () => {
    const { fetch } = stubFetch([{ body: '<!doctype html>' }]);

    expect((await createDatasetLoader({ fetch }).load()).kind).toBe('failed');
  });

  it('refuses a Dataset whose schemaVersion is not "2"', async () => {
    const body = DATASET_JSON.replace(
      '"schemaVersion": "2"',
      '"schemaVersion": "1"',
    );
    const { fetch } = stubFetch([{ body }]);

    expect((await createDatasetLoader({ fetch }).load()).kind).toBe('failed');
  });

  it('issues exactly one request per retry activation and clears the failure on success', async () => {
    const { fetch, urls } = stubFetch([
      { body: '', status: 500 },
      { body: '', status: 500 },
      { body: DATASET_JSON },
    ]);
    const loader = createDatasetLoader({ fetch });

    expect((await loader.load()).kind).toBe('failed');
    expect(urls).toHaveLength(1);

    expect((await loader.retry()).kind).toBe('failed');
    expect(urls).toHaveLength(2);

    expect((await loader.retry()).kind).toBe('loaded');
    expect(urls).toHaveLength(3);
    expect(loader.state.kind).toBe('loaded');
  });
});
