/**
 * Expo config plugin: ensure UnityFramework.framework is added to the
 * app target's "Embed & Sign" Frameworks build phase.
 *
 * Why this is needed:
 *   - @azesmway/react-native-unity 1.0.11 ships its podspec with
 *     vendored_frameworks = ["ios/UnityFramework.framework"]. CocoaPods
 *     LINKS the framework but does NOT auto-embed it on Expo 54 / RN 0.81.
 *   - Without embedding, [NSBundle bundleWithPath:@"<App.app>/Frameworks/UnityFramework.framework"]
 *     returns nil at runtime, and Unity init fails silently.
 *
 * Also patches RNUnityView.mm to:
 *
 *   CHANGE A — PR #174 fix (Fabric / New Architecture):
 *     Fabric only calls updateProps when props actually change. On first
 *     render with no props, updateProps never fires → initUnityModule never
 *     called → Unity permanently silent. Fix: call initUnityModule from
 *     initWithFrame: in RCT_NEW_ARCH_ENABLED branch. initWithFrame: fires
 *     exactly once before any layout pass.
 *
 *   CHANGE B — NSLog→CAIRN_LOG diagnostics in UnityFrameworkLoad():
 *     Replaces [bundle load] with [bundle loadAndReturnError:], returns nil
 *     immediately on failure. Full CAIRN_LOG at each nil-risk step.
 *
 *   CHANGE C — nil guard in initUnityModule (PR #183 pattern).
 *
 *   CHANGE D — exception catch with full callStackSymbols.
 *
 *   CHANGE E — remove setWindowScene:nil + makeKeyAndVisible (iOS 26 fix):
 *     setWindowScene:nil detaches Unity window from display on iOS 26
 *     mandatory-scene lifecycle. makeKeyAndVisible promotes Unity UIWindow
 *     above RN window → breaks touch. Fix: addSubview rootView to self.
 *
 *   CHANGE F — CAIRN_LOG macro bridges NSLog to RN/remote telemetry.
 *     cairnLogBridge is a file-scope __weak RNUnityView* set in initWithFrame:
 *     before calling initUnityModule. CAIRN_LOG writes NSLog AND calls
 *     sendMessageToMobileApp: as "NativeLog|INFO|..." → JS onUnityMessage
 *     → kind:'UnityLog' → crashLogger.breadcrumb → uploadDiagnostic.
 *
 *   CHANGE G — runEmbeddedWithArgc: + registerFrameworkListener + FrameworkLibAPI logs.
 *     These are the most failure-prone calls post-load. Previously unlogged.
 *     Steps 7-10 cover: registerFrameworkListener, runEmbeddedWithArgc start/end,
 *     quitHandler result, FrameworkLibAPI cls check + registerAPIforNativeCalls.
 *     Also logs post-attach rootView frame (layout sanity check).
 *
 *   CHANGE H — unityDidUnload / unityDidQuit CAIRN_LOG.
 *     Unity dying after init (Metal fault, license check, asset corruption)
 *     was previously completely silent. Now logs entry + ufw pointer.
 *
 *   CHANGE I — prepareForRecycle CAIRN_LOG (Fabric view recycling).
 *     Fabric can recycle RNUnityView during a re-render storm → Unity
 *     unloads silently. Now logged.
 *
 *   CHANGE J — AsyncStorage checkpoint at each init step (crash survival).
 *     If runEmbeddedWithArgc causes a C++ crash / Metal SIGABRT, the app
 *     process dies before any RN message can be sent and before the 5s
 *     auto-upload fires. Mitigated by writing a checkpoint key to
 *     NSUserDefaults at each step; on next launch RN reads it via
 *     crashLogger.uploadV163CheckpointIfAny-style logic and uploads.
 *     Key: 'cairn_unity_init_step'. Cleared after ArReady fires (on JS side).
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

const HOOK_MARKER = '# CAIRN_UNITY_EMBED_HOOK_V2';

const HOOK_BODY = `    ${HOOK_MARKER}
    installer.pods_project.targets.each do |t|
      if t.name == 'react-native-unity'
        t.build_configurations.each do |config|
          config.build_settings['BUILD_LIBRARY_FOR_DISTRIBUTION'] = 'YES'
        end
      end
    end

    installer.aggregate_targets.each do |aggregate_target|
      user_project = aggregate_target.user_project
      user_project.native_targets.each do |native_target|
        next unless native_target.product_type == 'com.apple.product-type.application'

        embed_phase = native_target.build_phases.find { |phase|
          phase.respond_to?(:symbol_dst_subfolder_spec) &&
            phase.symbol_dst_subfolder_spec == :frameworks
        }

        if embed_phase.nil?
          embed_phase = user_project.new(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase)
          embed_phase.name = 'Embed Frameworks'
          embed_phase.symbol_dst_subfolder_spec = :frameworks
          native_target.build_phases << embed_phase
        end

        already = embed_phase.files.any? { |f|
          f.display_name && f.display_name == 'UnityFramework.framework'
        }

        unless already
          unity_fw_ref = nil
          installer.pods_project.files.each do |f|
            if f.path && f.path.end_with?('UnityFramework.framework')
              unity_fw_ref = f
              break
            end
          end

          if unity_fw_ref
            build_file = embed_phase.add_file_reference(unity_fw_ref)
            build_file.settings = { 'ATTRIBUTES' => ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] }
            puts '[CairnUnity] UnityFramework.framework added to Embed Frameworks (CodeSignOnCopy)'
          else
            puts '[CairnUnity][WARN] UnityFramework.framework reference NOT FOUND in Pods project'
          end
        else
          puts '[CairnUnity] UnityFramework.framework already in Embed Frameworks'
        end
      end
      user_project.save
    end
`;

function insertAfterAnchor(insert, target, contents) {
  if (contents.includes(insert)) return contents;
  const lines = contents.split('\n');
  const idx = lines.findIndex(l => l.includes(target));
  if (idx === -1) return null;
  return [
    ...lines.slice(0, idx + 1),
    insert,
    ...lines.slice(idx + 1),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// RNUnityView.mm patch — ten changes, marker-guarded, idempotent
// ---------------------------------------------------------------------------

const MM_PATCH_MARKER = '// CAIRN_UNITY_MM_PATCH_V4';

// ---------------------------------------------------------------------------
// CHANGE F: CAIRN_LOG macro + cairnLogBridge + cairnCheckpoint helper.
// Injected before bundlePathStr so it's available to UnityFrameworkLoad().
//
// cairnCheckpoint() writes a step name to NSUserDefaults so that if a C++
// crash kills the app during runEmbeddedWithArgc:, the next launch can read
// the last reached step and upload it as a diagnostic. Cleared by JS after
// ArReady fires.
// ---------------------------------------------------------------------------

const BUNDLE_PATH_STR_LINE = 'NSString *bundlePathStr = @"/Frameworks/UnityFramework.framework";';

const CAIRN_LOG_MACRO_BLOCK = `// CAIRN CHANGE F+J: NSLog→RN bridge + crash-survival checkpoint.
static __weak RNUnityView *cairnLogBridge = nil;

static void cairnSendLog(NSString *msg) {
    RNUnityView *bridge = cairnLogBridge;
    if (bridge) {
        NSString *payload = [@"NativeLog|INFO|" stringByAppendingString:msg];
        [bridge sendMessageToMobileApp:payload];
    }
}

// cairnCheckpoint: persist current init step for crash-survival diagnosis.
// Writes to NSUserDefaults (survives app kill) AND sends a Checkpoint message
// to JS via sendMessageToMobileApp (JS writes to AsyncStorage and uploads on
// next launch if ArReady never fired). JS clears both on ArReady.
static void cairnCheckpoint(NSString *step) {
    [[NSUserDefaults standardUserDefaults] setObject:step forKey:@"cairn_unity_init_step"];
    [[NSUserDefaults standardUserDefaults] synchronize];
    // Also forward to JS so it can persist in AsyncStorage (readable cross-platform)
    RNUnityView *bridge = cairnLogBridge;
    if (bridge) {
        NSString *payload = [@"Checkpoint|" stringByAppendingString:step];
        [bridge sendMessageToMobileApp:payload];
    }
}

#define CAIRN_LOG(fmt, ...) do { \\
    NSString *_cairnMsg = [NSString stringWithFormat:fmt, ##__VA_ARGS__]; \\
    NSLog(@"%@", _cairnMsg); \\
    cairnSendLog(_cairnMsg); \\
} while(0)

${BUNDLE_PATH_STR_LINE}`;

// ---------------------------------------------------------------------------
// CHANGE A: initWithFrame: (New Arch) — PR #174 fix + set cairnLogBridge.
// ---------------------------------------------------------------------------
const INIT_WITH_FRAME_NEW_ARCH_ORIGINAL = `- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const RNUnityViewProps>();
    _props = defaultProps;

    self.onUnityMessage = [self](NSDictionary* data) {
      if (_eventEmitter != nil) {
        auto gridViewEventEmitter = std::static_pointer_cast<RNUnityViewEventEmitter const>(_eventEmitter);
        facebook::react::RNUnityViewEventEmitter::OnUnityMessage event = {
          .message=[[data valueForKey:@"message"] UTF8String]
        };
        gridViewEventEmitter->onUnityMessage(event);
      }
    };
  }

  return self;
}`;

const INIT_WITH_FRAME_NEW_ARCH_PATCHED = `${MM_PATCH_MARKER}
- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const RNUnityViewProps>();
    _props = defaultProps;

    self.onUnityMessage = [self](NSDictionary* data) {
      if (_eventEmitter != nil) {
        auto gridViewEventEmitter = std::static_pointer_cast<RNUnityViewEventEmitter const>(_eventEmitter);
        facebook::react::RNUnityViewEventEmitter::OnUnityMessage event = {
          .message=[[data valueForKey:@"message"] UTF8String]
        };
        gridViewEventEmitter->onUnityMessage(event);
      }
    };

    // CHANGE F: set bridge pointer BEFORE initUnityModule so UnityFrameworkLoad()
    // can forward step1-6 logs to JS from the very start.
    cairnLogBridge = self;

    // CHANGE A (PR #174): Fabric does not reliably call updateProps when no props
    // change on first render. initWithFrame: fires exactly once before any layout
    // pass — the correct init point. layoutSubviews would re-enter during
    // runEmbeddedWithArgc: (appController not yet set → unityIsInitialized false
    // → double init → crash).
    CAIRN_LOG(@"[CAIRN-UFW] initWithFrame: Fabric PR#174 — calling initUnityModule");
    if (![self unityIsInitialized]) {
      [self initUnityModule];
    }
  }

  return self;
}`;

// ---------------------------------------------------------------------------
// CHANGE B: UnityFrameworkLoad() — full CAIRN_LOG + return nil on failure.
// ---------------------------------------------------------------------------
const UFW_LOAD_ORIGINAL = `UnityFramework* UnityFrameworkLoad() {
    NSString* bundlePath = nil;
    bundlePath = [[NSBundle mainBundle] bundlePath];
    bundlePath = [bundlePath stringByAppendingString: bundlePathStr];

    NSBundle* bundle = [NSBundle bundleWithPath: bundlePath];
    if ([bundle isLoaded] == false) [bundle load];

    UnityFramework* ufw = [bundle.principalClass getInstance];
    if (![ufw appController])
    {
#ifdef DEBUG
      [ufw setExecuteHeader: &_mh_dylib_header];
#else
      [ufw setExecuteHeader: &_mh_execute_header];
#endif
    }

    [ufw setDataBundleId: [bundle.bundleIdentifier cStringUsingEncoding:NSUTF8StringEncoding]];

    return ufw;
}`;

const UFW_LOAD_PATCHED = `UnityFramework* UnityFrameworkLoad() {
    NSString* bundlePath = nil;
    bundlePath = [[NSBundle mainBundle] bundlePath];
    bundlePath = [bundlePath stringByAppendingString: bundlePathStr];
    cairnCheckpoint(@"step1-bundlePath");
    CAIRN_LOG(@"[CAIRN-UFW] step1 bundlePath=%@", bundlePath ?: @"<nil>");

    NSBundle* bundle = [NSBundle bundleWithPath: bundlePath];
    CAIRN_LOG(@"[CAIRN-UFW] step2 bundle=%@ isLoaded=%d",
              bundle ? @"non-nil" : @"<nil>", bundle ? (int)[bundle isLoaded] : -1);
    if (bundle == nil) {
        cairnCheckpoint(@"step2-FATAL-bundle-nil");
        CAIRN_LOG(@"[CAIRN-UFW] FATAL: bundleWithPath returned nil — framework not embedded or path wrong");
        return nil;
    }

    cairnCheckpoint(@"step3-loading-bundle");
    if ([bundle isLoaded] == false) {
        NSError* loadErr = nil;
        BOOL ok = [bundle loadAndReturnError:&loadErr];
        if (!ok || loadErr) {
            cairnCheckpoint(@"step3-FATAL-load-failed");
            CAIRN_LOG(@"[CAIRN-UFW] step3 LOAD FAILED ok=%d domain=%@ code=%ld desc=%@ reason=%@ underlying=%@",
                      ok,
                      loadErr.domain ?: @"<nil>",
                      (long)loadErr.code,
                      loadErr.localizedDescription ?: @"<nil>",
                      loadErr.localizedFailureReason ?: @"<nil>",
                      [loadErr.userInfo[NSUnderlyingErrorKey] description] ?: @"<nil>");
            return nil;
        }
        CAIRN_LOG(@"[CAIRN-UFW] step3 load OK");
    } else {
        CAIRN_LOG(@"[CAIRN-UFW] step3 already loaded");
    }

    cairnCheckpoint(@"step4-principalClass");
    Class pc = bundle.principalClass;
    CAIRN_LOG(@"[CAIRN-UFW] step4 principalClass=%@", pc ? NSStringFromClass(pc) : @"<nil>");
    if (pc == nil) {
        cairnCheckpoint(@"step4-FATAL-principalClass-nil");
        CAIRN_LOG(@"[CAIRN-UFW] FATAL: principalClass nil — NSPrincipalClass missing in Info.plist or class not found");
        return nil;
    }

    cairnCheckpoint(@"step5-getInstance");
    UnityFramework* ufw = [pc getInstance];
    CAIRN_LOG(@"[CAIRN-UFW] step5 ufw=%p appController=%p", ufw, [ufw appController]);
    if (ufw == nil) {
        cairnCheckpoint(@"step5-FATAL-ufw-nil");
        CAIRN_LOG(@"[CAIRN-UFW] FATAL: [principalClass getInstance] returned nil");
        return nil;
    }

    if (![ufw appController]) {
#ifdef DEBUG
      [ufw setExecuteHeader: &_mh_dylib_header];
#else
      [ufw setExecuteHeader: &_mh_execute_header];
#endif
    }

    [ufw setDataBundleId: [bundle.bundleIdentifier cStringUsingEncoding:NSUTF8StringEncoding]];
    cairnCheckpoint(@"step6-ufw-ready");
    CAIRN_LOG(@"[CAIRN-UFW] step6 ufw ready bundleId=%@", [bundle bundleIdentifier] ?: @"<nil>");

    return ufw;
}`;

// ---------------------------------------------------------------------------
// CHANGE C: initUnityModule entry — nil guard + CAIRN_LOG.
// ---------------------------------------------------------------------------
const INIT_UNITY_ENTRY_ORIGINAL = `- (void)initUnityModule {
    @try {
        if([self unityIsInitialized]) {
            return;
        }

        [self setUfw: UnityFrameworkLoad()];`;

const INIT_UNITY_ENTRY_PATCHED = `- (void)initUnityModule {
    CAIRN_LOG(@"[CAIRN-UFW] initUnityModule entered alreadyInit=%d", (int)[self unityIsInitialized]);
    @try {
        if([self unityIsInitialized]) {
            CAIRN_LOG(@"[CAIRN-UFW] initUnityModule: already initialized, skipping");
            return;
        }

        [self setUfw: UnityFrameworkLoad()];
        CAIRN_LOG(@"[CAIRN-UFW] initUnityModule after-load ufw=%p", [self ufw]);
        if (![self ufw]) {
            cairnCheckpoint(@"initUnityModule-FATAL-ufw-nil");
            CAIRN_LOG(@"[CAIRN-UFW] initUnityModule FATAL: UnityFrameworkLoad returned nil, aborting");
            return;
        }`;

// ---------------------------------------------------------------------------
// CHANGE G: runEmbeddedWithArgc: + registerFrameworkListener + FrameworkLibAPI logs.
// Replaces the block from registerFrameworkListener through FrameworkLibAPI.
// ---------------------------------------------------------------------------
const RUN_EMBEDDED_ORIGINAL = `        [[self ufw] registerFrameworkListener: self];

        unsigned count = (int) [[[NSProcessInfo processInfo] arguments] count];
        char **array = (char **)malloc((count + 1) * sizeof(char*));

        for (unsigned i = 0; i < count; i++)
        {
             array[i] = strdup([[[[NSProcessInfo processInfo] arguments] objectAtIndex:i] UTF8String]);
        }
        array[count] = NULL;

        [[self ufw] runEmbeddedWithArgc: gArgc argv: array appLaunchOpts: appLaunchOpts];
        [[self ufw] appController].quitHandler = ^(){ NSLog(@"AppController.quitHandler called"); };
        [self.ufw.appController.rootView removeFromSuperview];`;

const RUN_EMBEDDED_PATCHED = `        // CHANGE G: step7 — registerFrameworkListener
        cairnCheckpoint(@"step7-registerFrameworkListener");
        CAIRN_LOG(@"[CAIRN-UFW] step7 registerFrameworkListener");
        [[self ufw] registerFrameworkListener: self];

        unsigned count = (int) [[[NSProcessInfo processInfo] arguments] count];
        char **array = (char **)malloc((count + 1) * sizeof(char*));

        for (unsigned i = 0; i < count; i++)
        {
             array[i] = strdup([[[[NSProcessInfo processInfo] arguments] objectAtIndex:i] UTF8String]);
        }
        array[count] = NULL;

        // CHANGE G: step8 — runEmbeddedWithArgc (most failure-prone call: Metal init,
        // Unity bootstrap, rendering pipeline). C++ exceptions from here are NOT caught
        // by @try/@catch (ObjC only). cairnCheckpoint survives a crash for next-launch upload.
        cairnCheckpoint(@"step8-runEmbeddedWithArgc-START");
        CAIRN_LOG(@"[CAIRN-UFW] step8 runEmbeddedWithArgc START");
        [[self ufw] runEmbeddedWithArgc: gArgc argv: array appLaunchOpts: appLaunchOpts];
        cairnCheckpoint(@"step9-runEmbeddedWithArgc-DONE");
        CAIRN_LOG(@"[CAIRN-UFW] step9 runEmbeddedWithArgc DONE appController=%p", [[self ufw] appController]);

        // CHANGE G: quitHandler with CAIRN_LOG (was plain NSLog)
        [[self ufw] appController].quitHandler = ^(){
            CAIRN_LOG(@"[CAIRN-UFW] AppController.quitHandler fired — Unity quit");
        };
        [self.ufw.appController.rootView removeFromSuperview];`;

// ---------------------------------------------------------------------------
// CHANGE E: remove setWindowScene:nil + makeKeyAndVisible (iOS 26 fix).
// Also adds post-attach frame log and FrameworkLibAPI check (CHANGE G cont.)
// ---------------------------------------------------------------------------
const WINDOW_SCENE_ORIGINAL = `        if (@available(iOS 13.0, *)) {
            [[[[self ufw] appController] window] setWindowScene: nil];
        } else {
            [[[[self ufw] appController] window] setScreen: nil];
        }

        [[[[self ufw] appController] window] addSubview: self.ufw.appController.rootView];
        [[[[self ufw] appController] window] makeKeyAndVisible];
        [[[[[[self ufw] appController] window] rootViewController] view] setNeedsLayout];

        [NSClassFromString(@"FrameworkLibAPI") registerAPIforNativeCalls:self];`;

const WINDOW_SCENE_PATCHED = `        // CHANGE E (iOS 26): do NOT call setWindowScene:nil (detaches Unity window
        // from active UIScene on iOS 26 mandatory-scene lifecycle → renders nothing)
        // and do NOT call makeKeyAndVisible (promotes Unity UIWindow above RN window
        // → breaks all touch handling).
        // Add rootView directly to self — self fills the screen via
        // StyleSheet.absoluteFill in UnityAROverlay.tsx.
        cairnCheckpoint(@"step10-attachRootView");
        CAIRN_LOG(@"[CAIRN-UFW] step10 attaching rootView to self (iOS 26 safe)");
        [self addSubview: self.ufw.appController.rootView];
        [[[[[[self ufw] appController] window] rootViewController] view] setNeedsLayout];
        CAIRN_LOG(@"[CAIRN-UFW] step10 rootView.frame={{%.0f,%.0f},{%.0f,%.0f}} self.bounds={{%.0f,%.0f},{%.0f,%.0f}}",
                  self.ufw.appController.rootView.frame.origin.x,
                  self.ufw.appController.rootView.frame.origin.y,
                  self.ufw.appController.rootView.frame.size.width,
                  self.ufw.appController.rootView.frame.size.height,
                  self.bounds.origin.x, self.bounds.origin.y,
                  self.bounds.size.width, self.bounds.size.height);

        // CHANGE G: step11 — FrameworkLibAPI (wires Unity→RN message channel).
        // NSClassFromString returning nil means sendMessageToMobileApp will never
        // be called from Unity side (ArReady/ArFrame/Pong all silent).
        cairnCheckpoint(@"step11-FrameworkLibAPI");
        Class fwLibCls = NSClassFromString(@"FrameworkLibAPI");
        CAIRN_LOG(@"[CAIRN-UFW] step11 FrameworkLibAPI cls=%@ (nil=channel broken)", fwLibCls ? NSStringFromClass(fwLibCls) : @"<nil>");
        if (fwLibCls) {
            [fwLibCls registerAPIforNativeCalls:self];
            CAIRN_LOG(@"[CAIRN-UFW] step11 registerAPIforNativeCalls done");
        } else {
            CAIRN_LOG(@"[CAIRN-UFW] step11 WARN: FrameworkLibAPI not found — Unity→RN messages will be silent");
        }
        cairnCheckpoint(@"step11-init-COMPLETE");`;

// ---------------------------------------------------------------------------
// CHANGE D: catch block — richer stack trace.
// ---------------------------------------------------------------------------
const CATCH_ORIGINAL = `    @catch (NSException *e) {
        NSLog(@"%@",e);
    }`;

const CATCH_PATCHED = `    @catch (NSException *e) {
        cairnCheckpoint(@"initUnityModule-EXCEPTION");
        CAIRN_LOG(@"[CAIRN-UFW] initUnityModule EXCEPTION name=%@ reason=%@ stack=%@",
                  e.name, e.reason, [e callStackSymbols]);
    }`;

// ---------------------------------------------------------------------------
// CHANGE H: unityDidUnload / unityDidQuit — CAIRN_LOG entry.
// ---------------------------------------------------------------------------
const UNITY_DID_UNLOAD_ORIGINAL = `- (void)unityDidUnload:(NSNotification*)notification {
    if([self unityIsInitialized]) {
        [[self ufw] unregisterFrameworkListener:self];
        [self setUfw: nil];

        if (self.onPlayerUnload) {
            self.onPlayerUnload(nil);
        }
    }
}

- (void)unityDidQuit:(NSNotification*)notification {
    if([self unityIsInitialized]) {
        [[self ufw] unregisterFrameworkListener:self];
        [self setUfw: nil];

        if (self.onPlayerQuit) {
            self.onPlayerQuit(nil);
        }
    }
}`;

const UNITY_DID_UNLOAD_PATCHED = `- (void)unityDidUnload:(NSNotification*)notification {
    CAIRN_LOG(@"[CAIRN-UFW] unityDidUnload ufw=%p initialized=%d", [self ufw], (int)[self unityIsInitialized]);
    if([self unityIsInitialized]) {
        [[self ufw] unregisterFrameworkListener:self];
        [self setUfw: nil];

        if (self.onPlayerUnload) {
            self.onPlayerUnload(nil);
        }
    }
}

- (void)unityDidQuit:(NSNotification*)notification {
    CAIRN_LOG(@"[CAIRN-UFW] unityDidQuit ufw=%p initialized=%d", [self ufw], (int)[self unityIsInitialized]);
    if([self unityIsInitialized]) {
        [[self ufw] unregisterFrameworkListener:self];
        [self setUfw: nil];

        if (self.onPlayerQuit) {
            self.onPlayerQuit(nil);
        }
    }
}`;

// ---------------------------------------------------------------------------
// CHANGE I: prepareForRecycle (Fabric) — CAIRN_LOG.
// ---------------------------------------------------------------------------
const PREPARE_FOR_RECYCLE_ORIGINAL = `- (void)prepareForRecycle {
    [super prepareForRecycle];

    if ([self unityIsInitialized]) {
      [[self ufw] unloadApplication];

      NSArray *viewsToRemove = self.subviews;
      for (UIView *v in viewsToRemove) {
          [v removeFromSuperview];
      }

      [self setUfw:nil];
    }
}`;

const PREPARE_FOR_RECYCLE_PATCHED = `- (void)prepareForRecycle {
    CAIRN_LOG(@"[CAIRN-UFW] prepareForRecycle ufw=%p initialized=%d (Fabric view recycle)", [self ufw], (int)[self unityIsInitialized]);
    [super prepareForRecycle];

    if ([self unityIsInitialized]) {
      [[self ufw] unloadApplication];

      NSArray *viewsToRemove = self.subviews;
      for (UIView *v in viewsToRemove) {
          [v removeFromSuperview];
      }

      [self setUfw:nil];
      CAIRN_LOG(@"[CAIRN-UFW] prepareForRecycle done — ufw cleared");
    }
}`;

// ---------------------------------------------------------------------------
// Patch function
// ---------------------------------------------------------------------------

function patchRNUnityViewMM(mmPath) {
  if (!fs.existsSync(mmPath)) {
    throw new Error(`[withUnityEmbed] RNUnityView.mm not found at ${mmPath}`);
  }

  let src = fs.readFileSync(mmPath, 'utf8');

  if (src.includes(MM_PATCH_MARKER)) {
    console.log('[withUnityEmbed] RNUnityView.mm already patched (V4), skipping');
    return;
  }

  const OLD_MARKERS = ['// CAIRN_UNITY_MM_PATCH_V1', '// CAIRN_UNITY_MM_PATCH_V2', '// CAIRN_UNITY_MM_PATCH_V3'];
  const foundOld = OLD_MARKERS.find(m => src.includes(m));
  if (foundOld) {
    throw new Error(
      `[withUnityEmbed] RNUnityView.mm has old marker ${foundOld} — applying V4 is unsafe. ` +
      'Delete node_modules/@azesmway/react-native-unity and run `npm ci`, then re-run prebuild.'
    );
  }

  let patched = src;
  const failures = [];

  // CHANGE F+J: CAIRN_LOG macro + cairnCheckpoint
  if (patched.includes(BUNDLE_PATH_STR_LINE)) {
    patched = patched.replace(BUNDLE_PATH_STR_LINE, CAIRN_LOG_MACRO_BLOCK);
    console.log('[withUnityEmbed] CHANGE F+J applied: CAIRN_LOG macro + cairnCheckpoint injected');
  } else {
    failures.push('CHANGE F+J: bundlePathStr anchor not found');
  }

  // CHANGE A: initWithFrame: PR #174 fix
  if (patched.includes(INIT_WITH_FRAME_NEW_ARCH_ORIGINAL)) {
    patched = patched.replace(INIT_WITH_FRAME_NEW_ARCH_ORIGINAL, INIT_WITH_FRAME_NEW_ARCH_PATCHED);
    console.log('[withUnityEmbed] CHANGE A applied: initWithFrame: PR#174 + cairnLogBridge');
  } else {
    failures.push('CHANGE A: initWithFrame: (New Arch) anchor not found');
  }

  // CHANGE B: UnityFrameworkLoad
  if (patched.includes(UFW_LOAD_ORIGINAL)) {
    patched = patched.replace(UFW_LOAD_ORIGINAL, UFW_LOAD_PATCHED);
    console.log('[withUnityEmbed] CHANGE B applied: UnityFrameworkLoad CAIRN_LOG + return nil');
  } else {
    failures.push('CHANGE B: UnityFrameworkLoad anchor not found');
  }

  // CHANGE C: initUnityModule nil guard
  if (patched.includes(INIT_UNITY_ENTRY_ORIGINAL)) {
    patched = patched.replace(INIT_UNITY_ENTRY_ORIGINAL, INIT_UNITY_ENTRY_PATCHED);
    console.log('[withUnityEmbed] CHANGE C applied: initUnityModule nil guard');
  } else {
    failures.push('CHANGE C: initUnityModule entry anchor not found');
  }

  // CHANGE G: runEmbeddedWithArgc + registerFrameworkListener
  if (patched.includes(RUN_EMBEDDED_ORIGINAL)) {
    patched = patched.replace(RUN_EMBEDDED_ORIGINAL, RUN_EMBEDDED_PATCHED);
    console.log('[withUnityEmbed] CHANGE G applied: runEmbeddedWithArgc + registerFrameworkListener logs');
  } else {
    failures.push('CHANGE G: runEmbeddedWithArgc anchor not found');
  }

  // CHANGE E + G(FrameworkLibAPI): window scene fix + attach + FrameworkLibAPI check
  if (patched.includes(WINDOW_SCENE_ORIGINAL)) {
    patched = patched.replace(WINDOW_SCENE_ORIGINAL, WINDOW_SCENE_PATCHED);
    console.log('[withUnityEmbed] CHANGE E+G applied: iOS 26 window fix + FrameworkLibAPI check');
  } else {
    failures.push('CHANGE E+G: setWindowScene block anchor not found');
  }

  // CHANGE D: catch block
  if (patched.includes(CATCH_ORIGINAL)) {
    patched = patched.replace(CATCH_ORIGINAL, CATCH_PATCHED);
    console.log('[withUnityEmbed] CHANGE D applied: exception catch with callStackSymbols');
  } else {
    failures.push('CHANGE D: catch block anchor not found');
  }

  // CHANGE H: unityDidUnload / unityDidQuit
  if (patched.includes(UNITY_DID_UNLOAD_ORIGINAL)) {
    patched = patched.replace(UNITY_DID_UNLOAD_ORIGINAL, UNITY_DID_UNLOAD_PATCHED);
    console.log('[withUnityEmbed] CHANGE H applied: unityDidUnload + unityDidQuit CAIRN_LOG');
  } else {
    failures.push('CHANGE H: unityDidUnload/unityDidQuit anchor not found');
  }

  // CHANGE I: prepareForRecycle
  if (patched.includes(PREPARE_FOR_RECYCLE_ORIGINAL)) {
    patched = patched.replace(PREPARE_FOR_RECYCLE_ORIGINAL, PREPARE_FOR_RECYCLE_PATCHED);
    console.log('[withUnityEmbed] CHANGE I applied: prepareForRecycle CAIRN_LOG');
  } else {
    failures.push('CHANGE I: prepareForRecycle anchor not found');
  }

  if (failures.length > 0) {
    throw new Error(
      `[withUnityEmbed] CRITICAL: ${failures.length} patch anchor(s) failed in RNUnityView.mm:\n` +
      failures.map(f => `  - ${f}`).join('\n') + '\n' +
      'The @azesmway/react-native-unity source may have changed. Update withUnityEmbed.js.'
    );
  }

  fs.writeFileSync(mmPath, patched, 'utf8');
  console.log('[withUnityEmbed] RNUnityView.mm patched (10 changes applied, V4)');
}

module.exports = function withUnityEmbed(config) {
  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const mmPath = path.join(
        config.modRequest.platformProjectRoot,
        '..',
        'node_modules',
        '@azesmway',
        'react-native-unity',
        'ios',
        'RNUnityView.mm'
      );
      patchRNUnityViewMM(mmPath);
      return config;
    },
  ]);

  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');

      let podfile;
      try {
        podfile = fs.readFileSync(podfilePath, 'utf8');
      } catch (e) {
        console.warn('[withUnityEmbed] Could not read Podfile:', e.message);
        return config;
      }

      if (podfile.includes(HOOK_MARKER)) {
        console.log('[withUnityEmbed] Podfile hook already present, skipping');
        return config;
      }

      const updated = insertAfterAnchor(HOOK_BODY, 'post_install do |installer|', podfile);
      if (updated === null) {
        throw new Error(
          '[withUnityEmbed] CRITICAL: Could not find `post_install do |installer|` in Podfile.'
        );
      }

      fs.writeFileSync(podfilePath, updated, 'utf8');
      console.log('[withUnityEmbed] Embed Frameworks logic injected into existing post_install block');
      return config;
    },
  ]);

  return config;
};
