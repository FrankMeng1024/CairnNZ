#import <Foundation/Foundation.h>
#import "NativeCallProxy.h"

@implementation FrameworkLibAPI

id<NativeCallsProtocol> api = NULL;
+(void) registerAPIforNativeCalls:(id<NativeCallsProtocol>) aApi
{
    api = aApi;
}

@end

extern "C"
{
    // Explicit default visibility: `BUILD_LIBRARY_FOR_DISTRIBUTION=YES` plus
    // Xcode's framework template default `GCC_SYMBOLS_PRIVATE_EXTERN=YES`
    // can hide otherwise-default-visibility C symbols. Mark this one
    // explicitly so dlsym(RTLD_DEFAULT, "sendMessageToMobileApp") resolves
    // when Unity's IL2CPP DllImport("__Internal") looks it up at runtime.
    __attribute__((visibility("default")))
    void sendMessageToMobileApp(const char* message)
    {
        return [api sendMessageToMobileApp:[NSString stringWithUTF8String:message]];
    }
}
