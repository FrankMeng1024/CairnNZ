export function queryWebShapeSourcePressFeatures(
  map: any,
  point: { x: number; y: number },
  layerIds: string[],
  sourceId: string,
): any[] {
  if (!map?.queryRenderedFeatures) return [];
  const existingLayers = layerIds.filter(layerId => map.getLayer?.(layerId));
  if (existingLayers.length === 0) return [];
  try {
    return map.queryRenderedFeatures(point, { layers: existingLayers })
      .filter((feature: any) => String(feature?.source ?? '') === sourceId);
  } catch {
    return [];
  }
}
