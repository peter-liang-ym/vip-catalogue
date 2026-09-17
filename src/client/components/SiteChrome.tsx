/**
 * The site chrome (Requirement 10.2).
 *
 * Every route renders inside this component, in every load state, so the
 * attribution to the Georgia Tech VIP program and the link to the Source_Site are
 * written once and appear on the listing, on the Team_Detail_View, on the
 * team-not-found page, while the Dataset is loading, and after a failed Dataset
 * request (Requirements 9.5, 10.2, 12.6). Nothing here depends on the Dataset, the
 * Query_State, or the route, which is what makes "on every page" structural rather
 * than a rule each view has to remember.
 *
 * The unofficial-mirror notice is deliberately not here. Requirement 10.1 places
 * it on the listing page above the first Team_Card, and the listing already owns
 * it and its position; hoisting it into the chrome would put it on the detail and
 * not-found pages too and would separate the notice from the cards it qualifies.
 * The chrome carries the footer attribution, which is the part Requirement 10.2
 * asks for everywhere.
 *
 * The theme control is here for the same structural reason: Requirement 18.2 asks
 * for one, and the masthead is the one place every route and every load state
 * renders, so no view has to remember to offer it.
 *
 * The search field is here because it is the site's primary action, and the
 * masthead is where a primary action belongs: it was previously the first of a
 * column of controls stacked above the count, which put the thing most visitors
 * came to use below the fold on a phone. It is a slot rather than a fixture — the
 * chrome renders it only when a handler is supplied, which is the listing route
 * (Requirements 8.8, 11.7). No other route has a Search_Query to type into, and
 * the field carries no Query_State logic of its own: it reports raw input and
 * renders the query it is given, exactly as it did inside the listing.
 *
 * `SourceSiteLink` is exported because the freshness notices link to the
 * Source_Site as well (Requirements 10.4, 10.6), and one definition of that URL
 * means the footer and those notices cannot drift apart.
 */

import type { ComponentChildren } from 'preact';
import { ThemeToggle } from './ThemeToggle';

/** The Source_Site team index: where a visitor goes for authoritative content. */
export const SOURCE_SITE_URL = 'https://vip.gatech.edu/teams/';

/** The Source_Site link's text. It names where it goes, not "click here". */
export const SOURCE_SITE_LINK_TEXT = 'Official Georgia Tech VIP team pages';

/** Requirement 10.2: attribution to the program that publishes the content. */
export const ATTRIBUTION_TEXT =
  'Team information is published by the Georgia Tech Vertically Integrated Projects (VIP) program.';

export const SITE_TITLE = 'VIP Teams Mirror';

/** The site navigation's accessible name (Requirement 11.7). */
export const SITE_NAV_LABEL = 'Site';

/** The search field's label (Requirement 11.7). */
export const SEARCH_LABEL = 'Search teams';

const SEARCH_ID = 'site-search';

/** The link to the Source_Site (Requirements 10.2, 10.4, 10.6). */
export function SourceSiteLink() {
  return (
    <a
      class="source-site-link"
      href={SOURCE_SITE_URL}
      rel="noreferrer"
      data-testid="source-site-link"
    >
      {SOURCE_SITE_LINK_TEXT}
    </a>
  );
}

export interface SiteChromeProps {
  /** The listing address under the current Query_State, from `routeHref`. */
  readonly listingHref: string;
  readonly onListing: () => void;
  /** The storage the Theme_Preference is read from and written to; for tests. */
  readonly store?: Storage;
  /** The Search_Query the field shows; absent on the routes that have none. */
  readonly query?: string;
  /**
   * Search-field input, reported raw to the shell, which clamps it and writes the
   * address by replacement (Requirement 8.8). The field renders only when this is
   * supplied.
   */
  readonly onQuery?: (raw: string) => void;
  readonly children?: ComponentChildren;
}

export function SiteChrome({
  listingHref,
  onListing,
  store,
  query,
  onQuery,
  children,
}: SiteChromeProps) {
  return (
    <div class="site">
      <header class="site__header">
        <div class="site__masthead">
          <nav class="site__nav" aria-label={SITE_NAV_LABEL}>
            {/* A real href, so the site name is shareable and opens in a new tab
                like any other link, with the handler routing in place when it is
                followed normally. */}
            <a
              class="site__brand"
              href={listingHref}
              onClick={event => {
                event.preventDefault();
                onListing();
              }}
            >
              {SITE_TITLE}
            </a>
          </nav>
          {/* Requirement 18.2: one theme control, in the chrome that every route
              and every load state renders, so it is reachable from all of them. */}
          <ThemeToggle store={store} />
        </div>

        {/* Requirement 11.7: a programmatically associated label naming the
            control's purpose, and the field follows the lockup in the markup, so
            visual order and tab order agree (Requirement 11.1). */}
        {onQuery !== undefined && (
          <div class="site__search">
            <label class="site__search-label" for={SEARCH_ID}>
              {SEARCH_LABEL}
            </label>
            <input
              id={SEARCH_ID}
              class="site__search-input"
              type="search"
              value={query ?? ''}
              onInput={event => onQuery(event.currentTarget.value)}
            />
          </div>
        )}
      </header>

      {children}

      <footer class="site__footer" data-testid="site-footer">
        <p class="site__attribution">{ATTRIBUTION_TEXT}</p>
        <p class="site__source">
          <SourceSiteLink />
        </p>
      </footer>
    </div>
  );
}
