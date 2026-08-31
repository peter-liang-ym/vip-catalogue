/**
 * Dataset loader and load state machine (Requirements 3.3, 12.4, 12.5, 12.6,
 * 12.7, 12.8).
 *
 * One request per activation, one state at a time. `LoadState` is the whole
 * contract the Catalog_UI renders against: `loading` shows the indicator and
 * nothing else, `failed` shows the load-failure message and the retry control
 * and no cards, `loaded` shows the first page and neither failure affordance
 * (Requirements 12.4, 12.6, 12.8). Because the three cases are disjoint, the
 * "remove the failure message and the retry control on success" rule is a state
 * transition rather than a separate cleanup step.
 *
 * Every failure mode collapses into the same `failed` state: a non-ok response, a
 * network error, a document that is not JSON, a `schemaVersion` other than `"2"`,
 * and the 10-second abort (Requirements 3.3, 12.7). The visitor sees one message
 * in all of them, so distinguishing them here would buy nothing the UI could use.
 *
 * Nothing in this module touches the address bar or the page chrome: the
 * Query_State encoded in the address bar and the navigation and footer are simply
 * never written here, which is how Requirement 12.6 keeps them across a failure.
 */

import { deserialize } from '../ingest/serialize';
import { DATASET_SCHEMA_VERSION, type Dataset } from '../shared/types';
import { buildIndex, type SearchIndex } from './search';

/** The published Dataset, fetched relative to the site root. */
export const DATASET_URL = 'dataset.json';

/** A Dataset request that outlives this is ended and treated as a failure (Requirement 12.7). */
export const DATASET_TIMEOUT_MS = 10_000;

export type LoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'loaded';
      readonly dataset: Dataset;
      readonly index: SearchIndex;
    }
  | { readonly kind: 'failed' };

export interface DatasetLoader {
  /** The current state; the only thing the Catalog_UI needs to render. */
  readonly state: LoadState;
  /**
   * Issues exactly one Dataset request, resolving with the state it produced.
   *
   * The state moves to `loading` first, so the indicator shows for the whole
   * request including a retried one (Requirement 12.4).
   */
  load(): Promise<LoadState>;
  /**
   * What the retry control activates: the same single request, so activating it
   * n times issues exactly n requests and no more (Requirements 12.5, 12.8).
   */
  retry(): Promise<LoadState>;
}

export interface DatasetLoaderDeps {
  /** Injected for tests; the browser's `fetch` otherwise. */
  readonly fetch?: typeof globalThis.fetch;
  /** Called on every state change, which is what drives a re-render. */
  readonly onStateChange?: (state: LoadState) => void;
}

const FAILED: LoadState = { kind: 'failed' };

/**
 * Creates the loader. The initial state is `loading`: the app issues the first
 * request as it mounts, so there is no fourth "idle" state for the UI to render.
 */
export function createDatasetLoader(
  deps: DatasetLoaderDeps = {},
): DatasetLoader {
  const fetchDataset =
    deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  let state: LoadState = { kind: 'loading' };
  /**
   * Counts issued requests, so a response that a later activation superseded is
   * dropped instead of overwriting the newer request's state.
   */
  let issued = 0;

  function setState(next: LoadState): void {
    state = next;
    deps.onStateChange?.(next);
  }

  async function attempt(): Promise<LoadState> {
    try {
      const response = await fetchDataset(DATASET_URL, {
        signal: AbortSignal.timeout(DATASET_TIMEOUT_MS),
      });
      if (!response.ok) return FAILED;

      // `deserialize` and `buildIndex` both assume a well-formed document, so a
      // document that is not one throws and lands in the `catch` as a failure.
      const dataset = deserialize(await response.text());
      if (
        typeof dataset !== 'object' ||
        dataset === null ||
        dataset.schemaVersion !== DATASET_SCHEMA_VERSION
      ) {
        // A record shape this build cannot read is refused rather than rendered
        // (Requirements 3.3, 12.6).
        return FAILED;
      }

      return { kind: 'loaded', dataset, index: buildIndex(dataset) };
    } catch {
      return FAILED;
    }
  }

  async function load(): Promise<LoadState> {
    issued += 1;
    const requestId = issued;
    setState({ kind: 'loading' });

    const next = await attempt();
    if (requestId !== issued) return state;

    setState(next);
    return next;
  }

  return {
    get state(): LoadState {
      return state;
    },
    load,
    retry: load,
  };
}
