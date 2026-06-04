using UnityEngine;
using System;
using System.Runtime.InteropServices;

/// <summary>
/// Unity -> RN bridge using @azesmway/react-native-unity's NativeCallProxy.
///
/// HOW IT WORKS:
///   1. Library ships unity/Assets/Plugins/iOS/{NativeCallProxy.h, .mm}
///      which we copied to our project. NativeCallProxy.mm exports a
///      C function `sendMessageToMobileApp(const char*)` that forwards
///      to the registered NativeCallsProtocol delegate (the RN side
///      RNUnityView registers itself as that delegate).
///   2. We P/Invoke that C function via [DllImport("__Internal")].
///   3. At xcframework build time the symbol is available because
///      NativeCallProxy.mm is compiled into UnityFramework.framework.
///   4. At RN integration time the same symbol's call routes into
///      RNUnityView.sendMessageToMobileApp: which fires the
///      onUnityMessage event handler on the JS side.
/// </summary>
public static class UnityNativeBridge
{
#if UNITY_IOS && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void sendMessageToMobileApp(string message);
#endif

    private static int  _sendCount = 0;
    private static bool _failureLogged = false;

    public static void Send(string message)
    {
        if (string.IsNullOrEmpty(message)) return;
        _sendCount++;

#if UNITY_IOS && !UNITY_EDITOR
        try
        {
            sendMessageToMobileApp(message);
        }
        catch (Exception e)
        {
            if (!_failureLogged)
            {
                _failureLogged = true;
                Debug.LogWarning("[CairnUnity][NativeBridge] Send failed: " + e.Message);
            }
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
