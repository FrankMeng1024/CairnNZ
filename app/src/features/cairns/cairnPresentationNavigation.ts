import { authenticatedFetch } from '../../services/apiService';
import { useAppStore } from '../../store/useAppStore';

export async function resolveCairnPresentationItems(
  viewerId: string,
  groupIds: readonly string[],
): Promise<string[]> {
  const uniqueGroupIds = [...new Set(groupIds.map(String).filter(id => /^\d+$/.test(id)))];
  if (!viewerId || uniqueGroupIds.length === 0) throw new Error('presentation_group_required');
  const results = await Promise.all(uniqueGroupIds.map(async groupId => {
    const response = await authenticatedFetch(
      `/api/cairn-memory/presentation/${encodeURIComponent(groupId)}/items`,
      { expectedUserId: viewerId, skipLogoutOn401: true },
    );
    if (!response.ok) throw new Error(`presentation_group_unavailable_${response.status}`);
    const body = await response.json();
    return Array.isArray(body?.marker_ids) ? body.marker_ids.map(String) : [];
  }));
  if (String(useAppStore.getState().user?.id ?? '') !== viewerId) {
    throw new Error('presentation_account_changed');
  }
  const markerIds = [...new Set(results.flat().filter(id => /^\d+$/.test(id)))];
  if (markerIds.length === 0) throw new Error('presentation_group_empty');
  return markerIds;
}
