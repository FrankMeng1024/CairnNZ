import type { PedestrianFinalRequestResult } from '../../services/routing/pedestrianFinalRoute';
import {
  evaluateMatchedGeometryQuality,
  type MatchedGeometryQuality,
} from '../../services/routing/snapTrack';
import type { TrackPoint } from '../../store/useSessionStore';
import {
  roundSavedFinalRoadCorners,
  type SavedFinalCornerRoundingDiagnostics,
} from './savedFinalCornerRounding';

type FinalPoint = { lat: number; lng: number };

export interface FinalCandidatePromotionDecision {
  accepted: boolean;
  reason:
    | 'accepted-network-improvement'
    | 'no-network-authority'
    | 'endpoint-change'
    | 'length-regression'
    | 'edge-spike'
    | 'lost-reversal'
    | 'invented-reversal'
    | 'invented-crossing';
  canonicalReversals: number;
  currentReversals: number;
  candidateReversals: number;
  canonicalCrossings: number;
  currentCrossings: number;
  candidateCrossings: number;
  currentLengthRatio: number;
  candidateLengthRatio: number;
}

const EARTH_R = 6_371_000;
const toRad = (value: number) => value * Math.PI / 180;
const distanceM = (left: FinalPoint, right: FinalPoint) => {
  const dLat = toRad(right.lat - left.lat);
  const dLng = toRad(right.lng - left.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
};
const lengthM = (points: FinalPoint[]) => points.slice(1)
  .reduce((sum, point, index) => sum + distanceM(points[index], point), 0);
const bearing = (from: FinalPoint, to: FinalPoint) => {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  return (Math.atan2(
    Math.sin(dLng) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng),
  ) * 180 / Math.PI + 360) % 360;
};
const angleDelta = (left: number, right: number) => {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
};
const reversalCount = (points: FinalPoint[]) => {
  const headings: number[] = [];
  let anchor = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (distanceM(points[anchor], points[index]) < 3) continue;
    headings.push(bearing(points[anchor], points[index]));
    anchor = index;
  }
  return headings.slice(1).filter((value, index) => angleDelta(headings[index], value) >= 120).length;
};
const properCrossings = (points: FinalPoint[]) => {
  const cross = (a: FinalPoint, b: FinalPoint, c: FinalPoint) => (
    (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng)
  );
  let count = 0;
  for (let left = 1; left < points.length; left += 1) {
    for (let right = left + 2; right < points.length; right += 1) {
      if (left === 1 && right === points.length - 1
        && distanceM(points[0], points[points.length - 1]) < 0.1) continue;
      const [a, b, c, d] = [points[left - 1], points[left], points[right - 1], points[right]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) count += 1;
    }
  }
  return count;
};

/**
 * Compare a provider-backed candidate with both canonical truth and the
 * currently selected Local/Trend artifact. This is deliberately independent
 * from fingerprints: different geometry is not automatically better.
 */
export function decideActivityFinalCandidatePromotion(input: {
  canonical: FinalPoint[];
  current: FinalPoint[];
  candidate: FinalPoint[];
  networkMatched: boolean;
}): FinalCandidatePromotionDecision {
  const canonicalLength = lengthM(input.canonical);
  const currentLengthRatio = canonicalLength > 1 ? lengthM(input.current) / canonicalLength : 1;
  const candidateLengthRatio = canonicalLength > 1 ? lengthM(input.candidate) / canonicalLength : 1;
  const canonicalReversals = reversalCount(input.canonical);
  const currentReversals = reversalCount(input.current);
  const candidateReversals = reversalCount(input.candidate);
  const canonicalCrossings = properCrossings(input.canonical);
  const currentCrossings = properCrossings(input.current);
  const candidateCrossings = properCrossings(input.candidate);
  const result = (reason: FinalCandidatePromotionDecision['reason']): FinalCandidatePromotionDecision => ({
    accepted: reason === 'accepted-network-improvement',
    reason,
    canonicalReversals,
    currentReversals,
    candidateReversals,
    canonicalCrossings,
    currentCrossings,
    candidateCrossings,
    currentLengthRatio,
    candidateLengthRatio,
  });
  if (!input.networkMatched) return result('no-network-authority');
  if (input.canonical.length < 2 || input.current.length < 2 || input.candidate.length < 2
    || distanceM(input.canonical[0], input.candidate[0]) > 0.1
    || distanceM(input.canonical.at(-1)!, input.candidate.at(-1)!) > 0.1) return result('endpoint-change');
  const currentLengthError = Math.abs(1 - currentLengthRatio);
  const candidateLengthError = Math.abs(1 - candidateLengthRatio);
  if (candidateLengthRatio < 0.67 || candidateLengthRatio > 1.5
    || candidateLengthError > currentLengthError + 0.12) return result('length-regression');
  const canonicalMaxEdge = Math.max(0, ...input.canonical.slice(1)
    .map((point, index) => distanceM(input.canonical[index], point)));
  const currentMaxEdge = Math.max(0, ...input.current.slice(1)
    .map((point, index) => distanceM(input.current[index], point)));
  const candidateMaxEdge = Math.max(0, ...input.candidate.slice(1)
    .map((point, index) => distanceM(input.candidate[index], point)));
  if (candidateMaxEdge > Math.max(30, canonicalMaxEdge * 4, currentMaxEdge * 2)) return result('edge-spike');
  if (candidateReversals < Math.min(canonicalReversals, currentReversals)) return result('lost-reversal');
  if (candidateReversals > Math.max(canonicalReversals, currentReversals) + 1) return result('invented-reversal');
  // The provider candidate is compared with the artifact the user already
  // has, not merely with noisier canonical evidence. Never trade a cleaner
  // Local/Trend Final for a road candidate with more proper crossings.
  if (candidateCrossings > currentCrossings) return result('invented-crossing');
  return result('accepted-network-improvement');
}

export interface RoundedActivityFinalCandidateSelection {
  points: TrackPoint[];
  usedRoundedCandidate: boolean;
  fellBackToApprovedUnrounded: boolean;
  fallbackReason: string | null;
  roundingDiagnostics: SavedFinalCornerRoundingDiagnostics;
  roundedCanonicalQuality: MatchedGeometryQuality | null;
  roundedPromotion: FinalCandidatePromotionDecision | null;
}

export interface RoundedLocalFinalCandidateSelection {
  points: TrackPoint[];
  usedRoundedCandidate: boolean;
  fellBackToApprovedUnrounded: boolean;
  fallbackReason: string | null;
  roundingDiagnostics: SavedFinalCornerRoundingDiagnostics;
  roundedCanonicalQuality: MatchedGeometryQuality | null;
}

/**
 * Display-only softening for an already accepted Local/Trend Final. Road
 * authority is deliberately irrelevant here: this selector neither promotes
 * a provider candidate nor changes canonical evidence. The bounded fillet
 * must pass its local corridor/topology guards and the same canonical quality
 * gate used by matched geometry, otherwise the accepted input is retained.
 */
export function selectRoundedLocalFinalCandidate(input: {
  canonical: TrackPoint[];
  approvedUnrounded: TrackPoint[];
}): RoundedLocalFinalCandidateSelection {
  const rounded = roundSavedFinalRoadCorners(input.approvedUnrounded);
  if (rounded.diagnostics.roundedCorners === 0) {
    return {
      points: input.approvedUnrounded.map(point => ({ ...point })),
      usedRoundedCandidate: false,
      fellBackToApprovedUnrounded: rounded.diagnostics.postRoundRejected,
      fallbackReason: rounded.diagnostics.postRoundRejected
        ? `rounding-local:${rounded.diagnostics.postRoundRejectReason ?? 'rejected'}`
        : null,
      roundingDiagnostics: rounded.diagnostics,
      roundedCanonicalQuality: null,
    };
  }
  const roundedCanonicalQuality = evaluateMatchedGeometryQuality(
    input.canonical,
    rounded.points,
  );
  if (!roundedCanonicalQuality.accepted) {
    return {
      points: input.approvedUnrounded.map(point => ({ ...point })),
      usedRoundedCandidate: false,
      fellBackToApprovedUnrounded: true,
      fallbackReason: `canonical-quality:${roundedCanonicalQuality.reason}`,
      roundingDiagnostics: rounded.diagnostics,
      roundedCanonicalQuality,
    };
  }
  return {
    points: rounded.points,
    usedRoundedCandidate: true,
    fellBackToApprovedUnrounded: false,
    fallbackReason: null,
    roundingDiagnostics: rounded.diagnostics,
    roundedCanonicalQuality,
  };
}

/**
 * A road candidate reaches this boundary only after the caller has accepted
 * its unrounded geometry. Rounding is display-only and is strictly weaker
 * authority: the rounded output must pass the same canonical quality and
 * current-Final promotion gates, otherwise the approved unrounded road
 * candidate is retained verbatim.
 */
export function selectRoundedActivityFinalCandidate(input: {
  canonical: TrackPoint[];
  current: TrackPoint[];
  approvedUnrounded: TrackPoint[];
  eligibleCorners: ReadonlyArray<boolean>;
}): RoundedActivityFinalCandidateSelection {
  const rounded = roundSavedFinalRoadCorners(input.approvedUnrounded, {
    eligibleCorners: input.eligibleCorners,
  });
  if (rounded.diagnostics.roundedCorners === 0) {
    return {
      points: input.approvedUnrounded.map(point => ({ ...point })),
      usedRoundedCandidate: false,
      fellBackToApprovedUnrounded: rounded.diagnostics.postRoundRejected,
      fallbackReason: rounded.diagnostics.postRoundRejected
        ? `rounding-local:${rounded.diagnostics.postRoundRejectReason ?? 'rejected'}`
        : null,
      roundingDiagnostics: rounded.diagnostics,
      roundedCanonicalQuality: null,
      roundedPromotion: null,
    };
  }

  const roundedCanonicalQuality = evaluateMatchedGeometryQuality(
    input.canonical,
    rounded.points,
  );
  const roundedPromotion = decideActivityFinalCandidatePromotion({
    canonical: input.canonical,
    current: input.current,
    candidate: rounded.points,
    networkMatched: true,
  });
  const fallbackReason = !roundedCanonicalQuality.accepted
    ? `canonical-quality:${roundedCanonicalQuality.reason}`
    : !roundedPromotion.accepted
      ? `current-final:${roundedPromotion.reason}`
      : null;
  if (fallbackReason) {
    return {
      points: input.approvedUnrounded.map(point => ({ ...point })),
      usedRoundedCandidate: false,
      fellBackToApprovedUnrounded: true,
      fallbackReason,
      roundingDiagnostics: rounded.diagnostics,
      roundedCanonicalQuality,
      roundedPromotion,
    };
  }
  return {
    points: rounded.points,
    usedRoundedCandidate: true,
    fellBackToApprovedUnrounded: false,
    fallbackReason: null,
    roundingDiagnostics: rounded.diagnostics,
    roundedCanonicalQuality,
    roundedPromotion,
  };
}

export type ActivityFinalRefinementRequestCategory =
  | 'not-attempted'
  | 'success'
  | 'no-match'
  | 'auth'
  | 'timeout'
  | 'network'
  | 'client-error'
  | 'server-error'
  | 'mixed';

export interface RetainedLocalRefinementDecision {
  runResult: 'complete' | 'pending-network' | 'pending-retry';
  jobStatus: 'queued' | 'complete';
  jobOutcome: 'pending' | 'base-retained';
  roadEnhancementState: 'pending-network' | 'pending-retry' | 'terminal-local';
  roadRefinementPending: boolean;
  technicalOutcome: string;
  candidateDecision: string;
  requestHttpCategory: ActivityFinalRefinementRequestCategory;
  nextRetryDelayMs: number | null;
}

export interface AcceptedRefinementDecision {
  runResult: 'complete';
  jobStatus: 'complete';
  jobOutcome: 'enhanced';
  roadEnhancementState: 'accepted';
  roadRefinementPending: false;
  technicalOutcome: 'matched-success';
  candidateDecision: 'accepted';
  requestHttpCategory: ActivityFinalRefinementRequestCategory;
  nextRetryDelayMs: null;
}

function classifyRetainedLocalRoute(input: {
  deadlineReached: boolean;
  requestResults: PedestrianFinalRequestResult[];
  resultReasons: string[];
  governorAuthorized: boolean | null | undefined;
}): { technicalOutcome: string; candidateDecision: string } {
  const results = input.requestResults;
  const normalizedReasons = input.resultReasons.map(reason => reason.toLowerCase());
  if (input.deadlineReached
    || results.some(request => request.result.includes('timeout'))
    || normalizedReasons.some(reason => reason.includes('timeout') || reason.includes('abort'))) {
    return { technicalOutcome: 'deadline', candidateDecision: 'stable-local-deadline' };
  }
  if (results.some(request => request.httpStatus === 401 || request.httpStatus === 403
    || request.responseCode?.toLowerCase().includes('unauthor'))) {
    return { technicalOutcome: 'auth', candidateDecision: 'stable-local-auth-rejected' };
  }
  if (results.some(request => request.governorReason === 'budget')) {
    return { technicalOutcome: 'budget', candidateDecision: 'stable-local-governor-denied' };
  }
  if (results.some(request => request.responseCode === 'NoMatch'
    || request.result.toLowerCase().includes('no-match'))
    || normalizedReasons.some(reason => reason.includes('no_match') || reason.includes('no-match'))) {
    return { technicalOutcome: 'no-match', candidateDecision: 'stable-local-no-match' };
  }
  if (results.some(request => request.httpStatus != null && request.httpStatus >= 500)) {
    return { technicalOutcome: 'server-error', candidateDecision: 'stable-local-server-error' };
  }
  if (results.some(request => request.httpStatus != null && request.httpStatus >= 400)) {
    return { technicalOutcome: 'client-error', candidateDecision: 'stable-local-client-error' };
  }
  if (results.some(request => request.result === 'network-error')) {
    return { technicalOutcome: 'network-failure', candidateDecision: 'stable-local-network-failure' };
  }
  if (results.some(request => request.rejectedCandidateCount > 0)) {
    return { technicalOutcome: 'unsafe-candidate', candidateDecision: 'candidate-rejected' };
  }
  if (input.governorAuthorized === false) {
    return { technicalOutcome: 'governor-denied', candidateDecision: 'stable-local-governor-denied' };
  }
  if (results.some(request => request.invoked)) {
    return { technicalOutcome: 'no-meaningful-improvement', candidateDecision: 'stable-local-no-improvement' };
  }
  return { technicalOutcome: 'no-match', candidateDecision: 'stable-local-no-match' };
}

export function activityFinalRefinementRequestCategory(
  results: PedestrianFinalRequestResult[],
  technicalOutcome: string,
): ActivityFinalRefinementRequestCategory {
  if (technicalOutcome === 'deadline') return 'timeout';
  if (results.length === 0 || !results.some(result => result.invoked)) {
    if (technicalOutcome === 'network-failure') return 'network';
    if (technicalOutcome === 'no-match') return 'no-match';
    if (technicalOutcome === 'auth') return 'auth';
    return 'not-attempted';
  }
  const categories = new Set(results.filter(result => result.invoked).map(result => {
    if (result.httpStatus === 401 || result.httpStatus === 403) return 'auth';
    if (result.result.includes('timeout')) return 'timeout';
    if (result.responseCode === 'NoMatch' || result.result.includes('no-match')) return 'no-match';
    if (result.httpStatus != null && result.httpStatus >= 500) return 'server-error';
    if (result.httpStatus != null && result.httpStatus >= 400) return 'client-error';
    if (result.result === 'network-error') return 'network';
    return 'success';
  }));
  if (categories.size === 1) return [...categories][0] as ActivityFinalRefinementRequestCategory;
  return 'mixed';
}

/** Shared production/QA authority for the state of a defensible retained Local Final. */
export function decideRetainedLocalRefinement(input: {
  networkState: 'online' | 'offline';
  deadlineReached: boolean;
  requestResults: PedestrianFinalRequestResult[];
  resultReasons: string[];
  governorAuthorized: boolean | null | undefined;
  networkAttemptCount: number;
  maxNetworkAttempts?: number;
  retryDelaysMs?: readonly number[];
}): RetainedLocalRefinementDecision {
  if (input.networkState === 'offline') {
    return {
      runResult: 'pending-network',
      jobStatus: 'queued',
      jobOutcome: 'pending',
      roadEnhancementState: 'pending-network',
      roadRefinementPending: true,
      technicalOutcome: 'offline',
      candidateDecision: 'stable-local-selected',
      requestHttpCategory: 'not-attempted',
      nextRetryDelayMs: null,
    };
  }
  const retained = classifyRetainedLocalRoute(input);
  const requestHttpCategory = activityFinalRefinementRequestCategory(
    input.requestResults,
    retained.technicalOutcome,
  );
  const transient = retained.technicalOutcome === 'deadline'
    || retained.technicalOutcome === 'network-failure'
    || retained.technicalOutcome === 'server-error';
  const maxNetworkAttempts = input.maxNetworkAttempts ?? 3;
  const retryDelaysMs = input.retryDelaysMs ?? [5_000, 30_000];
  if (transient && input.networkAttemptCount < maxNetworkAttempts) {
    const delayIndex = Math.max(0, Math.min(
      retryDelaysMs.length - 1,
      Math.max(1, input.networkAttemptCount) - 1,
    ));
    return {
      runResult: 'pending-retry',
      jobStatus: 'queued',
      jobOutcome: 'pending',
      roadEnhancementState: 'pending-retry',
      roadRefinementPending: true,
      technicalOutcome: retained.technicalOutcome,
      candidateDecision: retained.candidateDecision,
      requestHttpCategory,
      nextRetryDelayMs: retryDelaysMs[delayIndex] ?? null,
    };
  }
  return {
    runResult: 'complete',
    jobStatus: 'complete',
    jobOutcome: 'base-retained',
    roadEnhancementState: 'terminal-local',
    roadRefinementPending: false,
    technicalOutcome: retained.technicalOutcome,
    candidateDecision: retained.candidateDecision,
    requestHttpCategory,
    nextRetryDelayMs: null,
  };
}

export function acceptedActivityFinalRefinement(
  requestResults: PedestrianFinalRequestResult[],
): AcceptedRefinementDecision {
  return {
    runResult: 'complete',
    jobStatus: 'complete',
    jobOutcome: 'enhanced',
    roadEnhancementState: 'accepted',
    roadRefinementPending: false,
    technicalOutcome: 'matched-success',
    candidateDecision: 'accepted',
    requestHttpCategory: activityFinalRefinementRequestCategory(requestResults, 'matched-success'),
    nextRetryDelayMs: null,
  };
}
