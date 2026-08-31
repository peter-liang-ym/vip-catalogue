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
 * `SourceSiteLink` is exported because the freshness notices link to the
 * Source_Site as well (Requirements 10.4, 10.6), and one definition of that URL
 * means the footer and those notices cannot drift apart.
 */

import type { ComponentChildren } from 'preact';

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
  readonly children?: ComponentChildren;
}

export function SiteChrome({
  listingHref,
  onListing,
  children,
}: SiteChromeProps) {
  return (
    <div class="site">
      <header class="site__header">
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
