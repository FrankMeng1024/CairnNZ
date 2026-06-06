using UnityEngine;
using System;
using System.Collections.Generic;

/// <summary>
/// Centralized logger. Goes to:
///   1. Unity Debug.Log (visible in Xcode console / Unity Editor console)
///   2. Forwards WARN/ERROR to RN via CairnBridge (INFO not forwarded by
///      default to avoid breadcrumb-buffer flood — see Cairn architect
///      review note on log volume).
///
/// Rate limiting: max ~5 forwards/sec. Excess dropped with a counter
/// summary at next allowed forward.
/// </summary>
public static class UnityLogger
{
    private const string PREFIX = "[CairnUnity]";
    private const int    MAX_FORWARDS_PER_SEC = 5;

    private static float _windowStart = 0f;
    private static int   _forwardsInWindow = 0;
    private static int   _droppedThisWindow = 0;

    public static void I(string tag, string msg)
    {
        var line = $"[{tag}] {msg}";
        Debug.Log(PREFIX + line);
        // INFO is NOT forwarded by default (steady-state events at
        // ~10 Hz would saturate RN's 500-slot ring buffer in seconds).
        // Re-enable per-call via IForward when needed for milestones.
    }

    public static void IForward(string tag, string msg)
    {
        var line = $"[{tag}] {msg}";
        Debug.Log(PREFIX + line);
        ForwardToRN("info", line);
    }

    public static void W(string tag, string msg)
    {
        var line = $"[{tag}][WARN] {msg}";
        Debug.LogWarning(PREFIX + line);
        ForwardToRN("warn", line);
    }

    public static void E(string tag, string msg, Exception e = null)
    {
        var ex = e != null ? $" | {e.GetType().Name}: {e.Message}" : "";
        var line = $"[{tag}][ERROR] {msg}{ex}";
        Debug.LogError(PREFIX + line);
        ForwardToRN("error", line);
        if (e != null && !string.IsNullOrEmpty(e.StackTrace))
        {
            Debug.LogError(PREFIX + "[" + tag + "][STACK] " + e.StackTrace);
        }
    }

    private static void ForwardToRN(string level, string line)
    {
        try
        {
            // LOG-GAP-5 fix: ERROR level bypasses rate-limit. Errors are rare
            // and represent the highest-value diagnostic signal — losing them
            // to rate-limit (e.g. during a tight exception loop) destroys the
            // ability to root-cause from telemetry. Info/warn still rate-limited.
            if (level == "error")
            {
                CairnBridge.Instance?.SendUnityLog(level, line);
                return;
            }

            // Rate-limit window of 1 second.
            float now = Time.realtimeSinceStartup;
            if (now - _windowStart > 1f)
            {
                if (_droppedThisWindow > 0)
                {
                    var summary = $"[UnityLogger] dropped {_droppedThisWindow} forwards (rate-limited)";
                    CairnBridge.Instance?.SendUnityLog("warn", summary);
                }
                _windowStart = now;
                _forwardsInWindow = 0;
                _droppedThisWindow = 0;
            }

            if (_forwardsInWindow >= MAX_FORWARDS_PER_SEC)
            {
                _droppedThisWindow++;
                return;
            }

            _forwardsInWindow++;
            CairnBridge.Instance?.SendUnityLog(level, line);
        }
        catch
        {
            // Logger failures must never recurse / crash.
        }
    }
}
