export const ACTIVITY_SOURCE_HEALTH_FRESH_MS = 15_000;
export const ACTIVITY_CANONICAL_HEALTH_FRESH_MS = 5_000;
export const ACTIVITY_CANONICAL_USER_WARNING_MS = 30_000;

export type ActivitySourceHealth = 'inactive' | 'awaiting-first-fix' | 'fresh' | 'stale';
export type ActivityCanonicalHealth = 'awaiting-first-fix' | 'fresh' | 'degraded';
export type ActivityUserFacingLocationIssue =
  | 'none'
  | 'source-unavailable'
  | 'sustained-route-unreliable';

export interface ActivityLocationHealth {
  sourceHealth: ActivitySourceHealth;
  canonicalHealth: ActivityCanonicalHealth;
  sourceAgeMs: number | null;
  canonicalAgeMs: number | null;
  /** Calm product UI authority. Transient Candidate/filter states remain internal. */
  userFacingIssue: ActivityUserFacingLocationIssue;
  canonicalDegradationReason:
    | 'none'
    | 'candidate'
    | 'accuracy-reject'
    | 'continuity-reject'
    | 'source-stale'
    | 'lifecycle-gap'
    | 'awaiting-first-fix'
    | 'other-reject';
}

function age(nowMs: number, timestamp: number | null): number | null {
  return timestamp === null ? null : Math.max(0, nowMs - timestamp);
}

/** Provider freshness and accepted-Activity freshness are separate facts. */
export function deriveActivityLocationHealth(args: {
  nowMs: number;
  sourceActive: boolean;
  latestSourceTimestamp: number | null;
  latestCanonicalTimestamp: number | null;
  pendingCandidate: boolean;
  latestCanonicalDecisionReason: string | null;
  continuityGapOpen: boolean;
  motionState?: 'acquiring' | 'moving' | 'probably-stationary' | 'uncertain';
  sourceFreshnessMs?: number;
  canonicalFreshnessMs?: number;
  canonicalUserWarningMs?: number;
}): ActivityLocationHealth {
  const sourceFreshnessMs = args.sourceFreshnessMs ?? ACTIVITY_SOURCE_HEALTH_FRESH_MS;
  const canonicalFreshnessMs = args.canonicalFreshnessMs ?? ACTIVITY_CANONICAL_HEALTH_FRESH_MS;
  const canonicalUserWarningMs = args.canonicalUserWarningMs ?? ACTIVITY_CANONICAL_USER_WARNING_MS;
  const sourceAgeMs = age(args.nowMs, args.latestSourceTimestamp);
  const canonicalAgeMs = age(args.nowMs, args.latestCanonicalTimestamp);
  const sourceHealth: ActivitySourceHealth = !args.sourceActive
    ? 'inactive'
    : sourceAgeMs === null
      ? 'awaiting-first-fix'
      : sourceAgeMs <= sourceFreshnessMs ? 'fresh' : 'stale';
  const canonicalHealth: ActivityCanonicalHealth = canonicalAgeMs === null
    ? 'awaiting-first-fix'
    : canonicalAgeMs <= canonicalFreshnessMs
      || (sourceHealth === 'fresh' && args.motionState === 'probably-stationary')
      ? 'fresh' : 'degraded';

  let canonicalDegradationReason: ActivityLocationHealth['canonicalDegradationReason'] = 'none';
  if (canonicalHealth === 'awaiting-first-fix') canonicalDegradationReason = 'awaiting-first-fix';
  else if (canonicalHealth === 'degraded') {
    const reason = args.latestCanonicalDecisionReason ?? '';
    if (args.pendingCandidate) canonicalDegradationReason = 'candidate';
    else if (args.continuityGapOpen || sourceHealth === 'inactive') canonicalDegradationReason = 'lifecycle-gap';
    else if (sourceHealth === 'stale') canonicalDegradationReason = 'source-stale';
    else if (
      reason.includes('continuity')
      || reason.includes('teleport')
      || reason.includes('candidate')
      || reason.includes('stationary')
      || reason.includes('impossible')
    ) {
      canonicalDegradationReason = 'continuity-reject';
    } else if (reason.includes('accuracy')) canonicalDegradationReason = 'accuracy-reject';
    else canonicalDegradationReason = 'other-reject';
  }
  const userFacingIssue: ActivityUserFacingLocationIssue = sourceHealth === 'stale'
    || (sourceHealth === 'inactive' && sourceAgeMs !== null)
    ? 'source-unavailable'
    : sourceHealth === 'fresh'
      && canonicalHealth === 'degraded'
      && args.motionState !== 'probably-stationary'
      && (canonicalAgeMs ?? 0) >= canonicalUserWarningMs
      ? 'sustained-route-unreliable'
      : 'none';
  return {
    sourceHealth,
    canonicalHealth,
    sourceAgeMs,
    canonicalAgeMs,
    userFacingIssue,
    canonicalDegradationReason,
  };
}
