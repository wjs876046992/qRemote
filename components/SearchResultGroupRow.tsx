/**
 * SearchResultGroupRow.tsx — one Search list row for a group of results that
 * are (probably) the same torrent from different indexers (#267).
 *
 * A group of one renders exactly the plain SearchResultRow. Otherwise the row
 * shows the group's primary (the member with the most seeders) with an "N sources"
 * toggle in its footer; expanding it lists every member compactly — indexer,
 * seeders, size — each with its own add and cart buttons.
 *
 * What the buttons act on:
 *   - the row's own + adds the WHOLE group (onAddGroup), so all the members'
 *     trackers end up on one torrent;
 *   - a member's + adds only that member (onAddResult), for when one specific
 *     indexer's copy is wanted;
 *   - cart buttons queue the individual result they sit on (the primary's, for
 *     the row itself).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SearchResultRow } from '@/components/SearchResultRow';
import { useTheme } from '@/context/ThemeContext';
import { SearchResult } from '@/types/api';
import { SearchResultGroup } from '@/utils/search-grouping';
import { formatSize } from '@/utils/format';
import { resultTrackerLabel } from '@/utils/searchResult';
import { spacing, borderRadius } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { haptics } from '@/utils/haptics';

interface SearchResultGroupRowProps {
  group: SearchResultGroup;
  /** See resultTrackerLabel — true when every result shares one siteUrl. */
  isAggregatedSource: boolean;
  /** The row's own + on a group of 2+; adds every source together. */
  onAddGroup: (group: SearchResultGroup) => void;
  /** + on a single result: the lone row of a group of one, or one expanded member. */
  onAddResult: (result: SearchResult) => void;
  /** `group` is passed only for a group of 2+, so the parent can offer a group add. */
  onLongPress: (result: SearchResult, group?: SearchResultGroup) => void;
  onOpenLink: (url: string) => void;
  onCopyUrl: (url: string) => void;
  /** fileUrl of the result currently being added, if any (drives the spinner). */
  addingUrl: string | null;
  isInCart: (fileUrl: string) => boolean;
  onToggleCart: (result: SearchResult) => void;
}

export function SearchResultGroupRow({
  group,
  isAggregatedSource,
  onAddGroup,
  onAddResult,
  onLongPress,
  onOpenLink,
  onCopyUrl,
  addingUrl,
  isInCart,
  onToggleCart,
}: SearchResultGroupRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const { primary } = group;

  if (group.sourceCount < 2) {
    return (
      <SearchResultRow
        result={primary}
        isAggregatedSource={isAggregatedSource}
        onAdd={onAddResult}
        onLongPress={(result) => onLongPress(result)}
        onOpenLink={onOpenLink}
        onCopyUrl={onCopyUrl}
        isAdding={addingUrl === primary.fileUrl}
        inCart={isInCart(primary.fileUrl)}
        onToggleCart={onToggleCart}
      />
    );
  }

  const footer = (
    <View>
      <TouchableOpacity
        onPress={() => {
          haptics.light();
          setSourcesOpen((open) => !open);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          sourcesOpen ? t('screens.search.collapseSources') : t('screens.search.expandSources')
        }
        accessibilityState={{ expanded: sourcesOpen }}
        style={[
          styles.sourcesChip,
          { backgroundColor: colors.background, borderColor: colors.surfaceOutline },
        ]}
        activeOpacity={0.7}
      >
        <Ionicons name="layers-outline" size={14} color={colors.primary} />
        <Text style={[styles.sourcesChipText, { color: colors.text }]} numberOfLines={1}>
          {t('screens.search.sourcesCount', { count: group.sourceCount })}
        </Text>
        <Ionicons
          name={sourcesOpen ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {sourcesOpen &&
        group.members.map((member) => (
          <SourceRow
            key={member.fileUrl}
            member={member}
            showName={member.fileName !== primary.fileName}
            isAggregatedSource={isAggregatedSource}
            isAdding={addingUrl === member.fileUrl}
            inCart={isInCart(member.fileUrl)}
            onAdd={onAddResult}
            onToggleCart={onToggleCart}
          />
        ))}
    </View>
  );

  return (
    <SearchResultRow
      result={primary}
      isAggregatedSource={isAggregatedSource}
      onAdd={() => onAddGroup(group)}
      onLongPress={(result) => onLongPress(result, group)}
      onOpenLink={onOpenLink}
      onCopyUrl={onCopyUrl}
      isAdding={addingUrl === primary.fileUrl}
      inCart={isInCart(primary.fileUrl)}
      onToggleCart={onToggleCart}
      footer={footer}
    />
  );
}

// ───────────────────────────────────────────────────────────── SourceRow ─────

interface SourceRowProps {
  member: SearchResult;
  /** Show the member's own title — only worth it when it differs from the primary's. */
  showName: boolean;
  isAggregatedSource: boolean;
  isAdding: boolean;
  inCart: boolean;
  onAdd: (result: SearchResult) => void;
  onToggleCart: (result: SearchResult) => void;
}

function SourceRow({
  member,
  showName,
  isAggregatedSource,
  isAdding,
  inCart,
  onAdd,
  onToggleCart,
}: SourceRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const seeders = Math.max(0, member.nbSeeders ?? 0);
  const leechers = Math.max(0, member.nbLeechers ?? 0);
  const label = resultTrackerLabel(member, isAggregatedSource) || '—';

  return (
    <View style={[styles.sourceRow, { borderTopColor: colors.surfaceOutline }]}>
      <View style={styles.sourceBody}>
        <Text style={[styles.sourceLabel, { color: colors.text }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.sourceMeta, { color: colors.textSecondary }]} numberOfLines={1}>
          <Text style={{ color: colors.success }}>↑{seeders}</Text>
          {`  ·  ↓${leechers}  ·  ${formatSize(member.fileSize)}`}
        </Text>
        {showName ? (
          <Text style={[styles.sourceMeta, { color: colors.textSecondary }]} numberOfLines={1}>
            {member.fileName}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={() => {
          haptics.medium();
          onAdd(member);
        }}
        disabled={isAdding}
        accessibilityLabel={t('screens.search.addToQueue')}
        style={[
          styles.sourceButton,
          { backgroundColor: isAdding ? colors.surfaceOutline : colors.primary },
        ]}
        activeOpacity={0.7}
      >
        {isAdding ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Ionicons name="add" size={18} color="#FFFFFF" />
        )}
      </TouchableOpacity>

      {member.fileUrl ? (
        <TouchableOpacity
          onPress={() => {
            haptics.selection();
            onToggleCart(member);
          }}
          accessibilityLabel={
            inCart ? t('screens.search.removeFromCart') : t('screens.search.addToCart')
          }
          accessibilityState={{ selected: inCart }}
          style={[
            styles.sourceButton,
            styles.sourceCartButton,
            {
              backgroundColor: inCart ? colors.primaryOpac : colors.background,
              borderColor: inCart ? colors.primary : colors.surfaceOutline,
            },
          ]}
          activeOpacity={0.7}
        >
          <Ionicons
            name={inCart ? 'cart' : 'cart-outline'}
            size={16}
            color={inCart ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ────────────────────────────────────────────────────────────── styles ───────

const styles = StyleSheet.create({
  sourcesChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 0.5,
  },
  sourcesChipText: {
    ...typography.captionSemibold,
    letterSpacing: 0.2,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sourceBody: {
    flex: 1,
    minWidth: 0,
  },
  sourceLabel: {
    ...typography.captionSemibold,
  },
  sourceMeta: {
    ...typography.caption,
    marginTop: 2,
  },
  sourceButton: {
    width: 30,
    height: 30,
    borderRadius: borderRadius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceCartButton: {
    borderWidth: 0.5,
  },
});
