/**
 * Entry URL discovery (Requirements 1.1, 1.7, 1.8).
 *
 * The all-in-one index is tried first because it publishes every entry in one
 * response, which satisfies Requirement 1.1 without depending on the batching
 * mechanism at all. The batched `/teams/` index is the documented fallback, used
 * only when the all-in-one page is unavailable or yields fewer entries than its
 * own `{n} Teams` counter.
 *
 * Both paths feed the same normalization step — collect `a[href*="/entry/"]`,
 * take the id with `/entry\/(\d+)/`, rebuild the canonical
 * `https://vip.gatech.edu/teams/entry/{id}`, keep the first occurrence of each
 * id — so nothing downstream can tell which index was used. That matters because
 * the all-in-one page links `/teams-all-in-one/entry/{id}` while the canonical
 * detail page lives under `/teams/entry/{id}`, and the parser reads the entry id
 * back out of the URL it was given.
 *
 * A counter that disagrees with the discovered count is a warning, not an abort:
 * it becomes an `Omission` naming both numbers (Requirement 1.1). Only two
 * conditions stop the job, and both are surfaced rather than thrown — an index
 * that fails on every path (`indexFailure`, Requirement 1.7) and an index that
 * parses but yields no entry URLs (`urls` empty, Requirement 1.8).
 *
 * Every request goes through the shared `RequestRunner`, so pacing, the 30s
 * timeout, and the 1s/2s/4s retry policy are the same ones the team page and
 * image fetches obey.
 */

import { load } from 'cheerio';

import type { Omission } from './parser';
import type { RequestRunner } from './scraper';

export const ALL_IN_ONE_INDEX_URL = 'https://vip.gatech.edu/teams-all-in-one/';
export const BATCHED_INDEX_URL = 'https://vip.gatech.edu/teams/';

const ENTRY_URL_PREFIX = 'https://vip.gatech.edu/teams/entry/';

/** Stops a runaway batch walk if a paginated index ever repeats new ids forever. */
const MAX_INDEX_BATCHES = 60;

/**
 * `omissions` is the concrete form of the design's "record any mismatch in the
 * Ingestion_Report as an omission warning": discovery produces the entries and
 * the job appends them to `IngestionReport.omissions` unchanged.
 */
export interface DiscoveryResult {
  readonly urls: readonly string[];
  readonly indexUrlUsed: string;
  readonly reportedCount?: number;
  readonly indexFailure?: { url: string; reason: string };
  readonly omissions: readonly Omission[];
}

export interface DiscoveryDeps {
  /**
   * Builds the URL of batch `page` (1-based) of the fallback index. The live
   * site drives batching through a "Load More" control, so the paged URL shape
   * is injected rather than assumed: a correction here needs no change to the
   * discovery logic.
   */
  readonly batchUrl?: (page: number) => string;
  readonly maxBatches?: number;
}

const defaultBatchUrl = (page: number): string =>
  page === 1 ? BATCHED_INDEX_URL : `${BATCHED_INDEX_URL}page/${page}/`;

interface IndexPage {
  readonly ids: readonly string[];
  readonly reportedCount?: number;
}

/**
 * Reads one index document. Ids are returned in document order and with their
 * duplicates intact; deduplication happens once, across every batch, in the
 * caller.
 */
function parseIndexPage(html: string): IndexPage {
  const $ = load(html);
  const ids: string[] = [];

  $('a[href*="/entry/"]').each((_, element) => {
    const match = /\/entry\/(\d+)/.exec($(element).attr('href') ?? '');
    if (match) ids.push(match[1]!);
  });

  // No trailing word boundary: `text()` concatenates adjacent nodes, so the
  // counter is regularly followed immediately by a link label ("112 TeamsTeam
  // A"), and `\b` would never see the break the rendered page shows.
  const counter = /(\d+)\s*Teams/i.exec($.root().text());
  return counter ? { ids, reportedCount: Number(counter[1]) } : { ids };
}

type IndexFetch =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly reason: string };

async function fetchIndexPage(
  runner: RequestRunner,
  url: string,
): Promise<IndexFetch> {
  const outcome = await runner.request(url, response => response.text());
  return outcome.ok && outcome.body !== undefined
    ? { ok: true, html: outcome.body }
    : { ok: false, reason: outcome.failureReason ?? 'unknown failure' };
}

interface Candidate {
  readonly indexUrl: string;
  readonly ids: readonly string[];
  readonly reportedCount?: number;
}

type Discovery =
  | { readonly ok: true; readonly candidate: Candidate }
  | { readonly ok: false; readonly failure: { url: string; reason: string } };

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique;
}

async function discoverFromAllInOne(runner: RequestRunner): Promise<Discovery> {
  const fetched = await fetchIndexPage(runner, ALL_IN_ONE_INDEX_URL);
  if (!fetched.ok) {
    return {
      ok: false,
      failure: { url: ALL_IN_ONE_INDEX_URL, reason: fetched.reason },
    };
  }

  const page = parseIndexPage(fetched.html);
  return {
    ok: true,
    candidate: {
      indexUrl: ALL_IN_ONE_INDEX_URL,
      ids: dedupe(page.ids),
      ...(page.reportedCount === undefined
        ? {}
        : { reportedCount: page.reportedCount }),
    },
  };
}

/**
 * Walks the batched index until a batch contributes no entry id that an earlier
 * batch did not already publish, which is the termination condition Requirement
 * 1.1 states. A batch that fails after the first one ends the walk with the ids
 * gathered so far and an omission; only a failed first batch is an index
 * failure, because that is the case in which the fallback produced nothing.
 */
async function discoverFromBatches(
  runner: RequestRunner,
  deps: DiscoveryDeps,
  omissions: Omission[],
): Promise<Discovery> {
  const batchUrl = deps.batchUrl ?? defaultBatchUrl;
  const maxBatches = deps.maxBatches ?? MAX_INDEX_BATCHES;
  const ids: string[] = [];
  const seen = new Set<string>();
  let reportedCount: number | undefined;

  for (let page = 1; page <= maxBatches; page += 1) {
    const url = batchUrl(page);
    const fetched = await fetchIndexPage(runner, url);

    if (!fetched.ok) {
      if (page === 1)
        return { ok: false, failure: { url, reason: fetched.reason } };
      omissions.push({
        sourceUrl: url,
        detail: `batched index stopped after ${page - 1} batches: ${fetched.reason}`,
      });
      break;
    }

    const parsed = parseIndexPage(fetched.html);
    reportedCount ??= parsed.reportedCount;

    const before = seen.size;
    for (const id of parsed.ids) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    if (seen.size === before) break;
  }

  return {
    ok: true,
    candidate: {
      indexUrl: BATCHED_INDEX_URL,
      ids,
      ...(reportedCount === undefined ? {} : { reportedCount }),
    },
  };
}

/** True when the index published fewer entries than it says it has. */
function fallsShortOfCounter(candidate: Candidate): boolean {
  return (
    candidate.reportedCount !== undefined &&
    candidate.ids.length < candidate.reportedCount
  );
}

function toResult(
  candidate: Candidate,
  omissions: Omission[],
): DiscoveryResult {
  if (
    candidate.reportedCount !== undefined &&
    candidate.reportedCount !== candidate.ids.length
  ) {
    omissions.push({
      sourceUrl: candidate.indexUrl,
      detail: `index counter reports ${candidate.reportedCount} teams but ${candidate.ids.length} entry URLs were discovered`,
    });
  }

  return {
    urls: candidate.ids.map(id => `${ENTRY_URL_PREFIX}${id}`),
    indexUrlUsed: candidate.indexUrl,
    ...(candidate.reportedCount === undefined
      ? {}
      : { reportedCount: candidate.reportedCount }),
    omissions,
  };
}

/**
 * Produces the canonical, deduplicated list of team page URLs.
 *
 * Never throws: an index the Source_Site will not serve comes back as
 * `indexFailure` with an empty `urls` list, and an index that serves nothing
 * usable comes back as an empty `urls` list on its own. The Ingestion_Job maps
 * those two shapes onto Requirements 1.7 and 1.8.
 */
export async function discoverEntryUrls(
  runner: RequestRunner,
  deps: DiscoveryDeps = {},
): Promise<DiscoveryResult> {
  const omissions: Omission[] = [];
  const primary = await discoverFromAllInOne(runner);

  if (primary.ok && !fallsShortOfCounter(primary.candidate)) {
    return toResult(primary.candidate, omissions);
  }

  omissions.push(
    primary.ok
      ? {
          sourceUrl: primary.candidate.indexUrl,
          detail: `all-in-one index published ${primary.candidate.ids.length} of ${primary.candidate.reportedCount} teams; retrying through the batched index`,
        }
      : {
          sourceUrl: primary.failure.url,
          detail: `all-in-one index unavailable (${primary.failure.reason}); falling back to the batched index`,
        },
  );

  const fallback = await discoverFromBatches(runner, deps, omissions);

  if (!fallback.ok) {
    if (primary.ok) return toResult(primary.candidate, omissions);
    return {
      urls: [],
      indexUrlUsed: fallback.failure.url,
      indexFailure: fallback.failure,
      omissions,
    };
  }

  // The fallback is only an improvement when it found more entries; a shorter
  // batched index must not discard entries the all-in-one page did publish.
  const better =
    primary.ok && primary.candidate.ids.length >= fallback.candidate.ids.length
      ? primary.candidate
      : fallback.candidate;

  return toResult(better, omissions);
}
