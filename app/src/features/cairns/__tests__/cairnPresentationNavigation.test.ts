const mockFetch = jest.fn();
let mockOwnerId = 'viewer-a';

jest.mock('../../../services/apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockFetch(...args),
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: mockOwnerId ? { id: mockOwnerId } : null }) },
}));

import { resolveCairnPresentationItems } from '../cairnPresentationNavigation';

const response = (markerIds: string[]) => ({ ok: true, json: async () => ({ marker_ids: markerIds }) });

describe('durable exact presentation navigation', () => {
  beforeEach(() => { mockFetch.mockReset(); mockOwnerId = 'viewer-a'; });

  test('resolves only exact group members and de-duplicates overlapping groups', async () => {
    mockFetch.mockResolvedValueOnce(response(['41', '42'])).mockResolvedValueOnce(response(['42', '43']));
    await expect(resolveCairnPresentationItems('viewer-a', ['7', '8', '7'])).resolves.toEqual(['41', '42', '43']);
    expect(mockFetch.mock.calls.map(([path]) => path)).toEqual([
      '/api/cairn-memory/presentation/7/items',
      '/api/cairn-memory/presentation/8/items',
    ]);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ expectedUserId: 'viewer-a', skipLogoutOn401: true });
  });

  test('fences a delayed response after account switch', async () => {
    let release!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const resolving = resolveCairnPresentationItems('viewer-a', ['7']);
    mockOwnerId = 'viewer-b';
    release(response(['41']));
    await expect(resolving).rejects.toThrow('presentation_account_changed');
  });

  test('keeps a revoked or transiently unavailable destination retryable', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 410, json: async () => ({}) });
    await expect(resolveCairnPresentationItems('viewer-a', ['7']))
      .rejects.toThrow('presentation_group_unavailable_410');
  });
});
