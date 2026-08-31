/**
 * Routing (Requirements 8.2, 9.4, 9.8).
 *
 * There are two routes: `/` is the listing and `/team/{entryId}` is the
 * Team_Detail_View. Both carry the Query_State in the address as the query
 * parameters `encodeQueryState` writes, which is what makes Requirement 9.4 a
 * property of the address rather than of remembered state: opening a Team_Card
 * pushes the detail path with the listing's own encoded Query_State, so returning
 * to the listing — by the listing link or by browser back — decodes exactly the
 * Query_State that was active when the card was opened, and does so after a
 * reload or on another device. An address carrying no Query_State parameters
 * decodes to the defaults, which is Requirement 9.8 with no extra rule.
 *
 * Paths are root-relative. The site is served from the root of a static host with
 * `404.html` falling back to the same app shell, so a path the shell does not
 * recognize — including the host's own miss on a deep link — renders the listing
 * rather than an error page.
 */

import type { FacetValues } from './facets';
import { encodeQueryState, type QueryState } from './queryState';
import { decodeQueryState } from './queryStateDecode';

export type Route =
  | { readonly kind: 'listing' }
  | { readonly kind: 'team'; readonly entryId: string };

export const LISTING_PATH = '/';

/** The path segment that introduces a Team_Detail_View. */
export const TEAM_SEGMENT = 'team';

export const LISTING_ROUTE: Route = { kind: 'listing' };

export interface Address {
  readonly route: Route;
  readonly queryState: QueryState;
}

/**
 * One path segment as text. A malformed escape is kept verbatim rather than
 * throwing: the address bar is visitor-editable, so an unreadable `entryId` has
 * to reach the Dataset lookup and come back as the not-found view
 * (Requirement 9.5), not as an exception during routing.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The route `pathname` names. Exactly `/team/{entryId}` is the detail route,
 * with or without a trailing slash; every other path — `/`, `/index.html`,
 * `/404.html`, and anything unrecognized — is the listing.
 */
export function parseRoute(pathname: string): Route {
  const segments = pathname.split('/').filter(segment => segment !== '');
  if (segments.length !== 2 || segments[0] !== TEAM_SEGMENT) {
    return LISTING_ROUTE;
  }

  const entryId = decodeSegment(segments[1] ?? '');

  return entryId === '' ? LISTING_ROUTE : { kind: 'team', entryId };
}

/** The path of `route`, without any Query_State. */
export function routePath(route: Route): string {
  return route.kind === 'listing'
    ? LISTING_PATH
    : `/${TEAM_SEGMENT}/${encodeURIComponent(route.entryId)}`;
}

/**
 * The whole address of `route` under `qs`: the path plus the encoded Query_State,
 * which is what every link href and every history entry is written from.
 */
export function routeHref(route: Route, qs: QueryState): string {
  return `${routePath(route)}${encodeQueryState(qs)}`;
}

/**
 * The route and Query_State an address holds. Total, since both halves are:
 * `parseRoute` falls back to the listing and `decodeQueryState` falls back to the
 * defaults per parameter (Requirements 8.4, 8.6).
 *
 * `facets` is supplied once the Dataset has arrived, so Filter values it does not
 * offer are dropped; before then values are kept verbatim, which is the behavior
 * the codec documents for restoration ahead of the Dataset.
 */
export function decodeAddress(
  pathname: string,
  search: string,
  facets?: FacetValues,
): Address {
  return {
    route: parseRoute(pathname),
    queryState: decodeQueryState(search, facets),
  };
}
