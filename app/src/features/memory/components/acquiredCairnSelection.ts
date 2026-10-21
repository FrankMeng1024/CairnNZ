import { clusterLeavesShareLocation, loadAllClusterLeaves } from './acquiredCairnClusters';

interface SelectionCallbacks {
  currentViewerId: () => string | null;
  onOpenSingle: (markerId: string) => void;
  onOpenGroup: (markerIds: string[]) => void;
  onExpandCluster: (center: [number, number], zoom: number) => void;
  onClusterError?: () => void;
}

export function createAcquiredCairnSelectionController() {
  let generation = 0;

  const invalidate = () => {
    generation += 1;
  };

  const select = async (
    event: any,
    source: any,
    requestedViewerId: string | null,
    callbacks: SelectionCallbacks,
  ) => {
    const request = ++generation;
    const ownsIntent = () => (
      request === generation && callbacks.currentViewerId() === requestedViewerId
    );
    const feature = event?.features?.[0];
    if (!feature || !ownsIntent()) return;
    const openFeatures = (features: any[]) => {
      if (!ownsIntent()) return;
      const markerIds = features
        .map(item => String(item?.properties?.markerId ?? ''))
        .filter(Boolean);
      if (markerIds.length === 1) callbacks.onOpenSingle(markerIds[0]);
      else if (markerIds.length > 1) callbacks.onOpenGroup(markerIds);
    };
    const clusterCount = Number(feature?.properties?.point_count ?? 0);
    if (!clusterCount) {
      openFeatures([feature]);
      return;
    }
    try {
      const leaves = await loadAllClusterLeaves(source, feature, clusterCount);
      if (!ownsIntent()) return;
      if (leaves.length !== clusterCount) throw new Error('incomplete_cluster_membership');
      if (clusterLeavesShareLocation(leaves)) {
        openFeatures(leaves);
        return;
      }
      const zoom = Number(await source?.getClusterExpansionZoom?.(feature));
      if (!ownsIntent()) return;
      const center = feature?.geometry?.coordinates;
      if (!Array.isArray(center) || !Number.isFinite(center[0]) || !Number.isFinite(center[1]) || !Number.isFinite(zoom)) {
        throw new Error('cluster_expansion_unavailable');
      }
      callbacks.onExpandCluster([Number(center[0]), Number(center[1])], zoom);
    } catch {
      if (ownsIntent()) callbacks.onClusterError?.();
    }
  };

  return { invalidate, select };
}
