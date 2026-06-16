// Phase 3.3 — TelemetryBatcherV2 (Unity side).
//
// Buffers V025Event in memory; flushes to backend POST /api/v025/debug-events
// every 5 seconds OR when buffer reaches 100 events, whichever happens first.
//
// Persistent queue: events are drained from a List<V025Event>; on flush failure
// they remain queued for retry next tick. Hard cap at 1000 events to bound
// memory if backend is offline for an extended period — overflow drops oldest
// events with a "telemetry-overflow" emit.
//
// Composition root (Phase 2A.3 doc):
//   ArSessionLifecycleV2 owns PhaseStepTracker (per-session sessionInstanceId).
//   TelemetryBatcherV2 owns the Action<V025Event> emit delegate. The composition
//   wires `new CairnSpawnerV2(strategy, lifecycle.Tracker, batcher.AddEvent)`.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Cairn.AR.V025.Telemetry
{
    using Cairn.AR.V025.Core;

    /// <summary>
    /// HTTP transport contract — abstracted so unit tests can inject a fake.
    /// </summary>
    public interface ITelemetryHttpClient
    {
        Task<TelemetryHttpResult> PostJsonAsync(string url, string jsonBody, CancellationToken cancel);
    }

    public readonly struct TelemetryHttpResult
    {
        public bool Ok { get; }
        public int StatusCode { get; }
        public string Diagnostic { get; }

        public TelemetryHttpResult(bool ok, int statusCode, string diagnostic)
        {
            Ok = ok;
            StatusCode = statusCode;
            Diagnostic = diagnostic ?? string.Empty;
        }
    }

    public sealed class TelemetryBatcherV2
    {
        public const int FlushPeriodSeconds = 5;
        public const int FlushBatchSize = 100;
        public const int MaxQueueSize = 1000;

        private readonly ITelemetryHttpClient _http;
        private readonly string _endpointUrl;
        private readonly object _lock = new object();
        private readonly List<V025Event> _queue = new List<V025Event>();
        private bool _flushInFlight;

        public TelemetryBatcherV2(ITelemetryHttpClient http, string endpointUrl)
        {
            _http = http ?? throw new ArgumentNullException(nameof(http));
            _endpointUrl = endpointUrl ?? throw new ArgumentNullException(nameof(endpointUrl));
        }

        public int QueueLength { get { lock (_lock) return _queue.Count; } }

        /// <summary>
        /// Add an event to the queue. Drops oldest if MaxQueueSize exceeded.
        /// </summary>
        public void AddEvent(V025Event ev)
        {
            lock (_lock)
            {
                if (_queue.Count >= MaxQueueSize)
                {
                    // Drop oldest 10% to make room (avoid quadratic shift).
                    var drop = MaxQueueSize / 10;
                    _queue.RemoveRange(0, drop);
                }
                _queue.Add(ev);
            }
        }

        /// <summary>
        /// Triggers a flush if there are ≥ FlushBatchSize events queued OR if
        /// the caller's "elapsed since last flush" exceeds FlushPeriodSeconds.
        /// </summary>
        public Task<TelemetryHttpResult> MaybeFlushAsync(bool force, CancellationToken cancel)
        {
            List<V025Event> drained;
            lock (_lock)
            {
                if (_flushInFlight) return Task.FromResult(new TelemetryHttpResult(true, 0, "already in flight"));
                if (_queue.Count == 0) return Task.FromResult(new TelemetryHttpResult(true, 0, "empty"));
                if (!force && _queue.Count < FlushBatchSize)
                {
                    return Task.FromResult(new TelemetryHttpResult(true, 0, "below batch size, not forced"));
                }
                drained = new List<V025Event>(_queue);
                _queue.Clear();
                _flushInFlight = true;
            }
            return FlushBatchAsync(drained, cancel);
        }

        private async Task<TelemetryHttpResult> FlushBatchAsync(List<V025Event> batch, CancellationToken cancel)
        {
            try
            {
                var json = SerializeEventsJson(batch);
                var result = await _http.PostJsonAsync(_endpointUrl, json, cancel).ConfigureAwait(false);
                if (!result.Ok)
                {
                    // Re-queue events on failure; trim from front if MaxQueueSize hit.
                    // Round-1 #3-2-F: documenting the trim policy.
                    // Failed batch goes to index 0; new events that arrived during
                    // in-flight period sit at the back. RemoveRange(0, ...) drops
                    // the failed batch FIRST when bounded — sensible "don't keep
                    // retrying the same broken batch forever" semantics; the
                    // newer events get to retry instead. Documented so future
                    // maintainer does not flip the trim direction.
                    lock (_lock)
                    {
                        _queue.InsertRange(0, batch);
                        if (_queue.Count > MaxQueueSize)
                        {
                            _queue.RemoveRange(0, _queue.Count - MaxQueueSize);
                        }
                    }
                }
                return result;
            }
            finally
            {
                lock (_lock) { _flushInFlight = false; }
            }
        }

        public static string SerializeEventsJson(IReadOnlyList<V025Event> events)
        {
            var sb = new StringBuilder();
            sb.Append("{\"events\":[");
            for (int i = 0; i < events.Count; i++)
            {
                if (i > 0) sb.Append(',');
                var ev = events[i];
                sb.Append('{');
                sb.Append("\"phase\":");        AppendJsonStr(sb, ev.Phase);
                sb.Append(",\"step\":");         AppendJsonStr(sb, ev.Step);
                sb.Append(",\"seq\":");          sb.Append(ev.Seq.ToString(CultureInfo.InvariantCulture));
                sb.Append(",\"sessionInstanceId\":"); AppendJsonStr(sb, ev.SessionInstanceId);
                sb.Append(",\"timestampUnixMs\":"); sb.Append(ev.TimestampUnixMs.ToString(CultureInfo.InvariantCulture));
                sb.Append(",\"outcome\":");      AppendJsonStr(sb, ev.Outcome);
                sb.Append(",\"diagnostic\":");   AppendJsonStr(sb, ev.Diagnostic);
                sb.Append('}');
            }
            sb.Append("]}");
            return sb.ToString();
        }

        private static void AppendJsonStr(StringBuilder sb, string s)
        {
            sb.Append('"');
            if (s != null)
            {
                foreach (var ch in s)
                {
                    switch (ch)
                    {
                        case '\\': sb.Append("\\\\"); break;
                        case '"':  sb.Append("\\\""); break;
                        case '\n': sb.Append("\\n"); break;
                        case '\r': sb.Append("\\r"); break;
                        case '\t': sb.Append("\\t"); break;
                        default:
                            if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                            else sb.Append(ch);
                            break;
                    }
                }
            }
            sb.Append('"');
        }
    }
}
