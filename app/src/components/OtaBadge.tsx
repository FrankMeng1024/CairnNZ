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
// pill says "v421 · Up to date" the user knows v421's changes are live.
//
// Full version history archived at: docs/OTA_CHANGELOG.md
// O1: switch from numeric v451+ to O-series. Users see "O1 · Up to date"
// on the OtaBadge. Future OTA versions increment as O2, O3, ...
// O2 (2026-07-26 batch 28): 6 bug fix (Remember-me SecureStore / Memory
// render sync / sim-walker subdivide / Stop 放弃-保存 / unlockOnWalk
// toggle / Bug5+6 log)。用户明确铁律: 每批 OTA 都 bump 版本号,首页
// 显示新版号让用户一眼看到收到的 OTA。
// O3 (2026-07-26 batch 28.8): O2 上线后用户报 10 新问题 → 查 aliyun log
// 复现根因 → 修 sim-walker subdivide 可配 + modal 关闭修复 + Chinese→English UI
// O4 (2026-07-26 batch 29 ROLLBACK): O3 上线后用户测所有 sim-walker 问题
// 依然没修复。用户明确要求回滚 sim-walker "真实用户模拟" 那段到 v450
// (2026-07-25 用户说好用的版本):
//   - gpsInjector.ts 完全回到 v450: 单点 emit, 5m/500ms/JITTER=2m, 无 subdivide
//   - SimWalkerOverlay.tsx 回到 v450: 3 input fields (step_m/emit_ms/undo_count)
//   - __simwalkerAddTrackPoint 里 recordPoint block 删除 (memory 不实时 unlock)
//   - real-GPS addTrackPoint 里 recordPoint block 删除 (同理)
//   - useMemorySettingsStore 里 unlockOnWalk field 删除
//   - MemorySettingsSection 里 unlockOnWalk toggle 删除
// 保留 (clean 部分, 不回退):
//   - UnfinishedRecoveryModal 中文→英文
//   - MemorySettingsSection Show friends' memory 英文 hint (unchanged)
//   - HikingScreen stop sheet Discard/Save 英文
//   - Chinese→English UI 全部保留
// O5 (2026-07-26 batch 30): O4 回滚后 subagent 4-eyes 审查发现 v450 sim-walker
// 有 3 个结构性 bug (回滚没解决,是 v450 code 本身的问题):
//   1. flushHikingToMemory 用 RDP simplify (10m tolerance) 把 sim-walker 直线
//      走 20 个点简化成 2 个 → memory 只解锁 2 个 hex cell 而不是 5 个。这是
//      用户报的 Bug 10 "memory 走完没记录" 的真根因!修:检测 sim-walker
//      active 时跳过 RDP,保留所有点让 H3 cell 全都能解锁
//   2. __simwalkerAddTrackPoint 只 gate paused 不 gate idle → 用户开摇杆但
//      没点 Start Hike 就走的话点会写到 trackPoints,然后点 Start Hike 触发
//      startTracking reset 全丢。修:改为 gate 到 status !== 'tracking'
//   3. setStepConfig 收到 NaN input (用户清空 field 或输入非数字) 会让
//      config.step_m=NaN → 所有点 lat=NaN → 静默坏掉整个 session。修:
//      添加 Number.isFinite fallback 到 previous config value
// O6 (2026-07-26 batch 31): O5 之后 subagent 又找到 3 个非 sim-walker bug —
// 这些是用户 O2/O3 报的 Bug 5/6/8 的真根因:
//   Bug 5 (activity list "Loading routes..." 一直转圈):
//     MapHistoryScreen fetchSessionDetail 无 timeout,server slow / 网络卡
//     就永远 stuck。修:15s Promise.race timeout + fall through 到 local
//     cache;fetch 完但空则显示 "Route data unavailable" 而不是继续转
//   Bug 6 (假 pending sync — home 显示 "1 hike pending sync"):
//     syncDaemon.drainPending 契约声明 3 个 trigger (hydrate/NetInfo/
//     AppState),但 AppState 那个从来没连过。session 若卡在 pending
//     只能等冷启才 self-heal。修:App.tsx AppState listener 里加
//     drainPending call — 用户前后台切一下就能触发 self-heal
//   Bug 8 (recovery modal 弹出用户已保存的 hike):
//     stopTracking 里 `void flushNow().then(renameToCompleted)` 是
//     fire-and-forget。用户点 Save 后立即杀 app 会让 rename 没跑完,
//     active/{sid}.jsonl 留在磁盘,下次冷启触发 UnfinishedRecoveryModal。
//     修:改成 await flushNow + await renameToCompleted,保证 rename
//     跑完才 return
// O8 (2026-07-26 batch 34): O7 subagent audit 找到用户 12:11 丢 session
// 的最可能根因是 stopTracking 里 uuidv4() 或其他同步操作抛错 (在 too_short_check
// log 和 addSession log 之间的 unguarded 区域)。修:
//   1. **顶层 try/catch 兜底整个 save 分支** — 抛错时先 log 到 aliyun
//      (o8.stop.outer_throw),再用 best-effort fallback addSession 保证
//      本地最少存下用户走的路径,syncState='pending'。stopTracking 完成
//      cleanup 不 re-throw
//   2. **uuidv4() 加 try/catch + fallback** — 若 crypto 不可用用 timestamp
//      + Math.random 做 key。fallback 时 log o8.stop.uuidv4_fallback
//   3. 加两个 aliyun 高保真 checkpoint:
//      - o8.stop.save_branch_entered (进入 save 分支)
//      - o8.stop.payload_built (v412Payload 构造完 uuidv4 前)
//      这样和 O7 的 3 个 log 一起,总共 5 个 checkpoint 可以精确
//      定位到哪一段死了
export const OTA_VERSION = 'O8';


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
          <Text style={styles.label}>{`${OTA_VERSION} · ${label}`}</Text>
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
