// Phase 4.7 — V025Bootstrap: composition root for v025 runtime.
//
// Wires all v025 components together:
//   ArSessionLifecycleV2 (PhaseStepTracker owner)
//     → CairnSpawnerV2(strategy, lifecycle.Tracker, batcher.AddEvent)
//     → AnchorRecoveryV2(lifecycle.Tracker, batcher.AddEvent)
//     → BlockerSentinel(lifecycle.Tracker, batcher.AddEvent)
//     → PendingAnchorRetryV2(sentinel, lifecycle.Tracker, batcher.AddEvent)
//   TelemetryBatcherV2 (batches V025Event to /api/v025/debug-events)
//     → 5s flush via MonoBehaviour Update
//   CairnAssemblyV2 (consumes SpawnResponse → instantiate)
//   CairnBridgeV2 (RN ↔ Unity wire layer)
//
// One singleton MonoBehaviour anchors the whole stack. ARScreenV2 finds it via
// FindObjectOfType, or Phase 5 wires it via prefab in the AR scene.

using System;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace Cairn.AR.V025.Bootstrap
{
    using Cairn.AR.V025.Anchor;
    using Cairn.AR.V025.Bridge;
    using Cairn.AR.V025.Core;
    using Cairn.AR.V025.Session;
    using Cairn.AR.V025.Spawn;
    using Cairn.AR.V025.Telemetry;
    using Cairn.AR.V025.Visual;

    /// <summary>
    /// Composition root MonoBehaviour. One instance per AR session in the scene.
    /// </summary>
    public sealed class V025Bootstrap : MonoBehaviour
    {
        [SerializeField] private string _telemetryEndpoint = "https://api.cairn.app/api/v025/debug-events";
        [SerializeField] private float _telemetryFlushPeriodSeconds = 5.0f;

        public ArSessionLifecycleV2 Lifecycle { get; private set; }
        public TelemetryBatcherV2 Telemetry { get; private set; }
        public CairnSpawnerV2 Spawner { get; private set; }
        public AnchorRecoveryV2 Recovery { get; private set; }
        public BlockerSentinel Sentinel { get; private set; }
        public PendingAnchorRetryV2 Retry { get; private set; }
        public CairnAssemblyV2 Assembly { get; private set; }

        private float _flushAccumSeconds;

        private void Awake()
        {
            // Lifecycle owns Tracker (sessionInstanceId)
            Lifecycle = new ArSessionLifecycleV2();
            Lifecycle.BringUp();
            Lifecycle.Activate();

            // Telemetry batcher with UnityWebRequest-backed HTTP client.
            Telemetry = new TelemetryBatcherV2(new UnityWebRequestTelemetryHttp(), _telemetryEndpoint);

            // Strategy stack
            var persistence = PersistenceFactory.Create();
            var validator = new FloorPlaneValidatorV2();
            // Phase 4 will replace this delegate with a real ARRaycastManager-backed adapter
            var ground = new GroundResolverV2(uv => GroundResolverV2.RaycastResult.Miss);
            var strategy = new AnchorAttachStrategy(persistence, validator, ground);

            // BlockerSentinel + Retry share lifecycle.Tracker + telemetry emit
            Sentinel = new BlockerSentinel(Lifecycle.Tracker, Telemetry.AddEvent);
            Retry = new PendingAnchorRetryV2(Sentinel, Lifecycle.Tracker, Telemetry.AddEvent);

            // Spawner + Recovery wired with the same Tracker + emit fn
            Spawner = new CairnSpawnerV2(strategy, Lifecycle.Tracker, Telemetry.AddEvent);
            Recovery = new AnchorRecoveryV2(Lifecycle.Tracker, Telemetry.AddEvent);

            // Visual assembly — caller adds CairnAssemblyV2 component to a child or this GO
            var existing = GetComponent<CairnAssemblyV2>();
            Assembly = existing != null ? existing : gameObject.AddComponent<CairnAssemblyV2>();
        }

        private async void Update()
        {
            _flushAccumSeconds += Time.deltaTime;
            if (_flushAccumSeconds >= _telemetryFlushPeriodSeconds)
            {
                _flushAccumSeconds = 0;
                try
                {
                    await Telemetry.MaybeFlushAsync(force: true, default).ConfigureAwait(false);
                }
                catch (System.IO.IOException ex)
                {
                    Debug.LogWarning($"[v025/bootstrap] telemetry flush IO error: {ex.Message}");
                }
            }
        }

        private void OnDestroy()
        {
            Lifecycle?.Teardown();
        }
    }

    /// <summary>
    /// UnityWebRequest-backed implementation of ITelemetryHttpClient.
    /// </summary>
    internal sealed class UnityWebRequestTelemetryHttp : ITelemetryHttpClient
    {
        public Task<TelemetryHttpResult> PostJsonAsync(string url, string jsonBody, System.Threading.CancellationToken cancel)
        {
            var tcs = new TaskCompletionSource<TelemetryHttpResult>();
            var req = new UnityWebRequest(url, "POST");
            req.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(jsonBody));
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            req.timeout = 30; // Round-1 #3-1 medium concern: 30s HTTP timeout
            var op = req.SendWebRequest();
            op.completed += _ =>
            {
                try
                {
                    var ok = req.result == UnityWebRequest.Result.Success;
                    var status = (int)req.responseCode;
                    var diag = ok ? "ok" : ($"{req.result}: {req.error}");
                    tcs.SetResult(new TelemetryHttpResult(ok, status, diag));
                }
                finally
                {
                    req.Dispose();
                }
            };
            return tcs.Task;
        }
    }
}
