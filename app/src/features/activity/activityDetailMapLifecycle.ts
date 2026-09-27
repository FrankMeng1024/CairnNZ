export interface ActivityDetailMapLifecycle {
  geometryIdentity: string | null;
  styleGeneration: number;
  styleReady: boolean;
  mapReady: boolean;
}

export type ActivityDetailMapEvent =
  | { type: 'geometry'; identity: string }
  | { type: 'map-will-load' }
  | { type: 'style-ready' }
  | { type: 'map-ready' }
  | { type: 'app-resume' };

export const initialActivityDetailMapLifecycle: ActivityDetailMapLifecycle = {
  geometryIdentity: null,
  styleGeneration: 0,
  styleReady: false,
  mapReady: false,
};

/** Event-driven native map binding model. No timeout is route authority. */
export function reduceActivityDetailMapLifecycle(
  state: ActivityDetailMapLifecycle,
  event: ActivityDetailMapEvent,
): ActivityDetailMapLifecycle {
  switch (event.type) {
    case 'geometry':
      return { ...state, geometryIdentity: event.identity };
    case 'map-will-load':
      return { ...state, styleReady: false, mapReady: false };
    case 'style-ready':
      return { ...state, styleReady: true, styleGeneration: state.styleGeneration + 1 };
    case 'map-ready':
      return { ...state, styleReady: true, mapReady: true };
    case 'app-resume':
      return { ...state, styleGeneration: state.styleGeneration + 1 };
  }
}

export function activityDetailMapBindingIdentity(
  geometryIdentity: string,
  styleGeneration: number,
): string {
  return `${geometryIdentity}-style-${styleGeneration}`;
}

export function activityDetailMapNeedsCameraFit(
  state: ActivityDetailMapLifecycle,
  lastFitIdentity: string | null,
): boolean {
  if (!state.geometryIdentity || !state.mapReady) return false;
  return activityDetailMapBindingIdentity(state.geometryIdentity, state.styleGeneration) !== lastFitIdentity;
}
