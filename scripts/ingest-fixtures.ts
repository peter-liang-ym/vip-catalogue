/**
 * Fixture capture: `bun run ingest:fixtures`.
 *
 * Saves the **unmodified** HTML of the team index and of a handful of
 * representative team pages into `fixtures/html/`, so selector work and the
 * parser regression tests read files instead of the network. Parser tests must
 * never hit the Source_Site; this script is the only thing in the repository
 * that puts those files there.
 *
 * Nothing is parsed, rewritten, or prettified on the way out: the whole point is
 * that a fixture is a byte-for-byte record of what the Source_Site served, so a
 * markup change shows up as a fixture diff.
 *
 * Discovery and retrieval are the Ingestion_Job's own components — the shared
 * `RequestRunner` (pacing, 30s timeout, 1s/2s/4s retries), `discoverEntryUrls`,
 * and `fetchTeamPages` — so a capture run is paced exactly like a real ingest
 * and this script owns no fetch logic of its own.
 *
 * Usage:
 *   bun run ingest:fixtures            # index + the default representative ids
 *   bun run ingest:fixtures 1248 9999  # index + the given entry ids
 *
 * `fixtures/html/entry-drifted.html` is hand-authored, not captured, and is
 * never written by this script.
 */

import { BATCHED_INDEX_URL, discoverEntryUrls } from '../src/ingest/discover';
import { createRequestRunner, fetchTeamPages } from '../src/ingest/scraper';

const FIXTURE_DIR = 'fixtures/html';

/**
 * The pages the design names as fixtures worth capturing: 1248 for multiple
 * advisors with `mailto:` links, a header image, and a hyphen time separator;
 * 14350 for the singular `Advisor` heading, no image element, an extra `Link(s)`
 * section, and an en dash time separator.
 */
const DEFAULT_ENTRY_IDS = ['1248', '14350'] as const;

/** Names the index fixture after the index that actually served the entries. */
function indexFixtureName(indexUrl: string): string {
  return indexUrl === BATCHED_INDEX_URL
    ? 'index-batched.html'
    : 'index-all-in-one.html';
}

function entryIdOf(url: string): string {
  return /entry\/(\d+)/.exec(url)?.[1] ?? '';
}

async function save(fileName: string, html: string): Promise<void> {
  const path = `${FIXTURE_DIR}/${fileName}`;
  await Bun.write(path, html);
  console.log(`wrote ${path} (${html.length} chars)`);
}

async function main(): Promise<number> {
  const requested = Bun.argv
    .slice(2)
    .filter(argument => /^\d+$/.test(argument));
  const wantedIds = requested.length > 0 ? requested : [...DEFAULT_ENTRY_IDS];

  const runner = createRequestRunner();

  const discovery = await discoverEntryUrls(runner);
  if (discovery.indexFailure !== undefined) {
    console.error(
      `index unavailable: ${discovery.indexFailure.url} (${discovery.indexFailure.reason})`,
    );
    return 1;
  }
  if (discovery.urls.length === 0) {
    console.error(`index at ${discovery.indexUrlUsed} yielded no entry URLs`);
    return 1;
  }
  console.log(
    `discovered ${discovery.urls.length} entry URLs from ${discovery.indexUrlUsed}`,
  );
  for (const omission of discovery.omissions) {
    console.warn(`warning: ${omission.detail}`);
  }

  // Re-requested rather than kept from discovery, which returns URLs and not
  // documents. One extra paced request buys a fixture that is exactly the bytes
  // the index served, with no reconstruction step to get wrong.
  const indexOutcome = await runner.request(discovery.indexUrlUsed, response =>
    response.text(),
  );
  if (indexOutcome.ok && indexOutcome.body !== undefined) {
    await save(indexFixtureName(discovery.indexUrlUsed), indexOutcome.body);
  } else {
    console.error(
      `could not save the index fixture: ${indexOutcome.failureReason ?? 'unknown failure'}`,
    );
    return 1;
  }

  // Canonical URLs come from discovery, so a requested id that the index does
  // not publish is reported instead of being guessed into a URL.
  const byId = new Map(discovery.urls.map(url => [entryIdOf(url), url]));
  const targets: string[] = [];
  for (const id of wantedIds) {
    const url = byId.get(id);
    if (url === undefined) {
      console.warn(`warning: entry ${id} is not published by the index`);
      continue;
    }
    targets.push(url);
  }

  let failures = 0;
  for await (const result of fetchTeamPages(runner, targets)) {
    if (result.ok && result.html !== undefined) {
      await save(`entry-${entryIdOf(result.url)}.html`, result.html);
    } else {
      failures += 1;
      console.error(
        `failed ${result.url}: ${result.failureReason ?? 'unknown failure'} after ${result.attempts} attempts`,
      );
    }
  }

  return failures > 0 ? 1 : 0;
}

process.exit(await main());
