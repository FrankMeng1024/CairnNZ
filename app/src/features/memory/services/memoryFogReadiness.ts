export function memoryFogPaintEvidenceReady(input: {
  hasRenderedLayerProbe: boolean;
  exactLayersRendered: boolean;
  fullyRenderedFrame: boolean;
  sourcesLoaded: boolean;
}): boolean {
  // Web can inspect the pixels/features belonging to the exact Fog authority;
  // a worker's `sourceLoaded` flag alone may still describe the previous data
  // during a warm viewport, account, selection, or revocation replacement.
  if (input.hasRenderedLayerProbe) return input.exactLayersRendered;
  // Native lacks queryRenderedFeatures on the imperative adapter. It must
  // therefore cross both boundaries: the correlated geometry is committed,
  // and Mapbox subsequently reports a fully rendered frame.
  return input.fullyRenderedFrame && input.sourcesLoaded;
}
