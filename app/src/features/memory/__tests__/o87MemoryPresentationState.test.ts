import {
  DAY_VISUAL_THEME,
  NIGHT_VISUAL_THEME,
  SUNSET_VISUAL_THEME,
} from '../../../components/tokens';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import {
  memoryScopeForNewRoute,
  useMemoryScopeStore,
} from '../store/useMemoryScopeStore';
import {
  reconcileAvailableMemorySources,
  type AvailableMemorySource,
} from '../store/useMemorySubscriptionsStore';

const resolvedSource: AvailableMemorySource = {
  friend_id: '31',
  friend_name: 'frank test',
  selected: true,
  authorization_version: 7,
  effective_at: '2026-10-19T00:00:00.000Z',
  sharing_status: 'shared',
  coverage_scope: 'full_history_delayed_v1',
};

describe('O87 Memory presentation state contracts', () => {
  afterEach(() => {
    jest.useRealTimers();
    useFriendMemoryStore.getState().reset();
    useMemoryScopeStore.setState({ ownerUserId: null, scope: 'self' });
  });

  test('keeps the resolved friend name and row identity through fallback refreshes', () => {
    const blankRefresh = reconcileAvailableMemorySources(
      [resolvedSource],
      [{ ...resolvedSource, friend_name: '' }],
    );
    expect(blankRefresh[0]).toBe(resolvedSource);
    expect(blankRefresh[0].friend_name).toBe('frank test');

    const numericRefresh = reconcileAvailableMemorySources(
      blankRefresh,
      [{ ...resolvedSource, friend_name: '31' }],
    );
    expect(numericRefresh[0]).toBe(resolvedSource);
    expect(numericRefresh[0].friend_name).toBe('frank test');
  });

  test('new Route scope is a one-time snapshot fenced to the active account', () => {
    useMemoryScopeStore.setState({ ownerUserId: 'viewer-a', scope: 'combined' });
    expect(memoryScopeForNewRoute('viewer-a')).toBe('combined');
    expect(memoryScopeForNewRoute('viewer-b')).toBe('self');

    const inherited = memoryScopeForNewRoute('viewer-a');
    useMemoryScopeStore.getState().setScope('self');
    expect(inherited).toBe('combined');
  });

  test('city summaries expose only current-session authorized source versions', () => {
    const now = Date.now();
    const projection = {
      friendId: '31',
      authorizationVersion: 7,
      projectionVersion: 'projection-31-v7',
      cellSizeM: 30,
      cells: [],
      regions: [{
        id: 'pudong',
        parentId: 'shanghai',
        level: 3 as const,
        name: 'Pudong',
        bbox: [121.4, 31.1, 121.8, 31.4] as [number, number, number, number],
        anchor: [121.60231, 31.20451] as [number, number],
      }],
      serverAuthorizedAtMs: now - 1_000,
      authorizationExpiresAtMs: now + 60_000,
    };
    useFriendMemoryStore.setState({
      userId: 'viewer-a',
      projections: { '31': projection },
      authorizedSourceVersions: { '31': 7 },
      lastObservedWallClockMs: now,
    });
    expect(useFriendMemoryStore.getState().getVisibleRegions()).toEqual([
      expect.objectContaining({
        id: 'pudong',
        sourceFriendId: '31',
        authorizationVersion: 7,
        anchor: [121.60231, 31.20451],
      }),
    ]);

    // A revocation/version rotation fails closed even if the projection object
    // remains in memory until its request cancellation/purge completes.
    useFriendMemoryStore.setState({ authorizedSourceVersions: { '31': 8 } });
    expect(useFriendMemoryStore.getState().getVisibleRegions()).toEqual([]);
  });

  test('fresh sources restore matching proof and expiry fails closed without map movement', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-19T00:00:00.000Z'));
    const now = Date.now();
    const projection = {
      friendId: '31',
      authorizationVersion: 7,
      projectionVersion: 'projection-31-v7',
      cellSizeM: 30,
      cells: [],
      regions: [{
        id: 'pudong', parentId: 'shanghai', level: 3 as const, name: 'Pudong',
        bbox: [121.4, 31.1, 121.8, 31.4] as [number, number, number, number],
        anchor: [121.60231, 31.20451] as [number, number],
      }],
      serverAuthorizedAtMs: now,
      authorizationExpiresAtMs: now + 1_000,
    };
    useFriendMemoryStore.setState({
      userId: 'viewer-a',
      projections: { '31': projection },
      authorizedSourceVersions: {},
      lastObservedWallClockMs: now,
    });

    await useFriendMemoryStore.getState().reconcileAuthorizedSources([{
      friend_id: 31, authorization_version: 7, selected: true,
    }]);
    expect(useFriendMemoryStore.getState().getVisibleRegions()).toHaveLength(1);

    useFriendMemoryStore.getState().suspendVisibility();
    expect(useFriendMemoryStore.getState().getVisibleRegions()).toEqual([]);
    await useFriendMemoryStore.getState().reconcileAuthorizedSources([{
      friend_id: 31, authorization_version: 7, selected: true,
    }]);
    expect(useFriendMemoryStore.getState().getVisibleRegions()).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(1_001);
    expect(useFriendMemoryStore.getState().authorizedSourceVersions).toEqual({});
    expect(useFriendMemoryStore.getState().getVisibleRegions()).toEqual([]);
    expect(useFriendMemoryStore.getState().projections).toEqual({});
  });

  test('the originally scheduled expiry fails closed after a wall-clock rollback', async () => {
    jest.useFakeTimers();
    const authorizedAt = new Date('2026-10-19T00:00:00.000Z').getTime();
    jest.setSystemTime(authorizedAt);
    const projection = {
      friendId: '31', authorizationVersion: 7, projectionVersion: 'projection-31-v7',
      cellSizeM: 30, cells: [], regions: [], serverAuthorizedAtMs: authorizedAt,
      authorizationExpiresAtMs: authorizedAt + 1_000,
    };
    useFriendMemoryStore.setState({
      userId: 'viewer-a', projections: { '31': projection },
      authorizedSourceVersions: {}, lastObservedWallClockMs: authorizedAt,
    });
    await useFriendMemoryStore.getState().reconcileAuthorizedSources([{
      friend_id: 31, authorization_version: 7, selected: true,
    }]);
    expect(useFriendMemoryStore.getState().authorizedSourceVersions).toEqual({ '31': 7 });

    jest.setSystemTime(authorizedAt - 60_000);
    await jest.advanceTimersByTimeAsync(1_001);

    expect(useFriendMemoryStore.getState().authorizedSourceVersions).toEqual({});
    expect(useFriendMemoryStore.getState().projections).toEqual({});
  });

  test.each([DAY_VISUAL_THEME, SUNSET_VISUAL_THEME, NIGHT_VISUAL_THEME])(
    '$mode keeps Friends restrained and gives overlap Mine visual priority',
    (theme) => {
      expect(theme.mapFriendMemoryFill).not.toBe(theme.mapMineMemoryFill);
      expect(theme.mapFriendMemoryOpacity).toBeLessThanOrEqual(0.24);
      expect(theme.mapMemoryOverlapFill).toBe(theme.mapMineMemoryFill);
      expect(theme.mapMemoryOverlapOpacity).toBe(theme.mapMineMemoryOpacity);
    },
  );
});
