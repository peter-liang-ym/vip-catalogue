/**
 * The publish store: the Ingestion_Job's only writer of published bytes
 * (Requirements 3.6, 3.8).
 *
 * Publication is atomic. The Dataset JSON is written to `dataset.json.tmp` and
 * only then renamed over `dataset.json`, so a reader of the site never observes a
 * half-written document and every abort path — index failure, validation failure,
 * count drop, zero records — leaves the previously published bytes exactly as they
 * were, simply by never reaching `publishDataset`. `rename` is the atomic
 * primitive here on both POSIX and Windows; writing in place is not.
 *
 * Image caching is per image and independent of publication. A failed fetch is
 * not an error the store raises: it writes nothing, which is precisely what
 * "retain any previously stored local copy" means (Requirement 3.8), and reports
 * whether a previous copy was in fact there so the Ingestion_Report can say
 * whether the site still has an image for that Team.
 *
 * The previous record count is read from the published Dataset rather than
 * carried between runs, because the published file is the only thing that
 * survives a run and the count-drop guard (Requirement 3.5) compares against what
 * is actually live. An absent, unreadable, or malformed file yields `undefined`,
 * which the guard treats as "no previous Dataset" — the first run must not be
 * blocked by the absence of a file it is about to create.
 *
 * The store is the injected I/O seam of `runIngestion`: property tests supply an
 * in-memory `PublishStore` and compare bytes before and after a generated run,
 * so nothing below is reached by a test that is not deliberately exercising the
 * filesystem.
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ImageFetchResult } from './scraper';
import { deserialize } from './serialize';

/** Site root that the build serves as-is; the Dataset and image cache live here. */
export const DEFAULT_PUBLIC_DIR = 'public';

/** The published Dataset and the intermediate file it is renamed from. */
export const DATASET_FILE_NAME = 'dataset.json';
export const DATASET_TMP_FILE_NAME = `${DATASET_FILE_NAME}.tmp`;

/**
 * What one image ended up as. `stored` means new bytes were written;
 * `retainedPrevious` means the fetch failed and an earlier copy is still in place,
 * so the site keeps showing an image for that Team.
 */
export interface ImageStoreOutcome {
  readonly stored: boolean;
  readonly retainedPrevious: boolean;
}

export interface PublishStore {
  /**
   * The record count of the currently published Dataset, or `undefined` when
   * there is none to compare against.
   */
  readPreviousCount(): Promise<number | undefined>;
  /** Replaces the published Dataset with `json` in one atomic step. */
  publishDataset(json: string): Promise<void>;
  /**
   * Caches one image at `imagePath` (site-relative, `images/{entryId}.{ext}` as
   * the Team_Record already names it). A failed fetch writes nothing.
   */
  storeImage(
    imagePath: string,
    result: ImageFetchResult,
  ): Promise<ImageStoreOutcome>;
}

export interface PublishStoreOptions {
  /** Defaults to `DEFAULT_PUBLIC_DIR`; tests point it at a temporary directory. */
  readonly publicDir?: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * `teams.length` rather than the document's own `teamCount`: the guard is about
 * how many records the site is actually serving, and a stale or wrong count field
 * should not be able to authorize a drop.
 */
function countRecords(json: string): number | undefined {
  try {
    const teams = deserialize(json).teams;
    return Array.isArray(teams) ? teams.length : undefined;
  } catch {
    return undefined;
  }
}

export function createPublishStore(
  options: PublishStoreOptions = {},
): PublishStore {
  const publicDir = options.publicDir ?? DEFAULT_PUBLIC_DIR;
  const datasetPath = join(publicDir, DATASET_FILE_NAME);
  const datasetTmpPath = join(publicDir, DATASET_TMP_FILE_NAME);

  return {
    async readPreviousCount(): Promise<number | undefined> {
      let json: string;
      try {
        json = await readFile(datasetPath, 'utf8');
      } catch {
        return undefined;
      }
      return countRecords(json);
    },

    async publishDataset(json: string): Promise<void> {
      await mkdir(publicDir, { recursive: true });
      await writeFile(datasetTmpPath, json, 'utf8');
      await rename(datasetTmpPath, datasetPath);
    },

    async storeImage(
      imagePath: string,
      result: ImageFetchResult,
    ): Promise<ImageStoreOutcome> {
      // No local name for this image (the source URL carried no usable
      // extension), so there is nothing to cache and the UI falls back to the
      // source URL.
      if (imagePath === '') {
        return { stored: false, retainedPrevious: false };
      }

      const target = join(publicDir, imagePath);

      if (!result.ok || result.bytes === undefined) {
        return {
          stored: false,
          retainedPrevious: await fileExists(target),
        };
      }

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, result.bytes);
      return { stored: true, retainedPrevious: false };
    },
  };
}
