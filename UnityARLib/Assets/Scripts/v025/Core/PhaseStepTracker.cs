// Phase 1A.6 — PhaseStepTracker.
//
// Single source of truth for the (phase, step, seq) triple required by Rule H.
// Each AR session creates ONE PhaseStepTracker; every emitted event reads its
// next sequence number from the tracker so seq is monotonic per session.
//
// Concurrency:
//   - seq increment is Interlocked (lock-free monotonic counter)
//   - phase/step mutation is guarded by a lock so a NextEvent() reader cannot
//     observe a torn state where seq is from one EnterPhase but phase/step
//     strings are from another. Without the lock, telemetry analysis joining
//     on (phase, step, seq) would silently drop events on race.

using System;
using System.Threading;

namespace Cairn.AR.V025.Core
{
    public sealed class PhaseStepTracker
    {
        public string SessionInstanceId { get; }

        private readonly object _phaseLock = new object();
        private long _seq;
        private string _currentPhase;
        private string _currentStep;

        public PhaseStepTracker(string sessionInstanceId)
        {
            if (string.IsNullOrEmpty(sessionInstanceId))
                throw new ArgumentException("sessionInstanceId required", nameof(sessionInstanceId));
            SessionInstanceId = sessionInstanceId;
            _seq = 0;
            _currentPhase = string.Empty;
            _currentStep = string.Empty;
        }

        public string CurrentPhase
        {
            get { lock (_phaseLock) return _currentPhase; }
        }

        public string CurrentStep
        {
            get { lock (_phaseLock) return _currentStep; }
        }

        public void EnterPhase(string phase, string step)
        {
            if (phase == null) throw new ArgumentNullException(nameof(phase));
            if (step == null) throw new ArgumentNullException(nameof(step));
            lock (_phaseLock)
            {
                _currentPhase = phase;
                _currentStep = step;
            }
        }

        public V025Event NextEvent(string outcome, string diagnostic)
        {
            // Round-2 #1A-4-6: take seq INSIDE the lock so phase/step/seq are a
            // consistent snapshot. Cost is one extra instruction in serialized region.
            string phase, step;
            long seq;
            lock (_phaseLock)
            {
                phase = _currentPhase;
                step = _currentStep;
                seq = Interlocked.Increment(ref _seq);
            }
            var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return new V025Event(phase, step, seq, SessionInstanceId, ts, outcome, diagnostic);
        }

        /// <summary>
        /// Build a one-off event with explicit phase/step that overrides whatever
        /// the tracker currently holds. SHARES the same monotonic seq counter as
        /// NextEvent — telemetry consumers see a single ordered stream per session.
        /// Use this for events whose phase/step is not the "current normal flow"
        /// (e.g. v22-AUTO-PROGRESS heartbeat, v22-SPAWN/refused from BlockerSentinel).
        /// </summary>
        public V025Event AdHocEvent(string phase, string step, string outcome, string diagnostic)
        {
            if (phase == null) throw new ArgumentNullException(nameof(phase));
            if (step == null) throw new ArgumentNullException(nameof(step));
            var seq = Interlocked.Increment(ref _seq);
            var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return new V025Event(phase, step, seq, SessionInstanceId, ts, outcome, diagnostic);
        }
    }
}
