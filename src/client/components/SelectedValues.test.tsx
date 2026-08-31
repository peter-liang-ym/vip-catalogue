// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUERY_STATE, type QueryState } from '../queryState';
import { EMPTY_SELECTIONS } from '../selections';
import {
  CLEAR_ALL_LABEL,
  FILTER_LABELS,
  SelectedValues,
} from './SelectedValues';

function state(overrides: Partial<QueryState> = {}): QueryState {
  return { ...DEFAULT_QUERY_STATE, ...overrides };
}

function mount(qs: QueryState) {
  const onCommit = vi.fn();
  render(<SelectedValues qs={qs} onCommit={onCommit} />);
  return { onCommit };
}

function indicators(): readonly string[] {
  return screen
    .queryAllByRole('listitem')
    .map(item => (item.textContent ?? '').replace('×', '').trim());
}

afterEach(cleanup);

describe('SelectedValues', () => {
  it('renders one indicator per selected value with its Filter name, value, and remove control (Requirement 6.8)', () => {
    mount(
      state({
        filters: {
          ...EMPTY_SELECTIONS,
          college: ['Computing', 'Engineering'],
          day: ['Monday'],
        },
      }),
    );

    expect(indicators()).toEqual([
      'College Computing',
      'College Engineering',
      'Meeting day Monday',
    ]);
    expect(
      screen
        .getAllByRole('button', { name: /^Remove / })
        .map(b => b.getAttribute('aria-label')),
    ).toEqual([
      'Remove College Computing',
      'Remove College Engineering',
      'Remove Meeting day Monday',
    ]);
  });

  it('names every Filter it can indicate (Requirement 6.8)', () => {
    mount(
      state({
        filters: {
          college: ['Computing'],
          major: ['Computer Science'],
          day: ['Tuesday'],
          advisor: ['Gil Weinberg'],
        },
      }),
    );

    expect(indicators()).toEqual([
      `${FILTER_LABELS.college} Computing`,
      `${FILTER_LABELS.major} Computer Science`,
      `${FILTER_LABELS.day} Tuesday`,
      `${FILTER_LABELS.advisor} Gil Weinberg`,
    ]);
  });

  it('deselects only the removed value and retains the Search_Query and every other value (Requirement 6.9)', () => {
    const qs = state({
      query: 'robot',
      filters: {
        ...EMPTY_SELECTIONS,
        college: ['Computing', 'Engineering'],
        day: ['Monday'],
      },
    });
    const { onCommit } = mount(qs);

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove College Computing' }),
    );

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toEqual({
      ...qs,
      filters: {
        ...EMPTY_SELECTIONS,
        college: ['Engineering'],
        day: ['Monday'],
      },
    });
  });

  it('clears the Search_Query, every selection, and the hide-conflicts toggle, leaving the Sort_Option and page size (Requirements 5.6, 6.7, 16.6)', () => {
    const qs = state({
      query: 'robot',
      filters: { ...EMPTY_SELECTIONS, major: ['Computer Science'] },
      sort: 'name-desc',
      hideConflicts: true,
      pageNumber: 3,
      pageSize: 48,
    });
    const { onCommit } = mount(qs);

    fireEvent.click(screen.getByRole('button', { name: CLEAR_ALL_LABEL }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toEqual({
      query: '',
      filters: EMPTY_SELECTIONS,
      sort: 'name-desc',
      hideConflicts: false,
      pageNumber: 3,
      pageSize: 48,
    });
  });

  it('shows the clear-all control for a Search_Query alone (Requirement 5.6)', () => {
    mount(state({ query: 'robot' }));

    expect(screen.getByRole('button', { name: CLEAR_ALL_LABEL })).toBeTruthy();
    expect(indicators()).toEqual([]);
  });

  it('shows the clear-all control for a selected value alone (Requirement 5.6)', () => {
    mount(
      state({ filters: { ...EMPTY_SELECTIONS, advisor: ['Gil Weinberg'] } }),
    );

    expect(screen.getByRole('button', { name: CLEAR_ALL_LABEL })).toBeTruthy();
  });

  it('shows the clear-all control while the hide-conflicts toggle is on (Requirement 16.7)', () => {
    mount(state({ hideConflicts: true }));

    expect(screen.getByRole('button', { name: CLEAR_ALL_LABEL })).toBeTruthy();
  });

  it('shows nothing while no query, no selection, and no toggle is active (Requirements 5.6, 16.7)', () => {
    mount(state());

    expect(screen.queryByTestId('selected-values')).toBeNull();
  });

  it('treats a whitespace-only Search_Query as no query (Requirement 5.6)', () => {
    mount(state({ query: '   ' }));

    expect(screen.queryByTestId('selected-values')).toBeNull();
  });
});
