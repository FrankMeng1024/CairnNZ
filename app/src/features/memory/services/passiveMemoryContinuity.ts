import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type MotionDecision,
  type RealGpsContinuityState,
  type RealGpsObservation,
} from '../../activity/realGpsContinuity';

export interface PassiveMemoryContinuityResult {
  state: RealGpsContinuityState;
  decision: MotionDecision;
  accepted: RealGpsObservation[];
  qualifiedPosition: { lat: number; lng: number; t: number } | null;
}

export function createPassiveMemoryContinuityState(): RealGpsContinuityState {
  return createRealGpsContinuityState();
}

/** Passive Memory shares Activity's physical evidence classifier, but only
 * accepted observations become 30 m exploration footprints. REFINE may move
 * the qualified puck inside a stationary cluster without painting new area. */
export function reducePassiveMemoryObservation(
  state: RealGpsContinuityState,
  observation: RealGpsObservation,
  receiptAtMs = Date.now(),
): PassiveMemoryContinuityResult {
  const decision = evaluateRealGpsObservation(state, observation, 'hiking', receiptAtMs);
  if (decision.kind !== 'ACCEPT') {
    return {
      state: decision.state,
      decision,
      accepted: [],
      qualifiedPosition: decision.kind === 'REFINE'
        ? decision.state.positionEstimate
        : decision.state.liveCoordinate
          ? {
              ...decision.state.liveCoordinate,
              // A rejected raw observation advances the ordering watermark,
              // but it never acquires provenance for the last trusted
              // coordinate. Preserve the trusted timestamp end-to-end.
              t: decision.state.lastTrusted?.t
                ?? decision.state.positionEstimate?.t
                ?? observation.t,
            }
          : null,
    };
  }
  const promoted = decision.confirmedCandidates
    ?? (decision.confirmedCandidate ? [decision.confirmedCandidate] : []);
  const accepted = [...promoted, observation];
  let nextState = decision.state;
  for (const point of accepted) {
    nextState = acceptRealGpsObservation(nextState, point, 'passive-memory').state;
  }
  return {
    state: nextState,
    decision,
    accepted,
    qualifiedPosition: nextState.liveCoordinate
      ? { ...nextState.liveCoordinate, t: nextState.lastTrusted?.t ?? observation.t }
      : null,
  };
}
