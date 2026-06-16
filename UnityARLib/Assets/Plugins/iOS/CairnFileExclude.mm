// CairnFileExclude.mm — Phase 4.1a iOS-only Objective-C++ bridge.
//
// Purpose:
//   ARWorldMap blobs persist to Application.persistentDataPath. By default these
//   files are backed up to iCloud, which (a) violates Apple's "files NOT meant
//   for sync should set the no-backup attribute" guidance, and (b) consumes
//   user iCloud storage for what is effectively a local disk cache.
//
// Provides a single C-callable function:
//   int Cairn_ExcludeFromBackup(const char* utf8Path);
//     return: 0 = success, non-zero = error code (errno-like)
//
// Called from C# via DllImport("__Internal", EntryPoint = "Cairn_ExcludeFromBackup").
// On non-iOS builds this file is excluded by Plugins/iOS/ + UNITY_IOS define.

#import <Foundation/Foundation.h>

#ifdef __cplusplus
extern "C" {
#endif

int Cairn_ExcludeFromBackup(const char* utf8Path)
{
    if (utf8Path == NULL) return -1;

    @autoreleasepool {
        NSString* path = [NSString stringWithUTF8String:utf8Path];
        if (path == nil) return -2;

        NSURL* url = [NSURL fileURLWithPath:path];
        if (url == nil) return -3;

        NSError* err = nil;
        BOOL ok = [url setResourceValue:@(YES)
                                 forKey:NSURLIsExcludedFromBackupKey
                                  error:&err];
        if (!ok) {
            // err.code typically NSFileReadNoSuchFileError (260) when path missing
            return (int)err.code;
        }
        return 0;
    }
}

#ifdef __cplusplus
}
#endif
