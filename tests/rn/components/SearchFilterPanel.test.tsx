import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SearchFilterPanel } from '@/components/SearchFilterPanel';
import { EMPTY_SEARCH_FILTER_DRAFT, SearchFilterDraft } from '@/utils/search-filters';

jest.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, colors: require('./theme-mock').mockColors }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { unit?: string }) => (opts?.unit ? `${key}:${opts.unit}` : key),
  }),
}));

async function renderPanel(
  overrides: Partial<React.ComponentProps<typeof SearchFilterPanel>> = {},
) {
  const props = {
    draft: EMPTY_SEARCH_FILTER_DRAFT,
    onChange: jest.fn(),
    searchIn: 'everywhere' as const,
    onSearchInChange: jest.fn(),
    onClear: jest.fn(),
    onApply: jest.fn(),
    ...overrides,
  };
  const utils = await render(<SearchFilterPanel {...props} />);
  return { props, ...utils };
}

describe('SearchFilterPanel', () => {
  it('reports the chosen "Search in" scope', async () => {
    const { props } = await renderPanel();
    await fireEvent.press(screen.getByText('screens.search.namesOnly'));
    expect(props.onSearchInChange).toHaveBeenCalledWith('names');
    await fireEvent.press(screen.getByText('screens.search.everywhere'));
    expect(props.onSearchInChange).toHaveBeenCalledWith('everywhere');
  });

  it('reports text, seeders and size edits as draft patches', async () => {
    const { props } = await renderPanel();
    await fireEvent.changeText(screen.getByLabelText('screens.search.filterResults'), '1080p');
    expect(props.onChange).toHaveBeenLastCalledWith({ filterText: '1080p' });
    await fireEvent.changeText(screen.getByLabelText('screens.search.minSeeders'), '5');
    expect(props.onChange).toHaveBeenLastCalledWith({ minSeeders: '5' });
    await fireEvent.changeText(screen.getByLabelText('screens.search.maxSize'), '1.5');
    expect(props.onChange).toHaveBeenLastCalledWith({ maxSize: '1.5' });
  });

  it('strips characters that cannot be part of a number', async () => {
    const { props } = await renderPanel();
    await fireEvent.changeText(screen.getByLabelText('screens.search.maxSeeders'), '1a2.5');
    expect(props.onChange).toHaveBeenLastCalledWith({ maxSeeders: '125' });
    await fireEvent.changeText(screen.getByLabelText('screens.search.minSize'), '2,5GB');
    expect(props.onChange).toHaveBeenLastCalledWith({ minSize: '2,5' });
  });

  it('cycles each size unit independently, wrapping at the end', async () => {
    const { props } = await renderPanel();
    // Defaults are MiB (min) and GiB (max).
    await fireEvent.press(screen.getByLabelText('screens.search.sizeUnit:MiB'));
    expect(props.onChange).toHaveBeenLastCalledWith({ minSizeUnit: 'GiB' });
    await fireEvent.press(screen.getByLabelText('screens.search.sizeUnit:GiB'));
    expect(props.onChange).toHaveBeenLastCalledWith({ maxSizeUnit: 'TiB' });
  });

  it('wraps the unit from TiB back to B', async () => {
    const draft: SearchFilterDraft = { ...EMPTY_SEARCH_FILTER_DRAFT, maxSizeUnit: 'TiB' };
    const { props } = await renderPanel({ draft });
    await fireEvent.press(screen.getByLabelText('screens.search.sizeUnit:TiB'));
    expect(props.onChange).toHaveBeenLastCalledWith({ maxSizeUnit: 'B' });
  });

  it('only enables "Clear filters" when the draft has something to clear', async () => {
    const clean = await renderPanel();
    await fireEvent.press(screen.getByText('screens.search.clearFilters'));
    expect(clean.props.onClear).not.toHaveBeenCalled();
    await clean.unmount();

    const dirty = await renderPanel({
      draft: { ...EMPTY_SEARCH_FILTER_DRAFT, filterText: 'x264' },
    });
    await fireEvent.press(screen.getByText('screens.search.clearFilters'));
    expect(dirty.props.onClear).toHaveBeenCalledTimes(1);
  });

  it('only applies on the Apply button, not while editing', async () => {
    const { props } = await renderPanel();
    await fireEvent.changeText(screen.getByLabelText('screens.search.filterResults'), '1080p');
    await fireEvent.press(screen.getByText('screens.search.namesOnly'));
    expect(props.onApply).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('screens.search.applyFilters'));
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });

  it('toggles video qualities in and out of the selection', async () => {
    const { props } = await renderPanel();
    await fireEvent.press(screen.getByText('1080p'));
    expect(props.onChange).toHaveBeenLastCalledWith({ qualities: ['1080p'] });
    await fireEvent.press(screen.getByText('2160p'));
    expect(props.onChange).toHaveBeenLastCalledWith({ qualities: ['2160p'] });
  });

  it('deselects an already selected quality', async () => {
    const draft: SearchFilterDraft = { ...EMPTY_SEARCH_FILTER_DRAFT, qualities: ['720p', '1080p'] };
    const { props } = await renderPanel({ draft });
    await fireEvent.press(screen.getByText('720p'));
    expect(props.onChange).toHaveBeenLastCalledWith({ qualities: ['1080p'] });
  });

  it('lets you clear a saved "Names only" scope even with nothing typed', async () => {
    const { props } = await renderPanel({ searchIn: 'names' });
    await fireEvent.press(screen.getByText('screens.search.clearFilters'));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
