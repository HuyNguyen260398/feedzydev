import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FilterBar from '@/components/FilterBar';
import type { PublicSource } from '@/lib/types';

const sources: PublicSource[] = [
  { sourceId: 'b', name: 'Beta Blog', siteUrl: 'https://b.example' },
  { sourceId: 'a', name: 'Alpha Blog', siteUrl: 'https://a.example' },
];

function setup(props: Partial<Parameters<typeof FilterBar>[0]> = {}) {
  const onSourceChange = vi.fn();
  const onRangeChange = vi.fn();
  const onQueryChange = vi.fn();
  render(
    <FilterBar
      sources={sources}
      range="any"
      onSourceChange={onSourceChange}
      onRangeChange={onRangeChange}
      onQueryChange={onQueryChange}
      {...props}
    />,
  );
  return { onSourceChange, onRangeChange, onQueryChange };
}

describe('FilterBar', () => {
  it('lists sources by name after "All sources"', () => {
    setup();
    const options = screen.getAllByRole('option', { hidden: true }).map((o) => o.textContent);
    expect(options.slice(0, 3)).toEqual(['All sources', 'Alpha Blog', 'Beta Blog']);
  });

  it('reports source and date changes; "All sources" maps to undefined', () => {
    const { onSourceChange, onRangeChange } = setup({ sourceId: 'a' });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'b' } });
    expect(onSourceChange).toHaveBeenLastCalledWith('b');
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: '' } });
    expect(onSourceChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.change(screen.getByLabelText('Published'), { target: { value: '7d' } });
    expect(onRangeChange).toHaveBeenLastCalledWith('7d');
  });

  it('Clear is hidden when nothing is filtered', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('Clear resets every filter, including search', () => {
    const { onSourceChange, onRangeChange, onQueryChange } = setup({
      sourceId: 'a',
      range: 'today',
      query: 'k8s',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSourceChange).toHaveBeenLastCalledWith(undefined);
    expect(onRangeChange).toHaveBeenLastCalledWith('any');
    expect(onQueryChange).toHaveBeenLastCalledWith('');
  });

  it('a search alone shows Clear', () => {
    setup({ query: 'k8s' });
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('reports typed search text; the clear button and Escape empty it', () => {
    const { onQueryChange } = setup({ query: 'kube' });
    const box = screen.getByRole('searchbox', { name: 'Search posts' });
    fireEvent.change(box, { target: { value: 'kubernetes' } });
    expect(onQueryChange).toHaveBeenLastCalledWith('kubernetes');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onQueryChange).toHaveBeenLastCalledWith('');
    onQueryChange.mockClear();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onQueryChange).toHaveBeenLastCalledWith('');
  });

  it('"/" focuses the search box unless typing elsewhere', () => {
    setup();
    const box = screen.getByRole('searchbox', { name: 'Search posts' });
    fireEvent.keyDown(document.body, { key: '/' });
    expect(box).toHaveFocus();
    box.blur();
    const source = screen.getByLabelText('Source');
    source.focus();
    fireEvent.keyDown(source, { key: '/' });
    expect(source).toHaveFocus();
  });
});
