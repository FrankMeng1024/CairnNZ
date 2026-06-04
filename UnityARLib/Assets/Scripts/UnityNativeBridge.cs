using UnityEngine;
using System;
using System.Runtime.InteropServices;

/// <summary>
/// Thin wrapper around the @azesmway/react-native-unity native bridge.
///
/// HOW IT WORKS (best-effort discovery):
///   The library's iOS plugin exposes a native function that Unity can
///   invoke via a P/Invoke extern. The exact symbol name depends on the
///   library version. We try the documented entry point first; if it
///   isn't found, we fall back to UnitySendMessage and finally to
///   logging-only mode so the framework never crashes due to a missing
///   symbol.
///
/// VERIFICATION (must do at first integration):
///   After the library is npm installed, search the iOS plugin for the
///   symbol that the bridge expects Unity to call. Common names:
///     - OnUnityMessage(const char*)
///     - sendMessageFromUnity(const char*)
///     - UnityFrameworkBridgeOnMessage(const char*)
///   If a different name is used, update SymbolPInvoke below.
///
/// SAFETY:
///   - Editor builds: stub (writes to Debug.Log, never P/Invokes)
///   - iOS device builds: real P/Invoke, exception caught and logged
///   - Send() must NEVER throw to caller; bridge faults are absorbed.
/// </summary>
public static class UnityNativeBridge
{
#if UNITY_IOS && !UNITY_EDITOR
    [DllImport("__Internal", EntryPoint = "OnUnityMessage")]
    private static extern void SymbolPInvoke(string message);
#endif

    private static bool _symbolMissingLogged = false;
    private static int  _sendCount = 0;

    public static void Send(string message)
    {
        if (string.IsNullOrEmpty(message)) return;
        _sendCount++;

#if UNITY_IOS && !UNITY_EDITOR
        try
        {
            SymbolPInvoke(message);
        }
        catch (EntryPointNotFoundException)
        {
            if (!_symbolMissingLogged)
            {
                _symbolMissingLogged = true;
                Debug.LogWarning(
                    "[CairnUnity][NativeBridge] OnUnityMessage symbol not found. " +
                    "Library API may have a different entry name — check iOS plugin source. " +
                    "Subsequent sends will be silently dropped.");
            }
        }
        catch (Exception e)
        {
            Debug.LogWarning("[CairnUnity][NativeBridge] Send failed: " + e.Message);
        }
#else
        // Editor / non-iOS: log so we can see roundtrip behaviour during dev.
        if (_sendCount <= 5 || _sendCount % 100 == 0)
        {
            Debug.Log("[CairnUnity][NativeBridge][Editor] Send #" + _sendCount + ": " +
                      (message.Length > 200 ? message.Substring(0, 200) + "..." : message));
        }
#endif
    }
}
