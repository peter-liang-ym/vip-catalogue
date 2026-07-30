/**
 * Scraper request engine: pacing, timeouts, and retry backoff
 * (Requirements 1.3, 1.4).
 *
 * Every outbound request the Ingestion_Job makes — index pages, team pages, and
 * images, initial attempts and retries alike — goes through one `RequestRunner`,
 * because Requirement 1.3 bounds requests to the Source_Site as a whole rather
 * than per kind of document. That is why the pacer lives on the runner and not
 * on a call site: a second, unpaced path would silently break the bound.
 *
 * Pacing is a token bucket over a sliding window: the runner keeps the start
 * times of the most recent `maxRequestsPerWindow` requests and waits out the
 * oldest one whenever the window is full. A sliding window is what the
 * requirement asks for ("within any 1-second window"), which a fixed window
 * would not give — two requests at the end of one fixed bucket and two at the
 * start of the next are four inside one second.
 *
 * `Clock` and `fetch` are injected so the whole engine can be driven by a
 * virtual clock and in-memory responses; nothing here waits in real time except
 * the default `systemClock`.
 *
 * The body is read inside the timed attempt rather than handed back to the
 * caller, so a response whose headers arrive quickly but whose body stalls still
 * counts as a timeout, which is what "does not return a complete response within
 * 30 seconds" means. Callers supply the reader, so a team page can decode text
 * and an image can take bytes without either duplicating the retry policy.
 */

/** Injected time source. Property tests advance a virtual clock instead of waiting. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** Injected retrieval. Narrower than the global `fetch`, which remains assignable. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ScraperConfig {
  readonly maxRequestsPerWindow: number;
  readonly windowMs: number;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly initialBackoffMs: number;
}

/** The Requirement 1.3 and 1.4 numbers: 2 per second, 30s, 3 retries from 1s. */
export const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  maxRequestsPerWindow: 2,
  windowMs: 1000,
  requestTimeoutMs: 30_000,
  maxRetries: 3,
  initialBackoffMs: 1000,
};

/** Wall-clock implementation used by the real Ingestion_Job. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: ms =>
    new Promise(resolve => {
      setTimeout(resolve, ms);
    }),
};

/**
 * One team page retrieval, as the Ingestion_Report records it (Requirement 1.5).
 * `status` is absent when the attempt timed out; `attempts` counts the initial
 * attempt plus any retries, so it is 1..4 under the default configuration.
 */
export interface FetchResult {
  readonly url: string;
  readonly ok: boolean;
  readonly status?: number;
  readonly html?: string;
  readonly failureReason?: string;
  readonly attempts: number;
}

/** The generic outcome of a retried request, before it is shaped per caller. */
export interface RequestOutcome<T> {
  readonly ok: boolean;
  readonly status?: number;
  readonly body?: T;
  readonly failureReason?: string;
  readonly attempts: number;
}

export interface ScraperDeps {
  readonly fetch?: FetchFn;
  readonly clock?: Clock;
  readonly config?: Partial<ScraperConfig>;
}

export interface RequestRunner {
  /** Retrieves `url`, paced and retried, reading the body with `readBody`. */
  request<T>(
    url: string,
    readBody: (response: Response) => Promise<T>,
  ): Promise<RequestOutcome<T>>;
  readonly config: ScraperConfig;
}

/** Sliding-window token bucket over request start times. */
interface RequestPacer {
  acquire(): Promise<void>;
}

export function createRequestPacer(
  clock: Clock,
  config: ScraperConfig,
): RequestPacer {
  const starts: number[] = [];

  return {
    async acquire(): Promise<void> {
      for (;;) {
        const now = clock.now();
        while (starts.length > 0 && now - starts[0]! >= config.windowMs) {
          starts.shift();
        }
        if (starts.length < config.maxRequestsPerWindow) {
          // No await between the check and the push, so concurrent callers
          // cannot both claim the same slot.
          starts.push(now);
          return;
        }
        await clock.sleep(starts[0]! + config.windowMs - now);
      }
    },
  };
}

/**
 * A timed-out attempt surfaces as an abort. `AbortSignal.timeout` rejects with a
 * `TimeoutError`; a caller-supplied signal rejects with an `AbortError`, and both
 * mean the same thing here — no complete response inside the budget.
 */
function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

function describeError(error: unknown): string {
  return `error: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Builds the single request path every outbound retrieval shares.
 *
 * Retry waits are `initialBackoffMs * 2^(attempt - 1)` — 1s, 2s, 4s — taken
 * after a failed attempt and before the next one, for at most `maxRetries`
 * retries. Each retry re-enters the pacer, so backoff never lets a burst past
 * the 1.3 bound.
 */
export function createRequestRunner(deps: ScraperDeps = {}): RequestRunner {
  const config: ScraperConfig = { ...DEFAULT_SCRAPER_CONFIG, ...deps.config };
  const clock = deps.clock ?? systemClock;
  const fetchFn = deps.fetch ?? ((url, init) => fetch(url, init));
  const pacer = createRequestPacer(clock, config);

  async function attempt<T>(
    url: string,
    readBody: (response: Response) => Promise<T>,
  ): Promise<Omit<RequestOutcome<T>, 'attempts'>> {
    try {
      const response = await fetchFn(url, {
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      if (response.status !== 200) {
        return {
          ok: false,
          status: response.status,
          failureReason: `status ${response.status}`,
        };
      }
      return {
        ok: true,
        status: response.status,
        body: await readBody(response),
      };
    } catch (error) {
      return isTimeout(error)
        ? { ok: false, failureReason: 'timeout' }
        : { ok: false, failureReason: describeError(error) };
    }
  }

  return {
    config,
    async request<T>(
      url: string,
      readBody: (response: Response) => Promise<T>,
    ): Promise<RequestOutcome<T>> {
      for (let attempts = 1; ; attempts += 1) {
        await pacer.acquire();
        const outcome = await attempt(url, readBody);
        if (outcome.ok || attempts > config.maxRetries) {
          return { ...outcome, attempts };
        }
        await clock.sleep(config.initialBackoffMs * 2 ** (attempts - 1));
      }
    },
  };
}
/**
 * One image retrieval. Same shape as `FetchResult`, carrying bytes and the
 * declared content type instead of HTML, because the publish store names the
 * cached file `images/{entryId}.{ext}` and needs the type to pick `ext`
 * (Requirement 3.8).
 */
export interface ImageFetchResult {
  readonly url: string;
  readonly ok: boolean;
  readonly status?: number;
  readonly bytes?: Uint8Array;
  readonly contentType?: string;
  readonly failureReason?: string;
  readonly attempts: number;
}

interface ImageBody {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

const readHtml = (response: Response): Promise<string> => response.text();

const readImageBody = async (response: Response): Promise<ImageBody> => ({
  bytes: new Uint8Array(await response.arrayBuffer()),
  contentType: response.headers.get('content-type') ?? '',
});

/**
 * Optional fields are spread in conditionally rather than assigned `undefined`,
 * so a timed-out result has no `status` key and a failed one has no `html` key —
 * the distinction the Ingestion_Report is written from (Requirement 1.5).
 */
function toFetchResult(
  url: string,
  outcome: RequestOutcome<string>,
): FetchResult {
  return {
    url,
    ok: outcome.ok,
    attempts: outcome.attempts,
    ...(outcome.status === undefined ? {} : { status: outcome.status }),
    ...(outcome.body === undefined ? {} : { html: outcome.body }),
    ...(outcome.failureReason === undefined
      ? {}
      : { failureReason: outcome.failureReason }),
  };
}

/**
 * Retrieves one Source_Document per URL, in the order given (Requirement 1.2).
 *
 * Sequential by construction: the pacer would hold concurrent requests anyway,
 * and yielding as each URL resolves lets the Ingestion_Job parse and accumulate
 * incrementally rather than buffering every page.
 *
 * A failed URL is a yielded `FetchResult` with `ok: false`, never a thrown
 * error, so the loop cannot be stopped by one bad page (Requirement 1.5). The
 * runner already converts every status, timeout, and transport error into an
 * outcome, so there is nothing here to catch.
 */
export async function* fetchTeamPages(
  runner: RequestRunner,
  urls: readonly string[],
): AsyncIterable<FetchResult> {
  for (const url of urls) {
    yield toFetchResult(url, await runner.request(url, readHtml));
  }
}

/**
 * Retrieves one team image under the same pacing, timeout, and retry policy as
 * a team page, because Requirements 1.3 and 3.8 count image requests as requests
 * to the Source_Site like any other. Failure is returned, not thrown: the job
 * keeps the previously cached bytes and carries on (Requirement 3.8).
 */
export async function fetchImage(
  runner: RequestRunner,
  url: string,
): Promise<ImageFetchResult> {
  const outcome = await runner.request(url, readImageBody);
  return {
    url,
    ok: outcome.ok,
    attempts: outcome.attempts,
    ...(outcome.status === undefined ? {} : { status: outcome.status }),
    ...(outcome.body === undefined
      ? {}
      : { bytes: outcome.body.bytes, contentType: outcome.body.contentType }),
    ...(outcome.failureReason === undefined
      ? {}
      : { failureReason: outcome.failureReason }),
  };
}
