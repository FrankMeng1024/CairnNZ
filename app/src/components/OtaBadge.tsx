/**
 * OtaBadge — production-grade OTA status pill.
 *
 * Two display modes:
 *   • Default (floating top-right) — used on screens like Home where there
 *     is no natural slot for an inline badge. Hidden when up-to-date.
 *   • inline=true — renders inline (caller positions it). Always visible:
 *     shows "Up to date" when no update, "Updating…" while downloading,
 *     and "Update ready · tap to restart" when a downloaded update is
 *     waiting. Used on AuthScreen above the Sign In title.
 *
 * Behaviour:
 *   - Auto-checks expo-updates on mount
 *   - Auto-downloads when an update is available (no user prompt)
 *   - Once downloaded → shows "Update ready" pill that user taps to apply
 *   - Tap → modal "Restart now / Later" (inline mode) or direct restart
 *
 * Lazy-loads expo-updates so a missing module doesn't crash the screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  TouchableOpacity, Text, View, StyleSheet, ActivityIndicator,
  Animated, Easing, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Manual OTA version counter. Bump this by 1 every time we ship an
// OTA update so the user can visually confirm they're running the
// latest bundle. The value is baked into the JS bundle, so when the
// pill says "v5 · Up to date" the user knows v5's changes are live.
//
// Bump rule: increment by 1 immediately before running `eas update`.
// Never reuse a number, never decrement.
//
// History:
//   186 — last v186 OTA before v187 portal cairn native build (#27/EAS).
//   192 — v187.7.12: link.xml IL2CPP preserve + asset fingerprint drift
//         monitor + AUTOMATION docs. Baked together with v187.7.11 CI
//         gate + URP/Cam/Volume instrumentation. After next EAS build:
//         AR feed should display real camera (no more yellow), and
//         ARDebugOverlay shows URPDiag/CamDiag/VolumeDiag for any future
//         visual issue.
//   193 — v187.7.13: GroundYResolver SessionTracking gate + PortalSpawner
//         defer queue (fixes "marker too close after re-enter AR") +
//         3 additional CairnBridge diagnostics (ARBgDiag2, RenderListDiag,
//         SessionLifecycleDiag) + CairnVolumeProfile regen.
//   194 — v187.7.13 OTA: re-expose OTA param panel + photo upload from
//         Photos library. Replaces the 📍 reset-location button (no longer
//         needed — AR origin works correctly) with a 🐞 debug-menu button
//         that opens an action sheet → either OTAControlPanel (21 sliders)
//         or photo upload to /api/debug-snapshot. No native build required;
//         uses expo-image-picker + expo-file-system already in package.json.
//         Backend route debug-snapshot.js exists from earlier iteration,
//         reused as-is. Drops __DEV__ gate so panel is reachable in
//         production builds (temporary tuning tool — will be hidden again
//         after visual issues resolved).
//   195 — Sprint 66: dual-source route edit ships. Existing routes get an
//         "Edit on map" surface with trim handles + 1km-corridor midpoint
//         drag, dual-line UI showing original GPS vs working line, save
//         preserves original trace. Routing decisions auto-pick DOC trails
//         (NZ official) for mountain routes, Mapbox roads for urban,
//         straight-line fallback only with explicit user confirmation.
//         App-kill / soft-unmount recovery via EditResumePrompt. OTA-only
//         (no native deps added — kdbush + expo-file-system pre-existing).
//   196 — v195.1 debug-button simplification: OTA params panel UI and
//         text-log upload are removed from ARScreen. The right-top button
//         now opens the iOS multi-select photo picker directly (single
//         action). Tuning is done by the dev based on uploaded screenshots,
//         not by the user. Multi-select + confirm sheet + 1h server TTL
//         (committed earlier under v194.1 but not OTA'd) ride along.
//   197 — v196.1 four user-reported AR fixes:
//         5 远处看不到 → setGlobal bumps WispFadeFar/IconScale/Halo/Wisp/Scroll
//         6 平放报错 → phone-flat threshold 0.85→0.97 + removed from plant gate
//         9 mark 完不让连 mark → PlantSheet squeeze 1.2s→0.5s + no await onPlant
//         10 init UX 干扰 → init=floating pill (not full-screen), 4s→8s timeout
//         Bug 8 (退出再进 marker 漂移 20m) intentionally postponed — needs
//         proper per-session anchor compensation that's beyond OTA scope.
//         Bugs 1/2/3/4/7 are Unity-side, await next build.
//   198 — Sprint 66 routes follow-up: 6 user-reported bugs from real-device
//         test batch + dual-review cleanup of regressions in the first pass.
//         User-visible changes:
//           1+2 Save as Route from Activity now opens RouteEditor in
//               draft mode with an editable name input (defaults to
//               'Hike Jun 9'/'Run Jun 9'), shows the activity's polyline
//               on the map, and lands on the Routes tab after save (not
//               the Activity detail).
//           3+4 View Route + Save-as-route draft both fit the camera to
//               the route bbox (cosine(lat) corrected, 1.4x padding).
//               No more user-GPS flash before snap.
//           5   Activity detail map gets a recenter button after the
//               user pans away.
//           6   too-short hike rejection now also checks distanceM<20m
//               (not just trackPoints<2) so 0-movement sessions with GPS
//               jitter no longer slip through.
//         Internal: handleSave is now async (awaits addRoute/updateRoute);
//         server-only sessions no longer break save (MapHistoryScreen
//         passes server-hydrated trackpoints via nav param);
//         displayedStats reads from geometry source priority instead
//         of empty waypoints[]; addRoute null result now throws into
//         catch instead of silent goBack. OTA-only.
//   199 — v198 follow-up: real-device test of save-as-route showed the
//         camera stuck on Mapbox's global default view (Corsica from
//         Asia) instead of the route. Root cause: the v198 "render no
//         Camera while waiting for hydration" path let MapView fall
//         back to the global default, and the late-mounting Camera
//         with center+zoom prop did not always pull the view back on
//         iOS. Fix: (a) Camera now uses the bounds prop (more reliable
//         than center+zoom for late-arriving data), (b) wait-state
//         Camera mounts at userCoord/region-center (never null), so
//         MapView never falls back to global default, (c) imperative
//         cameraRef.fitBounds() runs in a useEffect when routeCameraFit
//         changes — guarantees the view moves even if the prop update
//         path missed. Bbox padded ±10% (min 0.0005°) so the polyline
//         has breathing room. OTA-only.
//   200 — v200 route edit redesign: replace the 3-fixed-handle
//         (trim-start/trim-end/midpoint) interaction with a node-tap
//         model. Both entries (save-as-route from Activity, view-route
//         from Routes) now land in view-only mode; user taps Edit to
//         enter edit-mode. The right button toggles between Cancel
//         (save-as-route draft) and Delete (existing route). In edit
//         mode the route's snap-to-road junction nodes (degree>=3 in
//         the corridor TrailGraph) appear as small grey circles, plus
//         the two endpoints as colored handles. Tap a node → its 1km-
//         reachable, corridor-validated candidates light up. Tap a
//         candidate → commit the replacement (midpoint nodes call
//         commitMidpointDrag; endpoints route through trimStart/Stop or
//         the new restoreStart/restoreEnd actions for trim-restore).
//         Pre-validation filters out candidates whose post-replacement
//         segments leave the original 1km corridor — user only sees
//         working candidates. Background tap deselects.
//         Foundation: routeNodeAnchors helper (anchor extraction +
//         endpoint-exclusion + degree filter), candidateNodes helper
//         (Dijkstra + corridor pre-check + nearest-snap utility),
//         EditableNodeLayer component (Mapbox PointAnnotation rendering
//         with idle/selected/candidate state colors).
//         restoreStart/restoreEnd are pure-prepend/append (no orchestrator
//         re-routing) — they reuse originalPoints geometry so the
//         operation is reversible to the GPS truth. Coverage invariant
//         enforced. Persistence chain unchanged.
//         Trim handle drag (long-press + drag) is replaced by tap-to-
//         tap. The Phase 5 spec drag-with-magnet pass is deferred —
//         tap-to-tap covers the common case smoothly without gesture
//         conflict. OTA-only.
//   201 — v199 cinematic AR rebuild ships (the Phase 4-7 EAS build).
//         Single build replaces v187 cairn visual stack with Pounamu
//         greenstone NZ-aesthetic Avatar-grade system: ARAnchor parenting
//         (fixes #1/#7 floating + drift), per-session GPS offset
//         compensation (fixes #8 re-entry 20m), TMP SDF rune text on
//         stone backplate (fixes #2 字重叠), 3D oblate-spheroid pebble
//         cairn icon matching logo + billboard type chips for other
//         types (fixes #3 icon angles), real ascending strand particle
//         lifecycle Trails Module PerParticle + 5 hero mesh ribbons +
//         far-distance light shaft (fixes #4 flowing + #5 distance),
//         permanent floating-pill init UX with Avatar-style scanning
//         grid (locks #10), Tier-A Y-lock to eliminate post-plant
//         micro-drift, brand-new like/report aim-detection UX with
//         on-cairn realtime count badge. Backend canon-correct single
//         /vote endpoint with HMAC nonce + rate-limit + impossible-
//         travel + GPS gate (canon §一-4 mutex + 永久1票 enforced).
//         ~135 OTA-tunable globals (vs ~25 in v187). app.json version
//         0.2.0 → 0.2.1 to gate LikeReportSheet on binaries with the
//         new Unity LikeBadge handler (V2.C8).
//   202 — v200 follow-up: review subagent found 2 Blockers + 4 Critical
//         in the v200 first-ship attempt; this commit addresses them.
//         B1 (orphan persisted route on Cancel): freshlyCreatedRouteId
//         tracked across the save-as-route → Edit flow; cancel/discard
//         deletes the backend route. Unmount cleanup catches the case
//         where the user exits via hardware back / BackButton without
//         hitting Cancel. The view-mode Cancel button now branches on
//         (fromSessionId && !routeId) OR (freshlyCreatedRouteId === routeId)
//         so post-addRoute view-mode still treats Cancel as "discard".
//         B2 (two-tap Edit UX with no feedback): single-tap Edit now
//         calls addRoute then continues straight into the existing-route
//         dualEdit init using effectiveRouteId/effectiveExistingRoute
//         locals. No re-tap needed.
//         C3 (top-bar + bottom-row both render Save/Cancel): top-bar in
//         dualEditActive now keeps ONLY Reset. Save + Cancel are bottom-
//         row only.
//         C1, C2, C4 deferred to v203 (zoom-gate-with-active-selection
//         edge case + drag snap-radius scale-by-zoom + drag gesture
//         long-press conflict are bounded by tap-to-tap fallback being
//         primary).
//         OTA-only.
//   203 — v199 cinematic AR rebuild ships in the next EAS build (binary
//         version 0.2.1, see V2.C8 gate). Same scope as documented at
//         line 145-162 above; bumped because v202 occupied 201. After
//         this OTA, the new aim-detection LikeReportSheet UI mounts only
//         on binaries >= 0.2.1; older v0.2.0 binaries running v203 OTA
//         see no LikeReportSheet, no Unity LikeBadge, no broken UX.
//   204 — v200 follow-up: review subagent found 2 Blockers + 4 Critical
//         in the v200 first-ship attempt; this commit addresses them.
//         (Originally bumped 200→202 in an earlier draft; master-side
//         AR work landed v203 in parallel, hence final 204.)
//         B1 (orphan persisted route on Cancel): freshlyCreatedRouteId
//         tracked across the save-as-route → Edit flow; cancel/discard
//         deletes the backend route. Unmount cleanup catches the case
//         where the user exits via hardware back / BackButton without
//         hitting Cancel. The view-mode Cancel button now branches on
//         (fromSessionId && !routeId) OR (freshlyCreatedRouteId === routeId)
//         so post-addRoute view-mode still treats Cancel as "discard".
//         B2 (two-tap Edit UX with no feedback): single-tap Edit now
//         calls addRoute then continues straight into the existing-
//         route dualEdit init using effectiveRouteId/effectiveExistingRoute
//         locals. No re-tap needed.
//         C1 (zoom < 14 hides candidate dots): hideIntersections check
//         now exempts isSelected + isCandidate, so endpoint-tap at low
//         zoom still surfaces visible candidates.
//         C2 (snap radius too generous at low zoom): SNAP_RADIUS_M now
//         scales by current zoom (~50px screen-equivalent), capped
//         [20m, 200m]. handleAnchorDragEnd useCallback deps include
//         currentZoom.
//         C3 (top-bar + bottom-row both render Save/Cancel): top-bar
//         in dualEditActive keeps ONLY Reset. Save + Cancel are bottom-
//         row only.
//         C4 (long-press drag gesture conflict on iOS PointAnnotation):
//         documented trade-off — tap-to-tap is the primary discovered
//         path; drag-with-magnet is a power-user alternative requiring
//         long-press by Mapbox native default. Replacing this with a
//         custom screen-coord overlay is a v205 candidate.
//         OTA-only.
//   205 — v199 cinematic AR rebuild SHIPS. Pairs with the EAS build that
//         consumes UnityFramework.xcframework SHA ddcee027… (CI run
//         27221206395 on commit 692022f, master-merged as b7e8bd1). The
//         RN bundle delivered by this OTA contains:
//           • LikeReportSheet aim-cone activation (3D dot-product, V2.C1)
//             — only mounts on binaries >= 0.2.1 (v203 V2.C8 gate retained)
//           • useLikeReport hook hardened: mountedRef + abortRef + stable
//             getAuthTokenRef so 8s poll no longer restarts on every
//             ArFrame (10Hz parent re-render → server hammered) and post-
//             unmount setState/setError calls are guarded
//           • UnityAROverlay per-session GPS offset compensation (B3 fix
//             for "exit-and-reenter cairn drifts ~20m"): one-shot
//             OnSetSessionOffset before bulk-spawn, projOrigin = persisted
//             arOrigin else live userPos, offsetN/E from cosine-corrected
//             delta
//         Native side (binary 0.2.1, EAS build pending):
//           • PortalSpawnerV199 cinematic stack (8 shaders, 3 pebble
//             meshes, ribbon strands, scan grid, confidence ring,
//             handshake beam, type chip, light shaft)
//           • CairnGlobalsExt 110 OTA globals (5 missing ShaderUniform
//             bindings + 6 kill-switches added)
//           • SummonThenAnchor coroutine (C2: serialise summon → anchor)
//           • link.xml IL2CPP preserve covers URP/Core/TextMeshPro
//           • BuildScript silent-imports TMP Essentials before SceneSetup
//             so LiberationSans SDF is present on CI fresh checkout —
//             without this RuneText + LikeBadge silently fail-soft skip
//         Asset fingerprint extended: 8 v199 shaders + 3 pebble meshes +
//         PortalSpawnerV199 + CairnGlobalsExt monitored for cross-Unity-
//         version drift (76f1 local vs 36f1 CI). Spike 2 thermal
//         validation deferred to post-ship telemetry per Sprint 0
//         scope decision.
export const OTA_VERSION = 205;

type OtaState =
  | 'idle'          // checked, no update — "Up to date"
  | 'checking'      // initial check in progress
  | 'downloading'   // update found, fetching bundle
  | 'ready'         // bundle downloaded, waiting for user to restart
  | 'applying'      // user tapped restart
  | 'error';        // network / OTA failure (inline mode only — floating mode hides)

const COLORS = {
  bg: 'rgba(255,255,255,0.96)',
  border: 'rgba(0,0,0,0.06)',
  text: '#111827',
  textMuted: '#6B7280',
  dotBlue: '#3B82F6',
  dotAmber: '#F59E0B',
  dotGreen: '#10B981',
  dotGrey: '#9CA3AF',
  ctaBg: '#5d7c46',
  ctaText: '#FFFFFF',
};

interface Props {
  /**
   * inline=true: render inline (no absolute positioning), always visible.
   * inline=false (default): float at top-right, only show when there's
   *   something to show (downloading / ready / applying).
   */
  inline?: boolean;
  /**
   * idleHidden=true: don't render anything when state is 'idle' (no update
   * available). Useful when the badge is positioned in a layout where its
   * presence vs absence shifts other content (e.g. the splash screen) — set
   * this so the user only ever sees the pill when there is actually an
   * update being downloaded or ready to install.
   */
  idleHidden?: boolean;
}

export function OtaBadge({ inline = false, idleHidden = false }: Props) {
  const [state, setState] = useState<OtaState>('checking');
  const [modalOpen, setModalOpen] = useState(false);
  const fade = useRef(new Animated.Value(inline ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const insets = useSafeAreaInsets();
  // Dynamic Island on iPhone 14 Pro / 15 Pro / Pro Max sits inside the
  // safe-area top inset region. Push the badge ~10px below the inset to
  // clear both the island and the system status bar reliably across all
  // notch / island devices.
  const topOffset = insets.top + 10;

  // Floating mode: fade in only when state has something to show
  useEffect(() => {
    if (inline) return; // inline mode is always visible
    const visible = state === 'downloading' || state === 'ready' || state === 'applying';
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: visible ? 280 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [state, inline]);

  // Pulse when ready — draws the eye to the actionable state
  useEffect(() => {
    if (state === 'ready') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.06, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      pulseLoopRef.current = loop;
      loop.start();
    } else {
      pulseLoopRef.current?.stop();
      pulse.setValue(1);
    }
    return () => { pulseLoopRef.current?.stop(); };
  }, [state]);

  // OTA check + auto-download flow
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Hard cap on the check phase — on flaky networks
      // checkForUpdateAsync can hang for tens of seconds. v82.1: bumped
      // 15s → 30s + auto-retry once before surfacing error. User feedback:
      // 15s was too tight for EAS production endpoint cold-starts; users
      // were forced to tap "retry" themselves when patience would have
      // worked. Now: try, if fail try once more, only THEN show error.
      //
      // v89 + 1 升级: 错误分类 — 只对 timeout 重试，对其他错误 (DNS/TLS/
      // 401/auth) 不重试 (重试也是失败). 用户反馈 v85+ 仍偶遇 retry,
      // 真因可能是 _不可恢复错误_ 重试 N 次白等 60s 才出 error.
      const TIMEOUT_ERROR = 'ota-timeout';
      const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error(TIMEOUT_ERROR)), ms);
          p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
        });
      // 判断错误是否值得重试. 只重试 timeout (临时性). 其他错误重试也无用.
      const isRetryableError = (err: any): boolean => {
        const msg = String(err?.message || err || '').toLowerCase();
        return msg.includes(TIMEOUT_ERROR);
      };
      try {
        const Updates = await import('expo-updates');
        if (!Updates.isEnabled) {
          if (!cancelled) setState('idle');
          return;
        }
        // v89+1: check phase 错误分类重试. 只对 timeout 重试 1 次.
        const checkOnce = () => withTimeout(Updates.checkForUpdateAsync(), 30000);
        let result;
        try {
          result = await checkOnce();
        } catch (err) {
          if (cancelled) return;
          if (!isRetryableError(err)) {
            // 不可恢复错误 (DNS/TLS/401), 立即报错不重试.
            throw err;
          }
          // Timeout — silent retry. 用户全程看到 "Checking" 不闪 error.
          result = await checkOnce();
        }
        if (cancelled) return;
        if (!result.isAvailable) {
          setState('idle');
          return;
        }
        setState('downloading');
        // v89+1: download phase 同样错误分类.
        const fetchOnce = () => withTimeout(Updates.fetchUpdateAsync(), 60000);
        try {
          await fetchOnce();
        } catch (err) {
          if (cancelled) return;
          if (!isRetryableError(err)) {
            throw err;
          }
          await fetchOnce();
        }
        if (cancelled) return;
        // Auto-apply: instead of asking the user to tap "Restart", reload
        // immediately. Users complained that the manual "Done · tap to
        // restart" prompt + 3-cold-start cycle to actually receive the
        // bundle was confusing. Now: open app → "Downloading" pill →
        // app reboots → next frame they're on the new bundle.
        setState('applying');
        // Tiny delay so the user briefly sees the "Restarting" pill —
        // otherwise the reload feels like a random crash.
        setTimeout(() => { Updates.reloadAsync().catch(() => {}); }, 600);
      } catch {
        // 重试用尽 (timeout 都失败) 或不可恢复错误 → 显示 error.
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePress = () => {
    if (state === 'ready') setModalOpen(true);
    if (state === 'error') {
      // Re-trigger the OTA check on tap — same code path as the mount
      // useEffect, but we just bump state to checking so the spinner
      // shows immediately and let the existing effect re-run via a
      // state-key change. Cheap retry: full reload of the JS surface.
      setState('checking');
      // Use Updates.reloadAsync as a hard retry, since refreshing the
      // useEffect dep is non-trivial — and reloadAsync is cheap when
      // there's no pending bundle (it just re-runs the JS).
      import('expo-updates').then(U => U.reloadAsync().catch(() => setState('error')));
    }
  };

  const handleApply = async () => {
    setModalOpen(false);
    setState('applying');
    try {
      const Updates = await import('expo-updates');
      setTimeout(() => Updates.reloadAsync(), 400);
    } catch {
      setState('error');
    }
  };

  const handleLater = () => {
    setModalOpen(false);
    // stays in 'ready' — user can tap again later
  };

  // Floating mode: hide entirely when nothing actionable
  if (!inline && (state === 'idle' || state === 'checking' || state === 'error')) {
    return null;
  }
  // Inline + idleHidden: hide when there's no update — prevents the pill
  // from popping in/out of layout flow on screens where its presence
  // would shift surrounding content.
  if (inline && idleHidden && (state === 'idle' || state === 'error' || state === 'checking')) {
    return null;
  }

  // Visual config per state
  let dotColor = COLORS.dotGreen;
  let label = '';
  let showSpinner = false;
  let interactive = false;

  switch (state) {
    case 'checking':
      // Honest checking state — never pretend we already verified.
      dotColor = COLORS.dotGrey;
      label = 'Checking for update';
      showSpinner = true;
      break;
    case 'idle':
      // Only reached when the OTA endpoint *successfully* told us there
      // is no newer bundle. This is the only state where "Up to date"
      // is truthful — never use it as a fallback for failures.
      dotColor = COLORS.dotGreen;
      label = 'Up to date';
      break;
    case 'downloading':
      dotColor = COLORS.dotBlue;
      label = 'Downloading update';
      showSpinner = true;
      break;
    case 'ready':
      // Should be brief — auto-reload kicks in 600ms after download.
      // Kept tappable as a manual fallback in case reload fails.
      dotColor = COLORS.dotAmber;
      label = 'Update downloaded';
      interactive = true;
      break;
    case 'applying':
      dotColor = COLORS.dotBlue;
      label = 'Restarting…';
      showSpinner = true;
      break;
    case 'error':
      // Honest failure state — do NOT mask as "Up to date".
      dotColor = COLORS.dotGrey;
      label = "Couldn't check · tap to retry";
      interactive = true;
      break;
  }

  const wrapStyle = inline
    ? [styles.wrapInline, { opacity: fade, transform: [{ scale: pulse }] }]
    : [styles.wrapFloating, { top: topOffset, opacity: fade, transform: [{ scale: pulse }] }];

  return (
    <>
      <Animated.View style={wrapStyle} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.badge}
          onPress={handlePress}
          activeOpacity={interactive ? 0.65 : 1}
          disabled={!interactive}
        >
          {showSpinner ? (
            <ActivityIndicator size="small" color={dotColor} style={styles.spinner} />
          ) : (
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
          )}
          <Text style={styles.label}>{`v${OTA_VERSION} · ${label}`}</Text>
        </TouchableOpacity>
      </Animated.View>

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalIconRow}>
              <View style={[styles.modalIconDot, { backgroundColor: COLORS.dotAmber }]} />
              <View style={[styles.modalIconDot, { backgroundColor: COLORS.dotAmber, opacity: 0.5 }]} />
              <View style={[styles.modalIconDot, { backgroundColor: COLORS.dotAmber, opacity: 0.25 }]} />
            </View>
            <Text style={styles.modalTitle}>Update downloaded</Text>
            <Text style={styles.modalBody}>
              The new version is ready. Restart now to apply — it only takes a second.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.btnSecondary} onPress={handleLater} activeOpacity={0.7}>
                <Text style={styles.btnSecondaryText}>Later</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleApply} activeOpacity={0.85}>
                <Text style={styles.btnPrimaryText}>Restart now</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrapFloating: {
    position: 'absolute',
    right: 12,
    zIndex: 1000,
  },
  wrapInline: {
    alignSelf: 'flex-start',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 6,
    elevation: 3,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  spinner: { marginRight: 6, transform: [{ scale: 0.7 }] },
  label: { fontSize: 11.5, fontWeight: '600', color: COLORS.text, letterSpacing: 0.1 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 14,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  modalIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  modalIconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMuted,
    marginBottom: 18,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btnSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  btnPrimary: {
    backgroundColor: COLORS.ctaBg,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.ctaText,
  },
});
