// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_CONFLICT_MESSAGE,
  CLEAR_ALL_LABEL,
  EmptyState,
  excludedText,
  NO_MATCH_MESSAGE,
} from './EmptyState';

function mount(props: Partial<Parameters<typeof EmptyState>[0]> = {}) {
  const onClearAll = props.onClearAll ?? vi.fn();
  render(
    <EmptyState
      reason={props.reason ?? 'noMatch'}
      hiddenByToggle={props.hiddenByToggle ?? 0}
      onClearAll={onClearAll}
    />,
  );
  return { onClearAll };
}

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders nothing while the Result_Set holds Teams', () => {
    mount({ reason: 'none' });

    expect(screen.queryByTestId('empty-state-message')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('states that no teams match and offers clear-all (Requirement 5.7)', () => {
    mount({ reason: 'noMatch' });

    expect(screen.getByTestId('empty-state-message').textContent).toBe(
      NO_MATCH_MESSAGE,
    );
    expect(screen.getByRole('button').textContent).toBe(CLEAR_ALL_LABEL);
  });

  it('shows no excluded count and no toggle in the no-match state (Requirement 16.9)', () => {
    mount({ reason: 'noMatch', hiddenByToggle: 0 });

    expect(screen.queryByTestId('empty-state-excluded')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('activating clear-all calls the handler (Requirement 5.7)', () => {
    const { onClearAll } = mount({ reason: 'noMatch' });

    fireEvent.click(screen.getByRole('button'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('states the all-conflict message, the excluded count, and clear-all (Requirement 16.8)', () => {
    mount({ reason: 'allConflict', hiddenByToggle: 3 });

    expect(screen.getByTestId('empty-state-message').textContent).toBe(
      ALL_CONFLICT_MESSAGE,
    );
    expect(screen.getByTestId('empty-state-excluded').textContent).toBe(
      excludedText(3),
    );
    expect(screen.getByRole('button').textContent).toBe(CLEAR_ALL_LABEL);
  });

  it('renders no toggle of its own, leaving the listing its one instance (Requirement 16.8)', () => {
    mount({ reason: 'allConflict', hiddenByToggle: 1 });

    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('states one excluded team in the singular (Requirement 16.3)', () => {
    mount({ reason: 'allConflict', hiddenByToggle: 1 });

    expect(screen.getByTestId('empty-state-excluded').textContent).toBe(
      '1 team hidden by the hide-conflicts toggle.',
    );
  });
});
