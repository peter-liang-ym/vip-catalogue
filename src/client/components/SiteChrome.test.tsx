// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTRIBUTION_TEXT,
  SITE_TITLE,
  SiteChrome,
  SOURCE_SITE_LINK_TEXT,
  SOURCE_SITE_URL,
} from './SiteChrome';

const LISTING_HREF = '/?q=robot';

function mount(children?: ComponentChildren) {
  const onListing = vi.fn();
  render(
    <SiteChrome listingHref={LISTING_HREF} onListing={onListing}>
      {children}
    </SiteChrome>,
  );
  return { onListing };
}

afterEach(cleanup);

describe('SiteChrome', () => {
  it('displays the VIP program attribution and a Source_Site link in the footer (Requirement 10.2)', () => {
    mount(<p>listing</p>);

    const footer = screen.getByTestId('site-footer');
    expect(footer.textContent).toContain(ATTRIBUTION_TEXT);

    const link = screen.getByTestId('source-site-link');
    expect(footer.contains(link)).toBe(true);
    expect(link.getAttribute('href')).toBe(SOURCE_SITE_URL);
    expect(link.textContent).toBe(SOURCE_SITE_LINK_TEXT);
  });

  it('displays the footer for whatever page content it wraps (Requirement 10.2)', () => {
    mount(<p>the team was not found</p>);

    expect(screen.getByText('the team was not found')).toBeTruthy();
    expect(screen.getByTestId('site-footer')).toBeTruthy();
  });

  it('displays the footer with no page content at all (Requirement 10.2)', () => {
    mount();

    expect(screen.getByTestId('site-footer').textContent).toContain(
      ATTRIBUTION_TEXT,
    );
  });

  it('links the site name to the listing under the current Query_State (Requirement 9.4)', () => {
    const { onListing } = mount(<p>listing</p>);

    const brand = screen.getByText(SITE_TITLE);
    expect(brand.getAttribute('href')).toBe(LISTING_HREF);

    fireEvent.click(brand);
    expect(onListing).toHaveBeenCalledTimes(1);
  });
});
