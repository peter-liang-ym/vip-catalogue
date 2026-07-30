import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DATASET_FILE_NAME,
  DATASET_TMP_FILE_NAME,
  createPublishStore,
} from './publishStore';
import type { ImageFetchResult } from './scraper';

let publicDir: string;

beforeEach(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'vip-publish-'));
});

afterEach(async () => {
  await rm(publicDir, { recursive: true, force: true });
});

const datasetJson = (count: number): string =>
  JSON.stringify({
    schemaVersion: '2',
    generatedAt: '2026-01-05T04:30:00Z',
    teamCount: count,
    teams: Array.from({ length: count }, (_unused, index) => ({
      entryId: String(index),
    })),
  });

const okImage = (bytes: Uint8Array): ImageFetchResult => ({
  url: 'https://vip.gatech.edu/files/formidable/am.png',
  ok: true,
  status: 200,
  bytes,
  contentType: 'image/png',
  attempts: 1,
});

const failedImage: ImageFetchResult = {
  url: 'https://vip.gatech.edu/files/formidable/am.png',
  ok: false,
  failureReason: 'timeout',
  attempts: 4,
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
};

describe('publishDataset', () => {
  it('publishes the Dataset and leaves no intermediate file behind', async () => {
    const store = createPublishStore({ publicDir });

    await store.publishDataset(datasetJson(3));

    expect(await readFile(join(publicDir, DATASET_FILE_NAME), 'utf8')).toBe(
      datasetJson(3),
    );
    expect(await exists(join(publicDir, DATASET_TMP_FILE_NAME))).toBe(false);
  });

  it('replaces a previously published Dataset', async () => {
    const store = createPublishStore({ publicDir });

    await store.publishDataset(datasetJson(3));
    await store.publishDataset(datasetJson(5));

    expect(await readFile(join(publicDir, DATASET_FILE_NAME), 'utf8')).toBe(
      datasetJson(5),
    );
  });

  it('creates the public directory when it does not exist yet', async () => {
    const store = createPublishStore({ publicDir: join(publicDir, 'nested') });

    await store.publishDataset(datasetJson(1));

    expect(
      await readFile(join(publicDir, 'nested', DATASET_FILE_NAME), 'utf8'),
    ).toBe(datasetJson(1));
  });
});

describe('readPreviousCount', () => {
  it('is undefined when no Dataset has been published', async () => {
    const store = createPublishStore({ publicDir });

    expect(await store.readPreviousCount()).toBeUndefined();
  });

  it('reports the record count of the published Dataset', async () => {
    const store = createPublishStore({ publicDir });
    await store.publishDataset(datasetJson(112));

    expect(await store.readPreviousCount()).toBe(112);
  });

  it('is undefined for a malformed published Dataset', async () => {
    const store = createPublishStore({ publicDir });
    await writeFile(join(publicDir, DATASET_FILE_NAME), '{ not json', 'utf8');

    expect(await store.readPreviousCount()).toBeUndefined();
  });

  it('is undefined when the published Dataset has no teams list', async () => {
    const store = createPublishStore({ publicDir });
    await writeFile(
      join(publicDir, DATASET_FILE_NAME),
      JSON.stringify({ schemaVersion: '2', teamCount: 7 }),
      'utf8',
    );

    expect(await store.readPreviousCount()).toBeUndefined();
  });
});

describe('storeImage', () => {
  it('caches the fetched bytes at the path the Team_Record names', async () => {
    const store = createPublishStore({ publicDir });
    const bytes = new Uint8Array([1, 2, 3]);

    const outcome = await store.storeImage('images/1248.png', okImage(bytes));

    expect(outcome).toEqual({ stored: true, retainedPrevious: false });
    expect(
      new Uint8Array(await readFile(join(publicDir, 'images', '1248.png'))),
    ).toEqual(bytes);
  });

  it('keeps the previously stored bytes when the fetch fails', async () => {
    const store = createPublishStore({ publicDir });
    const previous = new Uint8Array([9, 9, 9]);
    await store.storeImage('images/1248.png', okImage(previous));

    const outcome = await store.storeImage('images/1248.png', failedImage);

    expect(outcome).toEqual({ stored: false, retainedPrevious: true });
    expect(
      new Uint8Array(await readFile(join(publicDir, 'images', '1248.png'))),
    ).toEqual(previous);
  });

  it('reports no retained copy when the fetch fails and nothing was cached', async () => {
    const store = createPublishStore({ publicDir });

    const outcome = await store.storeImage('images/1248.png', failedImage);

    expect(outcome).toEqual({ stored: false, retainedPrevious: false });
    expect(await exists(join(publicDir, 'images', '1248.png'))).toBe(false);
  });

  it('stores nothing for a record that names no local image path', async () => {
    const store = createPublishStore({ publicDir });

    const outcome = await store.storeImage(
      '',
      okImage(new Uint8Array([1, 2, 3])),
    );

    expect(outcome).toEqual({ stored: false, retainedPrevious: false });
  });
});
