// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUERY_STATE, type QueryState } from '../queryState';
import { SORT_OPTIONS } from '../sort';
import { SORT_CONTROL_LABEL, SORT_LABELS, SortControl } from './SortControl';

function state(overrides: Partial<QueryState> = {}): QueryState {
  return { ...DEFAULT_QUERY_STATE, ...overrides };
}

function mount(qs: QueryState = state()) {
  const onCommit = vi.fn();
  render(<SortControl qs={qs} onCommit={onCommit} />);
  return { onCommit };
}

function control(): HTMLSelectElement {
  return screen.getByLabelText(SORT_CONTROL_LABEL) as HTMLSelectElement;
}

afterEach(cleanup);

describe('SortControl', () => {
  it('offers exactly the four Sort_Options through one control (Requirement 7.1)', () => {
    mount();

    const options = [...control().options];
    expect(options.map(option => option.value)).toEqual([...SORT_OPTIONS]);
    expect(options.map(option => option.textContent)).toEqual(
      SORT_OPTIONS.map(option => SORT_LABELS[option]),
    );
  });

  it('associates a label naming the control with it (Requirement 11.7)', () => {
    mount();

    expect(control().tagName).toBe('SELECT');
  });

  it('shows name ascending as applied with no selection and an empty query (Requirement 7.3)', () => {
    mount(state({ sort: null, query: '' }));

    expect(control().value).toBe('name-asc');
  });

  it('shows relevance as applied with no selection and a non-empty query (Requirement 7.8)', () => {
    mount(state({ sort: null, query: 'robot' }));

    expect(control().value).toBe('relevance');
  });

  it('shows the explicitly selected Sort_Option whatever the query (Requirement 7.1)', () => {
    for (const sort of SORT_OPTIONS) {
      mount(state({ sort, query: '' }));
      expect(control().value).toBe(sort);
      cleanup();
    }
  });

  it('offers every Sort_Option enabled regardless of query or calendar state (Requirement 7.4)', () => {
    for (const query of ['', 'robot']) {
      mount(state({ query }));
      expect([...control().options].map(option => option.disabled)).toEqual([
        false,
        false,
        false,
        false,
      ]);
      cleanup();
    }
  });

  it('accepts a selection of every Sort_Option, including relevance with an empty query and conflict-free with no schedule loaded (Requirement 7.4)', () => {
    for (const sort of SORT_OPTIONS) {
      const { onCommit } = mount(state({ sort: 'name-desc', query: '' }));

      fireEvent.change(control(), { target: { value: sort } });

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit.mock.calls[0]?.[0].sort).toBe(sort);
      cleanup();
    }
  });

  it('sets the page number to 1 and leaves the query and Filter values unchanged (Requirement 7.2)', () => {
    const qs = state({
      query: 'robot music',
      filters: {
        college: ['Engineering'],
        major: ['Mechanical Engineering'],
        day: ['Monday'],
        advisor: ['Gil Weinberg'],
      },
      sort: null,
      pageNumber: 7,
    });
    const { onCommit } = mount(qs);

    fireEvent.change(control(), { target: { value: 'name-desc' } });

    expect(onCommit).toHaveBeenCalledWith({
      ...qs,
      sort: 'name-desc',
      pageNumber: 1,
    });
  });
});
