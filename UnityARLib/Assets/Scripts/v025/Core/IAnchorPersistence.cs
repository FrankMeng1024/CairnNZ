// Phase 1A.1 — IAnchorPersistence interface (Cairn AR v0.2.5)
//
// Single contract for all anchor persistence backends:
//   - ArkitWorldMapPersistence (iOS, Tier-S, cm precision via ARWorldMap)
//   - ArcoreStubPersistence    (Android, Phase 5+, NotSupported until v0.2.6)
//   - NullPersistence          (Editor / fallback, always returns NoCache)
//
// PersistenceFactory selects the impl per #if UNITY_IOS / #if UNITY_ANDROID / Editor.
//
// Contract:
//   - All methods are async + cancellable.
//   - Save/Load operate on a SpaceId (string, opaque to caller).
//   - PersistenceResult is the ONLY way to express outcome — never throw on
//     "expected" failures (no map / unsupported platform / load timeout). Throw
//     only on programmer errors (null arg, contract violation).
//   - Implementations MUST emit telemetry on every Save/Load attempt + outcome.

using System.Threading;
using System.Threading.Tasks;

namespace Cairn.AR.V025.Core
{
    /// <summary>
    /// PersistenceResult outcomes — exhaustive list of "expected" cases.
    /// Programmer errors throw; this enum covers all "expected" failure modes
    /// so callers can branch without try/catch.
    /// </summary>
    public enum PersistenceOutcome
    {
        /// <summary>Save / Load succeeded with a usable map.</summary>
        Success,

        /// <summary>No map cached for the given SpaceId. Caller should fall to Tier-G.</summary>
        NoCache,

        /// <summary>Map exists but cannot relocalize within timeout. Caller falls to Tier-G.</summary>
        RelocalizeTimeout,

        /// <summary>Backend cannot fulfil request on this platform (e.g. Arcore stub on Android pre-v0.2.6).</summary>
        NotSupported,

        /// <summary>Disk / IO failure (full disk, permission denied, file corrupt).</summary>
        IoError,

        /// <summary>Network or remote service failure (worldmap blob upload/download).</summary>
        NetworkError,

        /// <summary>The caller's CancellationToken fired before completion.</summary>
        Cancelled,
    }

    /// <summary>
    /// Outcome envelope for IAnchorPersistence operations.
    /// Use static factory methods to construct (never new an inconsistent state).
    /// </summary>
    public readonly struct PersistenceResult
    {
        public PersistenceOutcome Outcome { get; }

        /// <summary>Free-form error/diagnostic text. Always non-null; "" when Outcome=Success.</summary>
        public string Diagnostic { get; }

        private PersistenceResult(PersistenceOutcome outcome, string diagnostic)
        {
            Outcome = outcome;
            Diagnostic = diagnostic ?? string.Empty;
        }

        public static PersistenceResult Success() => new PersistenceResult(PersistenceOutcome.Success, string.Empty);
        public static PersistenceResult NoCache() => new PersistenceResult(PersistenceOutcome.NoCache, string.Empty);
        public static PersistenceResult RelocalizeTimeout(string diagnostic) => new PersistenceResult(PersistenceOutcome.RelocalizeTimeout, diagnostic);
        public static PersistenceResult NotSupported(string diagnostic) => new PersistenceResult(PersistenceOutcome.NotSupported, diagnostic);
        public static PersistenceResult IoError(string diagnostic) => new PersistenceResult(PersistenceOutcome.IoError, diagnostic);
        public static PersistenceResult NetworkError(string diagnostic) => new PersistenceResult(PersistenceOutcome.NetworkError, diagnostic);
        public static PersistenceResult Cancelled() => new PersistenceResult(PersistenceOutcome.Cancelled, string.Empty);

        public bool IsSuccess => Outcome == PersistenceOutcome.Success;
    }

    /// <summary>
    /// Anchor persistence contract. One implementation per platform; selected by
    /// PersistenceFactory at runtime via #if directives.
    /// </summary>
    public interface IAnchorPersistence
    {
        /// <summary>
        /// Persist the current AR world session under <paramref name="spaceId"/>.
        /// Implementations MUST emit telemetry phase=v22-PERSIST/step=save before
        /// returning, regardless of outcome.
        /// </summary>
        Task<PersistenceResult> SaveAsync(string spaceId, CancellationToken cancel);

        /// <summary>
        /// Attempt to load + relocalize against a previously saved space.
        /// Returns Success only after worldMappingStatus reaches the impl's threshold
        /// (ARKit: Mapped). Returns RelocalizeTimeout if threshold not reached within
        /// the impl's bounded retry window.
        /// </summary>
        Task<PersistenceResult> LoadAsync(string spaceId, CancellationToken cancel);

        /// <summary>
        /// Whether the underlying platform/runtime supports persistence at all.
        /// Editor: false. Arcore stub: false. ARKit (iOS device): true after init.
        /// Implementations MUST be cheap (no I/O); read a cached value.
        /// </summary>
        bool IsPlatformSupported { get; }
    }
}
