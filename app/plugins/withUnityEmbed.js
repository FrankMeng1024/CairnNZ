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
 * How it works:
 *   The Expo template Podfile has exactly ONE post_install block, INSIDE
 *   the target 'YourApp' do ... end block. CocoaPods does NOT support
 *   multiple post_install blocks. We must inject our embed-handling Ruby
 *   code INSIDE that single block, not as a second top-level block.
 *
 * Also patches RNUnityView.mm to:
 *
 *   CHANGE A — PR #174 fix (Fabric / New Architecture):
 *     Fabric only calls updateProps when props actually change. On first
 *     render with no props, updateProps is never dispatched and
 *     initUnityModule is never called → Unity permanently silent.
 *     Fix: call initUnityModule from initWithFrame: in the
 *     RCT_NEW_ARCH_ENABLED branch. initWithFrame: fires exactly once
 *     before any layout pass — the correct guaranteed init point.
 *     (layoutSubviews would re-enter during runEmbeddedWithArgc: bootstrap
 *     while appController is not yet set → double init → crash.)
 *
 *   CHANGE B — NSLog diagnostics in UnityFrameworkLoad():
 *     Replaces [bundle load] with [bundle loadAndReturnError:], returns nil
 *     immediately on failure. Full CAIRN_LOG at each nil-risk step.
 *
 *   CHANGE C — nil guard in initUnityModule (PR #183 pattern):
 *     Logs entry; returns early if UnityFrameworkLoad() returns nil.
 *
 *   CHANGE D — exception catch with full stack trace.
 *
 *   CHANGE E — remove setWindowScene:nil + makeKeyAndVisible (iOS 26 fix):
 *     setWindowScene:nil detaches Unity window from display on iOS 26
 *     mandatory-scene lifecycle → renders nothing. makeKeyAndVisible
 *     promotes Unity UIWindow above RN window → breaks touch handling.
 *     Fix: add rootView directly to self (RNUnityView).
 *
 *   CHANGE F — NSLog → RN bridge (remote diagnostics):
 *     Injects a CAIRN_LOG macro at the top of RNUnityView.mm that both
 *     writes to NSLog (Xcode Console) AND forwards the message to JS via
 *     sendMessageToMobileApp: as a "NativeLog|INFO|..." string. This lands
 *     in onUnityMessage → parseUnityMessage (kind:'UnityLog') →
 *     crashLogger.breadcrumb → uploadDiagnostic → visible on the backend
 *     without needing Xcode connected.
 *     Uses a file-scope static pointer (cairnLogBridge) set in initWithFrame:
 *     so that UnityFrameworkLoad() (a free function, no self) can also send
 *     logs to JS.
 *     No Unity build required — sendMessageToMobileApp: is pure ObjC/RN.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

const HOOK_MARKER = '# CAIRN_UNITY_EMBED_HOOK_V2';

// Ruby code injected INSIDE the existing `post_install do |installer|` block.
const HOOK_BODY = `    ${HOOK_MARKER}
    # Embed UnityFramework.framework into the app target's Frameworks build
    # phase with CodeSignOnCopy attribute. azesmway/react-native-unity vendors
    # the framework but Expo 54 + RN 0.81 doesn't auto-embed.
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
        # Only main app target — skip test bundles, extensions, etc.
        next unless native_target.product_type == 'com.apple.product-type.application'

        # Find/create Embed Frameworks build phase
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
// RNUnityView.mm patch — six changes, marker-guarded, idempotent
// ---------------------------------------------------------------------------

const MM_PATCH_MARKER = '// CAIRN_UNITY_MM_PATCH_V3';

// ---------------------------------------------------------------------------
// CHANGE F: NSLog → RN bridge.
//
// Strategy: inject a CAIRN_LOG(fmt, ...) macro right after the #import block
// at the top of the file. The macro:
//   1. Calls NSLog so Xcode Console still shows the line.
//   2. Calls cairnSendLog(formattedString) which checks a file-scope pointer
//      cairnLogBridge (set in initWithFrame:) and calls sendMessageToMobileApp:
//      with format "NativeLog|INFO|<message>". This lands in onUnityMessage
//      on the JS side → parseUnityMessage → kind:'UnityLog' → breadcrumb.
//
// cairnLogBridge is __weak to avoid retain cycles (RNUnityView owns nothing
// extra; if it deallocates the pointer goes nil automatically).
//
// The anchor for injection is the line:  NSString *bundlePathStr = ...
// We insert the macro block immediately before that line.
// ---------------------------------------------------------------------------

const BUNDLE_PATH_STR_LINE = 'NSString *bundlePathStr = @"/Frameworks/UnityFramework.framework";';

const CAIRN_LOG_MACRO_BLOCK = `// CAIRN CHANGE F: NSLog → RN bridge (remote diagnostics without Xcode).
// cairnLogBridge holds a weak ref to the RNUnityView instance so that
// UnityFrameworkLoad() (a free C function, no self) can also forward logs
// to JS. Set in initWithFrame: before calling initUnityModule.
static __weak RNUnityView *cairnLogBridge = nil;

static void cairnSendLog(NSString *msg) {
    RNUnityView *bridge = cairnLogBridge;
    if (bridge) {
        NSString *payload = [@"NativeLog|INFO|" stringByAppendingString:msg];
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
// CHANGE A: initWithFrame: (New Arch branch) — PR #174 fix + set cairnLogBridge.
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

    // CHANGE F: set bridge pointer before calling initUnityModule so that
    // UnityFrameworkLoad() can forward NSLogs to JS from the start.
    cairnLogBridge = self;

    // CHANGE A (PR #174): Fabric does not reliably call updateProps when no
    // props change on first render. Call initUnityModule here — initWithFrame:
    // fires exactly once before any layout pass. layoutSubviews would re-enter
    // during runEmbeddedWithArgc: bootstrap (appController not yet set at that
    // point, so unityIsInitialized() returns false → double init → crash).
    CAIRN_LOG(@"[CAIRN-UFW] initWithFrame: calling initUnityModule (Fabric PR#174 fix)");
    if (![self unityIsInitialized]) {
      [self initUnityModule];
    }
  }

  return self;
}`;

// ---------------------------------------------------------------------------
// CHANGE B: UnityFrameworkLoad() — full CAIRN_LOG diagnostics + return nil on failure.
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
    CAIRN_LOG(@"[CAIRN-UFW] step1 bundlePath=%@", bundlePath ?: @"<nil>");

    NSBundle* bundle = [NSBundle bundleWithPath: bundlePath];
    CAIRN_LOG(@"[CAIRN-UFW] step2 bundle=%@ isLoaded=%d", bundle ? @"non-nil" : @"<nil>", bundle ? (int)[bundle isLoaded] : -1);

    if (bundle == nil) {
        CAIRN_LOG(@"[CAIRN-UFW] FATAL: [NSBundle bundleWithPath:] returned nil — framework not embedded or path wrong");
        return nil;
    }

    if ([bundle isLoaded] == false) {
        NSError* loadErr = nil;
        BOOL ok = [bundle loadAndReturnError:&loadErr];
        if (!ok || loadErr) {
            CAIRN_LOG(@"[CAIRN-UFW] step3 LOAD FAILED ok=%d domain=%@ code=%ld desc=%@ reason=%@ underlying=%@",
                  ok,
                  loadErr.domain ?: @"<nil>",
                  (long)loadErr.code,
                  loadErr.localizedDescription ?: @"<nil>",
                  loadErr.localizedFailureReason ?: @"<nil>",
                  [loadErr.userInfo[NSUnderlyingErrorKey] description] ?: @"<nil>");
            return nil;
        } else {
            CAIRN_LOG(@"[CAIRN-UFW] step3 load OK");
        }
    } else {
        CAIRN_LOG(@"[CAIRN-UFW] step3 already loaded");
    }

    Class pc = bundle.principalClass;
    CAIRN_LOG(@"[CAIRN-UFW] step4 principalClass=%@", pc ? NSStringFromClass(pc) : @"<nil>");
    if (pc == nil) {
        CAIRN_LOG(@"[CAIRN-UFW] FATAL: principalClass nil — NSPrincipalClass missing in Info.plist or class not found");
        return nil;
    }

    UnityFramework* ufw = [pc getInstance];
    CAIRN_LOG(@"[CAIRN-UFW] step5 ufw=%p appController=%p", ufw, [ufw appController]);
    if (ufw == nil) {
        CAIRN_LOG(@"[CAIRN-UFW] FATAL: [principalClass getInstance] returned nil");
        return nil;
    }

    if (![ufw appController])
    {
#ifdef DEBUG
      [ufw setExecuteHeader: &_mh_dylib_header];
#else
      [ufw setExecuteHeader: &_mh_execute_header];
#endif
    }

    [ufw setDataBundleId: [bundle.bundleIdentifier cStringUsingEncoding:NSUTF8StringEncoding]];
    CAIRN_LOG(@"[CAIRN-UFW] step6 returning ufw=%p bundleId=%@", ufw, [bundle bundleIdentifier] ?: @"<nil>");

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
            CAIRN_LOG(@"[CAIRN-UFW] initUnityModule: already initialized, returning");
            return;
        }

        [self setUfw: UnityFrameworkLoad()];
        CAIRN_LOG(@"[CAIRN-UFW] initUnityModule after-load ufw=%p", [self ufw]);
        if (![self ufw]) {
            CAIRN_LOG(@"[CAIRN-UFW] initUnityModule FATAL: UnityFrameworkLoad returned nil, aborting");
            return;
        }`;

// ---------------------------------------------------------------------------
// CHANGE D: catch block — richer stack trace via CAIRN_LOG.
// ---------------------------------------------------------------------------
const CATCH_ORIGINAL = `    @catch (NSException *e) {
        NSLog(@"%@",e);
    }`;

const CATCH_PATCHED = `    @catch (NSException *e) {
        CAIRN_LOG(@"[CAIRN-UFW] initUnityModule EXCEPTION name=%@ reason=%@ stack=%@",
              e.name, e.reason, [e callStackSymbols]);
    }`;

// ---------------------------------------------------------------------------
// CHANGE E: remove setWindowScene:nil + makeKeyAndVisible (iOS 26 fix).
// ---------------------------------------------------------------------------
const WINDOW_SCENE_ORIGINAL = `        if (@available(iOS 13.0, *)) {
            [[[[self ufw] appController] window] setWindowScene: nil];
        } else {
            [[[[self ufw] appController] window] setScreen: nil];
        }

        [[[[self ufw] appController] window] addSubview: self.ufw.appController.rootView];
        [[[[self ufw] appController] window] makeKeyAndVisible];
        [[[[[[self ufw] appController] window] rootViewController] view] setNeedsLayout];`;

const WINDOW_SCENE_PATCHED = `        // CHANGE E (iOS 26 fix): do NOT call setWindowScene:nil (detaches Unity
        // window from active scene on iOS 26 mandatory-scene lifecycle → renders
        // nothing) and do NOT call makeKeyAndVisible (promotes Unity UIWindow above
        // RN window → breaks all touch handling).
        // Add rootView directly to self (RNUnityView) — self fills the screen via
        // StyleSheet.absoluteFill in UnityAROverlay.tsx.
        CAIRN_LOG(@"[CAIRN-UFW] initUnityModule: attaching rootView to self (iOS 26 safe)");
        [self addSubview: self.ufw.appController.rootView];
        [[[[[[self ufw] appController] window] rootViewController] view] setNeedsLayout];`;

// ---------------------------------------------------------------------------
// Patch function
// ---------------------------------------------------------------------------

function patchRNUnityViewMM(mmPath) {
  if (!fs.existsSync(mmPath)) {
    throw new Error(`[withUnityEmbed] RNUnityView.mm not found at ${mmPath} — cannot patch`);
  }

  let src = fs.readFileSync(mmPath, 'utf8');

  // Idempotent: already patched with V3
  if (src.includes(MM_PATCH_MARKER)) {
    console.log('[withUnityEmbed] RNUnityView.mm already patched (V3), skipping');
    return;
  }

  // V1 or V2 marker: source was patched in a previous install; the node_modules
  // copy was not cleaned. Fail loudly so the developer knows to clean.
  if (src.includes('// CAIRN_UNITY_MM_PATCH_V1') || src.includes('// CAIRN_UNITY_MM_PATCH_V2')) {
    throw new Error(
      '[withUnityEmbed] RNUnityView.mm has an older patch marker (V1 or V2) but we are applying V3. ' +
      'Delete node_modules/@azesmway/react-native-unity and run `npm ci`, then re-run prebuild.'
    );
  }

  let patched = src;
  const failures = [];

  // CHANGE F: inject CAIRN_LOG macro block before bundlePathStr line
  if (patched.includes(BUNDLE_PATH_STR_LINE)) {
    patched = patched.replace(BUNDLE_PATH_STR_LINE, CAIRN_LOG_MACRO_BLOCK);
    console.log('[withUnityEmbed] CHANGE F applied: CAIRN_LOG macro + NSLog→RN bridge injected');
  } else {
    failures.push('CHANGE F: bundlePathStr anchor not found');
  }

  // CHANGE A: initWithFrame: (New Arch branch) — PR #174 fix + cairnLogBridge
  if (patched.includes(INIT_WITH_FRAME_NEW_ARCH_ORIGINAL)) {
    patched = patched.replace(INIT_WITH_FRAME_NEW_ARCH_ORIGINAL, INIT_WITH_FRAME_NEW_ARCH_PATCHED);
    console.log('[withUnityEmbed] CHANGE A applied: initWithFrame: PR#174 fix + cairnLogBridge set');
  } else {
    failures.push('CHANGE A: initWithFrame: (New Arch) anchor not found');
  }

  // CHANGE B: UnityFrameworkLoad — CAIRN_LOG + loadAndReturnError + return nil
  if (patched.includes(UFW_LOAD_ORIGINAL)) {
    patched = patched.replace(UFW_LOAD_ORIGINAL, UFW_LOAD_PATCHED);
    console.log('[withUnityEmbed] CHANGE B applied: UnityFrameworkLoad CAIRN_LOG diagnostics');
  } else {
    failures.push('CHANGE B: UnityFrameworkLoad anchor not found');
  }

  // CHANGE C: initUnityModule nil guard + CAIRN_LOG
  if (patched.includes(INIT_UNITY_ENTRY_ORIGINAL)) {
    patched = patched.replace(INIT_UNITY_ENTRY_ORIGINAL, INIT_UNITY_ENTRY_PATCHED);
    console.log('[withUnityEmbed] CHANGE C applied: initUnityModule nil guard + CAIRN_LOG');
  } else {
    failures.push('CHANGE C: initUnityModule anchor not found');
  }

  // CHANGE D: catch block — richer stack trace
  if (patched.includes(CATCH_ORIGINAL)) {
    patched = patched.replace(CATCH_ORIGINAL, CATCH_PATCHED);
    console.log('[withUnityEmbed] CHANGE D applied: exception catch with callStackSymbols');
  } else {
    failures.push('CHANGE D: catch block anchor not found');
  }

  // CHANGE E: remove setWindowScene:nil + makeKeyAndVisible
  if (patched.includes(WINDOW_SCENE_ORIGINAL)) {
    patched = patched.replace(WINDOW_SCENE_ORIGINAL, WINDOW_SCENE_PATCHED);
    console.log('[withUnityEmbed] CHANGE E applied: removed setWindowScene:nil + makeKeyAndVisible');
  } else {
    failures.push('CHANGE E: setWindowScene:nil block anchor not found');
  }

  if (failures.length > 0) {
    throw new Error(
      `[withUnityEmbed] CRITICAL: ${failures.length} patch anchor(s) failed in RNUnityView.mm:\n` +
      failures.map(f => `  - ${f}`).join('\n') + '\n' +
      'The @azesmway/react-native-unity source may have changed. Update withUnityEmbed.js.'
    );
  }

  fs.writeFileSync(mmPath, patched, 'utf8');
  console.log('[withUnityEmbed] RNUnityView.mm patched (6/6 changes applied, V3)');
}

module.exports = function withUnityEmbed(config) {
  // Step 1: patch RNUnityView.mm source before pod install
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

  // Step 2: patch Podfile (embed UnityFramework in Embed Frameworks build phase)
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
          '[withUnityEmbed] CRITICAL: Could not find `post_install do |installer|` in Podfile. ' +
          'UnityFramework will NOT be embedded — runtime load will fail.'
        );
      }

      fs.writeFileSync(podfilePath, updated, 'utf8');
      console.log('[withUnityEmbed] Embed Frameworks logic injected into existing post_install block');

      return config;
    },
  ]);

  return config;
};
