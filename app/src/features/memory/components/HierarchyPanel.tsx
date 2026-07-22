/**
 * HierarchyPanel — v434 (2-layer World→Country→City, no drill)
 *
 * Simple tree navigation:
 *   Title = 'World' | some country name
 *   List  = title's children (countries if title=World, cities if title=country)
 *   ↑     = go up one level (country → World). Hidden at world layer.
 *
 * Green rule:
 *   The item matching "user's current map center region" is green.
 *   `is_here` is computed on server from currentCityId (country layer)
 *   or currentCountryId (world layer). Client only renders.
 *
 * Actions:
 *   - Tap city (country layer): parent flies map + refetches with new here_city_id
 *   - Tap country (world layer): parent switches title to that country. NO fly.
 *   - Tap ↑: parent sets title = 'world'.
 *
 * Rows:
 *   marked = solid sepia dot
 *   walked = hollow sepia dot
 *   is_here (any state) overrides → green solid dot
 *   NO right-side count numbers on any row
 *   Locked (not in items) collapsed to single "N more locked" grey row
 *
 * Legend at bottom: Marked / Walked (no Never/Friends)
 *
 * Empty state (title=World, no items, no memory): encouragement banner.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Pressable,
  ScrollView,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Colors, Radius, FontSize } from '../../../components/tokens';
import { MemoryColors } from '../config/memoryConfig';
import { Icon } from '../../../components/Icon';
import { fetchPanelData, type PanelData, type PanelItem } from '../services/hierarchyService';

interface Props {
  titleId: string;                           // 'world' or a country id
  currentCityId: string | null;              // used for is_here on country layer
  currentCountryId: string | null;           // used for is_here on world layer
  onSelectItem: (
    itemId: string,
    itemType: 'city' | 'country',
    bbox: [number, number, number, number],
  ) => void;
  onGoUp: () => void;                        // → parent sets title='world'
  onClose: () => void;
}

const LIST_MAX_HEIGHT = 260;
const SCROLL_HINT_THRESHOLD = 6;
const PANEL_WIDTH = 236;

export function HierarchyPanel({
  titleId,
  currentCityId,
  currentCountryId,
  onSelectItem,
  onGoUp,
  onClose,
}: Props) {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);

  // Fetch on any change of titleId or here-ids
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPanelData(titleId, currentCityId, currentCountryId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setError('Could not load region info');
        } else {
          setData(d);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Network error');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [titleId, currentCityId, currentCountryId]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const nearBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - SCROLL_HINT_THRESHOLD;
    setShowScrollHint(!nearBottom);
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    const scrollable = h > LIST_MAX_HEIGHT - 1;
    setIsScrollable(scrollable);
    setShowScrollHint(scrollable);
  }, []);

  // Sort items: is_here first (green), then marked (desc), then walked (alpha)
  const sortedItems: PanelItem[] = data
    ? [
        ...data.items.filter((it) => it.is_here),
        ...data.items
          .filter((it) => !it.is_here && it.state === 'marked')
          .sort((a, b) => a.name_en.localeCompare(b.name_en)),
        ...data.items
          .filter((it) => !it.is_here && it.state === 'walked')
          .sort((a, b) => a.name_en.localeCompare(b.name_en)),
      ]
    : [];

  const isWorldLayer = data?.title.id === 'world';
  const itemType: 'city' | 'country' = isWorldLayer ? 'country' : 'city';

  // Empty state: World layer with no items + no locked = fresh user
  //  (Actually a fresh user has locked_count = ~214 total countries, so
  //   the "empty banner" condition should be: items.length===0 regardless
  //   of locked_count. But we prefer to show banner only in true first-open
  //   case: items empty AND at world layer.)
  const showEmptyBanner =
    data !== null && !error && isWorldLayer && data.items.length === 0;

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} testID="hierarchy-backdrop" />
      <Animated.View style={styles.panel} pointerEvents="box-none" testID="hierarchy-panel">
        {/* Header: title + ↑ button (hidden at world) */}
        <View style={styles.header}>
          <Text
            style={styles.title}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            testID="hierarchy-title"
          >
            {data?.title.name_en ?? 'Loading…'}
          </Text>
          {data?.parent ? (
            <TouchableOpacity
              style={styles.upBtn}
              onPress={onGoUp}
              activeOpacity={0.7}
              accessibilityLabel="Go up"
              testID="hierarchy-up-btn"
            >
              <Icon name="ArrowUp" size={16} color={Colors.primary} strokeWidth={2.5} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Body */}
        {loading && !data ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        ) : error && !data ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : data ? (
          <View style={[styles.listContainer, loading && styles.stale]}>
            {showEmptyBanner ? (
              <View style={styles.emptyBanner} testID="hierarchy-empty-banner">
                <Text style={styles.emptyBannerText}>
                  Head out and start walking to unlock places.
                </Text>
              </View>
            ) : null}
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onContentSizeChange={onContentSizeChange}
              showsVerticalScrollIndicator
              nestedScrollEnabled
            >
              {sortedItems.map((item) => {
                const isHere = item.is_here;
                return (
                  <TouchableOpacity
                    key={item.id}
                    testID={`hierarchy-row-${item.id}`}
                    accessibilityState={{ selected: isHere }}
                    style={[styles.row, isHere && styles.rowHere]}
                    onPress={() => onSelectItem(item.id, itemType, item.bbox)}
                    activeOpacity={0.6}
                  >
                    <View
                      style={[
                        styles.dot,
                        isHere ? styles.dotHere
                          : item.state === 'marked' ? styles.dotMarked
                          : styles.dotWalked,
                      ]}
                    />
                    <Text
                      style={[styles.rowName, isHere && styles.rowNameHere]}
                      numberOfLines={2}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                    >
                      {item.name_en}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {isScrollable && showScrollHint ? (
              <View style={styles.scrollHint} pointerEvents="none">
                <Text style={styles.scrollHintText}>▼ more</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Locked summary row */}
        {data && !error && data.locked_count > 0 && !showEmptyBanner ? (
          <View style={styles.lockedSummary} testID="hierarchy-locked-summary">
            <View style={[styles.dot, styles.dotLocked]} />
            <Text style={styles.lockedSummaryText}>
              {data.locked_count} more locked
            </Text>
          </View>
        ) : null}

        {/* Legend: Marked / Walked */}
        {data && !error && !showEmptyBanner ? (
          <View style={styles.legend} testID="hierarchy-legend">
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.dotMarked]} />
              <Text style={styles.legendText}>Marked</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, styles.dotWalked]} />
              <Text style={styles.legendText}>Walked</Text>
            </View>
          </View>
        ) : null}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 15,
  },
  panel: {
    position: 'absolute',
    left: '50%',
    bottom: 168,
    marginLeft: -(PANEL_WIDTH / 2),
    width: PANEL_WIDTH,
    backgroundColor: '#fff',
    borderRadius: Radius.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 12,
    zIndex: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f2ede2',
  },
  title: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
    lineHeight: 20,
    flex: 1,
  },
  upBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f5efe4',
    flexShrink: 0,
  },
  loading: { padding: 24, alignItems: 'center' },
  errorBox: { padding: 16, alignItems: 'center' },
  errorText: { fontSize: FontSize.small, color: '#a89a82', textAlign: 'center' },
  listContainer: { position: 'relative' },
  list: { maxHeight: LIST_MAX_HEIGHT },
  listContent: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#faf7f0',
  },
  rowHere: { backgroundColor: 'rgba(93,124,70,0.06)' },
  rowName: {
    flex: 1,
    fontSize: FontSize.body - 0.5,
    lineHeight: 18,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  rowNameHere: { color: Colors.primary, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  dotHere: { backgroundColor: Colors.primary },
  dotMarked: { backgroundColor: MemoryColors.sepia },
  dotWalked: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: MemoryColors.sepia,
  },
  dotLocked: { backgroundColor: '#d5cdba' },
  lockedSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f2ede2',
    backgroundColor: '#fbf8f1',
  },
  lockedSummaryText: {
    flex: 1,
    fontSize: FontSize.small,
    color: '#a89a82',
    fontStyle: 'italic',
  },
  scrollHint: {
    position: 'absolute',
    bottom: 4, left: 0, right: 0,
    alignItems: 'center',
  },
  scrollHintText: {
    fontSize: FontSize.tiny,
    color: '#a89a82',
    letterSpacing: 0.5,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  emptyBanner: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f5efe4',
    borderBottomWidth: 1,
    borderBottomColor: '#f2ede2',
  },
  emptyBannerText: {
    fontSize: FontSize.small,
    color: '#7a6f5f',
    textAlign: 'center',
    lineHeight: 18,
  },
  stale: { opacity: 0.5 },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#f2ede2',
    backgroundColor: '#fbf8f1',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    fontSize: FontSize.tiny + 0.5,
    color: '#7a6f5f',
    letterSpacing: 0.2,
  },
});

export default HierarchyPanel;
