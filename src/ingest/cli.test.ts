/**
 * The CLI's two pure decisions: where a report is written, and which fixture
 * stands in for a Source_Site URL in `--from-cache` mode. Everything else in
 * `cli.ts` is process control over `runIngestion`, which `job.test.ts` covers.
 */

import { describe, expect, it } from 'vitest';

import { fixturePathFor, reportFileName } from './cli';
import { ALL_IN_ONE_INDEX_URL, BATCHED_INDEX_URL } from './discover';

describe('reportFileName', () => {
  it('names the report after the run start, without colons or milliseconds', () => {
    expect(reportFileName('2026-01-05T04:30:00.000Z')).toBe(
      'ingest-2026-01-05T043000Z.json',
    );
  });
});

describe('fixturePathFor', () => {
  it('maps both index URLs onto the captured index fixtures', () => {
    expect(fixturePathFor(ALL_IN_ONE_INDEX_URL)).toBe(
      'fixtures/html/index-all-in-one.html',
    );
    expect(fixturePathFor(BATCHED_INDEX_URL)).toBe(
      'fixtures/html/index-batched.html',
    );
  });

  it('maps a canonical entry URL onto its entry fixture', () => {
    expect(fixturePathFor('https://vip.gatech.edu/teams/entry/1248')).toBe(
      'fixtures/html/entry-1248.html',
    );
  });

  // A later batch page and an image have no fixture, so the fixture fetch
  // answers 404 and the job's own failure paths handle them.
  it('maps nothing for URLs no fixture stands in for', () => {
    expect(fixturePathFor(`${BATCHED_INDEX_URL}page/2/`)).toBeNull();
    expect(
      fixturePathFor('https://vip.gatech.edu/wp-content/uploads/header.jpg'),
    ).toBeNull();
  });
});
