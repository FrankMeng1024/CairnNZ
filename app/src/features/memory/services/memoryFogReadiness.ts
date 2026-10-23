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

export function memoryFogPreparingMayClearFailure(
  failedReadinessKey: string,
  preparingReadinessKey: string,
): boolean {
  // React effects may report an already-classified cold failure before the
  // Preparing callback for the same authority. Preparing is allowed to clear
  // an older target's error, never the matching current failure.
  return !failedReadinessKey || failedReadinessKey !== preparingReadinessKey;
}

export function memoryFogTargetFailureVisible(input: {
  combinedScope: boolean;
  failure: string | null;
  targetReadinessKey: string;
  readyReadinessKey: string;
}): boolean {
  // A refresh error over the exact complete scene is non-destructive and
  // silent. A cold/new-target error needs the one central Retry state.
  return input.combinedScope
    && Boolean(input.failure)
    && Boolean(input.targetReadinessKey)
    && input.targetReadinessKey !== input.readyReadinessKey;
}
