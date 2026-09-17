/**
 * Payload and module-graph gate: `bun run check:payload`.
 *
 * Two mechanical checks stand behind Requirement 12.2, both read off a real
 * `bun run build` output rather than off source:
 *
 *  1. The published Dataset is gzipped and measured against a 300 KB budget.
 *     The measured size is the gate, not a projection to a hypothetical record
 *     count: the Source_Site publishes 112 teams, and 110 of them gzip to about
 *     123 KB, so the budget holds ~2.5x headroom and still catches per-record
 *     bloat, which moves the measured number as surely as a record count would.
 *  2. The calendar parser stays out of the initial chunk. `parseCalendar` and
 *     `ical.js` are reached through a dynamic `import()` on the first
 *     Calendar_File; a stray static import anywhere on the entry chunk's graph
 *     would inline ~80 KB of parser into first render with no other visible
 *     symptom. The check walks the built graph from the entry chunk following
 *     *static* imports only and fails if either is reachable.
 *
 * Nothing here is parsed as JavaScript: chunk-to-chunk edges are read out of the
 * emitted bundles textually, which is enough because Vite writes its static
 * imports as plain `from"./chunk.js"` specifiers and its dynamic ones as
 * `import("./chunk.js")`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

/** Requirement 12.2, in bytes. KB is decimal, as network sizes are quoted. */
const BUDGET_BYTES = 300_000;

const DIST_DIR = 'dist';
const ASSETS_DIR = `${DIST_DIR}/assets`;
const ENTRY_HTML = `${DIST_DIR}/index.html`;

/**
 * Markers for the two things that must not be reachable statically.
 *
 * The parser is recognised either by its own chunk name — Vite names the chunk
 * after the dynamically imported module — or, if a static import inlined it into
 * a chunk of another name, by the `vcalendar`/`vevent` component literals from
 * its body. Its name alone is not enough and its mention is not either: the
 * entry chunk legitimately contains the string `parseCalendar` as the dynamic
 * `import()` specifier and the property read on the resolved chunk.
 *
 * `ical.js` publishes its API under the `ICAL` namespace, a property name that
 * survives minification.
 */
const FORBIDDEN = [
  {
    label: 'parseCalendar',
    inChunk: (name: string, code: string) =>
      name.startsWith('parseCalendar') ||
      (code.includes('vcalendar') && code.includes('vevent')),
  },
  {
    label: 'ical.js',
    inChunk: (_name: string, code: string) => code.includes('ICAL'),
  },
] as const;

function formatKb(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} KB`;
}

/** Prefers the built copy, so the check measures what visitors download. */
function datasetPath(): string | undefined {
  for (const candidate of [`${DIST_DIR}/dataset.json`, 'public/dataset.json']) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

type SizeResult = {
  readonly path: string;
  readonly records: number;
  readonly rawBytes: number;
  readonly compressedBytes: number;
  readonly perRecordBytes: number;
  readonly ok: boolean;
};

function checkDatasetSize(path: string): SizeResult {
  const raw = readFileSync(path);
  const compressed = Bun.gzipSync(raw);
  const parsed = JSON.parse(raw.toString('utf8')) as {
    teams?: readonly unknown[];
  };
  const records = parsed.teams?.length ?? 0;

  // Reported, not gated: it is the number that moves first when a field grows,
  // so it is what a maintainer compares against a previous run.
  const perRecordBytes =
    records > 0 ? Math.round(compressed.byteLength / records) : 0;

  return {
    path,
    records,
    rawBytes: raw.byteLength,
    compressedBytes: compressed.byteLength,
    perRecordBytes,
    ok: compressed.byteLength <= BUDGET_BYTES,
  };
}

/** The hashed entry chunk, as `index.html` actually references it. */
function entryChunkName(): string | undefined {
  const html = readFileSync(ENTRY_HTML, 'utf8');
  return /<script[^>]+type="module"[^>]+src="[^"]*\/assets\/([^"]+\.js)"/.exec(
    html,
  )?.[1];
}

/**
 * Static import edges out of one chunk. `from"./x.js"`, bare `import"./x.js"`
 * side-effect imports, and `export…from"./x.js"` re-exports all match; a
 * dynamic `import("./x.js")` does not, because the `(` is not a quote.
 */
function staticImportsOf(code: string): readonly string[] {
  const names = new Set<string>();
  for (const match of code.matchAll(
    /(?:from|import)\s*["']\.\/([^"']+)["']/g,
  )) {
    names.add(match[1]!);
  }
  return [...names];
}

type GraphResult = {
  readonly entry: string;
  readonly reachable: readonly string[];
  readonly violations: readonly string[];
};

function checkModuleGraph(
  entry: string,
  chunks: ReadonlyMap<string, string>,
): GraphResult {
  const reachable: string[] = [];
  const pending = [entry];
  const seen = new Set<string>();

  while (pending.length > 0) {
    const name = pending.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const code = chunks.get(name);
    if (code === undefined) continue;
    reachable.push(name);
    pending.push(...staticImportsOf(code));
  }

  const violations: string[] = [];
  for (const { label, inChunk } of FORBIDDEN) {
    const offender = reachable.find(name => inChunk(name, chunks.get(name)!));
    if (offender !== undefined) {
      violations.push(
        `${label} is reachable from the entry chunk via ${offender}`,
      );
    }
  }

  return { entry, reachable, violations };
}

async function readChunks(): Promise<ReadonlyMap<string, string>> {
  const chunks = new Map<string, string>();
  for (const file of await readdir(ASSETS_DIR)) {
    if (file.endsWith('.js')) {
      chunks.set(file, readFileSync(`${ASSETS_DIR}/${file}`, 'utf8'));
    }
  }
  return chunks;
}

async function main(): Promise<number> {
  let failed = false;

  const path = datasetPath();
  if (path === undefined) {
    console.error(
      'no Dataset found at dist/dataset.json or public/dataset.json; run `bun run ingest` first',
    );
    failed = true;
  } else {
    const size = checkDatasetSize(path);
    console.log(`dataset: ${size.path} (${size.records} records)`);
    console.log(`  uncompressed:        ${formatKb(size.rawBytes)}`);
    console.log(`  compressed (gzip):   ${formatKb(size.compressedBytes)}`);
    console.log(`  per record:          ${size.perRecordBytes} B compressed`);
    console.log(`  budget:              ${formatKb(BUDGET_BYTES)} compressed`);
    if (size.ok) {
      console.log('  within budget (12.2)');
    } else {
      console.error('  OVER BUDGET (12.2)');
      failed = true;
    }
  }

  if (!existsSync(ENTRY_HTML) || !existsSync(ASSETS_DIR)) {
    console.error(
      `no build output in ${DIST_DIR}/; run \`bun run build\` first`,
    );
    return 1;
  }

  const entry = entryChunkName();
  if (entry === undefined) {
    console.error(`could not find the entry module script in ${ENTRY_HTML}`);
    return 1;
  }

  const graph = checkModuleGraph(entry, await readChunks());
  console.log(`entry chunk: ${entry}`);
  console.log(`  statically reachable chunks: ${graph.reachable.join(', ')}`);
  if (graph.violations.length === 0) {
    console.log(
      '  parseCalendar and ical.js stay out of the entry chunk (12.2)',
    );
  } else {
    for (const violation of graph.violations) {
      console.error(`  ${violation}`);
    }
    failed = true;
  }

  return failed ? 1 : 0;
}

process.exit(await main());
