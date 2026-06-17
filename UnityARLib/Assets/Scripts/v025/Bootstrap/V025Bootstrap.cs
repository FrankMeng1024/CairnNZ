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
//   CairnBridgeV2 (RN ↔ Unity wire layer) — final-A round-2 fix:
//     Bootstrap now instantiates CairnBridgeV2 and starts it. Production
//     transport adapter is provided via SetTransport (called by the iOS-side
//     UnityMessageBridge MonoBehaviour or a TestTransport for Editor PlayMode).
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
        // Final-A B2 fix: default endpoint matches RN production (api.yiiling.cn).
        // EAS builds use EXPO_PUBLIC_API_BASE_URL=https://api.yiiling.cn (eas.json
        // dev/preview/production). Override via SerializeField for staging only.
        [SerializeField] private string _telemetryBaseUrl = "https://api.yiiling.cn";
        [SerializeField] private float _telemetryFlushPeriodSeconds = 5.0f;

        public ArSessionLifecycleV2 Lifecycle { get; private set; }
        public TelemetryBatcherV2 Telemetry { get; private set; }
        public CairnSpawnerV2 Spawner { get; private set; }
        public AnchorRecoveryV2 Recovery { get; private set; }
        public BlockerSentinel Sentinel { get; private set; }
        public PendingAnchorRetryV2 Retry { get; private set; }
        public CairnAssemblyV2 Assembly { get; private set; }
        public CairnBridgeV2 Bridge { get; private set; }

        private SimplePlaneCandidateSource _planeSource;
        private float _flushAccumSeconds;

        /// <summary>
        /// Default plane source returns empty array. Phase 5 ARRaycastManager-backed
        /// adapter calls SetPlaneSource() to inject real planes.
        /// </summary>
        public void SetPlaneSource(IPlaneCandidateSource source)
        {
            _planeSource = new SimplePlaneCandidateSource(source);
        }

        /// <summary>
        /// Final-A B1 fix: bridge transport injection. The native UnityMessageBridge
        /// MonoBehaviour (Phase 5 .iOS.cs) calls this with a real transport that
        /// wraps SendMessage / OnMessage. Tests inject a fake.
        /// </summary>
        public void SetBridgeTransport(IBridgeTransport transport)
        {
            if (Bridge != null) { Bridge.Dispose(); }
            Bridge = new CairnBridgeV2(transport, Spawner, Assembly, _planeSource, Lifecycle, Telemetry.AddEvent);
            Bridge.Start();
        }

        private void Awake()
        {
            // Lifecycle owns Tracker (sessionInstanceId)
            Lifecycle = new ArSessionLifecycleV2();
            Lifecycle.BringUp();
            Lifecycle.Activate();

            // Telemetry batcher with UnityWebRequest-backed HTTP client.
            var endpoint = _telemetryBaseUrl.TrimEnd('/') + "/api/v025/debug-events";
            Telemetry = new TelemetryBatcherV2(new UnityWebRequestTelemetryHttp(), endpoint);

            // Strategy stack
            var persistence = PersistenceFactory.Create();
            // Phase 5 §A.1: if iOS path returned ArkitWorldMapPersistence, wire ARSession
            // so SaveAsync/LoadAsync can access ARKitSessionSubsystem.
#if HAS_ARKIT_WORLDMAP && UNITY_IOS && !UNITY_EDITOR
            if (persistence is Cairn.AR.V025.Core.ArkitWorldMapPersistence arkit)
            {
                var session = FindObjectOfType<UnityEngine.XR.ARFoundation.ARSession>();
                if (session != null) arkit.SetArSession(session);
                else Debug.LogWarning("[v025/Bootstrap] ARSession not found in scene; ArkitWorldMapPersistence will fail until SetArSession is called");
            }
#endif
            var validator = new FloorPlaneValidatorV2();
            // Phase 5 will replace this Miss stub via SetGroundResolver() once
            // ARRaycastManager is live in the AR scene. Until then, Tier-G plane
            // scan still works (Phase 1A FloorPlaneValidatorV2 path); only the
            // raycast fallback after plane scan is dead. Documented in ADR-014.
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

            // Plane candidate source: defaults to empty list; Phase 5 overrides with
            // ARPlaneManager-backed adapter via SetPlaneSource().
            _planeSource = new SimplePlaneCandidateSource(null);

            // v0.2.5 OTA — auto-instantiate a SendMessage-based transport so
            // RN can drive v025 without a separate native bridge module.
            // RN side calls UnityView.postMessage("V025Bootstrap", "OnRNMessage", json),
            // this MonoBehaviour's OnRNMessage(string) forwards into the
            // transport's _onMessage handler, which CairnBridgeV2.OnRawMessage
            // is subscribed to. Outbound v025/* messages flow back through
            // UnityNativeBridge.Send (sendMessageToMobileApp) → JS
            // onUnityMessage where cairnBridgeV2.ts filters by type prefix.
            //
            // _autoTransport is field-initialized (see field decl below) so
            // OnRNMessage can never NRE before this runs. We reuse the same
            // instance — calling SetBridgeTransport with it wires the bridge.
            SetBridgeTransport(_autoTransport);
            // Bridge can also be replaced by a test harness via SetBridgeTransport
            // (the previous Bridge.Dispose() in SetBridgeTransport handles cleanup).
        }

        private SendMessageTransport _autoTransport = new SendMessageTransport();

        /// <summary>
        /// RN entry point — UnityView.postMessage("V025Bootstrap", "OnRNMessage", json).
        /// Forwards into the bridge transport so CairnBridgeV2 sees it.
        /// _autoTransport is field-initialized so even if SendMessage races
        /// Awake() (it shouldn't — Unity holds messages until Awake returns)
        /// the receive path never NREs. Bridge is wired during Awake; messages
        /// arriving before Awake completes are received by transport but not
        /// yet routed to a CairnBridgeV2 subscription — Subscribe() in
        /// SetBridgeTransport just registers _onMessage, no buffering needed
        /// for normal lifecycle.
        /// </summary>
        public void OnRNMessage(string raw)
        {
            if (_autoTransport == null)
            {
                Debug.LogWarning("[v025/Bootstrap] OnRNMessage called before transport init; dropping: " + raw);
                return;
            }
            _autoTransport.Receive(raw);
        }

        /// <summary>
        /// Default transport: outbound uses sendMessageToMobileApp (the same
        /// C function legacy CairnBridge calls via UnityNativeBridge.Send).
        /// We P/Invoke directly here to avoid an asmdef reference to the
        /// default Assembly-CSharp, which is the build that contains
        /// UnityNativeBridge but cannot be referenced from an asmdef-defined
        /// assembly. Inbound is fed by V025Bootstrap.OnRNMessage.
        /// </summary>
        private sealed class SendMessageTransport : IBridgeTransport
        {
            private System.Action<string> _onMessage;
#if UNITY_IOS && !UNITY_EDITOR
            [System.Runtime.InteropServices.DllImport("__Internal")]
            private static extern void sendMessageToMobileApp(string message);
#endif
            public void Send(string jsonPayload)
            {
                if (string.IsNullOrEmpty(jsonPayload)) return;
#if UNITY_IOS && !UNITY_EDITOR
                try
                {
                    sendMessageToMobileApp(jsonPayload);
                }
                catch (System.EntryPointNotFoundException e)
                {
                    // Symbol missing at runtime — bridge module not linked.
                    UnityEngine.Debug.LogWarning("[v025/transport] Send failed (symbol missing): " + e.Message);
                }
                catch (System.DllNotFoundException e)
                {
                    // __Internal not resolvable — extremely rare on iOS.
                    UnityEngine.Debug.LogWarning("[v025/transport] Send failed (dll not found): " + e.Message);
                }
#else
                // Editor / non-iOS: log so roundtrip behaviour is visible during dev.
                UnityEngine.Debug.Log("[v025/transport][Editor] Send: " +
                    (jsonPayload.Length > 200 ? jsonPayload.Substring(0, 200) + "..." : jsonPayload));
#endif
            }
            public System.IDisposable Subscribe(System.Action<string> onMessage)
            {
                _onMessage = onMessage;
                return new Sub(() => _onMessage = null);
            }
            public void Receive(string raw) { _onMessage?.Invoke(raw); }
            private sealed class Sub : System.IDisposable
            {
                private readonly System.Action _onDispose;
                public Sub(System.Action a) { _onDispose = a; }
                public void Dispose() { _onDispose?.Invoke(); }
            }
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
            Bridge?.Dispose();
            Lifecycle?.Teardown();
        }
    }

    /// <summary>
    /// Plane source wrapper — falls through to inner source if set, else empty.
    /// </summary>
    internal sealed class SimplePlaneCandidateSource : IPlaneCandidateSource
    {
        private static readonly PlaneCandidate[] _empty = System.Array.Empty<PlaneCandidate>();
        private readonly IPlaneCandidateSource _inner;
        public SimplePlaneCandidateSource(IPlaneCandidateSource inner) { _inner = inner; }
        public PlaneCandidate[] CurrentCandidates() => _inner != null ? _inner.CurrentCandidates() : _empty;
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
