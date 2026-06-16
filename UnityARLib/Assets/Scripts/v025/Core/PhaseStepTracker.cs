// Phase 1A.6 — PhaseStepTracker.
//
// Single source of truth for the (phase, step, seq) triple required by Rule H.
// Each AR session creates ONE PhaseStepTracker; every emitted event reads its
// next sequence number from the tracker so seq is monotonic per session.
//
// Concurrency: seq increment is Interlocked; safe under multi-coroutine emit.

using System;
using System.Threading;

namespace Cairn.AR.V025.Core
{
    public sealed class PhaseStepTracker
    {
        public string SessionInstanceId { get; }

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

        public string CurrentPhase => _currentPhase;
        public string CurrentStep => _currentStep;

        public void EnterPhase(string phase, string step)
        {
            if (phase == null) throw new ArgumentNullException(nameof(phase));
            if (step == null) throw new ArgumentNullException(nameof(step));
            _currentPhase = phase;
            _currentStep = step;
        }

        public V025Event NextEvent(string outcome, string diagnostic)
        {
            var seq = Interlocked.Increment(ref _seq);
            var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return new V025Event(_currentPhase, _currentStep, seq, SessionInstanceId, ts, outcome, diagnostic);
        }

        /// <summary>
        /// Build a one-off event without changing the tracker's current phase/step.
        /// Use this for ad-hoc events (e.g. v22-AUTO-PROGRESS) that don't belong
        /// to the normal phase/step sequence.
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
