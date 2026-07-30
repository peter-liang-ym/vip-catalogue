/**
 * The Ingestion_Job: discovery → page fetches → parse → serialize → validate →
 * publishable check → publish → image cache
 * (Requirements 1.6, 1.7, 1.8, 2.9, 3.4, 3.5, 3.6, 3.7).
 *
 * Everything that touches the network or the filesystem arrives as an injected
 * dependency — the `Scraper`, the `Clock`, the `PublishStore`, and the report
 * sink — so the whole pipeline runs from in-memory fixtures in a test and the
 * only thing the CLI adds is process control.
 *
 * The Ingestion_Report is written exactly once, on every path, from one stage
 * that no branch can skip: an index failure, zero discovered URLs, a validation
 * failure, a count drop, and a fully successful run all leave through the same
 * write (Requirement 1.6). `published` and `exitCode` are the only things that
 * differ per path.
 *
 * The report write happens before the Dataset rename, not after. Requirements 1.6
 * and 2.9 say that a failed report write must leave the previously published
 * Dataset in place, and once the rename has happened it cannot be taken back, so
 * the only ordering that satisfies both is: gate → cache images → write the report
 * → rename. Image caching sits before the write because Requirement 3.8 records
 * image failures in that same report, and caching an image is additive — it cannot
 * corrupt the Dataset the site is currently serving.
 *
 * Only two conditions abort before any parsing: an index that fails on every path
 * (Requirement 1.7) and an index that yields no entry URLs (Requirement 1.8). A
 * single failed team page never stops the loop (Requirement 1.5), and a document
 * the Parser cannot name never stops it either (Requirement 2.8) — both become
 * report entries and the run continues.
 */

import type { DiscoveryResult } from './discover';
import { parseTeamPage, type Omission, type ParseError } from './parser';
import type { PublishStore } from './publishStore';
import type { Clock, FetchResult, ImageFetchResult } from './scraper';
import { buildDataset, serialize } from './serialize';
import { checkPublishable, type ValidationFailure } from './validate';

import type { TeamRecord } from '../shared/types';

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;

/**
 * The I/O surface of the Source_Site, as the job uses it. The concrete
 * implementation composes `discoverEntryUrls`, `fetchTeamPages`, and `fetchImage`
 * over one shared `RequestRunner`, so a single pacer governs every request.
 */
export interface Scraper {
  discoverEntryUrls(): Promise<DiscoveryResult>;
  fetchTeamPages(urls: readonly string[]): AsyncIterable<FetchResult>;
  fetchImage(url: string): Promise<ImageFetchResult>;
}

/** Persists one run's report. Throwing is a legal outcome the job handles. */
export type ReportSink = (report: IngestionReport) => Promise<void>;

export interface FailedUrl {
  readonly url: string;
  readonly reason: string;
}

export interface ImageFailure {
  readonly imageUrl: string;
  readonly entryId: string;
}

/** The machine-readable summary of one run (Requirement 1.6). */
export interface IngestionReport {
  readonly runStartedAt: string;
  readonly runEndedAt: string;
  readonly indexUrlUsed?: string;
  readonly discoveredUrlCount: number;
  readonly recordCount: number;
  readonly failedUrls: readonly FailedUrl[];
  readonly parseErrors: readonly ParseError[];
  readonly omissions: readonly Omission[];
  readonly validationFailures: readonly ValidationFailure[];
  readonly imageFailures: readonly ImageFailure[];
  readonly previousRecordCount?: number;
  readonly published: boolean;
  readonly exitCode: number;
}

export interface IngestionDeps {
  readonly scraper: Scraper;
  readonly clock: Clock;
  readonly store: PublishStore;
  readonly writeReport: ReportSink;
}

/** Everything the run accumulates for the report, whatever path it takes. */
interface Accumulator {
  indexUrlUsed?: string;
  discoveredUrlCount: number;
  recordCount: number;
  previousRecordCount?: number;
  readonly failedUrls: FailedUrl[];
  readonly parseErrors: ParseError[];
  readonly omissions: Omission[];
  readonly validationFailures: ValidationFailure[];
  readonly imageFailures: ImageFailure[];
}

/**
 * `json` is present exactly when the run earned publication, which makes it the
 * single source of `published` — there is no way to report `published: true`
 * without holding the bytes that are about to be renamed into place.
 */
interface PipelineOutcome {
  readonly json?: string;
}

function createAccumulator(): Accumulator {
  return {
    discoveredUrlCount: 0,
    recordCount: 0,
    failedUrls: [],
    parseErrors: [],
    omissions: [],
    validationFailures: [],
    imageFailures: [],
  };
}

function toIsoTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Caches one local copy per referenced image (Requirements 3.6, 3.8).
 *
 * A failed fetch is recorded and skipped over: the store writes nothing, which
 * leaves any previously stored copy in place, and the remaining images and the
 * publication itself carry on. A record naming no local path has no cacheable
 * image, so it costs no request.
 */
async function cacheImages(
  deps: IngestionDeps,
  records: readonly TeamRecord[],
  acc: Accumulator,
): Promise<void> {
  for (const record of records) {
    if (record.imageUrl === '' || record.imagePath === '') continue;

    const result = await deps.scraper.fetchImage(record.imageUrl);
    if (!result.ok) {
      acc.imageFailures.push({
        imageUrl: record.imageUrl,
        entryId: record.entryId,
      });
    }
    await deps.store.storeImage(record.imagePath, result);
  }
}

/**
 * Retrieves and parses every discovered team page, accumulating the failures and
 * omissions as it goes, and returns the records that survived.
 */
async function collectRecords(
  deps: IngestionDeps,
  urls: readonly string[],
  acc: Accumulator,
): Promise<TeamRecord[]> {
  const records: TeamRecord[] = [];

  for await (const page of deps.scraper.fetchTeamPages(urls)) {
    if (!page.ok || page.html === undefined) {
      acc.failedUrls.push({
        url: page.url,
        reason: page.failureReason ?? 'unknown failure',
      });
      continue;
    }

    const outcome = parseTeamPage(page.html, page.url);
    acc.parseErrors.push(...outcome.parseErrors);
    acc.omissions.push(...outcome.omissions);
    if (outcome.record !== undefined) records.push(outcome.record);
  }

  return records;
}

/**
 * The pipeline proper. Every abort returns an outcome with no `json`, so the
 * report stage below cannot report a publication that did not happen.
 */
async function runPipeline(
  deps: IngestionDeps,
  acc: Accumulator,
): Promise<PipelineOutcome> {
  const discovery = await deps.scraper.discoverEntryUrls();
  acc.indexUrlUsed = discovery.indexUrlUsed;
  acc.discoveredUrlCount = discovery.urls.length;
  acc.omissions.push(...discovery.omissions);

  // Requirement 1.7: the index failed on every path, so there is nothing to
  // parse and the previously published Dataset stays as it is.
  if (discovery.indexFailure !== undefined) {
    acc.failedUrls.push(discovery.indexFailure);
    return {};
  }
  // Requirement 1.8: `discoveredUrlCount: 0` is the report's own record of this.
  if (discovery.urls.length === 0) return {};

  const records = await collectRecords(deps, discovery.urls, acc);
  acc.recordCount = records.length;

  const generatedAt = new Date(deps.clock.now());
  acc.previousRecordCount = await deps.store.readPreviousCount();

  // One gate covers the Requirement 3.3 shape checks, the zero-record guard
  // (3.7), and the 80 percent count-drop guard (3.5).
  const gate = checkPublishable(
    buildDataset(records, generatedAt),
    acc.previousRecordCount,
  );
  if (!gate.ok) {
    acc.validationFailures.push(...gate.failures);
    return {};
  }

  await cacheImages(deps, records, acc);
  return { json: serialize(records, generatedAt) };
}

function buildReport(
  acc: Accumulator,
  runStartedAt: string,
  runEndedAt: string,
  outcome: PipelineOutcome,
): IngestionReport {
  const published = outcome.json !== undefined;

  return {
    runStartedAt,
    runEndedAt,
    ...(acc.indexUrlUsed === undefined
      ? {}
      : { indexUrlUsed: acc.indexUrlUsed }),
    discoveredUrlCount: acc.discoveredUrlCount,
    recordCount: acc.recordCount,
    failedUrls: acc.failedUrls,
    parseErrors: acc.parseErrors,
    omissions: acc.omissions,
    validationFailures: acc.validationFailures,
    imageFailures: acc.imageFailures,
    ...(acc.previousRecordCount === undefined
      ? {}
      : { previousRecordCount: acc.previousRecordCount }),
    published,
    exitCode: published ? EXIT_SUCCESS : EXIT_FAILURE,
  };
}

interface ReportStageResult {
  readonly report: IngestionReport;
  readonly persisted: boolean;
}

/**
 * The one write. A sink that throws is the single failure with no report entry to
 * show for it, so the error goes to stderr and the run aborts with a non-zero
 * exit code without attempting a second write (Requirements 1.6, 2.9).
 */
async function writeReportOnce(
  deps: IngestionDeps,
  report: IngestionReport,
): Promise<ReportStageResult> {
  try {
    await deps.writeReport(report);
    return { report, persisted: true };
  } catch (error) {
    console.error('writing the Ingestion_Report failed:', error);
    return { report, persisted: false };
  }
}

/**
 * Runs one Ingestion_Job and returns its report.
 *
 * The process wrapper maps `report.exitCode` onto the process exit status, which
 * is what keeps every path above testable without process control.
 */
export async function runIngestion(
  deps: IngestionDeps,
): Promise<IngestionReport> {
  const acc = createAccumulator();
  const runStartedAt = toIsoTimestamp(deps.clock.now());
  let outcome: PipelineOutcome = {};
  let stage: ReportStageResult | undefined;

  try {
    outcome = await runPipeline(deps, acc);
  } finally {
    // Reached on every path, including a pipeline that threw, so the report is
    // written exactly once whatever happened above.
    stage = await writeReportOnce(
      deps,
      buildReport(acc, runStartedAt, toIsoTimestamp(deps.clock.now()), outcome),
    );
  }

  if (!stage.persisted) {
    return { ...stage.report, published: false, exitCode: EXIT_FAILURE };
  }
  if (outcome.json !== undefined) {
    await deps.store.publishDataset(outcome.json);
  }
  return stage.report;
}
