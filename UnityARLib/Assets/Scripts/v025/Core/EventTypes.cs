// Phase 1A.6 — EventTypes (Cairn AR v0.2.5 telemetry envelope).
//
// Rule H requirement: every emitted event MUST include phase + step + seq +
// sessionInstanceId. EventTypes is the canonical contract; TelemetryBatcherV2
// (Phase 3.3) wraps these into bulk INSERTs against debug_events_v2.
//
// Phase + Step ARE strings (not enums) so adding a new event type does not
// require schema migration — backend uses (phase, step) tuple as a free-form
// pair. Convention: phase is `v22-UPPER-HYPHEN`, step is `lower-hyphen`.

using System;

namespace Cairn.AR.V025.Core
{
    /// <summary>
    /// Canonical event payload. Immutable; constructed once per emit.
    /// </summary>
    public readonly struct V025Event
    {
        public string Phase { get; }
        public string Step { get; }
        public long Seq { get; }
        public string SessionInstanceId { get; }
        public long TimestampUnixMs { get; }
        public string Outcome { get; }
        public string Diagnostic { get; }

        public V025Event(
            string phase,
            string step,
            long seq,
            string sessionInstanceId,
            long timestampUnixMs,
            string outcome,
            string diagnostic)
        {
            Phase = phase ?? throw new ArgumentNullException(nameof(phase));
            Step = step ?? throw new ArgumentNullException(nameof(step));
            Seq = seq;
            SessionInstanceId = sessionInstanceId ?? throw new ArgumentNullException(nameof(sessionInstanceId));
            TimestampUnixMs = timestampUnixMs;
            Outcome = outcome ?? string.Empty;
            Diagnostic = diagnostic ?? string.Empty;
        }
    }

    /// <summary>
    /// Standard phase strings used across v025. Keep in sync with backend
    /// debug_events_v2 query patterns.
    /// </summary>
    public static class V025Phases
    {
        public const string Spawn = "v22-SPAWN";
        public const string Persist = "v22-PERSIST";
        public const string Anchor = "v22-ANCHOR";
        public const string Recovery = "v22-RECOVERY";
        public const string Lifecycle = "v22-LIFECYCLE";
        public const string TierFallback = "v22-TIER-FALLBACK";
        public const string AutoProgress = "v22-AUTO-PROGRESS";  // Rule S heartbeat
    }

    /// <summary>Standard outcome strings.</summary>
    public static class V025Outcomes
    {
        public const string Success = "success";
        public const string Failure = "failure";
        public const string Timeout = "timeout";
        public const string Cancelled = "cancelled";
        public const string Skipped = "skipped";
    }
}
