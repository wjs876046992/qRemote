import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SearchResultGroupRow } from '@/components/SearchResultGroupRow';
import { SearchResult } from '@/types/api';
import { SearchResultGroup, groupSearchResults, singletonGroups } from '@/utils/search-grouping';

jest.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, colors: require('./theme-mock').mockColors }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));

const HASH = '0123456789abcdef0123456789abcdef01234567';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    fileName: 'Some Movie 2024',
    fileSize: 1_000_000,
    fileUrl: 'https://idx.example/1.torrent',
    nbLeechers: 2,
    nbSeeders: 10,
    siteUrl: 'https://idx.example',
    descrLink: '',
    ...overrides,
  };
}

const best = result({
  fileUrl: `magnet:?xt=urn:btih:${HASH}&dn=best`,
  siteUrl: 'https://alpha.example',
  nbSeeders: 50,
});
const other = result({
  fileUrl: `magnet:?xt=urn:btih:${HASH}&dn=other`,
  siteUrl: 'https://beta.example',
  nbSeeders: 7,
  fileName: 'Some.Movie.2024 [Beta]',
});
const third = result({
  fileUrl: `magnet:?xt=urn:btih:${HASH}&dn=third`,
  siteUrl: 'https://gamma.example',
  nbSeeders: 1,
});

function makeGroup(): SearchResultGroup {
  const [group] = groupSearchResults([other, best, third]);
  expect(group.sourceCount).toBe(3);
  return group;
}

async function renderRow(group: SearchResultGroup, overrides: Record<string, unknown> = {}) {
  const props = {
    group,
    isAggregatedSource: false,
    onAddGroup: jest.fn(),
    onAddResult: jest.fn(),
    onLongPress: jest.fn(),
    onOpenLink: jest.fn(),
    onCopyUrl: jest.fn(),
    addingUrl: null as string | null,
    isInCart: jest.fn(() => false),
    onToggleCart: jest.fn(),
    ...overrides,
  };
  await render(<SearchResultGroupRow {...props} />);
  return props;
}

describe('SearchResultGroupRow', () => {
  describe('a group of one', () => {
    const [single] = singletonGroups([result()]);

    it('renders the plain row with no sources chip', async () => {
      await renderRow(single);
      expect(screen.getByText('Some Movie 2024')).toBeTruthy();
      expect(screen.queryByLabelText('screens.search.expandSources')).toBeNull();
      expect(screen.queryByText(/sourcesCount/)).toBeNull();
    });

    it('adds just that result, and long-press reports no group', async () => {
      const props = await renderRow(single);
      await fireEvent.press(screen.getByLabelText('screens.search.addToQueue'));
      expect(props.onAddResult).toHaveBeenCalledWith(single.primary);
      expect(props.onAddGroup).not.toHaveBeenCalled();

      await fireEvent(screen.getByText('Some Movie 2024'), 'longPress');
      expect(props.onLongPress).toHaveBeenCalledWith(single.primary);
    });
  });

  describe('a group of several sources', () => {
    it('shows the primary (most seeders) with a pluralized sources chip, members collapsed', async () => {
      await renderRow(makeGroup());
      expect(screen.getByText('Some Movie 2024')).toBeTruthy();
      expect(screen.getByText('↑50')).toBeTruthy();
      expect(screen.getByText('screens.search.sourcesCount:3')).toBeTruthy();
      expect(screen.queryByText('beta.example')).toBeNull();
      expect(screen.getAllByLabelText('screens.search.addToQueue')).toHaveLength(1);
    });

    it('expands to list every member, and collapses again', async () => {
      await renderRow(makeGroup());
      await fireEvent.press(screen.getByLabelText('screens.search.expandSources'));

      expect(screen.getByLabelText('screens.search.collapseSources')).toBeTruthy();
      // Primary row + one add button per member.
      expect(screen.getAllByLabelText('screens.search.addToQueue')).toHaveLength(4);
      expect(screen.getByText('beta.example')).toBeTruthy();
      expect(screen.getByText('gamma.example')).toBeTruthy();
      // A member whose title differs from the primary's shows its own.
      expect(screen.getByText('Some.Movie.2024 [Beta]')).toBeTruthy();

      await fireEvent.press(screen.getByLabelText('screens.search.collapseSources'));
      expect(screen.queryByText('beta.example')).toBeNull();
      expect(screen.getByLabelText('screens.search.expandSources')).toBeTruthy();
    });

    it("the row's own + adds the whole group; a member's + adds only that member", async () => {
      const group = makeGroup();
      const props = await renderRow(group);
      await fireEvent.press(screen.getByLabelText('screens.search.expandSources'));

      const adds = screen.getAllByLabelText('screens.search.addToQueue');
      await fireEvent.press(adds[0]);
      expect(props.onAddGroup).toHaveBeenCalledWith(group);
      expect(props.onAddResult).not.toHaveBeenCalled();

      // Members are listed best first: best, other, third.
      await fireEvent.press(adds[2]);
      expect(props.onAddResult).toHaveBeenCalledTimes(1);
      expect(props.onAddResult).toHaveBeenCalledWith(other);
    });

    it('long-press on the row passes the group along so "Add now" can add all sources', async () => {
      const group = makeGroup();
      const props = await renderRow(group);
      await fireEvent(screen.getByText('Some Movie 2024'), 'longPress');
      expect(props.onLongPress).toHaveBeenCalledWith(group.primary, group);
    });

    it('toggles the cart per result and reflects cart membership', async () => {
      const props = await renderRow(makeGroup(), {
        isInCart: jest.fn((url: string) => url === other.fileUrl),
      });
      await fireEvent.press(screen.getByLabelText('screens.search.expandSources'));

      // Row's cart button is for the primary; one cart button per member follows.
      expect(screen.getAllByLabelText('screens.search.addToCart')).toHaveLength(3);
      expect(screen.getAllByLabelText('screens.search.removeFromCart')).toHaveLength(1);

      await fireEvent.press(screen.getAllByLabelText('screens.search.addToCart')[0]);
      expect(props.onToggleCart).toHaveBeenLastCalledWith(best);
      await fireEvent.press(screen.getByLabelText('screens.search.removeFromCart'));
      expect(props.onToggleCart).toHaveBeenLastCalledWith(other);
    });

    it("disables the row's + while the group is being added", async () => {
      const props = await renderRow(makeGroup(), { addingUrl: best.fileUrl });
      await fireEvent.press(screen.getByLabelText('screens.search.addToQueue'));
      expect(props.onAddGroup).not.toHaveBeenCalled();
    });

    it('uses the bracketed indexer tag for the label when the source is aggregated', async () => {
      const a = result({
        fileUrl: `magnet:?xt=urn:btih:${HASH}&dn=a`,
        fileName: 'Some Movie [IdxOne]',
        nbSeeders: 9,
      });
      const b = result({
        fileUrl: `magnet:?xt=urn:btih:${HASH}&dn=b`,
        fileName: 'Some Movie [IdxTwo]',
        nbSeeders: 3,
      });
      const [group] = groupSearchResults([a, b]);
      await renderRow(group, { isAggregatedSource: true });
      await fireEvent.press(screen.getByLabelText('screens.search.expandSources'));
      expect(screen.getAllByText('IdxOne').length).toBeGreaterThan(0);
      expect(screen.getByText('IdxTwo')).toBeTruthy();
    });
  });
});
