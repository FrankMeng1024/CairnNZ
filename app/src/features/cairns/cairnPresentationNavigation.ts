import { authenticatedFetch } from '../../services/apiService';
import { useAppStore } from '../../store/useAppStore';

export type CairnPresentationDestination = {
  markerId: string;
  revisionId: string;
  eventId: string;
};

async function resolveGroup(viewerId: string, groupId: string): Promise<CairnPresentationDestination[]> {
  const response = await authenticatedFetch(
    `/api/cairn-memory/presentation/${encodeURIComponent(groupId)}/items`,
    { expectedUserId: viewerId, skipLogoutOn401: true },
  );
  if (!response.ok) throw new Error(`presentation_group_unavailable_${response.status}`);
  const body = await response.json();
  if (String(useAppStore.getState().user?.id ?? '') !== viewerId) {
    throw new Error('presentation_account_changed');
  }
  const exact = Array.isArray(body?.items) ? body.items.flatMap((item: any) => {
    const markerId = String(item?.marker_id ?? '');
    const revisionId = String(item?.revision_id ?? '');
    const eventId = String(item?.event_id ?? '');
    return /^\d+$/.test(markerId) && /^\d+$/.test(revisionId) && /^\d+$/.test(eventId)
      ? [{ markerId, revisionId, eventId }] : [];
  }) : [];
  if (exact.length) return exact;
  // Backward-compatible read during a rolling backend/client update. This is
  // suitable for the ordinary in-app group list, but notification callers
  // explicitly require exact event revision identity and reject this fallback.
  return (Array.isArray(body?.marker_ids) ? body.marker_ids : []).flatMap((id: unknown) => {
    const markerId = String(id);
    return /^\d+$/.test(markerId) ? [{ markerId, revisionId: '', eventId: '' }] : [];
  });
}

export async function resolveCairnPresentationDestinations(
  viewerId: string,
  groupIds: readonly string[],
  options: { requireExactRevision?: boolean } = {},
): Promise<CairnPresentationDestination[]> {
  const uniqueGroupIds = [...new Set(groupIds.map(String).filter(id => /^\d+$/.test(id)))];
  if (!viewerId || uniqueGroupIds.length === 0) throw new Error('presentation_group_required');
  const results: CairnPresentationDestination[] = [];
  for (const groupId of uniqueGroupIds) {
    if (String(useAppStore.getState().user?.id ?? '') !== viewerId) {
      throw new Error('presentation_account_changed');
    }
    results.push(...await resolveGroup(viewerId, groupId));
  }
  if (String(useAppStore.getState().user?.id ?? '') !== viewerId) {
    throw new Error('presentation_account_changed');
  }
  const destinations = [...new Map(results.map(item => [`${item.markerId}:${item.revisionId}`, item])).values()];
  if (destinations.length === 0) throw new Error('presentation_group_empty');
  if (options.requireExactRevision && destinations.some(item => !item.revisionId || !item.eventId)) {
    throw new Error('presentation_exact_revision_unavailable');
  }
  return destinations;
}

export async function resolveCairnPresentationItems(
  viewerId: string,
  groupIds: readonly string[],
): Promise<string[]> {
  const uniqueGroupIds = [...new Set(groupIds.map(String).filter(id => /^\d+$/.test(id)))];
  if (!viewerId || uniqueGroupIds.length === 0) throw new Error('presentation_group_required');
  const destinations = await resolveCairnPresentationDestinations(viewerId, uniqueGroupIds);
  const markerIds = [...new Set(destinations.map(item => item.markerId))];
  if (markerIds.length === 0) throw new Error('presentation_group_empty');
  return markerIds;
}
