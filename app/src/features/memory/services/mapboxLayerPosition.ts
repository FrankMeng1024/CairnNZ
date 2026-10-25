export type WebLayerPositionResult = 'waiting' | 'already-ordered' | 'moved';

/**
 * Reconcile one RNMapbox-style relative layer position against the live GL
 * style. This is deliberately synchronous and idempotent so the same rule can
 * be applied after late mounts, remounts and every styledata/style reload.
 */
export function reconcileWebLayerPosition(
  map: any,
  id: string,
  aboveLayerID?: string,
  belowLayerID?: string,
): WebLayerPositionResult {
  const anchorID = belowLayerID ?? aboveLayerID;
  if (!anchorID || !map?.getLayer?.(id) || !map.getLayer?.(anchorID)) return 'waiting';
  const layers = map.getStyle?.()?.layers ?? [];
  const layerIndex = layers.findIndex((layer: any) => layer.id === id);
  const anchorIndex = layers.findIndex((layer: any) => layer.id === anchorID);
  if (layerIndex < 0 || anchorIndex < 0) return 'waiting';
  if (belowLayerID) {
    if (layerIndex < anchorIndex) return 'already-ordered';
    map.moveLayer(id, anchorID);
    return 'moved';
  }
  if (layerIndex > anchorIndex) return 'already-ordered';
  map.moveLayer(id);
  return 'moved';
}
