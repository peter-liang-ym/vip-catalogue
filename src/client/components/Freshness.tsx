/**
 * Data-freshness notices on the listing page (Requirements 10.3, 10.4, 10.6).
 *
 * Three outcomes, from one reading of `generatedAt` against the render time:
 *
 * - It parses and is at most 30 days old: the timestamp renders as a calendar
 *   date, a time of day, and an explicit time zone (Requirement 10.3).
 * - It parses and is more than 30 days old: the timestamp still renders, and the
 *   out-of-date notice with a Source_Site link renders with it
 *   (Requirement 10.4).
 * - It is absent or does not parse: the unknown-currency indication renders with a
 *   Source_Site link, and no timestamp (Requirement 10.6).
 *
 * `dataCurrency` decides which, so the rule is a pure function of the two values
 * and testable without a DOM. `now` is passed in rather than read from the clock
 * here, for the same reason the Scraper and the Calendar_Parser take an injected
 * clock: "more than 30 days earlier than the current date at page render" is only
 * checkable if the render time can be chosen.
 *
 * None of the three cases replaces anything: this component renders above the
 * listing and the listing renders the Result_Set either way, so "SHALL continue to
 * display the Result_Set" in Requirements 10.4 and 10.6 holds by composition
 * rather than by a condition. The two qualifying cases carry `notice`, the one
 * shared advisory style in `base.css`, which is in the normal flow and sized by its
 * own text, so neither displaces anything either.
 *
 * `generatedAt` is typed as possibly absent even though `Dataset` declares it
 * required, because Requirement 10.6 is exactly the case where the published
 * document does not carry it.
 */

import { SourceSiteLink } from './SiteChrome';

/** Requirement 10.4: older than this at render and the data may be out of date. */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The zone the timestamp is stated in. Atlanta, because every other time this
 * site shows — meeting times, Busy_Blocks, the calendar load time — is Atlanta
 * wall-clock time, and a visitor comparing them should not have to change frames.
 */
export const DISPLAY_TIME_ZONE = 'America/New_York';

/**
 * Requirement 10.3: a calendar date, a time of day, and an explicit time zone.
 * `timeZoneName` is what makes the zone explicit rather than implied by the
 * visitor's own locale.
 */
const timestampFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export type DataCurrency =
  /** `generatedAt` is absent or unreadable as a date (Requirement 10.6). */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'current'; readonly generatedAtText: string }
  | { readonly kind: 'stale'; readonly generatedAtText: string };

/** How the generation timestamp is stated (Requirement 10.3). */
export function generatedAtText(formatted: string): string {
  return `Team data as of ${formatted}`;
}

/** Requirement 10.4: the notice that the data may be out of date. */
export const STALE_NOTICE_TEXT =
  'This data is more than 30 days old and may be out of date. Check the official VIP site for current information:';

/** Requirement 10.6: the indication that the data currency is unknown. */
export const UNKNOWN_CURRENCY_TEXT =
  'The age of this data is unknown. Check the official VIP site for current information:';

/** The instant `generatedAt` names, or `null` when it names none (Requirement 10.6). */
function parseGeneratedAt(generatedAt: string | undefined): Date | null {
  if (generatedAt === undefined) return null;

  // `Date.parse` yields `NaN` for '' and for anything it cannot read, which is
  // both halves of "absent or cannot be interpreted as a date".
  const ms = Date.parse(generatedAt);

  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Which of the three cases `generatedAt` falls in at render time `now`. */
export function dataCurrency(
  generatedAt: string | undefined,
  now: number,
): DataCurrency {
  const instant = parseGeneratedAt(generatedAt);
  if (instant === null) return { kind: 'unknown' };

  const text = generatedAtText(timestampFormat.format(instant));

  return now - instant.getTime() > STALE_AFTER_MS
    ? { kind: 'stale', generatedAtText: text }
    : { kind: 'current', generatedAtText: text };
}

export interface FreshnessProps {
  /** The Dataset generation timestamp; absent or unreadable is Requirement 10.6. */
  readonly generatedAt: string | undefined;
  /** The render time in epoch milliseconds, injected so the 30-day rule is testable. */
  readonly now: number;
}

export function Freshness({ generatedAt, now }: FreshnessProps) {
  const currency = dataCurrency(generatedAt, now);

  return (
    <div class="freshness" data-testid="freshness">
      {currency.kind === 'unknown' ? (
        <p class="freshness__unknown notice" data-testid="freshness-unknown">
          {UNKNOWN_CURRENCY_TEXT} <SourceSiteLink />
        </p>
      ) : (
        // Requirement 10.3: ordinary page text, so it is visible without any
        // visitor interaction.
        <p class="freshness__generated" data-testid="freshness-generated">
          {currency.generatedAtText}
        </p>
      )}

      {currency.kind === 'stale' && (
        <p class="freshness__stale notice" data-testid="freshness-stale">
          {STALE_NOTICE_TEXT} <SourceSiteLink />
        </p>
      )}
    </div>
  );
}
