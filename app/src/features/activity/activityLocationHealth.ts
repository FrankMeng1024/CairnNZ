export const ACTIVITY_SOURCE_HEALTH_FRESH_MS = 15_000;
/** Core Location may legitimately batch outdoor background fixes under iOS
 * power management. hike1 retained trustworthy samples with 19–21 s gaps, so
 * background cadence has a separate bounded freshness budget. */
export const ACTIVITY_BACKGROUND_SOURCE_HEALTH_FRESH_MS = 30_000;
/** A foreground takeover stops/drains the background owner before the first
 * foreground callback. That ownership handoff is recovery, not GPS loss. */
export const ACTIVITY_FOREGROUND_RECOVERY_GRACE_MS = 12_000;
export const ACTIVITY_CANONICAL_HEALTH_FRESH_MS = 5_000;
export const ACTIVITY_CANONICAL_USER_WARNING_MS = 30_000;

export type ActivitySourceHealth = 'inactive' | 'awaiting-first-fix' | 'fresh' | 'stale';
export type ActivityCanonicalHealth = 'awaiting-first-fix' | 'fresh' | 'degraded';
export type ActivityUserFacingLocationIssue =
  | 'none'
  | 'source-unavailable'
  | 'sustained-route-unreliable';
export type ActivityPresentationFreshness = 'CURRENT' | 'RECOVERING_PUCK' | 'STALE_PUCK';

export interface ActivityLocationHealth {
  sourceHealth: ActivitySourceHealth;
  canonicalHealth: ActivityCanonicalHealth;
  sourceAgeMs: number | null;
  canonicalAgeMs: number | null;
  foregroundRecoveryActive: boolean;
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

/** Presentation freshness is independent from camera-follow intent. */
export function deriveActivityPresentationFreshness(args: {
  nowMs: number;
  sourceActive: boolean;
  latestSourceTimestamp: number | null;
  freshForMs?: number;
}): ActivityPresentationFreshness {
  const sourceAgeMs = age(args.nowMs, args.latestSourceTimestamp);
  if (sourceAgeMs === null || (!args.sourceActive && sourceAgeMs <= (args.freshForMs ?? 20_000))) {
    return 'RECOVERING_PUCK';
  }
  return sourceAgeMs <= (args.freshForMs ?? 20_000) ? 'CURRENT' : 'STALE_PUCK';
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
  latestSourceKind?: 'foreground' | 'background' | null;
  foregroundRecoveryUntilMs?: number | null;
  sourceFreshnessMs?: number;
  canonicalFreshnessMs?: number;
  canonicalUserWarningMs?: number;
}): ActivityLocationHealth {
  const sourceFreshnessMs = args.sourceFreshnessMs ?? (
    args.latestSourceKind === 'background'
      ? ACTIVITY_BACKGROUND_SOURCE_HEALTH_FRESH_MS
      : ACTIVITY_SOURCE_HEALTH_FRESH_MS
  );
  const canonicalFreshnessMs = args.canonicalFreshnessMs ?? ACTIVITY_CANONICAL_HEALTH_FRESH_MS;
  const canonicalUserWarningMs = args.canonicalUserWarningMs ?? ACTIVITY_CANONICAL_USER_WARNING_MS;
  const sourceAgeMs = age(args.nowMs, args.latestSourceTimestamp);
  const canonicalAgeMs = age(args.nowMs, args.latestCanonicalTimestamp);
  const foregroundRecoveryActive = args.foregroundRecoveryUntilMs != null
    && args.nowMs < args.foregroundRecoveryUntilMs;
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
  // A distance-filtered provider is allowed to stay quiet while its recent
  // evidence says the user is stationary. No callback / no canonical advance
  // is not, by itself, source loss. Native source inactivity remains a real
  // unavailable state, and stale evidence while moving/uncertain still warns.
  const stationaryQuietProvider = args.sourceActive
    && args.motionState === 'probably-stationary';
  const userFacingIssue: ActivityUserFacingLocationIssue = (
    !foregroundRecoveryActive
    && (
      (sourceHealth === 'stale' && !stationaryQuietProvider)
      || (sourceHealth === 'inactive' && sourceAgeMs !== null)
    )
  )
    ? 'source-unavailable'
    : sourceHealth === 'fresh'
      && canonicalHealth === 'degraded'
      && args.motionState !== 'probably-stationary'
      && (canonicalAgeMs ?? 0) >= canonicalUserWarningMs
      // Candidate/continuity filtering is route-settling evidence, not proof
      // of weak radio/GPS signal. Only sustained accuracy rejection earns the
      // user-facing quality warning; all reasons remain in telemetry.
      && canonicalDegradationReason === 'accuracy-reject'
      ? 'sustained-route-unreliable'
      : 'none';
  return {
    sourceHealth,
    canonicalHealth,
    sourceAgeMs,
    canonicalAgeMs,
    foregroundRecoveryActive,
    userFacingIssue,
    canonicalDegradationReason,
  };
}
