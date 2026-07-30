/**
 * Unit tests for the Ingestion_Job (Requirements 1.6, 1.7, 1.8, 3.4, 3.5, 3.6,
 * 3.7, 3.8).
 *
 * The Scraper, the PublishStore, and the report sink are all in-memory, so each
 * path through the pipeline is driven by the outcomes it is about rather than by
 * the network.
 */

import { describe, expect, it } from 'vitest';

import type { DiscoveryResult } from './discover';
import { runIngestion, type IngestionReport, type Scraper } from './job';
import type { PublishStore } from './publishStore';
import type { Clock, FetchResult, ImageFetchResult } from './scraper';
import { deserialize } from './serialize';

const NOW = Date.parse('2026-01-05T04:30:00Z');

const clock: Clock = {
  now: () => NOW,
  sleep: () => Promise.resolve(),
};

const entryUrl = (id: string): string =>
  `https://vip.gatech.edu/teams/entry/${id}`;

const IMAGE_URL = 'https://vip.gatech.edu/files/formidable/team.png';

/** A team page in the source site's shape, complete enough to parse cleanly. */
const teamPage = (name: string, withImage = true): string =>
  `<!doctype html><html><body><main><div id="content">` +
  `<h1>${name}</h1>` +
  (withImage ? `<img src="${IMAGE_URL}" alt="${name} banner">` : '') +
  `<h4>Goals</h4><p>Build things.</p>` +
  `<h4>Issues Involved or Addressed</h4><p>Traffic.</p>` +
  `<h4>Partners/Sponsors</h4><p>GTRI</p>` +
  `<h4>Methods and Technologies</h4><p>Python</p>` +
  `<h4>Majors Sought</h4><div>Computing: Computer Science</div>` +
  `<h4>Preferred Interests and Preparation</h4><p>Curiosity</p>` +
  `<h4>Advisors</h4><div><div>Ada Lovelace<br>School of ECE<br>` +
  `<a href="mailto:ada@gatech.edu">ada@gatech.edu</a></div></div>` +
  `<h4>Day, Time &amp; Location</h4>` +
  `<p>Full Team Meeting:</p><p>Thursday</p><p>9:30-10:20</p><p>Baker 101E</p>` +
  `</div></main></body></html>`;

const okPage = (id: string, name: string, withImage = true): FetchResult => ({
  url: entryUrl(id),
  ok: true,
  status: 200,
  html: teamPage(name, withImage),
  attempts: 1,
});

const failedPage = (id: string, reason: string): FetchResult => ({
  url: entryUrl(id),
  ok: false,
  failureReason: reason,
  attempts: 4,
});

const okImage: ImageFetchResult = {
  url: IMAGE_URL,
  ok: true,
  status: 200,
  bytes: new Uint8Array([1, 2, 3]),
  contentType: 'image/png',
  attempts: 1,
};

const failedImage: ImageFetchResult = {
  url: IMAGE_URL,
  ok: false,
  failureReason: 'timeout',
  attempts: 4,
};

const discovery = (
  urls: readonly string[],
  extra: Partial<DiscoveryResult> = {},
): DiscoveryResult => ({
  urls,
  indexUrlUsed: 'https://vip.gatech.edu/teams-all-in-one/',
  omissions: [],
  ...extra,
});

function fakeScraper(
  result: DiscoveryResult,
  pages: readonly FetchResult[] = [],
  image: ImageFetchResult = okImage,
): { scraper: Scraper; imageRequests: string[] } {
  const imageRequests: string[] = [];

  return {
    imageRequests,
    scraper: {
      discoverEntryUrls: () => Promise.resolve(result),
      fetchTeamPages: async function* () {
        for (const page of pages) yield page;
      },
      fetchImage: url => {
        imageRequests.push(url);
        return Promise.resolve(image);
      },
    },
  };
}

function fakeStore(previousCount?: number): {
  store: PublishStore;
  published: string[];
  storedImages: string[];
} {
  const published: string[] = [];
  const storedImages: string[] = [];

  return {
    published,
    storedImages,
    store: {
      readPreviousCount: () => Promise.resolve(previousCount),
      publishDataset: json => {
        published.push(json);
        return Promise.resolve();
      },
      storeImage: (imagePath, result) => {
        if (result.ok) storedImages.push(imagePath);
        return Promise.resolve({
          stored: result.ok,
          retainedPrevious: !result.ok,
        });
      },
    },
  };
}

function fakeSink(): {
  writeReport: (r: IngestionReport) => Promise<void>;
  writes: IngestionReport[];
} {
  const writes: IngestionReport[] = [];
  return {
    writes,
    writeReport: report => {
      writes.push(report);
      return Promise.resolve();
    },
  };
}

describe('runIngestion', () => {
  it('publishes the Dataset, caches the images, and reports the run', async () => {
    const { scraper, imageRequests } = fakeScraper(
      discovery([entryUrl('1'), entryUrl('2')]),
      [okPage('1', 'Aerial Robotics'), okPage('2', 'Smart Cities')],
    );
    const { store, published, storedImages } = fakeStore();
    const sink = fakeSink();

    const report = await runIngestion({ scraper, clock, store, ...sink });

    expect(report.published).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.discoveredUrlCount).toBe(2);
    expect(report.recordCount).toBe(2);
    expect(report.runStartedAt).toBe('2026-01-05T04:30:00.000Z');
    expect(report.runEndedAt).toBe('2026-01-05T04:30:00.000Z');
    expect(report.indexUrlUsed).toBe(
      'https://vip.gatech.edu/teams-all-in-one/',
    );
    expect(sink.writes).toHaveLength(1);
    expect(published).toHaveLength(1);
    expect(deserialize(published[0]!).teams.map(team => team.name)).toEqual([
      'Aerial Robotics',
      'Smart Cities',
    ]);
    expect(imageRequests).toEqual([IMAGE_URL, IMAGE_URL]);
    expect(storedImages).toEqual(['images/1.png', 'images/2.png']);
  });

  it('aborts on an index failure without publishing', async () => {
    const failure = {
      url: 'https://vip.gatech.edu/teams/',
      reason: 'status 503',
    };
    const { scraper } = fakeScraper(discovery([], { indexFailure: failure }));
    const { store, published } = fakeStore(112);
    const sink = fakeSink();

    const report = await runIngestion({ scraper, clock, store, ...sink });

    expect(report.published).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.failedUrls).toEqual([failure]);
    expect(sink.writes).toHaveLength(1);
    expect(published).toEqual([]);
  });

  it('aborts when the index yields no entry URLs', async () => {
    const { scraper } = fakeScraper(discovery([]));
    const { store, published } = fakeStore(112);
    const sink = fakeSink();

    const report = await runIngestion({ scraper, clock, store, ...sink });

    expect(report).toMatchObject({
      published: false,
      exitCode: 1,
      discoveredUrlCount: 0,
      recordCount: 0,
    });
    expect(sink.writes).toHaveLength(1);
    expect(published).toEqual([]);
  });

  it('keeps going past a failed URL and a document with no team name', async () => {
    const nameless = {
      url: entryUrl('3'),
      ok: true,
      status: 200,
      html: '<html><body><main><div id="content"><p>no name</p></div></main></body></html>',
      attempts: 1,
    } satisfies FetchResult;
    const { scraper } = fakeScraper(
      discovery([entryUrl('1'), entryUrl('2'), entryUrl('3')]),
      [okPage('1', 'Aerial Robotics'), failedPage('2', 'timeout'), nameless],
    );
    const { store, published } = fakeStore();
    const sink = fakeSink();

    const report = await runIngestion({ scraper, clock, store, ...sink });

    expect(report.published).toBe(true);
    expect(report.recordCount).toBe(1);
    expect(report.failedUrls).toEqual([
      { url: entryUrl('2'), reason: 'timeout' },
    ]);
    expect(report.parseErrors).toEqual([
      { sourceUrl: entryUrl('3'), message: expect.stringContaining('name') },
    ]);
    expect(published).toHaveLength(1);
  });

  it('rejects a run whose record count dropped below 80 percent', async () => {
    const { scraper } = fakeScraper(discovery([entryUrl('1')]), [
      okPage('1', 'Aerial Robotics'),
    ]);
    const { store, published } = fakeStore(112);
    const sink = fakeSink();

    const report = await runIngestion({ scraper, clock, store, ...sink });

    expect(report.published).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.previousRecordCount).toBe(112);
    expect(report.validationFailures.map(failure => failure.check)).toEqual([
      'countDrop',
    ]);
    expect(published).toEqual([]);
  });

  it('rejects a run that produced zero records', async () => {
    const { scraper } = fakeScraper(discovery([entryUrl('1')]), [
      failedPage('1', 'status 503'),
    ]);
    const { store, published } = fakeStore();
    const sink = fakeSink();

    const report = await runIngestion({ scraper, clock, store, ...sink });

    expect(report.published).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.validationFailures.map(failure => failure.check)).toEqual([
      'zeroRecords',
    ]);
    expect(published).toEqual([]);
  });

  it('publishes despite an image fetch failure and records it', async () => {
    const { scraper } = fakeScraper(
      discovery([entryUrl('1')]),
      [okPage('1', 'Aerial Robotics')],
      failedImage,
    );
    const { store, published, storedImages } = fakeStore();
    const sink = fakeSink();

    const report = await runIngestion({ scraper, clock, store, ...sink });

    expect(report.published).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.imageFailures).toEqual([
      { imageUrl: IMAGE_URL, entryId: '1' },
    ]);
    expect(published).toHaveLength(1);
    expect(storedImages).toEqual([]);
  });

  it('requests no image for a record that references none', async () => {
    const { scraper, imageRequests } = fakeScraper(discovery([entryUrl('1')]), [
      okPage('1', 'Aerial Robotics', false),
    ]);
    const { store } = fakeStore();
    const sink = fakeSink();

    const report = await runIngestion({ scraper, clock, store, ...sink });

    expect(report.published).toBe(true);
    expect(report.imageFailures).toEqual([]);
    expect(imageRequests).toEqual([]);
  });
});
