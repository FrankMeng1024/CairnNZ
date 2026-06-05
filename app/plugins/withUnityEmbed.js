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
 *   Pattern lifted directly from viro's withViroIos.js:127 which does
 *   the same thing for ARCore weak linking. Uses the same insertLines
 *   approach as withViroPodfileFix in this repo.
 *
 * Also patches RNUnityView.mm (via withUnityPatchMM) to:
 *
 *   CHANGE A — PR #174 fix (Fabric / New Architecture):
 *     Root cause: Fabric only calls updateProps when props actually change.
 *     On first render with no props, updateProps is never dispatched and
 *     initUnityModule is never called → Unity permanently silent.
 *     Original library: initWithFrame: (New Arch branch) does NOT call
 *     initUnityModule — only the Old Arch initWithFrame: does.
 *     Fix: call initUnityModule from initWithFrame: in the
 *     RCT_NEW_ARCH_ENABLED branch, guarded by unityIsInitialized.
 *     This is the correct fix location per PR #174 root-cause analysis —
 *     layoutSubviews would re-enter during runEmbeddedWithArgc: while
 *     appController is not yet set (unityIsInitialized returns false
 *     mid-init), causing double runEmbeddedWithArgc: → crash.
 *
 *   CHANGE B — NSLog diagnostics in UnityFrameworkLoad():
 *     Replaces [bundle load] with [bundle loadAndReturnError:] and logs
 *     the NSError. Returns nil immediately on load failure. Adds
 *     step-by-step NSLog at each nil-risk point (bundlePath, bundle,
 *     principalClass, ufw).
 *
 *   CHANGE C — nil guard in initUnityModule (PR #183 pattern):
 *     Logs entry and early-returns if UnityFrameworkLoad() returns nil,
 *     instead of silently no-oping through all [ufw ...] calls.
 *
 *   CHANGE D — exception catch with full stack trace:
 *     Replaces bare NSLog(@"%@", e) with name + reason + callStackSymbols.
 *
 *   CHANGE E — remove setWindowScene:nil + makeKeyAndVisible (iOS 26):
 *     On iOS 26 with mandatory UISceneDelegate lifecycle, setting the
 *     Unity window's scene to nil detaches it from any display → Unity
 *     initialises (ufw non-nil, appController non-nil) but renders
 *     nothing. makeKeyAndVisible promotes Unity's window above the RN
 *     window and breaks all touch handling.
 *     Fix: remove both calls; add Unity's rootView directly to self
 *     (the RNUnityView) which is already correctly positioned by RN.
 */

const { withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

const HOOK_MARKER = '# CAIRN_UNITY_EMBED_HOOK_V2';

// Ruby code injected INSIDE the existing `post_install do |installer|` block,
// immediately after the `post_install do |installer|` anchor line. The block's
// own `end` is preserved (we don't add our own `end`).
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

/**
 * Insert helper — modeled after viro's insertLinesHelper.
 * Finds the line containing `target` and inserts `insert` after it (offset=1).
 */
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
// RNUnityView.mm patch — applied at prebuild time
// ---------------------------------------------------------------------------
//
// Five changes in one pass (marker-guarded, idempotent):
//
//  CHANGE A — PR #174 fix: call initUnityModule from initWithFrame: (Fabric branch).
//    Root cause: Fabric's updateProps is only dispatched when props actually change.
//    On first render with no prop changes, updateProps never fires, initUnityModule
//    is never called, Unity is permanently silent.
//    The correct fix location is initWithFrame: in the #ifdef RCT_NEW_ARCH_ENABLED
//    block, NOT layoutSubviews. layoutSubviews fires repeatedly during layout and
//    during runEmbeddedWithArgc: bootstrap; at that point unityIsInitialized() is
//    false (ufw set but appController not yet set), so a layoutSubviews guard would
//    call initUnityModule again → double runEmbeddedWithArgc: → crash.
//    initWithFrame: fires exactly once, before any layout pass.
//
//  CHANGE B — NSLog diagnostics in UnityFrameworkLoad().
//    Replaces [bundle load] with [bundle loadAndReturnError:] and logs the
//    NSError. Returns nil immediately on load failure (previous code fell through
//    to principalClass lookup). Adds step-by-step NSLog at each nil-risk point.
//
//  CHANGE C — nil guard in initUnityModule (PR #183 pattern).
//    Logs entry; returns early if UnityFrameworkLoad() returns nil instead of
//    silently no-oping through all subsequent [ufw ...] calls.
//
//  CHANGE D — catch block: richer stack trace.
//
//  CHANGE E — remove setWindowScene:nil + makeKeyAndVisible (iOS 26 fix).
//    On iOS 26 with mandatory UISceneDelegate lifecycle, setWindowScene:nil
//    detaches Unity's window from the active scene → renders nothing.
//    makeKeyAndVisible promotes Unity's UIWindow above the RN window → breaks
//    all RN touch handling.
//    Replacement: add Unity's rootView as a subview of self (the RNUnityView),
//    which is already correctly positioned by React Native's layout system.

const MM_PATCH_MARKER = '// CAIRN_UNITY_MM_PATCH_V2';

// ---------------------------------------------------------------------------
// CHANGE A: initWithFrame: (New Arch branch) — add initUnityModule call.
// ---------------------------------------------------------------------------
// The original New Arch initWithFrame: never calls initUnityModule:
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

// Patched: calls initUnityModule immediately after super init + props setup.
// Guard is unityIsInitialized for safety (though at this point it's always false).
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

    // PR #174: Fabric (New Architecture) does not reliably call updateProps
    // on first render when no props change. Call initUnityModule here —
    // initWithFrame: fires exactly once, before any layout pass, making it
    // the correct guaranteed init point. layoutSubviews would re-enter during
    // runEmbeddedWithArgc: bootstrap and cause a double-init crash.
    NSLog(@"[CAIRN-UFW] initWithFrame: calling initUnityModule (Fabric PR#174 fix)");
    if (![self unityIsInitialized]) {
      [self initUnityModule];
    }
  }

  return self;
}`;

// ---------------------------------------------------------------------------
// CHANGE B: UnityFrameworkLoad() — NSLog diagnostics + return nil on failure.
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
    NSLog(@"[CAIRN-UFW] step1 bundlePath=%@", bundlePath ?: @"<nil>");

    NSBundle* bundle = [NSBundle bundleWithPath: bundlePath];
    NSLog(@"[CAIRN-UFW] step2 bundle=%@ isLoaded=%d", bundle ? @"non-nil" : @"<nil>", bundle ? (int)[bundle isLoaded] : -1);

    if (bundle == nil) {
        NSLog(@"[CAIRN-UFW] FATAL: [NSBundle bundleWithPath:] returned nil — framework not embedded or path wrong");
        return nil;
    }

    if ([bundle isLoaded] == false) {
        NSError* loadErr = nil;
        BOOL ok = [bundle loadAndReturnError:&loadErr];
        if (!ok || loadErr) {
            NSLog(@"[CAIRN-UFW] step3 LOAD FAILED ok=%d domain=%@ code=%ld desc=%@ reason=%@ underlying=%@",
                  ok,
                  loadErr.domain ?: @"<nil>",
                  (long)loadErr.code,
                  loadErr.localizedDescription ?: @"<nil>",
                  loadErr.localizedFailureReason ?: @"<nil>",
                  [loadErr.userInfo[NSUnderlyingErrorKey] description] ?: @"<nil>");
            return nil;
        } else {
            NSLog(@"[CAIRN-UFW] step3 load OK");
        }
    } else {
        NSLog(@"[CAIRN-UFW] step3 already loaded");
    }

    Class pc = bundle.principalClass;
    NSLog(@"[CAIRN-UFW] step4 principalClass=%@", pc ? NSStringFromClass(pc) : @"<nil>");
    if (pc == nil) {
        NSLog(@"[CAIRN-UFW] FATAL: principalClass nil — NSPrincipalClass missing in Info.plist or class not found");
        return nil;
    }

    UnityFramework* ufw = [pc getInstance];
    NSLog(@"[CAIRN-UFW] step5 ufw=%p appController=%p", ufw, [ufw appController]);
    if (ufw == nil) {
        NSLog(@"[CAIRN-UFW] FATAL: [principalClass getInstance] returned nil");
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
    NSLog(@"[CAIRN-UFW] step6 returning ufw=%p bundleId=%@", ufw, [bundle bundleIdentifier] ?: @"<nil>");

    return ufw;
}`;

// ---------------------------------------------------------------------------
// CHANGE C: initUnityModule entry — nil guard + entry log.
// ---------------------------------------------------------------------------
const INIT_UNITY_ENTRY_ORIGINAL = `- (void)initUnityModule {
    @try {
        if([self unityIsInitialized]) {
            return;
        }

        [self setUfw: UnityFrameworkLoad()];`;

const INIT_UNITY_ENTRY_PATCHED = `- (void)initUnityModule {
    NSLog(@"[CAIRN-UFW] initUnityModule entered alreadyInit=%d", (int)[self unityIsInitialized]);
    @try {
        if([self unityIsInitialized]) {
            NSLog(@"[CAIRN-UFW] initUnityModule: already initialized, returning");
            return;
        }

        [self setUfw: UnityFrameworkLoad()];
        NSLog(@"[CAIRN-UFW] initUnityModule after-load ufw=%p", [self ufw]);
        if (![self ufw]) {
            NSLog(@"[CAIRN-UFW] initUnityModule FATAL: UnityFrameworkLoad returned nil, aborting");
            return;
        }`;

// ---------------------------------------------------------------------------
// CHANGE D: catch block — richer stack trace.
// ---------------------------------------------------------------------------
const CATCH_ORIGINAL = `    @catch (NSException *e) {
        NSLog(@"%@",e);
    }`;

const CATCH_PATCHED = `    @catch (NSException *e) {
        NSLog(@"[CAIRN-UFW] initUnityModule EXCEPTION name=%@ reason=%@ stack=%@",
              e.name, e.reason, [e callStackSymbols]);
    }`;

// ---------------------------------------------------------------------------
// CHANGE E: remove setWindowScene:nil + makeKeyAndVisible (iOS 26 fix).
// ---------------------------------------------------------------------------
// Original block (lines 67-75 of RNUnityView.mm):
const WINDOW_SCENE_ORIGINAL = `        if (@available(iOS 13.0, *)) {
            [[[[self ufw] appController] window] setWindowScene: nil];
        } else {
            [[[[self ufw] appController] window] setScreen: nil];
        }

        [[[[self ufw] appController] window] addSubview: self.ufw.appController.rootView];
        [[[[self ufw] appController] window] makeKeyAndVisible];
        [[[[[[self ufw] appController] window] rootViewController] view] setNeedsLayout];`;

// Replacement: add rootView directly to self (the RNUnityView); no window promotion.
// On iOS 26 (and all iOS 13+), Unity's window must stay attached to its scene.
// The rootView is the full-screen Unity GL view — adding it to self is sufficient
// because self fills the screen via StyleSheet.absoluteFill in UnityAROverlay.tsx.
const WINDOW_SCENE_PATCHED = `        // CAIRN iOS 26 fix: do NOT call setWindowScene:nil (detaches Unity window
        // from display on iOS 26 mandatory-scene lifecycle → renders nothing) and
        // do NOT call makeKeyAndVisible (promotes Unity UIWindow above RN window →
        // breaks all touch handling). Add rootView directly to self instead —
        // self fills the screen via StyleSheet.absoluteFill in UnityAROverlay.tsx.
        NSLog(@"[CAIRN-UFW] initUnityModule: attaching rootView to self (iOS 26 safe)");
        [[[[self ufw] appController] window] addSubview: self.ufw.appController.rootView];
        [[[[[[self ufw] appController] window] rootViewController] view] setNeedsLayout];`;

function patchRNUnityViewMM(mmPath) {
  if (!fs.existsSync(mmPath)) {
    throw new Error(`[withUnityEmbed] RNUnityView.mm not found at ${mmPath} — cannot patch`);
  }

  let src = fs.readFileSync(mmPath, 'utf8');

  // Idempotent check
  if (src.includes(MM_PATCH_MARKER)) {
    console.log('[withUnityEmbed] RNUnityView.mm already patched (V2), skipping');
    return;
  }

  // Remove any V1 patch marker to allow re-patching (clean re-install scenario)
  const V1_MARKER = '// CAIRN_UNITY_MM_PATCH_V1';
  if (src.includes(V1_MARKER)) {
    console.log('[withUnityEmbed] V1 patch marker found — treating as unpatched and applying V2 patch');
    // V1 patch had different anchors so we can't cleanly strip; abort and surface the issue.
    throw new Error(
      '[withUnityEmbed] RNUnityView.mm has a V1 patch marker but we are applying V2. ' +
      'Run `npx expo install --fix` or reinstall @azesmway/react-native-unity to get a clean copy, then re-run prebuild.'
    );
  }

  let patched = src;
  const failures = [];

  // CHANGE A: initWithFrame: (New Arch branch) — PR #174 fix
  if (patched.includes(INIT_WITH_FRAME_NEW_ARCH_ORIGINAL)) {
    patched = patched.replace(INIT_WITH_FRAME_NEW_ARCH_ORIGINAL, INIT_WITH_FRAME_NEW_ARCH_PATCHED);
    console.log('[withUnityEmbed] CHANGE A applied: initWithFrame: PR#174 fix (Fabric init)');
  } else {
    failures.push('CHANGE A: initWithFrame: (New Arch) anchor not found');
  }

  // CHANGE B: UnityFrameworkLoad NSLog + loadAndReturnError + return nil
  if (patched.includes(UFW_LOAD_ORIGINAL)) {
    patched = patched.replace(UFW_LOAD_ORIGINAL, UFW_LOAD_PATCHED);
    console.log('[withUnityEmbed] CHANGE B applied: UnityFrameworkLoad NSLog diagnostics + return nil on failure');
  } else {
    failures.push('CHANGE B: UnityFrameworkLoad anchor not found');
  }

  // CHANGE C: initUnityModule nil guard + entry log
  if (patched.includes(INIT_UNITY_ENTRY_ORIGINAL)) {
    patched = patched.replace(INIT_UNITY_ENTRY_ORIGINAL, INIT_UNITY_ENTRY_PATCHED);
    console.log('[withUnityEmbed] CHANGE C applied: initUnityModule nil guard + entry log');
  } else {
    failures.push('CHANGE C: initUnityModule anchor not found');
  }

  // CHANGE D: catch block — richer stack trace
  if (patched.includes(CATCH_ORIGINAL)) {
    patched = patched.replace(CATCH_ORIGINAL, CATCH_PATCHED);
    console.log('[withUnityEmbed] CHANGE D applied: exception catch stack trace');
  } else {
    failures.push('CHANGE D: catch block anchor not found');
  }

  // CHANGE E: remove setWindowScene:nil + makeKeyAndVisible (iOS 26 fix)
  if (patched.includes(WINDOW_SCENE_ORIGINAL)) {
    patched = patched.replace(WINDOW_SCENE_ORIGINAL, WINDOW_SCENE_PATCHED);
    console.log('[withUnityEmbed] CHANGE E applied: removed setWindowScene:nil + makeKeyAndVisible (iOS 26 fix)');
  } else {
    failures.push('CHANGE E: setWindowScene:nil block anchor not found');
  }

  if (failures.length > 0) {
    // Any anchor failure means the library source changed; the patch is unsafe to apply partially.
    throw new Error(
      `[withUnityEmbed] CRITICAL: ${failures.length} patch anchor(s) failed to match in RNUnityView.mm.\n` +
      failures.map(f => `  - ${f}`).join('\n') + '\n' +
      'The @azesmway/react-native-unity source may have changed. Review and update withUnityEmbed.js.'
    );
  }

  fs.writeFileSync(mmPath, patched, 'utf8');
  console.log('[withUnityEmbed] RNUnityView.mm patched (5/5 changes applied, V2)');
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

      // Idempotent: skip if already injected
      if (podfile.includes(HOOK_MARKER)) {
        console.log('[withUnityEmbed] Podfile hook already present, skipping');
        return config;
      }

      // Inject INSIDE existing post_install block (after `post_install do |installer|` line)
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
