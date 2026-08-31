/**
 * The team-not-found view (Requirement 9.5).
 *
 * Reached when `/team/{id}` names a source entry identifier the Dataset does not
 * hold — a stale link, a team the source site removed, or an address a visitor
 * edited by hand. The shell resolves that: `index.byEntryId.get(id)` comes back
 * `undefined` and this view renders instead of the Team_Detail_View.
 *
 * Requirement 9.5 is as much about what is absent as what is present. The
 * component takes no `TeamRecord` and no field of one, so displaying no
 * Team_Record field values is structural rather than a rule that could be broken
 * later: there is nothing here to render them from.
 *
 * What it does render is the not-found message and a link to the listing. The
 * link carries the listing address the shell hands it, which is the address the
 * current history entry holds, so following it restores the Query_State that was
 * active when the Team_Card was opened, or the defaults when the detail address
 * was reached directly (Requirements 9.4, 9.8) — the same href-plus-handler pair
 * the Team_Card uses to travel the other way.
 *
 * The site navigation and footer that Requirement 9.5 also asks for, and that
 * Requirement 10.2 asks for on every page including this one, are not spelled
 * here. They wrap every route once, in the site chrome, so this view contributes
 * only the page content and cannot fall out of step with the footer the listing
 * and detail views show.
 */

/** Requirement 9.5: the message stating that the team was not found. */
export const NOT_FOUND_MESSAGE = 'That team was not found.';

/** The listing link's text (Requirement 9.5). It names where it goes. */
export const LISTING_LINK_TEXT = 'Back to all teams';

export interface NotFoundProps {
  /** The listing address under the current Query_State, from `routeHref`. */
  readonly listingHref: string;
  readonly onListing: () => void;
}

export function NotFound({ listingHref, onListing }: NotFoundProps) {
  return (
    <main class="not-found" data-testid="not-found">
      <h1 class="not-found__message">{NOT_FOUND_MESSAGE}</h1>

      {/* A real href, so the link is shareable and opens in a new tab like any
          other, with the handler routing in place when it is followed normally. */}
      <a
        class="not-found__listing-link"
        href={listingHref}
        onClick={event => {
          event.preventDefault();
          onListing();
        }}
      >
        {LISTING_LINK_TEXT}
      </a>
    </main>
  );
}
