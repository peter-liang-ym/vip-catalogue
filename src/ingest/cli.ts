/**
 * Ingestion CLI: `bun run ingest` and `bun run ingest --from-cache`.
 *
 * This is the process wrapper `runIngestion` was written to be free of. It builds
 * the four injected dependencies, runs one job, prints a short human summary, and
 * maps `report.exitCode` onto the process exit status — which is what makes the
 * Requirement 1.7, 1.8, 3.4, 3.5, and 3.7 abort paths observable to a shell or a
 * CI step without any of the job's own logic knowing about processes.
 *
 * Nothing here decides whether a run publishes. Every gate lives in
 * `checkPublishable` and every report field in `runIngestion`; the exit status is
 * a copy of a value the job already computed, never a second judgement of it.
 *
 * `--from-cache` swaps only the bytes' origin. The fixture mode injects a `fetch`
 * that serves `fixtures/html/` instead of the Source_Site and keeps
 * `discoverEntryUrls`, `fetchTeamPages`, `parseTeamPage`, the validator, and the
 * publish store exactly as the live run uses them, so a cache run exercises the
 * real pipeline rather than a parallel one. A fixture that is not on disk answers
 * as a 404, which is deliberate: a missing index fixture then travels the same
 * Requirement 1.7 path a dead index would, and a missing entry fixture becomes one
 * failed URL rather than a crash.
 *
 * The two index fixtures and the `entry-{id}.html` files come from
 * `bun run ingest:fixtures`. `fixtures/html/entry-drifted.html` is hand-authored
 * for the parser's unit tests and is not published by any index, so a cache run
 * never reads it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';

import {
  ALL_IN_ONE_INDEX_URL,
  BATCHED_INDEX_URL,
  discoverEntryUrls,
} from './discover';
import {
  runIngestion,
  type IngestionReport,
  type ReportSink,
  type Scraper,
} from './job';
import { createPublishStore } from './publishStore';
import {
  createRequestRunner,
  fetchImage,
  fetchTeamPages,
  systemClock,
  type Clock,
  type FetchFn,
} from './scraper';

const FIXTURE_DIR = 'fixtures/html';
const REPORT_DIR = 'reports';

/** `2026-01-05T04:30:00.000Z` → `2026-01-05T043000Z`, as the design names reports. */
export function reportFileName(runStartedAt: string): string {
  const stamp = runStartedAt.replace(/:/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `ingest-${stamp}.json`;
}

/**
 * The report sink. A throw here is a legal outcome that `runIngestion` turns into
 * a non-zero exit with the previously published Dataset untouched, so nothing is
 * swallowed on the way out.
 */
const writeReport: ReportSink = async (report: IngestionReport) => {
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(
    `${REPORT_DIR}/${reportFileName(report.runStartedAt)}`,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
};

/** Composes discovery, page fetches, and image fetches over one shared runner. */
function scraperOver(runner: ReturnType<typeof createRequestRunner>): Scraper {
  return {
    discoverEntryUrls: () => discoverEntryUrls(runner),
    fetchTeamPages: urls => fetchTeamPages(runner, urls),
    fetchImage: url => fetchImage(runner, url),
  };
}

function createLiveScraper(): Scraper {
  return scraperOver(createRequestRunner());
}

/** Maps a Source_Site URL onto the fixture that stands in for it, if any. */
export function fixturePathFor(url: string): string | null {
  if (url === ALL_IN_ONE_INDEX_URL)
    return `${FIXTURE_DIR}/index-all-in-one.html`;
  if (url === BATCHED_INDEX_URL) return `${FIXTURE_DIR}/index-batched.html`;

  const entryId = /\/entry\/(\d+)/.exec(url)?.[1];
  return entryId === undefined ? null : `${FIXTURE_DIR}/entry-${entryId}.html`;
}

/**
 * Serves fixtures as HTTP responses. An unmapped URL — a later batch page, an
 * image, anything the capture script does not save — and an absent file both
 * answer 404, so the job's existing failure paths handle them unchanged.
 */
const fixtureFetch: FetchFn = async (url: string) => {
  const path = fixturePathFor(url);
  if (path === null) return new Response('', { status: 404 });

  try {
    return new Response(await readFile(path, 'utf8'), { status: 200 });
  } catch {
    return new Response('', { status: 404 });
  }
};

/**
 * Reading a local file needs neither politeness nor patience, so the fixture
 * runner drops the pacing bound and the retry waits. Retries themselves stay:
 * a 404 for a missing fixture should reach the report by the same route a 404
 * from the Source_Site would.
 */
const noWaitClock: Clock = {
  now: () => Date.now(),
  sleep: () => Promise.resolve(),
};

function createFixtureScraper(): Scraper {
  return scraperOver(
    createRequestRunner({
      fetch: fixtureFetch,
      clock: noWaitClock,
      config: {
        maxRequestsPerWindow: Number.MAX_SAFE_INTEGER,
        initialBackoffMs: 0,
      },
    }),
  );
}

function summarize(report: IngestionReport, fromCache: boolean): void {
  console.log(
    `${fromCache ? 'cache' : 'live'} run: ` +
      `${report.discoveredUrlCount} URLs discovered, ` +
      `${report.recordCount} records parsed, ` +
      `published=${report.published}`,
  );
  console.log(`report: ${REPORT_DIR}/${reportFileName(report.runStartedAt)}`);

  for (const failure of report.validationFailures) {
    console.error(
      `validation ${failure.check}${failure.entryId === undefined ? '' : ` (${failure.entryId})`}` +
        `${failure.detail === undefined ? '' : `: ${failure.detail}`}`,
    );
  }
  for (const failed of report.failedUrls) {
    console.error(`failed ${failed.url}: ${failed.reason}`);
  }
  if (report.parseErrors.length > 0) {
    console.error(`${report.parseErrors.length} parse errors`);
  }
  if (report.omissions.length > 0) {
    console.warn(`${report.omissions.length} omissions recorded`);
  }
  if (report.imageFailures.length > 0) {
    console.warn(`${report.imageFailures.length} images could not be fetched`);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const fromCache = argv.includes('--from-cache');

  const report = await runIngestion({
    scraper: fromCache ? createFixtureScraper() : createLiveScraper(),
    clock: systemClock,
    store: createPublishStore(),
    writeReport,
  });

  summarize(report, fromCache);
  return report.exitCode;
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
