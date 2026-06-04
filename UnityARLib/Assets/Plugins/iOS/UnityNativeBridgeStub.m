// UnityNativeBridgeStub.m
//
// Weak stub for the OnUnityMessage symbol that Unity's IL2CPP-generated
// code expects at link time. The real implementation is provided by
// @azesmway/react-native-unity once the xcframework is integrated into
// the host React Native app.
//
// HOW THIS WORKS:
//   1. At UnityFramework.xcframework BUILD time (in CI): this file
//      provides a weak default symbol so the linker is satisfied. The
//      stub does nothing useful but logs to NSLog so we can see if RN
//      integration accidentally didn't override it.
//   2. At HOST APP integration time (in EAS Build): the
//      react-native-unity library's iOS plugin defines a stronger,
//      non-weak `OnUnityMessage` symbol with the real implementation
//      that forwards to the React Native bridge. The strong symbol
//      wins, our stub is shadowed, no behavior change.
//
// If after RN integration we ever see the "[CairnUnity][NativeBridge-Stub]"
// log lines on device, it means RN's symbol wasn't picked up — investigate
// linker order / library inclusion.

#import <Foundation/Foundation.h>

// `__attribute__((weak))` makes this symbol weak — any non-weak
// definition with the same name will override it at link time.
__attribute__((visibility("default")))
__attribute__((weak))
void OnUnityMessage(const char* message) {
    NSLog(@"[CairnUnity][NativeBridge-Stub] OnUnityMessage called BUT no host app override is present. Message: %s",
          message ? message : "(null)");
}
