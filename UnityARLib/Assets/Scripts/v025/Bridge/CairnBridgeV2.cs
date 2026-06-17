// Phase 2A.8 — CairnBridgeV2 Unity-side message dispatcher.
//
// Counterpart of app/src/services/v025/cairnBridgeV2.ts (RN side).
//
// Wire format: JSON-encoded objects, both directions, with a `type` discriminator.
// Inbound (RN → Unity):
//   v025/spawn         → CairnSpawnerV2.HandleAsync → emit v025/spawn-ok|refused
//   v025/save-space    → ArkitWorldMapPersistence.SaveAsync (Phase 4)
//   v025/begin-session → ArSessionLifecycleV2.BringUp + Activate
//   v025/end-session   → ArSessionLifecycleV2.Teardown
// Outbound (Unity → RN):
//   v025/spawn-ok / v025/spawn-refused
//   v025/session-ready / v025/session-lost
//   v025/save-space-ok / v025/save-space-failed
//   v025/telemetry — emitted by TelemetryBatcherV2 (Phase 3)
//
// This class is pure-logic — it consumes a delegate transport, so it can be
// unit-tested without the @azesmway/react-native-unity native bridge. The
// Unity-side adapter (Phase 4 wiring) supplies the real transport.
//
// Phase 2A 4-eye sub#2A-1-B01: Unity-side bridge MUST exist before Phase 2A
// closeout. This file is that fix.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using Unity.Mathematics;

namespace Cairn.AR.V025.Bridge
{
    using Cairn.AR.V025.Core;
    using Cairn.AR.V025.Session;
    using Cairn.AR.V025.Spawn;
    using Cairn.AR.V025.Visual;

    /// <summary>
    /// Transport contract — the real implementation wraps the native bridge's
    /// SendMessage / OnMessage hooks. Unit tests inject a fake.
    /// </summary>
    public interface IBridgeTransport
    {
        void Send(string jsonPayload);
        IDisposable Subscribe(Action<string> onMessage);
    }

    /// <summary>
    /// Source of candidate floor planes — pluggable so Editor tests can inject
    /// fake planes without an ARPlaneManager.
    /// </summary>
    public interface IPlaneCandidateSource
    {
        PlaneCandidate[] CurrentCandidates();
    }

    public sealed class CairnBridgeV2 : IDisposable
    {
        private readonly IBridgeTransport _transport;
        private readonly CairnSpawnerV2 _spawner;
        private readonly CairnAssemblyV2 _assembly;
        private readonly IPlaneCandidateSource _planes;
        private readonly ArSessionLifecycleV2 _lifecycle;
        private readonly Action<V025Event> _emitTelemetry;
        private IDisposable _subscription;
        private readonly CancellationTokenSource _disposeCts = new CancellationTokenSource();

        public CairnBridgeV2(
            IBridgeTransport transport,
            CairnSpawnerV2 spawner,
            CairnAssemblyV2 assembly,
            IPlaneCandidateSource planes,
            ArSessionLifecycleV2 lifecycle,
            Action<V025Event> emitTelemetry)
        {
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
            _spawner = spawner ?? throw new ArgumentNullException(nameof(spawner));
            _assembly = assembly ?? throw new ArgumentNullException(nameof(assembly));
            _planes = planes ?? throw new ArgumentNullException(nameof(planes));
            _lifecycle = lifecycle ?? throw new ArgumentNullException(nameof(lifecycle));
            _emitTelemetry = emitTelemetry ?? throw new ArgumentNullException(nameof(emitTelemetry));
        }

        public void Start()
        {
            if (_subscription != null) return;
            _subscription = _transport.Subscribe(OnRawMessage);
        }

        public void Dispose()
        {
            _subscription?.Dispose();
            _subscription = null;
            _disposeCts.Cancel();
        }

        private async void OnRawMessage(string raw)
        {
            // JSON parsing — minimal, no external deps. Top-level shape:
            //   {"type":"v025/spawn", "spaceId":"...", "cairnId":"...", "targetXyz":{"x":..,"y":..,"z":..}}
            var msg = MiniJson.Parse(raw);
            if (msg == null) return;
            if (!msg.TryGetValue("type", out var typeObj) || !(typeObj is string type)) return;
            if (!type.StartsWith("v025/", StringComparison.Ordinal)) return;

            try
            {
                switch (type)
                {
                    case "v025/spawn":
                        await OnSpawnAsync(msg).ConfigureAwait(false);
                        break;
                    case "v025/begin-session":
                        OnBeginSession(msg);
                        break;
                    case "v025/end-session":
                        OnEndSession();
                        break;
                    case "v025/save-space":
                        // Phase 5 §A.5 fix: awaitable Task instead of async void.
                        // Fire-and-forget at the dispatcher with explicit `_ =` so
                        // unobserved exceptions are caught by the outer try/catch.
                        _ = OnSaveSpaceAsync(msg);
                        break;
                    default:
                        // unknown v025/* message: ignore (forward-compat)
                        break;
                }
            }
            catch (BlockerSentinelException bse)
            {
                // BlockerSentinel ALREADY emitted telemetry; here we only need the wire response.
                if (msg.TryGetValue("cairnId", out var c) && c is string cairnId)
                {
                    SendSpawnRefused(cairnId, bse.Message);
                }
            }
            catch (System.Threading.Tasks.TaskCanceledException tce)
            {
                if (msg.TryGetValue("cairnId", out var c) && c is string cairnId)
                {
                    SendSpawnRefused(cairnId, "cancelled: " + tce.Message);
                }
            }
        }

        private async Task OnSpawnAsync(Dictionary<string, object> msg)
        {
            var spaceId  = msg.TryGetValue("spaceId",   out var s) ? s as string : null;
            var cairnId  = msg.TryGetValue("cairnId",   out var c) ? c as string : null;
            var cairnType = msg.TryGetValue("cairnType", out var t) ? t as string : "cairn";
            if (spaceId == null || cairnId == null) return;

            var targetXyz = ParseXyz(msg, "targetXyz");
            var planes = _planes.CurrentCandidates();

            var req = new CairnSpawnerV2.SpawnRequest(spaceId, cairnId, cairnType, targetXyz, planes);
            var resp = await _spawner.HandleAsync(req, _disposeCts.Token).ConfigureAwait(false);

            if (resp.Ok)
            {
                // Instantiate the visual using the v0.2.4 PortalSpawner pipeline.
                _assembly.SpawnAtPosition(cairnId, resp.FinalXyz, resp.CairnType);
                SendSpawnOk(cairnId, resp.Kind, resp.FinalXyz, resp.Diagnostic);
            }
            else
            {
                SendSpawnRefused(cairnId, resp.Diagnostic);
            }
        }

        private void OnBeginSession(Dictionary<string, object> msg)
        {
            var id = _lifecycle.BringUp();
            _lifecycle.Activate();
            var json = $"{{\"type\":\"v025/session-ready\",\"sessionInstanceId\":{JsonStr(id)}}}";
            _transport.Send(json);
        }

        private void OnEndSession()
        {
            var id = _lifecycle.SessionInstanceId ?? string.Empty;
            _lifecycle.Teardown();
            var json = $"{{\"type\":\"v025/session-lost\",\"sessionInstanceId\":{JsonStr(id)},\"reason\":\"client-requested\"}}";
            _transport.Send(json);
        }

        // Final-A X-4: save-space dispatch. Spawner doesn't own persistence directly,
        // but PersistenceFactory.Create() gives us the right impl per platform.
        // Phase 1A iOS shell returns IoError; Phase 5 .iOS.cs replacement returns
        // Success. Either way, RN gets a structured response.
        // Phase 5 §A.5: changed from `async void OnSaveSpaceFireAndForget` to
        // `async Task OnSaveSpaceAsync`. Caller in OnRawMessage uses `_ = ...`
        // for fire-and-forget; unobserved exceptions surface to the outer
        // try/catch instead of becoming SynchronizationContext crashes.
        private async Task OnSaveSpaceAsync(System.Collections.Generic.Dictionary<string, object> msg)
        {
            var spaceId = msg.TryGetValue("spaceId", out var s) ? s as string : null;
            if (spaceId == null) return;
            var persistence = PersistenceFactory.Create();
            try
            {
                var result = await persistence.SaveAsync(spaceId, _disposeCts.Token).ConfigureAwait(false);
                if (result.IsSuccess)
                {
                    _transport.Send($"{{\"type\":\"v025/save-space-ok\",\"spaceId\":{JsonStr(spaceId)}}}");
                }
                else
                {
                    var json = "{"
                        + "\"type\":\"v025/save-space-failed\","
                        + $"\"spaceId\":{JsonStr(spaceId)},"
                        + $"\"outcome\":{JsonStr(result.Outcome.ToString())},"
                        + $"\"diagnostic\":{JsonStr(result.Diagnostic ?? string.Empty)}"
                        + "}";
                    _transport.Send(json);
                }
            }
            catch (System.Threading.Tasks.TaskCanceledException)
            {
                _transport.Send($"{{\"type\":\"v025/save-space-failed\",\"spaceId\":{JsonStr(spaceId)},\"outcome\":\"Cancelled\",\"diagnostic\":\"\"}}");
            }
        }

        private void SendSpawnOk(string cairnId, AttachOutcomeKind kind, float3 xyz, string diagnostic)
        {
            var json = "{"
                + "\"type\":\"v025/spawn-ok\","
                + $"\"cairnId\":{JsonStr(cairnId)},"
                + $"\"outcomeKind\":{JsonStr(kind.ToString())},"
                + $"\"finalXyz\":{{\"x\":{JsonNum(xyz.x)},\"y\":{JsonNum(xyz.y)},\"z\":{JsonNum(xyz.z)}}},"
                + $"\"diagnostic\":{JsonStr(diagnostic ?? string.Empty)}"
                + "}";
            _transport.Send(json);
        }

        private void SendSpawnRefused(string cairnId, string diagnostic)
        {
            var json = "{"
                + "\"type\":\"v025/spawn-refused\","
                + $"\"cairnId\":{JsonStr(cairnId)},"
                + $"\"diagnostic\":{JsonStr(diagnostic ?? string.Empty)}"
                + "}";
            _transport.Send(json);
        }

        private static float3 ParseXyz(Dictionary<string, object> msg, string key)
        {
            if (!msg.TryGetValue(key, out var raw) || !(raw is Dictionary<string, object> obj))
                return float3.zero;
            float Get(string k)
            {
                if (!obj.TryGetValue(k, out var v)) return 0f;
                if (v is double d) return (float)d;
                if (v is long l) return l;
                if (v is int i) return i;
                return 0f;
            }
            return new float3(Get("x"), Get("y"), Get("z"));
        }

        private static string JsonStr(string s)
        {
            if (s == null) return "null";
            // Minimal JSON escape: backslash and quote.
            var escaped = s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r");
            return "\"" + escaped + "\"";
        }

        private static string JsonNum(float f)
        {
            if (float.IsNaN(f) || float.IsInfinity(f)) return "0";
            return f.ToString("R", CultureInfo.InvariantCulture);
        }
    }

    /// <summary>
    /// Tiny JSON parser — enough for the v025 wire format (objects, strings,
    /// numbers, booleans, null). Avoids a Newtonsoft.Json dependency in v025.Runtime.
    /// </summary>
    internal static class MiniJson
    {
        public static Dictionary<string, object> Parse(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            int idx = 0;
            SkipWs(s, ref idx);
            var v = ParseValue(s, ref idx);
            return v as Dictionary<string, object>;
        }

        private static object ParseValue(string s, ref int i)
        {
            SkipWs(s, ref i);
            if (i >= s.Length) return null;
            char c = s[i];
            if (c == '{') return ParseObject(s, ref i);
            if (c == '[') return ParseArray(s, ref i);
            if (c == '"') return ParseString(s, ref i);
            if (c == 't' || c == 'f') return ParseBool(s, ref i);
            if (c == 'n') { i += 4; return null; }
            return ParseNumber(s, ref i);
        }

        private static Dictionary<string, object> ParseObject(string s, ref int i)
        {
            var dict = new Dictionary<string, object>();
            i++; // {
            SkipWs(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return dict; }
            while (i < s.Length)
            {
                SkipWs(s, ref i);
                var key = ParseString(s, ref i);
                SkipWs(s, ref i);
                if (i < s.Length && s[i] == ':') i++;
                var value = ParseValue(s, ref i);
                dict[key] = value;
                SkipWs(s, ref i);
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == '}') { i++; break; }
                break;
            }
            return dict;
        }

        private static List<object> ParseArray(string s, ref int i)
        {
            var list = new List<object>();
            i++; // [
            SkipWs(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return list; }
            while (i < s.Length)
            {
                list.Add(ParseValue(s, ref i));
                SkipWs(s, ref i);
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == ']') { i++; break; }
                break;
            }
            return list;
        }

        private static string ParseString(string s, ref int i)
        {
            if (i >= s.Length || s[i] != '"') return null;
            i++;
            var start = i;
            var sb = new System.Text.StringBuilder();
            while (i < s.Length && s[i] != '"')
            {
                if (s[i] == '\\' && i + 1 < s.Length)
                {
                    char next = s[i + 1];
                    if (next == 'n') sb.Append('\n');
                    else if (next == 'r') sb.Append('\r');
                    else if (next == 't') sb.Append('\t');
                    else sb.Append(next);
                    i += 2;
                    continue;
                }
                sb.Append(s[i]);
                i++;
            }
            if (i < s.Length) i++; // closing "
            return sb.ToString();
        }

        private static bool ParseBool(string s, ref int i)
        {
            if (i + 4 <= s.Length && s.Substring(i, 4) == "true") { i += 4; return true; }
            if (i + 5 <= s.Length && s.Substring(i, 5) == "false") { i += 5; return false; }
            i++;
            return false;
        }

        private static object ParseNumber(string s, ref int i)
        {
            var start = i;
            if (i < s.Length && (s[i] == '-' || s[i] == '+')) i++;
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '-' || s[i] == '+'))
                i++;
            var raw = s.Substring(start, i - start);
            if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
                return d;
            return 0.0;
        }

        private static void SkipWs(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }
    }
}
