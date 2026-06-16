// Phase 2A.6 — ArSessionLifecycleV2.
//
// Owns the C# AR session lifecycle and pins the sessionInstanceId for the
// session's PhaseStepTracker.
//
// Contract (mirror of RN useArSessionStoreV2):
//   - sessionInstanceId is created at BringUp and is IDENTICAL through any
//     number of recoveries.
//   - Teardown clears the id; next BringUp creates a new one.
//
// This class owns NO Unity-engine references — it's pure-logic so PlayMode
// tests can construct it without an ARSession. The Unity-side adapter
// (Phase 4) will wire ARSession callbacks to this class's methods.

using System;

namespace Cairn.AR.V025.Session
{
    using Cairn.AR.V025.Core;

    public enum ArSessionStateV2
    {
        Idle,
        BringingUp,
        Active,
        Recovering,
        TearingDown,
    }

    public sealed class ArSessionLifecycleV2
    {
        public ArSessionStateV2 State { get; private set; } = ArSessionStateV2.Idle;
        public string SessionInstanceId { get; private set; }
        public PhaseStepTracker Tracker { get; private set; }

        private readonly Func<string> _idFactory;

        /// <param name="idFactory">Optional id factory; defaults to UUID-like string. Tests can inject deterministic ids.</param>
        public ArSessionLifecycleV2(Func<string> idFactory = null)
        {
            _idFactory = idFactory ?? DefaultIdFactory;
        }

        private static string DefaultIdFactory()
        {
            // mirror RN useArSessionStoreV2.genId so cross-platform telemetry has the same
            // shape: arv2-<ts>-<rnd1>-<rnd2>
            var ts = ((DateTimeOffset)DateTime.UtcNow).ToUnixTimeMilliseconds().ToString("x");
            var r1 = Guid.NewGuid().ToString("N").Substring(0, 8);
            var r2 = Guid.NewGuid().ToString("N").Substring(0, 4);
            return $"arv2-{ts}-{r1}-{r2}";
        }

        public string BringUp()
        {
            if (State != ArSessionStateV2.Idle && SessionInstanceId != null)
            {
                // idempotent — return existing id
                return SessionInstanceId;
            }
            SessionInstanceId = _idFactory();
            Tracker = new PhaseStepTracker(SessionInstanceId);
            Tracker.EnterPhase(V025Phases.Lifecycle, "bring-up");
            State = ArSessionStateV2.BringingUp;
            return SessionInstanceId;
        }

        public void Activate()
        {
            if (State != ArSessionStateV2.BringingUp) return;
            State = ArSessionStateV2.Active;
            Tracker.EnterPhase(V025Phases.Lifecycle, "active");
        }

        public void EnterRecovery(string reason)
        {
            if (State != ArSessionStateV2.Active) return;
            State = ArSessionStateV2.Recovering;
            Tracker.EnterPhase(V025Phases.Recovery, reason ?? "");
        }

        public void ExitRecovery()
        {
            if (State != ArSessionStateV2.Recovering) return;
            State = ArSessionStateV2.Active;
            Tracker.EnterPhase(V025Phases.Lifecycle, "active");
        }

        public void Teardown()
        {
            State = ArSessionStateV2.TearingDown;
            SessionInstanceId = null;
            Tracker = null;
            State = ArSessionStateV2.Idle;
        }
    }
}
