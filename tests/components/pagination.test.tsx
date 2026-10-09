// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { usePagination, pageWindow } from '../../src/components/common/ui/Pagination';

/** Renders the hook's output so the page math can be asserted from the DOM. */
function Harness({ rows, resetKey }: { rows: number[]; resetKey?: string }) {
  const { pageItems, pagination, page, total, totalPages } = usePagination(rows, {
    initialPageSize: 10,
    resetKey,
  });
  return (
    <div>
      <span data-testid="meta">{`page=${page} total=${total} pages=${totalPages}`}</span>
      <ul>
        {pageItems.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {pagination}
    </div>
  );
}

const meta = () => screen.getByTestId('meta').textContent ?? '';
const shownRows = () => screen.getAllByRole('listitem').map((li) => Number(li.textContent));

afterEach(cleanup);

describe('usePagination', () => {
  it('renders the first page and slices at the page size', () => {
    render(<Harness rows={Array.from({ length: 25 }, (_, i) => i + 1)} />);
    expect(meta()).toBe('page=1 total=25 pages=3');
    expect(shownRows()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('advances a page and reports the correct 1-based range', () => {
    render(<Harness rows={Array.from({ length: 25 }, (_, i) => i + 1)} />);
    fireEvent.click(screen.getByLabelText('Page 2'));
    expect(meta()).toBe('page=2 total=25 pages=3');
    expect(shownRows()).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    // "Showing 11–20 of 25"
    expect(screen.getByRole('status').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Showing 11–20 of 25',
    );
  });

  it('renders a short final page without padding', () => {
    render(<Harness rows={Array.from({ length: 25 }, (_, i) => i + 1)} />);
    fireEvent.click(screen.getByLabelText('Page 3'));
    expect(shownRows()).toEqual([21, 22, 23, 24, 25]);
  });

  it('hides the bar entirely when everything fits on one page', () => {
    render(<Harness rows={[1, 2, 3]} />);
    expect(screen.queryByLabelText('Pagination')).toBeNull();
  });

  it('clamps rather than painting an empty page when a filter narrows the list', () => {
    const rows = Array.from({ length: 25 }, (_, i) => i + 1);
    const { rerender } = render(<Harness rows={rows} resetKey="all" />);
    fireEvent.click(screen.getByLabelText('Page 3'));
    expect(meta()).toBe('page=3 total=25 pages=3');
    // A filter narrows 25 rows to 4 while the reader sits on page 3.
    rerender(<Harness rows={[1, 2, 3, 4]} resetKey="narrowed" />);
    expect(meta()).toBe('page=1 total=4 pages=1');
    expect(shownRows()).toEqual([1, 2, 3, 4]);
  });

  it('disables the edges instead of wrapping around', () => {
    render(<Harness rows={Array.from({ length: 25 }, (_, i) => i + 1)} />);
    expect(screen.getByLabelText('Previous page').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Next page').hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByLabelText('Page 3'));
    expect(screen.getByLabelText('Next page').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Previous page').hasAttribute('disabled')).toBe(false);
  });

  it('marks the current page for assistive tech', () => {
    render(<Harness rows={Array.from({ length: 60 }, (_, i) => i + 1)} />);
    fireEvent.click(screen.getByLabelText('Page 2'));
    const nav = screen.getByLabelText('Pagination');
    expect(within(nav).getByLabelText('Page 2').getAttribute('aria-current')).toBe('page');
  });

  it('collapses a long range into first/last around the cursor', () => {
    // 40 pages, cursor on 20 -> 1 gap 18..22 gap 40
    expect(pageWindow(20, 40)).toEqual([1, 'gap', 18, 19, 20, 21, 22, 'gap', 40]);
    // Near the start the window is dense rather than mostly gaps.
    expect(pageWindow(1, 40)).toEqual([1, 2, 3, 'gap', 40]);
    expect(pageWindow(40, 40)).toEqual([1, 'gap', 38, 39, 40]);
    // Short ranges render every page, with no gap markers at all.
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('renders only the window around the cursor', () => {
    render(<Harness rows={Array.from({ length: 400 }, (_, i) => i + 1)} />);
    const nav = screen.getByLabelText('Pagination');
    expect(within(nav).queryByLabelText('Page 20')).toBeNull();
    expect(within(nav).getByLabelText('Page 1')).toBeTruthy();
    expect(within(nav).getByLabelText('Page 40')).toBeTruthy();
  });

  it('re-slices from the top when the page size changes', () => {
    // 40 rows at 10/page = 4 pages, so every page number is one click away.
    render(<Harness rows={Array.from({ length: 40 }, (_, i) => i + 1)} />);
    fireEvent.click(screen.getByLabelText('Page 4'));
    expect(meta()).toBe('page=4 total=40 pages=4');
    expect(shownRows()).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
    expect(meta()).toBe('page=1 total=40 pages=1');
    expect(shownRows()).toHaveLength(40);
    expect(shownRows()[0]).toBe(1);
  });

  it('survives an empty list', () => {
    render(<Harness rows={[]} />);
    expect(meta()).toBe('page=1 total=0 pages=1');
    expect(screen.queryByLabelText('Pagination')).toBeNull();
  });
});