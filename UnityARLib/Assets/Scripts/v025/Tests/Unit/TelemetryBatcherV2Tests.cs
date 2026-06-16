// Phase 3 — TelemetryBatcherV2 unit tests.

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Cairn.AR.V025.Core;
using Cairn.AR.V025.Telemetry;

namespace Cairn.AR.V025.Tests.Unit
{
    public class TelemetryBatcherV2Tests
    {
        private sealed class FakeHttp : ITelemetryHttpClient
        {
            public List<string> Bodies { get; } = new List<string>();
            public bool ReturnOk { get; set; } = true;
            public int StatusCode { get; set; } = 200;

            public Task<TelemetryHttpResult> PostJsonAsync(string url, string jsonBody, CancellationToken cancel)
            {
                Bodies.Add(jsonBody);
                return Task.FromResult(new TelemetryHttpResult(ReturnOk, StatusCode, ReturnOk ? "ok" : "fake error"));
            }
        }

        private static V025Event Ev(int seq, string outcome = "success", string diag = "")
        {
            return new V025Event("v22-SPAWN", "test", seq, "session-1", 123456, outcome, diag);
        }

        [Test]
        public void AddEvent_QueueLengthIncreases()
        {
            var http = new FakeHttp();
            var b = new TelemetryBatcherV2(http, "http://example.com/api/v025/debug-events");
            b.AddEvent(Ev(1));
            b.AddEvent(Ev(2));
            Assert.AreEqual(2, b.QueueLength);
        }

        [Test]
        public async Task MaybeFlush_Forced_EvenWithSmallQueue_PostsBody()
        {
            var http = new FakeHttp();
            var b = new TelemetryBatcherV2(http, "http://example.com/api/v025/debug-events");
            b.AddEvent(Ev(1));
            await b.MaybeFlushAsync(force: true, CancellationToken.None);
            Assert.AreEqual(1, http.Bodies.Count);
            Assert.That(http.Bodies[0], Does.Contain("\"phase\":\"v22-SPAWN\""));
            Assert.AreEqual(0, b.QueueLength);
        }

        [Test]
        public async Task MaybeFlush_NotForced_BelowBatchSize_DoesNotFlush()
        {
            var http = new FakeHttp();
            var b = new TelemetryBatcherV2(http, "http://example.com/api/v025/debug-events");
            b.AddEvent(Ev(1));
            await b.MaybeFlushAsync(force: false, CancellationToken.None);
            Assert.AreEqual(0, http.Bodies.Count);
            Assert.AreEqual(1, b.QueueLength);
        }

        [Test]
        public async Task MaybeFlush_AtBatchSize_AutoFlushes()
        {
            var http = new FakeHttp();
            var b = new TelemetryBatcherV2(http, "http://example.com/api/v025/debug-events");
            for (int i = 0; i < TelemetryBatcherV2.FlushBatchSize; i++) b.AddEvent(Ev(i));
            await b.MaybeFlushAsync(force: false, CancellationToken.None);
            Assert.AreEqual(1, http.Bodies.Count);
            Assert.AreEqual(0, b.QueueLength);
        }

        [Test]
        public async Task FlushFailure_ReQueuesEvents()
        {
            var http = new FakeHttp { ReturnOk = false, StatusCode = 500 };
            var b = new TelemetryBatcherV2(http, "http://example.com/api/v025/debug-events");
            b.AddEvent(Ev(1));
            b.AddEvent(Ev(2));
            await b.MaybeFlushAsync(force: true, CancellationToken.None);
            Assert.AreEqual(1, http.Bodies.Count);
            // Failure → events back in queue
            Assert.AreEqual(2, b.QueueLength);
        }

        [Test]
        public void MaxQueueSize_DropsOldestOnOverflow()
        {
            var http = new FakeHttp();
            var b = new TelemetryBatcherV2(http, "http://example.com/api/v025/debug-events");
            for (int i = 0; i < TelemetryBatcherV2.MaxQueueSize + 50; i++) b.AddEvent(Ev(i));
            // After overflow, queue is bounded
            Assert.LessOrEqual(b.QueueLength, TelemetryBatcherV2.MaxQueueSize);
        }

        [Test]
        public void SerializeEventsJson_IncludesAllFields()
        {
            var json = TelemetryBatcherV2.SerializeEventsJson(new List<V025Event>
            {
                new V025Event("v22-SPAWN", "request", 7, "session-x", 1719000000000L, "success", "diag-msg"),
            });
            Assert.That(json, Does.Contain("\"events\":["));
            Assert.That(json, Does.Contain("\"phase\":\"v22-SPAWN\""));
            Assert.That(json, Does.Contain("\"step\":\"request\""));
            Assert.That(json, Does.Contain("\"seq\":7"));
            Assert.That(json, Does.Contain("\"sessionInstanceId\":\"session-x\""));
            Assert.That(json, Does.Contain("\"timestampUnixMs\":1719000000000"));
            Assert.That(json, Does.Contain("\"outcome\":\"success\""));
            Assert.That(json, Does.Contain("\"diagnostic\":\"diag-msg\""));
        }

        [Test]
        public void SerializeEventsJson_EscapesQuotesAndNewlines()
        {
            var json = TelemetryBatcherV2.SerializeEventsJson(new List<V025Event>
            {
                new V025Event("v22-SPAWN", "test", 1, "s", 0, "success", "line1\nline2 \"quoted\""),
            });
            Assert.That(json, Does.Contain("line1\\nline2 \\\"quoted\\\""));
        }
    }
}
