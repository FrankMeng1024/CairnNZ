import type { PedestrianFinalRequestResult } from '../../services/routing/pedestrianFinalRoute';

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
