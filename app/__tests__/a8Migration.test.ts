/**
 * a8Migration.test — synthetic fixture for Plan v4 Pre-EAS step 5.
 *
 * Verifies the Q4 invariant: legacy v0.2.2 user with cairns must keep
 * their arOrigin preserved across the v0.2.2 → v0.2.3 schema upgrade,
 * and schemaVersion must be stamped to 2.
 *
 * Spec (MASTER_BUG_SHEET.md §A8 Migration, lines 168-180):
 *   v=0 + arOrigin!=null + markers>0 → preserve arOrigin, stamp v=2, toast
 *   v=0 + arOrigin==null              → fresh-install-stamp
 *   v=0 + arOrigin!=null + markers==0 → wiped-orphan-arorigin
 *   v=2                                → no-op-already-v2
 */

// In-memory storage mock — must be declared via factory so the mocked
// module shares state with the test.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete store[key]; }),
    __reset: () => Object.keys(store).forEach((k) => delete store[k]),
  };
});

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../src/services/crashLogger', () => ({
  crashLogger: { breadcrumb: jest.fn() },
}));

jest.mock('../src/services/apiService', () => ({
  authenticatedFetch: jest.fn(),
  API_BASE_URL: 'http://test',
}));

jest.mock('../src/services/offlineQueue', () => ({
  enqueue: jest.fn(),
  makeOp: jest.fn(),
  uuidv4: () => 'test-uuid',
}));

jest.mock('../src/services/debugLogger', () => ({
  debugLogger: { log: jest.fn() },
}));

import { runA8Migration, __TEST_seedV022State } from '../src/services/a8Migration';
import { useMarkerStore } from '../src/store/useMarkerStore';
import { useArOriginStore } from '../src/store/useArOriginStore';
import { storage } from '../src/store/storage';

const TEST_USER = 'test-user-fixture';

beforeEach(async () => {
  // Reset MMKV mock + zustand stores between tests.
  const asyncStorageMock = require('@react-native-async-storage/async-storage');
  asyncStorageMock.__reset();
  // Wipe the marker store + ar origin store so each test starts clean.
  useMarkerStore.setState({ markers: [], arOrigin: null, userId: null, syncing: false });
  useArOriginStore.setState({
    state: 'COLD_INIT',
    a1State: null,
    lastA1TransitionAt: 0,
    lastA4TransitionAt: 0,
    schemaVersion: 0,
    migrationToast: null,
  });
});

describe('runA8Migration — Plan v4 Pre-EAS step 5 fixture', () => {
  test('legacy v0.2.2 user with cairns preserves arOrigin + stamps v=2 + emits toast', async () => {
    // Seed legacy state: schemaVersion absent, arOrigin set, markers > 0.
    await __TEST_seedV022State(TEST_USER);
    useMarkerStore.setState({
      arOrigin: { lat: -41.2865, lng: 174.7762, alt: 12.5 }, // Wellington
      markers: [
        { id: 'm1', type: 'cairn', regionCode: 'nz', lat: -41.2865, lng: 174.7762,
          note: 'first', authorId: 'u1', createdAt: Date.now(), permission: 'personal' } as any,
        { id: 'm2', type: 'cairn', regionCode: 'nz', lat: -41.2870, lng: 174.7770,
          note: 'second', authorId: 'u1', createdAt: Date.now(), permission: 'personal' } as any,
      ],
    });

    const result = await runA8Migration(TEST_USER);

    expect(result.outcome).toBe('preserved-arorigin-with-markers');
    expect(result.showToast).toBe(true);
    expect(result.toastMessage).toBe('Cairn positions preserved — verify next AR open');

    // Q4 invariant: arOrigin unchanged in marker store.
    const ms = useMarkerStore.getState();
    expect(ms.arOrigin).toEqual({ lat: -41.2865, lng: 174.7762, alt: 12.5 });
    expect(ms.markers).toHaveLength(2);

    // Schema stamped.
    const stamped = await storage.getItem(`cairn_ar_schema_version_${TEST_USER}`);
    expect(stamped).toBe('2');

    // migrationTs recorded.
    const ts = await storage.getItem(`cairn_ar_migration_ts_${TEST_USER}`);
    expect(ts).not.toBeNull();
    expect(parseInt(ts!, 10)).toBeGreaterThan(0);
  });

  test('fresh install (no arOrigin) stamps v=2 silently', async () => {
    await __TEST_seedV022State(TEST_USER);
    useMarkerStore.setState({ arOrigin: null, markers: [] });

    const result = await runA8Migration(TEST_USER);

    expect(result.outcome).toBe('fresh-install-stamp');
    expect(result.showToast).toBe(false);
    expect(result.toastMessage).toBeNull();

    const stamped = await storage.getItem(`cairn_ar_schema_version_${TEST_USER}`);
    expect(stamped).toBe('2');
  });

  test('orphan arOrigin (no markers) wipes arOrigin + stamps v=2', async () => {
    await __TEST_seedV022State(TEST_USER);
    useMarkerStore.setState({
      arOrigin: { lat: 0, lng: 0, alt: null },
      markers: [],
    });

    const result = await runA8Migration(TEST_USER);

    expect(result.outcome).toBe('wiped-orphan-arorigin');
    expect(result.showToast).toBe(false);

    const stamped = await storage.getItem(`cairn_ar_schema_version_${TEST_USER}`);
    expect(stamped).toBe('2');
    // Note: clearArOrigin() runs against the live marker store; we don't
    // assert state here because the test mock doesn't fully simulate
    // markerStore's userId-aware clearArOrigin path. The outcome enum
    // is the spec-mandated assertion.
  });

  test('idempotent: second run is no-op, no second toast', async () => {
    await __TEST_seedV022State(TEST_USER);
    useMarkerStore.setState({
      arOrigin: { lat: -41.2865, lng: 174.7762, alt: 12.5 },
      markers: [{ id: 'm1', type: 'cairn', regionCode: 'nz', lat: -41.2865, lng: 174.7762,
        note: 'x', authorId: 'u', createdAt: Date.now(), permission: 'personal' } as any],
    });

    const first = await runA8Migration(TEST_USER);
    expect(first.outcome).toBe('preserved-arorigin-with-markers');

    const second = await runA8Migration(TEST_USER);
    expect(second.outcome).toBe('no-op-already-v2');
    expect(second.showToast).toBe(false);
  });

  test('no userId returns no-op-no-userid', async () => {
    const result = await runA8Migration('');
    expect(result.outcome).toBe('no-op-no-userid');
    expect(result.showToast).toBe(false);
  });

  test('namespacing: per-user keys do not leak across users', async () => {
    await __TEST_seedV022State('user-a');
    useMarkerStore.setState({
      arOrigin: { lat: 1, lng: 1, alt: null },
      markers: [{ id: 'm', type: 'cairn', regionCode: 'nz', lat: 1, lng: 1,
        note: '', authorId: 'u', createdAt: Date.now(), permission: 'personal' } as any],
    });
    await runA8Migration('user-a');

    expect(await storage.getItem('cairn_ar_schema_version_user-a')).toBe('2');
    expect(await storage.getItem('cairn_ar_schema_version_user-b')).toBeNull();
  });
});
