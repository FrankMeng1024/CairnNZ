/**
 * AuthScreen — Sprint 35 auth overhaul (CR-004 / STORY-00117)
 *
 * Sprint 38: Google OAuth wired via expo-auth-session useIdTokenAuthRequest
 *
 * Previous: Sprint 35 auth overhaul (CR-004 / STORY-00117)
 * - Splash: Sign In is primary (green), Create Account is secondary — industry convention
 * - Form header: small Cairn icon inline-left of title on same line
 * - Focus ring: border-only highlight, placeholder stays fully visible at all times
 * - Privacy Policy: professional, GDPR/NZ Privacy Act compliant text
 * - Social buttons: Apple (disabled, shows info) + Google (placeholder → Sprint 36 real OAuth)
 * - Auth wired to real backend via authService (STORY-00119)
 *
 * Previous: Sprint 22 splash uplift (STORY-00058)
 * - Cairn logo glow pulse, premium pill entry buttons, inline validation
 * - Branded social login buttons (Apple=black, Google=white+border)
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Animated, ScrollView, Dimensions, Alert,
  ActivityIndicator, Modal, Image, ImageBackground,
} from 'react-native';
import Svg, { Path, Ellipse, Line, G } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
// R114/O22 (2026-08-08) Bug 2: DateTimePicker removed. See DobInputs
// helper below — replaced with three plain TextInputs (Year / Month / Day)
// so the DOB picker works over OTA without a native binary rebuild.
// v412: UnfinishedSessionBanner 已被 v412 UnfinishedRecoveryModal 取代 (HikingScreen 内)
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAppStore } from '../store/useAppStore';
import { storage } from '../store/storage';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import { login, register, loginWithGoogle, verifyCode, resendCode,
  passwordResetRequest, passwordResetVerify, patchDob, restoreAccount,
} from '../services/authService';
import { CairnLogo } from '../components/ActivityIcons/CairnLogo';
import { GlassPanel } from '../components/GlassPanel';
// O1 batch 39: Google + makeRedirectUri + Prompt imports removed — 0 actual code references (Google OAuth deferred).
import { crashLogger } from '../services/crashLogger';
import { prewarmMapTiles } from '../services/mapboxPrewarm';
import { OtaBadge } from '../components/OtaBadge';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const { height: SCREEN_H } = Dimensions.get('window');

// ── Trail path SVG (draws from bottom to top over ~500ms) ─────────────────
// O1 batch 39: TRAIL_PATH + TRAIL_LENGTH + AnimatedPath + TrailPath removed — function never called.

// ── Animated Cairn Logo — 3-stone ellipse + waving triangle flag ──────────
// Matches icon_logo_anim14.html: three stacked ellipses rising from base,
// then flag drops and waves with traveling-wave physics (三角 中波★).
// All animation via pure setInterval+setState — no Animated API on SVG paths.

// Stone rise: 3 stones animate up sequentially (s0=base, s1=mid, s2=top)
// viewBox: 0 0 22 30 — same as HTML prototype
// Each stone settles ~0.9s after the previous for a deliberate, weighty feel.
const STONE_DEFS = [
  // base stone
  { cx: 11,   cy: 23.5, rx: 8.0,  ry: 3.0,  color: '#4a6b38', shadowOp: 0.20, delay: 0    },
  // mid stone
  { cx: 9.8,  cy: 16.5, rx: 4.95, ry: 1.98, color: '#5d7c46', shadowOp: 0.24, delay: 900  },
  // top stone
  { cx: 12.5, cy: 10.5, rx: 3.06, ry: 1.28, color: '#7a9e5a', shadowOp: 0.28, delay: 1800 },
];
// Flag pole tip Y (top of top stone)
const POLE_TIP_Y = 9.22;
const POLE_X = 12.5;

// Traveling wave config — 三角中波★
const FLAG_CFG = { f1: 0.52, k1: 0.75, f2: 0.88, k2: 1.15, a2: 0.38, amp: 0.55, p2: 1.1 };

function calcFlagPaths(t: number, fadeIn: number): { flagD: string; sheenD: string } {
  // Triangle flag: pole at (12.5,1.5)–(12.5,5.5), tip converges to (20,3.5)
  const X0 = POLE_X, Y_TOP = 1.5, Y_BOT = 5.5, Y_TIP = 3.5, X_TIP = 20, N = 8;
  const cfg = FLAG_CFG;
  const ptsTop: [number, number][] = [];
  const ptsBot: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const xNorm = i / N;
    const x = X0 + (X_TIP - X0) * xNorm;
    const env = xNorm * xNorm;
    const w1 = Math.sin(2 * Math.PI * (cfg.f1 * t - cfg.k1 * xNorm));
    const w2 = Math.sin(2 * Math.PI * (cfg.f2 * t - cfg.k2 * xNorm) + cfg.p2);
    const off = env * cfg.amp * (w1 + cfg.a2 * w2) * fadeIn * 0.5;
    ptsTop.push([x, Y_TOP + (Y_TIP - Y_TOP) * xNorm + off]);
    ptsBot.push([x, Y_BOT + (Y_TIP - Y_BOT) * xNorm + off]);
  }
  const f = (v: number) => v.toFixed(3);
  let d = `M ${f(ptsTop[0][0])} ${f(ptsTop[0][1])}`;
  for (let i = 1; i <= N; i++) {
    d += ` Q ${f((ptsTop[i-1][0]+ptsTop[i][0])/2)} ${f((ptsTop[i-1][1]+ptsTop[i][1])/2)} ${f(ptsTop[i][0])} ${f(ptsTop[i][1])}`;
  }
  for (let i = N - 1; i >= 0; i--) {
    d += ` Q ${f((ptsBot[i][0]+ptsBot[i+1][0])/2)} ${f((ptsBot[i][1]+ptsBot[i+1][1])/2)} ${f(ptsBot[i][0])} ${f(ptsBot[i][1])}`;
  }
  // Sheen: top-half strip 0.7u thick
  const half = Math.ceil(ptsTop.length / 2);
  const topH = ptsTop.slice(0, half);
  let s = `M ${f(topH[0][0])} ${f(topH[0][1])}`;
  for (let i = 1; i < topH.length; i++) {
    s += ` Q ${f((topH[i-1][0]+topH[i][0])/2)} ${f((topH[i-1][1]+topH[i][1])/2)} ${f(topH[i][0])} ${f(topH[i][1])}`;
  }
  for (let i = topH.length - 2; i >= 0; i--) {
    const by = topH[i][1] + 0.7, by1 = topH[i+1][1] + 0.7;
    s += ` Q ${f((topH[i][0]+topH[i+1][0])/2)} ${f((by+by1)/2)} ${f(topH[i][0])} ${f(by)}`;
  }
  return { flagD: d + ' Z', sheenD: s + ' Z' };
}

// Full logo: stones rise sequentially, then flag drops + waves
// size prop scales the whole SVG (used for small version in verify screen)
// R21 (2026-08-17): official Google "G" mark — 4-color SVG per Google
// brand guidelines. Used on the Landing "Continue with Google" button so
// the mark is recognisable, not a monochrome placeholder.
// R21 (2026-08-17): official Apple glyph — filled silhouette per Apple
// HIG "Sign in with Apple" button spec. Icon-only monochrome, meant to
// sit on white pill next to "Continue with Apple" text.
function AppleIcon({ size = 18, color = '#000' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path fill={color} d="M17.523 12.632c.03 2.964 2.598 3.945 2.626 3.958-.021.068-.407 1.4-1.343 2.775-.808 1.19-1.646 2.375-2.966 2.4-1.297.024-1.713-.77-3.196-.77-1.482 0-1.945.746-3.172.794-1.274.048-2.244-1.286-3.06-2.47C4.75 16.885 3.481 12.408 5.194 9.4c.85-1.492 2.371-2.437 4.023-2.461 1.25-.024 2.43.842 3.196.842.764 0 2.198-1.041 3.707-.888.631.026 2.402.255 3.541 1.924-.091.057-2.115 1.235-2.138 3.815M15.093 5.42c.678-.821 1.135-1.964.99-3.1-.977.04-2.157.65-2.858 1.47-.628.725-1.177 1.887-1.03 3.001 1.088.084 2.201-.552 2.898-1.371" />
    </Svg>
  );
}

function GoogleGIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <Path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <Path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <Path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </Svg>
  );
}

function AnimatedCairn({ size = 4, noFlag = false, onComplete, staticMode = false }: { size?: number; noFlag?: boolean; onComplete?: () => void; staticMode?: boolean }) {
  // Stone visibility: starts FAR off the bottom (y=30 = pushed entirely
  // out of the 22×30 viewBox) and opacity 0. Initialising y far below the
  // base position guarantees that even if react-native-svg's native bridge
  // momentarily ignores opacity=0 on first paint, the stones still cannot
  // be seen because they are translated outside the visible area.
  // staticMode renders the final state (stones risen, flag down) without
  // running any setInterval/setTimeout.
  const [stoneY, setStoneY] = useState(staticMode ? [0, 0, 0] : [30, 30, 30]);
  const [stoneOp, setStoneOp] = useState(staticMode ? [1, 1, 1] : [0, 0, 0]);
  const [showFlag, setShowFlag] = useState(staticMode ? !noFlag : false);
  const [flagDropY, setFlagDropY] = useState(staticMode ? 0 : -26);
  const [flagD, setFlagD] = useState('');
  const [sheenD, setSheenD] = useState('');
  const waveStartRef = useRef<number | null>(null);
  const waveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timersRef = useRef<Array<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (staticMode) {
      // Static mode: jump to final state, fire onComplete once, no timers.
      onComplete?.();
      // Compute the flag's final wave path once (t=large = settled wave).
      try {
        const { flagD: fd, sheenD: sd } = calcFlagPaths(2.0, 1.0);
        setFlagD(fd);
        setSheenD(sd);
      } catch { /* ignore — flag will not render but stones will */ }
      return () => { mountedRef.current = false; };
    }

    // Animate each stone rising in sequence
    STONE_DEFS.forEach((_, idx) => {
      const startTimeout = setTimeout(() => {
        if (!mountedRef.current) return;
        // Snap from far-offscreen (y=30) to the rise-start position (y=6)
        // on the same tick we begin animating, so the stone never visibly
        // teleports — it just appears at the bottom and rises.
        setStoneY(prev => { const n = [...prev]; n[idx] = 6; return n; });
        // Rise over 630ms with deliberate ease — feels like a stone
        // settling under its own weight onto the cairn.
        const start = Date.now();
        const timer = setInterval(() => {
          if (!mountedRef.current) {
            clearInterval(timer);
            return;
          }
          const p = Math.min((Date.now() - start) / 630, 1);
          const ease = 1 - Math.pow(1 - p, 3);
          setStoneY(prev => { const n = [...prev]; n[idx] = 6 * (1 - ease); return n; });
          setStoneOp(prev => { const n = [...prev]; n[idx] = ease; return n; });
          if (p >= 1) {
            clearInterval(timer);
            if (idx === 2) {
              if (mountedRef.current) onComplete?.();
              if (!noFlag) {
                // Hold a beat after top stone lands, then plant flag with a "bam" feel.
                const flagTimeout = setTimeout(() => {
                  if (mountedRef.current) setShowFlag(true);
                }, 350);
                timersRef.current.push(flagTimeout);
              }
            }
          }
        }, 16);
        timersRef.current.push(timer);
      }, STONE_DEFS[idx].delay);
      timersRef.current.push(startTimeout);
    });
    return () => {
      mountedRef.current = false;
      timersRef.current.forEach((t) => {
        clearInterval(t as any);
        clearTimeout(t as any);
      });
      timersRef.current = [];
      if (waveTimerRef.current) clearInterval(waveTimerRef.current);
    };
  }, []);

  // Once flag is shown, animate drop then wave
  useEffect(() => {
    if (staticMode) return;
    if (!showFlag) return;
    waveStartRef.current = null;
    const dropStart = Date.now();
    waveTimerRef.current = setInterval(() => {
      if (!mountedRef.current) {
        if (waveTimerRef.current) clearInterval(waveTimerRef.current);
        return;
      }
      const now = Date.now();
      if (!waveStartRef.current) waveStartRef.current = now;
      const t = (now - waveStartRef.current) / 1000;
      const fadeIn = Math.min(t / 1.4, 1);
      const dropElapsed = now - dropStart;
      // Flag plants with a snappy "bam" — fast drop with ease-in (gravity).
      // -26 → 0 over 250ms, easeInQuad so it accelerates as it lands.
      let dy: number;
      if (dropElapsed < 250) {
        const p = dropElapsed / 250;
        const eased = p * p; // easeInQuad
        dy = -26 + (26 * eased);
      } else {
        dy = 0;
      }
      setFlagDropY(dy);
      const { flagD: fd, sheenD: sd } = calcFlagPaths(t, fadeIn);
      setFlagD(fd);
      setSheenD(sd);
    }, 16);
    return () => { if (waveTimerRef.current) clearInterval(waveTimerRef.current); };
  }, [showFlag]);

  const SVG_W = 22 * size, SVG_H = 30 * size;

  return (
    <View style={{ width: SVG_W, height: SVG_H }}>
      <Svg width={SVG_W} height={SVG_H} viewBox="0 0 22 30" fill="none">
        {/* Shadow ellipse under base */}
        <Ellipse cx="11" cy="28.5" rx="8.5" ry="1.0" fill="#4a6b38" opacity={0.10} />

        {/* 3 stones — rise from bottom */}
        {STONE_DEFS.map((s, i) => (
          <G key={i} transform={`translate(0, ${stoneY[i]})`} opacity={stoneOp[i]}>
            <Ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.color} />
            <Path
              d={`M ${s.cx - s.rx} ${s.cy} a ${s.rx} ${s.ry} 0 0 0 ${s.rx * 2} 0`}
              fill="#2d4a20"
              opacity={s.shadowOp}
            />
          </G>
        ))}

        {/* Flag pole + waving flag — drops after stones complete */}
        {showFlag && (
          <G transform={`translate(0, ${flagDropY})`}>
            <Line
              x1={POLE_X} y1="1.5" x2={POLE_X} y2={POLE_TIP_Y}
              stroke="#3d5c30" strokeWidth="1.1" strokeLinecap="round"
            />
            {flagD ? <Path d={flagD} fill="#7a9e5a" /> : null}
            {sheenD ? <Path d={sheenD} fill="white" opacity={0.22} /> : null}
          </G>
        )}
      </Svg>
    </View>
  );
}

const cairnStyles = StyleSheet.create({
  container: { alignItems: 'center' },
});

// ── Press-animated wrapper ─────────────────────────────────────────────────
function PressBtn({ onPress, style, children, scale = 0.97, disabled }: {
  onPress: () => void; style?: object | object[]; children: React.ReactNode; scale?: number; disabled?: boolean;
}) {
  const anim = useRef(new Animated.Value(1)).current;
  const onIn = () => !disabled && Animated.spring(anim, { toValue: scale, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const onOut = () => Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();
  return (
    <Animated.View style={{ transform: [{ scale: anim }] }}>
      <TouchableOpacity
        onPress={disabled ? undefined : onPress}
        onPressIn={onIn}
        onPressOut={onOut}
        activeOpacity={disabled ? 0.5 : 1}
        style={[style, disabled && { opacity: 0.5 }]}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Password field with eye toggle ─────────────────────────────────────────
function PasswordInput({ value, onChangeText, placeholder, error, onBlur, isNew }: {
  value: string; onChangeText: (v: string) => void; placeholder: string;
  error?: string; onBlur?: () => void; isNew?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = React.useRef<TextInput>(null);
  return (
    <>
      <View style={[formStyles.inputWrap, !!error && formStyles.inputError, focused && !error && formStyles.inputFocused]}>
        <View style={formStyles.inputIcon}>
          <Icon name="KeyRound" size={IconSize.sm} color={focused ? Colors.primary : Colors.textMuted} strokeWidth={1.8} />
        </View>
        <TextInput
          ref={inputRef}
          style={formStyles.inputInner}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          // R114/O22 (2026-08-10) Bug X: user reported password field
          // auto-clears after submit error. Root cause: iOS Strong-Password
          // Autofill (triggered by textContentType='newPassword' +
          // autoComplete='password-new') decides the user "rejected" its
          // suggestion when the form fails validation and wipes the field.
          // We disable iOS's password-manager interference so the value
          // the user typed stays put after an error — they just edit it.
          textContentType="none"
          autoComplete="off"
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          // R114/O24 (2026-08-12) defense-in-depth: explicitly opt out of
          // iOS behaviors that could wipe the buffer on refocus. These
          // are the platform defaults but stating them documents intent
          // and prevents future regressions if RN changes defaults.
          clearTextOnFocus={false}
          selectTextOnFocus={false}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); onBlur?.(); }}
        />
        {/* AUTH-1 (2026-08-11): X clear button — industry-standard affordance
            so the user can wipe the field in one tap when a password error
            makes them want a fresh start (instead of long-press-select-all).
            R114/O24 (2026-08-12) refinement: 4-eyes review flagged the
            original hitSlop.left=8 caused iOS users to hit the X when
            aiming at the right end of the input, then their next keystroke
            replaced the (now-cleared) field with a single char. Fix:
            (a) shrink hitSlop.left to 0 so X only accepts taps on itself;
            (b) hide X while the field is focused (typing users don't need
            it; they can backspace). Only visible when field has content
            AND is blurred = user is clearly deciding to wipe. */}
        {value.length > 0 && !focused && (
          <TouchableOpacity
            testID="btn-password-clear"
            style={formStyles.clearBtn}
            onPress={() => { onChangeText(''); inputRef.current?.focus(); }}
            accessibilityRole="button"
            accessibilityLabel="Clear password"
            hitSlop={{ top: 8, bottom: 8, left: 0, right: 4 }}
          >
            <Icon name="X" size={IconSize.sm} color={Colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={formStyles.eyeBtn}
          onPress={() => setShow(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={show ? 'Hide password' : 'Show password'}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
        >
          <Icon name={show ? 'EyeOff' : 'Eye'} size={IconSize.sm} color={Colors.textMuted} strokeWidth={1.8} />
        </TouchableOpacity>
      </View>
      {!!error && <Text style={formStyles.fieldError}>{error}</Text>}
    </>
  );
}

// ── OTP 6-cell input with auto-focus + auto-submit ─────────────────────────
// R114/O22 (2026-08-10) Bug D: replaces the single-input verification code
// field. Six independent boxes look cleaner and support:
//   - Auto-focus next box after each digit
//   - Backspace to prior box
//   - Paste a 6-digit code into any box → fills all
//   - When 6 digits are complete → onComplete(code) fires; parent auto-verifies
function OtpInput({ value, onChange, onComplete, error, autoFocus, autoSubmit = true }: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (code: string) => void;
  error?: boolean;
  autoFocus?: boolean;
  // R21 (2026-08-17 user "reset password 6 位和注册不一样"): let caller
  // opt out of auto-submit-on-complete. Register verify auto-verifies
  // (autoSubmit=true, default). Forgot verify has a New Password input
  // below, so it needs the user to tap Reset button manually.
  autoSubmit?: boolean;
}) {
  const refs = React.useRef<Array<any>>([]);
  const digits: string[] = [];
  for (let i = 0; i < 6; i++) digits.push(value[i] ?? '');

  const applyValue = (next: string) => {
    // Only digits, max 6.
    const clean = next.replace(/\D/g, '').slice(0, 6);
    onChange(clean);
    if (clean.length === 6) {
      // Fire completion callback on the next microtask so parent state
      // (verifyCode_) has time to update before the verify request goes out.
      // Also blur the last input so the keyboard closes cleanly.
      setTimeout(() => {
        try { refs.current[5]?.blur?.(); } catch { /* silent */ }
        if (autoSubmit) onComplete(clean);
      }, 0);
    }
  };

  const onCellChange = (idx: number, raw: string) => {
    // Native paste handler: if raw > 1 char (autofill or paste), replace whole value.
    const clean = raw.replace(/\D/g, '');
    if (clean.length > 1) {
      applyValue(clean);
      // Focus the last non-empty cell (or 5 if fully filled).
      const focusIdx = Math.min(clean.length, 5);
      setTimeout(() => { try { refs.current[focusIdx]?.focus?.(); } catch { /* silent */ } }, 0);
      return;
    }
    // Single-char change: replace digit at idx.
    const arr = value.split('');
    while (arr.length < 6) arr.push('');
    arr[idx] = clean; // may be '' when clearing
    const merged = arr.slice(0, 6).join('');
    applyValue(merged);
    // Advance focus if a digit was entered and we're not at the last box.
    if (clean && idx < 5) {
      try { refs.current[idx + 1]?.focus?.(); } catch { /* silent */ }
    }
  };

  const onKeyPress = (idx: number, key: string) => {
    // Backspace on an empty cell goes back to previous cell.
    if (key === 'Backspace' && !digits[idx] && idx > 0) {
      try { refs.current[idx - 1]?.focus?.(); } catch { /* silent */ }
    }
  };

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
      {digits.map((d, i) => (
        <TextInput
          key={i}
          ref={(r) => { refs.current[i] = r; }}
          value={d}
          onChangeText={(v) => onCellChange(i, v)}
          onKeyPress={(e) => onKeyPress(i, e.nativeEvent.key)}
          keyboardType="number-pad"
          maxLength={1}
          textContentType={i === 0 ? 'oneTimeCode' : 'none'}
          autoComplete={i === 0 ? 'sms-otp' : 'off'}
          autoFocus={autoFocus && i === 0}
          style={{
            flex: 1,
            aspectRatio: 1,
            maxWidth: 56,
            borderWidth: 2,
            borderColor: error ? Colors.danger : (d ? Colors.primary : Colors.border),
            borderRadius: 12,
            textAlign: 'center',
            fontSize: 22,
            fontWeight: '700',
            color: Colors.textPrimary,
            backgroundColor: 'rgba(255,255,255,0.95)',
          }}
          returnKeyType={i === 5 ? 'done' : 'next'}
          selectTextOnFocus
        />
      ))}
    </View>
  );
}

// ── DOB three-field input (Year / Month / Day) ─────────────────────────────
// R114/O22 (2026-08-08): replaces @react-native-community/datetimepicker
// so we can ship the DOB picker over OTA without a new native binary.
// Contract with parent: `value` is 'YYYY-MM-DD' string or empty. On any
// valid change we call `onChange(newValue)`. If the parsed date fails
// the 13+ age gate we call `onError(msg)` — parent still stores what the
// user typed so the fields show it back.
function DobInputs({ value, onChange, onError, error }: {
  value: string;
  onChange: (v: string) => void;
  onError: (msg: string) => void;
  error?: string;
}) {
  // Split the incoming 'YYYY-MM-DD' string into fields. Missing/invalid
  // parts render as empty so the user sees the placeholder.
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [y, setY] = React.useState(parts ? parts[1] : '');
  const [m, setM] = React.useState(parts ? parts[2] : '');
  const [d, setD] = React.useState(parts ? parts[3] : '');

  const commit = (yy: string, mm: string, dd: string) => {
    // Only emit a change when all three fields have 4 / 2 / 2 digits.
    // Otherwise clear parent's dob so the submit button knows it's empty.
    if (yy.length === 4 && mm.length >= 1 && dd.length >= 1) {
      const mmPadded = mm.padStart(2, '0');
      const ddPadded = dd.padStart(2, '0');
      const iso = `${yy}-${mmPadded}-${ddPadded}`;
      const yNum = Number(yy);
      const mNum = Number(mm);
      const dNum = Number(dd);
      // Simple range checks. Backend enforces 13+ and calendar validity
      // definitively; here we just guide the user.
      if (yNum < 1900 || yNum > new Date().getFullYear()) {
        onError('Please enter a valid year.');
      } else if (mNum < 1 || mNum > 12) {
        onError('Month must be 01–12.');
      } else if (dNum < 1 || dNum > 31) {
        onError('Day must be 01–31.');
      } else {
        // Age gate — 13+ per backend rule.
        const birth = new Date(iso);
        const age = (Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
        if (Number.isNaN(age)) {
          onError('Please enter a valid date.');
        } else if (age < 13) {
          onError('Cairn is only available for people aged 13 and up.');
        }
      }
      onChange(iso);
    } else {
      onChange('');
    }
  };

  // R114 concept polish (2026-08-16): DOB fields now use inputWrap
  // shell (matches other form fields exactly) with a bare TextInput
  // inside — visual parity with Email / Name / Password pills per
  // Auth-3-signup.png concept.
  // 2026-08-16 fix: 3-input DOB row is tight on 375. Override inputWrap's
  // Spacing.md paddingHorizontal to a smaller value so the placeholder text
  // (YYYY / MM / DD) fits inside each pill without clipping.
  const wrapStyle = [formStyles.inputWrap, !!error && formStyles.inputError,
    { flex: 1, paddingHorizontal: 4 }];
  const innerStyle = {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: 0,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    textAlign: 'center' as const,
    backgroundColor: 'transparent' as const,
    minWidth: 0,  // web fix: prevent flex shrink from clipping
  };

  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <View style={[...wrapStyle, { flex: 1.3 }]}>
        <TextInput
          value={y}
          onChangeText={(v) => {
            const clean = v.replace(/\D/g, '').slice(0, 4);
            setY(clean);
            commit(clean, m, d);
          }}
          placeholder="YYYY"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          maxLength={4}
          style={innerStyle}
          testID="input-dob-year"
          returnKeyType="next"
        />
      </View>
      <View style={wrapStyle}>
        <TextInput
          value={m}
          onChangeText={(v) => {
            const clean = v.replace(/\D/g, '').slice(0, 2);
            setM(clean);
            commit(y, clean, d);
          }}
          placeholder="MM"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          maxLength={2}
          style={innerStyle}
          testID="input-dob-month"
          returnKeyType="next"
        />
      </View>
      <View style={wrapStyle}>
        <TextInput
          value={d}
          onChangeText={(v) => {
            const clean = v.replace(/\D/g, '').slice(0, 2);
            setD(clean);
            commit(y, m, clean);
          }}
          placeholder="DD"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          maxLength={2}
          style={innerStyle}
          testID="input-dob-day"
          returnKeyType="done"
        />
      </View>
    </View>
  );
}

// ── Inline text input with error ───────────────────────────────────────────
function FieldInput({ icon, placeholder, value, onChangeText, error, onBlur, keyboardType, autoCapitalize, autoFocus, textContentType, autoComplete }: {
  icon: string; placeholder: string; value: string; onChangeText: (v: string) => void;
  error?: string; onBlur?: () => void; keyboardType?: any; autoCapitalize?: any; autoFocus?: boolean;
  textContentType?: any; autoComplete?: any;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <>
      <View style={[formStyles.inputWrap, !!error && formStyles.inputError, focused && !error && formStyles.inputFocused]}>
        <View style={formStyles.inputIcon}>
          <Icon name={icon as any} size={IconSize.sm} color={focused ? Colors.primary : Colors.textMuted} strokeWidth={1.8} />
        </View>
        <TextInput
          style={formStyles.inputInner}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? 'sentences'}
          autoFocus={autoFocus}
          textContentType={textContentType}
          autoComplete={autoComplete}
          autoCorrect={false}
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); onBlur?.(); }}
        />
      </View>
      {!!error && <Text style={formStyles.fieldError}>{error}</Text>}
    </>
  );
}

// ── Privacy Policy content ─────────────────────────────────────────────────
const PRIVACY_POLICY = `Cairn Privacy Policy
Effective date: May 2026

1. What we collect
• Account data: name, email address, hashed password (never stored in plain text)
• Location data: GPS coordinates, only while you actively start a tracking session
• Activity data: track routes, distance, duration, planted markers — associated with your account
• Device info: OS type, app version (for crash reporting only)

2. Why we collect it
• Location: to record your track, calculate distance, and enable safety features
• Account data: to identify you and protect your personal track history
• We never collect your location in the background without an active session

3. How we protect it
• Passwords hashed with bcrypt (industry standard)
• Data encrypted in transit (HTTPS/TLS)
• JWT tokens expire after 7 days
• You can delete your account and all associated data at any time

4. Sharing
• We do not sell your data to third parties — ever
• Location and track data shared only with friends you explicitly add
• We may use aggregated, anonymised statistics to improve the product

5. Your rights
• Access: request a copy of your data at any time
• Deletion: delete your account and all data via Settings → Account → Delete Account
• Correction: update your profile information at any time

6. Applicable law
Cairn complies with the New Zealand Privacy Act 2020 and, where applicable, the EU General Data Protection Regulation (GDPR).

7. Contact
privacy@cairnapp.nz`;

// ── Auth Screen ────────────────────────────────────────────────────────────
// O18 AUTH-04/06: 'forgot_request' and 'forgot_verify' are the new forgot-
// password flow. 'dob_backfill' is the modal shown to pre-migration users
// on next login (nullable dateOfBirth). 'restore_confirm' is shown when
// login returns hint='pending_deletion'.
type AuthView =
  | 'splash' | 'login' | 'register' | 'verify' | 'welcome'
  | 'forgot_request' | 'forgot_verify'
  | 'dob_backfill' | 'restore_confirm'
  // Concept 1.6 Account Created success screen. Auto-shown after
  // register completes; auto-navigates to Home ~2s later.
  | 'success'
  // Concept 3.4 Network Error screen. Shown when an API request fails
  // with a network-level error. Tap "Try Again" returns to the previous
  // view so the user can retry.
  | 'network_error'
  // ── 2026-08-16 concept batch (rows 01–06 of auth-scan) ────────────────
  // Concept 1.4 Verify Email — dedicated 6-digit OTP UI (paper bg, pill
  //   boxes, wall-clock resend countdown). Reuses handleVerify + handleResend
  //   under the hood; API unchanged.
  | 'verify_email'
  // Concept 1.5 Complete Profile — standalone Display Name + DOB collector.
  //   Currently accessible as a demo view; Continue triggers setView('success').
  //   API unchanged; register happy path still submits name+DOB inline.
  | 'complete_profile'
  // Concept 1.7 Go to Home — mountain-landscape transition screen shown
  //   after 'success' with "YOUR WORLD / 12.6 km²". Auto-navigates to Home
  //   after 2s. No button.
  | 'go_to_home'
  // Concept 2.2 Restore Session — landscape bg + white spinner + "Restoring
  //   your journey". Displayed during hydrate; auto-transitions after ~2s.
  | 'restore_session'
  // Concept 2.4 Session Expired — paper bg + green lock icon + Sign In pill.
  | 'session_expired'
  // Concept 3.2 Code Sent — paper bg + green send icon + email echoed +
  //   wall-clock resend timer + Back to Sign In.
  | 'code_sent'
  // Concept 3.3 Invalid Code — paper bg + coral circle with white X +
  //   resend timer + Back to Sign In.
  | 'invalid_code';

// R21 (2026-08-17): apple_confirm / google_confirm views removed. Apple &
// Google OAuth already show system-native full-screen modals (Sign in with
// Apple sheet, in-app Safari for Google), so an in-app intermediate confirm
// screen was redundant friction. Landing buttons now call the OAuth handler
// directly.

// Remember-me persistence key. Stored value is a JSON-encoded
// { email, password } pair. Cleared on Sign Out or when the user
// signs in with the box unchecked.
// O1 batch 28.5: 老 REMEMBER_ME_KEY (AsyncStorage 明文) 已废弃,改用
// credentialsStore (SecureStore 加密)。首次开 app 会自动清理老 key。
const OLD_REMEMBER_ME_KEY = 'cairn_remember_me';

export function AuthScreen() {
  // Breadcrumb FIRST so even if hooks below crash we know we got here.
  crashLogger.breadcrumb('AuthScreen:render_start');
  // v302 boot diag: server beacon — survives jetsam/native-crash.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('auth_screen_render_start');
  } catch {/* ignore */}
  const nav = useNavigation<Nav>();
  const { setLoggedIn, setUser, hydrate } = useAppStore();
  // R21 v2 (2026-08-17): AuthScreen only mounts when hydrate() finished
  // with isLoggedIn=false (no token OR invalid token). Initial view is
  // 'splash' — the Landing screen. Old logic that started at
  // 'restore_session' and ran a second getMe on mount is gone: hydrate
  // in useAppStore already did the token check and flipped isLoggedIn
  // if valid, so if we get here, we're definitely not signed in.
  const [view, setView] = useState<AuthView>('splash');
  // R21 v2 (2026-08-17): removed the mount-time getMe check. hydrate() in
  // useAppStore already ran on App mount, did getToken + getMe, and
  // flipped isLoggedIn if valid. If we're rendering AuthScreen at all,
  // it means hydrate decided we're NOT signed in — so just show splash.
  // No second getMe here (was causing double API round-trip + longer
  // restore_session flash).
  // Concept 3.4: remember the view before switching to 'network_error'
  // so "Try Again" can restore where the user was. Defaults to 'splash'
  // as a safe fallback.
  const [previousView, setPreviousView] = useState<AuthView>('splash');
  const [welcomeName, setWelcomeName] = useState('');
  const [verifyEmail, setVerifyEmail] = useState('');   // email to verify after register
  const [verifyCode_, setVerifyCode_] = useState('');   // 6-digit code input
  const [verifyError, setVerifyError] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0); // seconds remaining
  // R114/O24 (2026-08-12) Bug 3 fix: wall-clock deadline instead of a
  // JS setInterval-driven decrement. setInterval/setTimeout are throttled
  // (and often paused entirely) when the app goes to background on iOS,
  // so a 60s countdown started before backgrounding could still show
  // "45s left" 5 minutes later. Now we store an absolute epoch ms
  // deadline; the ticker + AppState listener both recompute against
  // Date.now() so wall-clock time is what counts, background or not.
  const resendDeadlineRef = useRef<number>(0);
  const startResendCooldown = React.useCallback((seconds: number) => {
    resendDeadlineRef.current = Date.now() + seconds * 1000;
    setResendCooldown(seconds);
  }, []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // O18 AUTH-06: date of birth captured at register. Stored as 'YYYY-MM-DD'
  // string (matches backend Joi.isoDate schema). Empty until user picks.
  const [dob, setDob] = useState('');
  const [dobError, setDobError] = useState('');
  // R114/O22 (2026-08-08) Bug 2: DateTimePicker modal state removed —
  // inline DobInputs (Year / Month / Day fields) replaces the picker.
  // O18 AUTH-04: forgot-password state — reset email, 6-digit code, new pw.
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  // O18 AUTH-01: post-login restore-modal state.
  const [restoreDeadline, setRestoreDeadline] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);  // STORY-00132: separate state
  const [appleLoading, setAppleLoading] = useState(false);    // O18 batch 6.6
  const [apiError, setApiError] = useState('');
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [privacyError, setPrivacyError] = useState('');
  const googleFlowActive = useRef(false);
  const submitAttempted = useRef(false);  // STORY-00133: only validate on blur after first submit

  // ── 2026-08-16 concept views (rows 01–06 of auth-scan) ────────────────
  // Concept 1.5 Complete Profile — separate Display Name + DOB collector.
  // Kept isolated from the register form state (name / dob) so the
  // existing register happy path is not disturbed.
  const [profileName, setProfileName] = useState('');
  const [profileDob, setProfileDob] = useState('');
  const [profileError, setProfileError] = useState('');
  // Concept 3.2 Code Sent / 3.3 Invalid Code — email echoed on the screen.
  // Populated by whoever navigates to those views (default falls back to
  // verifyEmail so the screens still render meaningfully).
  const [codeSentEmail, setCodeSentEmail] = useState('');

  // Google OAuth hook — CONFIRMED as sign-out crash root cause via OTA
  // bisect on 2026-05-21. Re-disabled. Real fix requires app.json scheme
  // for makeRedirectUri to work — coming in next build. Until then,
  // Google sign-in shows alert and AnimatedCairn animation can be
  // re-enabled (it's safe).
  crashLogger.breadcrumb('AuthScreen:google_hook_skipped');
  const googleRequest: any = null;
  const googleResponse: any = null;
  const promptGoogleAsync = async () => {
    // Sprint 6 review M8: Google backend endpoint /api/auth/google works,
    // but the client-side OAuth flow requires EXPO_PUBLIC_GOOGLE_CLIENT_ID
    // + iOS client ID configured in Google Cloud Console. Until the user
    // completes that Pre-Build gate setup (see sprint-6-pre-build-gate.md
    // section 4), we honestly say "not configured yet" rather than
    // pretending the button will do something. Backend contract is ready
    // to accept id_token via loginWithGoogle whenever the client can
    // produce one.
    Alert.alert(
      'Google Sign In',
      'Google Sign In needs a build configured with your Google OAuth client. Use email sign-in in the meantime.',
      [{ text: 'OK' }],
    );
    return { type: 'dismiss' as const };
  };
  void googleRequest;
  void googleResponse;

  const splashFade = useRef(new Animated.Value(0)).current;
  const splashTranslate = useRef(new Animated.Value(8)).current;
  // R21 perf (2026-08-17): hero image fades in 180ms after decode. Prior to
  // this, cold start showed a brief paper-only frame while the JPEG decoded
  // from disk (~40-80ms on iPhone), then the image popped in with the RN
  // built-in Android fade (~300ms). Now: container is paper-colored so the
  // pre-decode frame is invisible; onLoad flips this Animated.Value to 1
  // over 180ms for a controlled, subtle fade instead of an abrupt pop.
  // R21 (2026-08-17): heroImageFade initial value 1 (opaque). Previously
  // started at 0 and animated to 1 on Image onLoad, which caused the
  // background to lag behind the text by ~180ms — user reported "背景 文字
  // 整体 都不是同一个时间出现的 有先后 这个不好". Now the JPG (187 KB)
  // decodes fast enough that even without fade-in the appear is instant.
  const heroImageFade = useRef(new Animated.Value(1)).current;
  // v312 anchor: splash refs created.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('auth_screen_after_splash_refs');
  } catch {/* ignore */}
  // STORY-00135: wordmark + tagline sequential animations
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkTranslate = useRef(new Animated.Value(-8)).current;
  const tagline1Opacity = useRef(new Animated.Value(0)).current;
  const tagline1Translate = useRef(new Animated.Value(-8)).current;
  const tagline2Opacity = useRef(new Animated.Value(0)).current;
  const tagline2Translate = useRef(new Animated.Value(-8)).current;
  // O1 batch 39: trailComplete state removed — TrailPath component removed.
  // Increments every time we (re-)enter splash so AnimatedCairn remounts and
  // replays its stone-rising animation from scratch — without this, the user
  // hits Back from Sign In and sees the stones already stacked.
  const [splashMountKey, setSplashMountKey] = useState(0);
  // v312 anchor: all useRef + useState done.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('auth_screen_after_all_state');
  } catch {/* ignore */}

  const animateWordmark = () => {
    // Wordmark fades in alongside the first stone landing — no delay.
    Animated.parallel([
      Animated.timing(wordmarkOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(wordmarkTranslate, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      // Tagline line 1 — 80ms stagger
      Animated.parallel([
        Animated.timing(tagline1Opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(tagline1Translate, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(tagline2Opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(tagline2Translate, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start();
      }, 80);
    });
  };

  // Kick off Mapbox tile pre-warm on AuthScreen mount so tiles are
  // downloading in the background while the user signs in. Web is skipped
  // inside prewarmMapTiles. Silent on failure — never blocks auth flow.
  useEffect(() => {
    prewarmMapTiles();
  }, []);

  // Load remember-me credentials on first mount. If the user previously
  // ticked the box on a successful Sign In we pre-fill email + password
  // and re-tick the box. The user still has to tap Sign In — we never
  // auto-route them past the auth screen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // O1 batch 28.5: 从 credentialsStore (SecureStore) hydrate。
        // 首次运行同时清老 AsyncStorage key (若存在)。
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { loadCredentials } = require('../services/credentialsStore');
        const creds = await loadCredentials();
        if (cancelled) return;
        if (creds) {
          setEmail(creds.email);
          setPassword(creds.password);
          setRememberMe(true);
        }
        // 一次性清老 AsyncStorage key (若有历史明文数据),不阻塞主流程
        try {
          await storage.removeItem(OLD_REMEMBER_ME_KEY);
        } catch {/* silent */}
      } catch {
        // Corrupt/missing creds — ignore.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isFirstSplashMount = useRef(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/bootDiagnostics').markBootPhase('auth_view_effect', { view });
    } catch {/* ignore */}
    if (view === 'splash') {
      // R21 (2026-08-17): all splash elements appear SIMULTANEOUSLY.
      // R21 v2 (2026-08-17 user "从 sign in back 到首页不柔和 有个很突兀的闪烁"):
      // only fade in on FIRST splash mount. When user backs from login →
      // splash we skip the fade so the transition is instant (feels like
      // a native stack pop, not a reload).
      splashTranslate.setValue(0);
      wordmarkOpacity.setValue(1);
      wordmarkTranslate.setValue(0);
      tagline1Opacity.setValue(1);
      tagline1Translate.setValue(0);
      tagline2Opacity.setValue(1);
      tagline2Translate.setValue(0);
      if (isFirstSplashMount.current) {
        splashFade.setValue(0);
        setSplashMountKey(k => k + 1);
        Animated.timing(splashFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        isFirstSplashMount.current = false;
      } else {
        splashFade.setValue(1);
      }
    }
  }, [view]);

  const resetErrors = () => {
    setNameError(''); setEmailError(''); setPasswordError(''); setConfirmError('');
    setPrivacyError(''); setApiError('');
  };

  // R114/O22 post-verify fix: clear form input state so switching views
  // (splash → register, login → register, signout → register, etc.) always
  // starts with a blank form. Prior behavior kept the previously-typed
  // email/name/password across view changes, which meant a signout-then-
  // create-account showed prefill from the previous session. Reset all
  // user-input state fields; auth-flow state (verifyEmail, view, cooldown)
  // is untouched so mid-flow transitions still work.
  //
  // O22 hotfix (2026-08-08): earlier version called setShowPassword which
  // does not exist in this component (the password-visibility state lives
  // inside PasswordInput's own useState `show`). That undefined reference
  // crashed the app on every view change. Removed.
  const resetFormInputs = () => {
    setName('');
    setEmail('');
    setPassword('');
    setConfirm('');
    setDob('');
    setDobError('');
    setPrivacyChecked(false);
    // AUTH-3 (2026-08-11, 4-eyes review #2): also clear restoreDeadline so
    // if user A's soft-deleted deadline is cached and user B logs in fresh
    // with no restore state, user B never sees User A's deadline flash on
    // stale render. /login handler sets restoreDeadline on hint='pending_deletion',
    // otherwise it stays empty — but we defensively clear on every view change.
    setRestoreDeadline('');
    submitAttempted.current = false;
  };

  const handleViewChange = (v: AuthView) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/bootDiagnostics').markBootPhase('auth_view_change', { to: v });
    } catch {/* ignore */}
    resetErrors();
    resetFormInputs();
    submitAttempted.current = false;
    setView(v);
  };

  const validateEmail = (val: string) => {
    if (!val.trim()) return 'Email is required';
    // O17: validate email format on both login and register (was register-only).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) return 'Please enter a valid email';
    return '';
  };

  const validatePassword = (val: string) => {
    if (!val) return 'Password is required';
    if (view === 'register') {
      // R21 (2026-08-17 user "注册时候的密码没满足要求也通过了"): concept
      // 1.3 shows 3 rules (8 chars / uppercase / number) as a green
      // checklist. Previously only length was enforced client-side and
      // backend also only checks length, so users could bypass the
      // stricter rules. Now client blocks submit unless all 3 pass.
      if (val.length < 8) return 'Password must be at least 8 characters';
      if (!/[A-Z]/.test(val)) return 'Password must contain an uppercase letter';
      if (!/[0-9]/.test(val)) return 'Password must contain a number';
    }
    return '';
  };

  // O18 AUTH-06: 'YYYY-MM-DD' validator + whole-year age check. UI keeps
  // the input a single ISO date string; keyboard is 'numbers-and-punctuation'
  // so users can type the format directly. A future picker widget can drop
  // in without changing this contract.
  const validateDob = (val: string) => {
    if (!val || !val.trim()) return 'Date of birth is required';
    const m = val.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 'Use YYYY-MM-DD (e.g. 1998-06-15)';
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== mo - 1 ||
      dt.getUTCDate() !== d
    ) return 'Not a real date';
    const now = new Date();
    let age = now.getUTCFullYear() - y;
    const nm = now.getUTCMonth() - (mo - 1);
    if (nm < 0 || (nm === 0 && now.getUTCDate() < d)) age -= 1;
    if (age < 13) return 'Cairn is for people 13 and up';
    if (age > 120) return 'Please enter a valid date';
    return '';
  };

  const handleAuth = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/bootDiagnostics').markBootPhase('login_handleAuth_enter');
    } catch {/* ignore */}
    const isRegister = view === 'register';
    submitAttempted.current = true;  // STORY-00133: enable blur validation after first submit
    let valid = true;

    if (isRegister && !name.trim()) { setNameError('Name is required'); valid = false; }
    const eErr = validateEmail(email); if (eErr) { setEmailError(eErr); valid = false; }
    const pErr = validatePassword(password); if (pErr) { setPasswordError(pErr); valid = false; }
    if (isRegister && password !== confirm) { setConfirmError('Passwords do not match'); valid = false; }
    // O18 AUTH-06: DOB required at register only (login doesn't need it).
    if (isRegister) {
      const dErr = validateDob(dob);
      if (dErr) { setDobError(dErr); valid = false; } else { setDobError(''); }
    }
    if (isRegister && !privacyChecked) { setPrivacyError('Please agree to continue'); valid = false; }
    if (!valid) return;

    // R21 (2026-08-17): request GPS permission IN the button click's user-
    // gesture context. Web browsers only show the permission prompt when
    // the request happens inside a user-initiated event; async setTimeout
    // loses the gesture context and Chrome silently drops the prompt.
    // Fire-and-forget: don't await, don't block login on grant/deny.
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Location = require('expo-location');
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted' && perm.canAskAgain !== false) {
          await Location.requestForegroundPermissionsAsync();
        }
      } catch { /* silent */ }
    })();

    setLoading(true);
    setApiError('');
    try {
      const result = isRegister
        ? await register(name.trim(), email.trim().toLowerCase(), password, dob.trim())
        : await login(email.trim().toLowerCase(), password);

      if (result.error) {
        // 409 = email already registered — guide user to sign in instead
        if (result.error.includes('already exists') || result.error.includes('already registered')) {
          setApiError('An account with this email already exists. Please sign in instead, or use "Continue with Google" if you signed up with Google.');
        } else {
          setApiError(result.error);
        }
        return;
      }

      // 2-step registration: backend sent a code to the user's email
      if (result.step === 'verify') {
        setVerifyEmail(result.email || email.trim().toLowerCase());
        setVerifyCode_('');
        setVerifyError('');
        startResendCooldown(60);
        setView('verify');
        return;
      }

      // O18 AUTH-01: soft-deleted account — show restore modal instead of
      // continuing to Home. Token is already saved by login() so restore
      // endpoint can authenticate; user must explicitly choose Restore or
      // Cancel (Cancel = sign out without restoring, account will hard-
      // delete when cron sweeps past the deadline).
      if (result.hint === 'pending_deletion' && result.restoreDeadline) {
        setRestoreDeadline(result.restoreDeadline);
        setView('restore_confirm');
        return;
      }

      // R114/O22 user directive (2026-08-08): remove DOB backfill for old
      // accounts. Per user: "老账户你帮我 migrate 随便什么 birthday. 因为
      // 我们上限必定是有 birthday 的, 简化这里, 不要有多余的, 容易出问题".
      // Backend migration writes a sentinel DOB (2000-01-01) for any legacy
      // user whose dateOfBirth is NULL. Client no longer prompts.

      // Persist or clear remember-me credentials based on the checkbox.
      // O1 batch 28.5: 用 credentialsStore (SecureStore 加密)。rememberMe=true
      // 存 {email, password},toggle off = 清 SecureStore (下次不预填密码)。
      // 用户拍板: 测试向 sim-walker + 生产 UX 都要 remember-me 完整功能。
      if (!isRegister) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { saveCredentials, clearCredentials } = require('../services/credentialsStore');
          if (rememberMe) {
            await saveCredentials({
              email: email.trim().toLowerCase(),
              password,
            });
          } else {
            await clearCredentials();
          }
        } catch {
          // Storage failure is non-fatal — the user is signed in either way.
        }
      }
      // Re-hydrate stores with new user's data (sessions, markers) BEFORE
      // flipping isLoggedIn / navigating. If we navigated first, Home
      // would render with sessions=[] then re-render once the fetch
      // returned, causing a visible content jitter (RecentRow appearing,
      // stats row appearing, cards reflowing). Waiting here keeps the
      // first paint of Home in its terminal state.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('login_before_setUser');
      } catch {/* ignore */}
      if (result.user) setUser(result.user);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('login_before_hydrate');
      } catch {/* ignore */}
      await hydrate();
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('login_after_hydrate');
      } catch {/* ignore */}
      // Sprint 72 STORY-00549: clear logout marker on successful login so
      // next cold start can auto-login.
      try {
        await storage.removeItem('cairn_logout_marker');
        crashLogger.breadcrumb('login:marker_cleared');
      } catch {/* ignore */}
      // R21 (2026-08-17): setUser first, then setLoggedIn. Reversed order
      // prevents RootNavigator gate `isLoggedIn && user` from evaluating
      // true-and-null for one render.
      if (result.user) setUser(result.user);
      setLoggedIn(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('login_after_setLoggedIn');
      } catch {/* ignore */}
      if (isRegister) {
        // R21 (2026-08-17): register happy path — but authService.register
        // actually always returns step='verify' + no token, so this branch
        // is unreachable in production. Keeping the code path here as a
        // safety net if backend contract ever changes to return token
        // directly. Straight to Home; OnboardingModal handles welcome.
        nav.replace('Home');
      } else {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../services/bootDiagnostics').markBootPhase('login_before_nav_home');
        } catch {/* ignore */}
        // v319 fix: DEFER nav.replace to next tick. v311-v318 crashed
        // here because setLoggedIn(true) + nav.replace('Home') on the
        // same JS tick made native-stack reconcile Stack.Navigator
        // children from 1 (Auth) → 13 (Home + 12 others) AND dispatch
        // a 'replace' command simultaneously — native-stack iOS edge
        // case = synchronous JS throw / native crash.
        //
        // Smoking gun: register branch above uses setTimeout(...,1800)
        // for nav.replace AND has never been reported as crashing.
        // Login branch was synchronous AND consistently crashes. Single
        // operational difference is the deferral. (Subagent C analysis,
        // 2026-06-24, _review/v319_login_crash_investigation/subagent_C.md.)
        setTimeout(() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../services/bootDiagnostics').markBootPhase('login_settimeout_fired');
          } catch {/* ignore */}
          // R21 (2026-08-17 user "sign in 后应该索要各种权限"): request
          // foreground location permission after successful sign in so
          // Home can immediately show real weather + city name. Fire-and-
          // forget: nav.replace happens regardless of grant/deny.
          (async () => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const Location = require('expo-location');
              const perm = await Location.getForegroundPermissionsAsync();
              if (perm.status !== 'granted' && perm.canAskAgain !== false) {
                await Location.requestForegroundPermissionsAsync();
              }
            } catch { /* silent */ }
          })();
          nav.replace('Home');
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../services/bootDiagnostics').markBootPhase('login_after_nav_home');
          } catch {/* ignore */}
        }, 0);
      }
    } catch (e: any) {
      const msg: string = e?.message || '';
      const status: number | undefined = e?.status;
      // Sleep-run 2026-08-16: 401 = session/token invalid → dedicated
      // Concept 2.4 Session Expired screen. Prefer explicit status code;
      // fall back to string sniffing so authService errors that only
      // surface as `Error("401 …")` still route correctly.
      const is401 =
        status === 401 ||
        msg.includes('401') ||
        /unauthori[sz]ed/i.test(msg) ||
        /session expired/i.test(msg);
      if (is401) {
        setPreviousView(view);
        setView('session_expired');
      } else if (
        // TypeError / "Failed to fetch" / "Network request failed" = network unreachable
        e?.name === 'TypeError' ||
        msg.includes('Network request failed') ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('net::') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND')
      ) {
        setApiError('Cannot reach the server. Check your internet connection and try again.');
        // Concept 3.4 Network Error: swap the whole screen to the
        // dedicated no-connection view instead of a small inline error.
        // Remember where we were so Try Again can bring the user back.
        setPreviousView(view);
        setView('network_error');
      } else if (msg) {
        setApiError(msg);
      } else {
        setApiError('We couldn\'t reach Cairn. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    googleFlowActive.current = true;
    setGoogleLoading(true);  // STORY-00132: immediate feedback
    resetErrors();
    await promptGoogleAsync();
    setGoogleLoading(false);
    googleFlowActive.current = false;
  };

  // O18 batch 6.6 AUTH-02: Sign in with Apple.
  // Uses expo-apple-authentication. iOS only (Apple restricts the API).
  // Web + Android fall back to the "coming soon" alert.
  const handleAppleAuth = async () => {
    // R114/O22 STORY-73002: comprehensive breadcrumb coverage. User reports
    // Apple SI causes app crash on Create Account screen — not a JS-catchable
    // error, so we need boot-ok upload of breadcrumbs to reconstruct which
    // step crashed. Every branch and every await is instrumented.
    crashLogger.breadcrumb('apple:handler_start');
    resetErrors();
    if (Platform.OS !== 'ios') {
      crashLogger.breadcrumb(`apple:platform_skip os=${Platform.OS}`);
      Alert.alert('Apple Sign In', 'Apple Sign In is available on iOS only. Please use email or Google on this device.', [{ text: 'OK' }]);
      return;
    }
    setAppleLoading(true);
    try {
      crashLogger.breadcrumb('apple:require_modules');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AppleAuthentication = require('expo-apple-authentication');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Crypto = require('expo-crypto');
      crashLogger.breadcrumb('apple:isAvailable_call');
      const available = await AppleAuthentication.isAvailableAsync();
      crashLogger.breadcrumb(`apple:isAvailable_result=${available}`);
      if (!available) {
        Alert.alert('Apple Sign In', 'Apple Sign In is not available on this device (older iOS or unsupported region).', [{ text: 'OK' }]);
        return;
      }
      // Sprint 6 review C7 fix: generate a random nonce, SHA-256 it, and
      // pass the hash to Apple. Apple echoes the hash in the identity_token
      // and the backend verifies it matches. This prevents identity_token
      // replay attacks — App Store review checklist item.
      crashLogger.breadcrumb('apple:nonce_gen_start');
      const rawNonce = Math.random().toString(36).slice(2) + Date.now().toString(36) +
                       Math.random().toString(36).slice(2);
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      crashLogger.breadcrumb(`apple:nonce_gen_ok raw_len=${rawNonce.length} hash_len=${hashedNonce.length}`);
      crashLogger.breadcrumb('apple:signInAsync_start');
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      crashLogger.breadcrumb(`apple:signInAsync_ok has_id_token=${!!credential.identityToken} has_fullName=${!!credential.fullName} has_user=${!!credential.user}`);
      const idToken = credential.identityToken;
      if (!idToken) {
        crashLogger.breadcrumb('apple:no_id_token');
        Alert.alert('Apple Sign In failed', 'No identity token returned. Please try again.', [{ text: 'OK' }]);
        return;
      }
      // Apple only sends `fullName` on the very first authorize. Persist
      // it so a retry (after crash / user cancels first attempt) can
      // still send the display name.
      let providedName: string | undefined;
      if (credential.fullName && (credential.fullName.givenName || credential.fullName.familyName)) {
        providedName = [credential.fullName.givenName, credential.fullName.familyName]
          .filter(Boolean).join(' ').trim() || undefined;
        crashLogger.breadcrumb(`apple:fullName_extracted name_len=${(providedName || '').length}`);
        try { await storage.setItem(`cairn_apple_name_${credential.user}`, providedName || ''); } catch { /* silent */ }
      } else {
        try {
          const cached = await storage.getItem(`cairn_apple_name_${credential.user}`);
          if (cached) providedName = cached;
          crashLogger.breadcrumb(`apple:fullName_from_cache has_cached=${!!cached}`);
        } catch { /* silent */ }
      }
      crashLogger.breadcrumb('apple:loginWithApple_start');
      const { loginWithApple } = require('../services/authService');
      const result = await loginWithApple(idToken, providedName, rawNonce);
      crashLogger.breadcrumb(`apple:loginWithApple_result has_err=${!!result.error} has_user=${!!result.user} hint=${result.hint || 'none'}`);
      if (result.error) {
        Alert.alert('Apple Sign In failed', result.error, [{ text: 'OK' }]);
        return;
      }
      if (result.hint === 'pending_deletion' && result.restoreDeadline) {
        crashLogger.breadcrumb('apple:pending_deletion_redirect');
        setRestoreDeadline(result.restoreDeadline);
        setView('restore_confirm');
        return;
      }
      if (result.user) {
        crashLogger.breadcrumb(`apple:setUser user_id=${result.user.id}`);
        setUser(result.user);
      }
      crashLogger.breadcrumb('apple:hydrate_start');
      await hydrate();
      crashLogger.breadcrumb('apple:setLoggedIn');
      setLoggedIn(true);
      crashLogger.breadcrumb('apple:complete');
    } catch (err: any) {
      // Apple returns an error whose `code` includes ERR_REQUEST_CANCELED
      // when the user swipes away — suppress the alert in that case.
      const code = err?.code || '';
      const msg = String(err?.message || '').slice(0, 80);
      crashLogger.breadcrumb(`apple:catch code=${code} msg=${msg}`);
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return;
      Alert.alert('Apple Sign In failed', err?.message || 'Please try again.', [{ text: 'OK' }]);
    } finally {
      setAppleLoading(false);
      crashLogger.breadcrumb('apple:finally');
    }
  };

  // Resend cooldown countdown — R114/O24: wall-clock recompute + AppState
  // resync so backgrounded time still counts down.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => {
      const remaining = Math.max(
        0,
        Math.ceil((resendDeadlineRef.current - Date.now()) / 1000)
      );
      setResendCooldown(remaining);
    }, 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native');
    const sub = AppState.addEventListener('change', (state: string) => {
      if (state !== 'active') return;
      if (resendDeadlineRef.current <= 0) return;
      const remaining = Math.max(
        0,
        Math.ceil((resendDeadlineRef.current - Date.now()) / 1000)
      );
      setResendCooldown(remaining);
    });
    return () => sub.remove();
  }, []);

  // 2026-08-16 concept batch — auto-advance for transitional views.
  //   • go_to_home    : 2s, then nav.replace('Home')
  //   • restore_session: 2s, then setView('splash') as safe default
  //   • code_sent     : 2s, then setView('forgot_verify') so the user
  //                     can enter the code they just received. Without
  //                     this the Code Sent screen would be a dead-end.
  // All three are pure UI transitions with no side effects on auth state.
  useEffect(() => {
    if (view !== 'go_to_home') return;
    const t = setTimeout(() => { nav.replace('Home'); }, 2000);
    return () => clearTimeout(t);
  }, [view, nav]);
  // R21 (2026-08-17): removed the 2s auto-timeout on 'restore_session'.
  // The mount-time useEffect above owns this view now — it either advances
  // to Home (token valid) or to 'splash' (no token / invalid). A dumb 2s
  // timeout would race the getMe call and could kick users to splash mid-
  // request.
  useEffect(() => {
    if (view !== 'code_sent') return;
    const t = setTimeout(() => { setView('forgot_verify'); }, 2000);
    return () => clearTimeout(t);
  }, [view]);

  // R114/O22 (2026-08-10) Bug Y: auto-fill OTP from clipboard.
  // Typical flow: user gets email → opens mail app → long-presses code
  // → Copy → switches back to Cairn. When the app foregrounds on the
  // verify view, we read the clipboard. If it contains exactly 6 digits
  // we fill the OTP inputs and immediately auto-verify. Non-6-digit
  // clipboard content is ignored (never trigger verify on random text).
  //
  // Triggered on: (a) entering verify view, (b) AppState → active while
  // on verify view (user tabs back from mail). We also skip if the user
  // has already typed something (to avoid overwriting mid-typing).
  useEffect(() => {
    if (view !== 'verify') return;
    let cancelled = false;
    const tryAutoFill = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Clipboard = require('expo-clipboard');
        const txt = await Clipboard.getStringAsync();
        if (cancelled) return;
        const digits = String(txt || '').replace(/\D/g, '');
        // Only autofill if:
        //   - clipboard has EXACTLY 6 digits
        //   - user hasn't typed anything yet (respect manual input)
        //   - not already verifying
        if (digits.length === 6 && !verifyCode_ && !verifyLoading) {
          setVerifyCode_(digits);
          void handleVerify(digits);
        }
      } catch { /* silent — clipboard access may be denied */ }
    };
    // Fire once on view entry.
    void tryAutoFill();
    // Fire again when user comes back from another app (mail app).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native');
    const sub = AppState.addEventListener('change', (s: string) => {
      if (s === 'active') void tryAutoFill();
    });
    return () => { cancelled = true; sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const handleVerify = async (codeOverride?: string) => {
    // R114/O22 (2026-08-10) Bug D: 支持从 OtpInput 自动传入完整 code, 不再
    // 依赖 verifyCode_ state. 因为 setState 是异步的, 用户输完第 6 位后
    // 立即触发 verify 时 verifyCode_ 可能还是上一次的值. 优先使用 codeOverride.
    const raw = codeOverride ?? verifyCode_;
    const trimmed = raw.replace(/\s/g, '');
    if (trimmed.length !== 6) { setVerifyError('Please enter the 6-digit code.'); return; }
    setVerifyLoading(true);
    setVerifyError('');
    const result = await verifyCode(verifyEmail, trimmed);
    setVerifyLoading(false);
    if (result.error) {
      // R21 (2026-08-17 user "invalid code 页面不对 应该停留在 6 位验证码页面
      // 让我可以改 继续输"): stay on verify_email view, show error inline
      // below the OTP boxes. Previously routed to a dedicated 'invalid_code'
      // splash which was a dead-end — user had to Back to Sign In and
      // restart the entire flow.
      setVerifyError(result.error);
      return;
    }
    // Sprint 72 STORY-00549: verify (registration) also counts as fresh login
    try {
      await storage.removeItem('cairn_logout_marker');
      crashLogger.breadcrumb('login:marker_cleared');
    } catch {/* ignore */}
    // R21 (2026-08-17): setUser FIRST, then setLoggedIn — reversed order.
    // RootNavigator gate is `isLoggedIn && user`; if we flipped isLoggedIn
    // first, gate could evaluate true-and-null for one render, breaking
    // screens that assert user!.  Order matters.
    if (result.user) setUser(result.user);
    setLoggedIn(true);
    await hydrate();
    // R21 (2026-08-17): register verify success → straight to Home.
    // OnboardingModal (4-page tour, gated by hasCompletedOnboarding)
    // covers any settling / welcome moment. No welcome view / no timeout.
    nav.replace('Home');
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setVerifyError('');
    const result = await resendCode(verifyEmail);
    if (result.error) { setVerifyError(result.error); return; }
    startResendCooldown(60);
  };

  // ── Google / Apple Sign-in Confirmation (Concept 1.3) ──────────────────
  // R114/O25 (2026-08-17): pixel-scanned from signinapple.png (Google concept —
  // filenames were swapped) and signingoogle.png (Apple concept).
  // Layout (430×932pt device):
  //   • Logo + Title inline row: y_top ≈ 177pt (logo x=49..83, ~34pt wide;
  //     title text starts x=114pt, ~30pt tall). Deep-forest title #22362D.
  //   • 3 checklist rows: y_top 358 / 437 / 515 (≈ 78pt gap). Each row is
  //     a green Check icon (16pt, #22362D) + gray body text (14pt, #8C8C8C).
  //   • Primary Continue button: y_top 672..765 band (~54pt effective button
  //     inside; button color #21362C, radius 14pt, white text).
  //   • Cancel link: y ≈ 843pt, centered, gray 14pt.
  //   • Paper bg #F4EFE6.
  // R21 (2026-08-17): apple_confirm / google_confirm views removed —
  // Apple & Google OAuth show system-native full-screen modals so an
  // in-app confirm was redundant. Landing buttons call OAuth directly.

  // ── Splash ─────────────────────────────────────────────────────────────

  // ── Splash ─────────────────────────────────────────────────────────────
  if (view === 'splash') {
    return (
      <View style={[styles.container, { flex: 1, backgroundColor: '#F4EFE6' }]}>
        {/* 1.1 Welcome (Landing) — CONCEPT_TRUTH sleep-run-2026-08-15
            R21 (2026-08-17): switched bg from o3-auth-background.png (290×147
            landscape, only sky visible cropped to portrait) to
            home-background.jpg (941×1672 portrait — full mountain valley
            landscape, matches concept 1.1 which shows peaks + lake + fore-
            ground rocks). Same image the Home + Settings screens already
            use, so the world feels continuous across landing → home.

            R21 perf (2026-08-17): source switched from landing-hero.png
            (1.9 MB, 853×1844) to landing-hero.jpg (187 KB, JPEG q85, same
            dimensions). PNG had alpha channel but landscape needs none;
            visual identical, decode ~10× faster on iPhone. Container
            backgroundColor is paper (#F4EFE6) so the pre-decode frame
            shows paper (not white flash), then image fades in via
            Animated.timing on onLoad. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: heroImageFade }]}>
          <ImageBackground
            source={require('../../assets/auth/landing-hero.jpg')}
            style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
            resizeMode="cover"
            fadeDuration={0}
          >
          >
            {/* R21 (2026-08-17): softer top-to-bottom fade to paper. Landing
                hero is landscape (702×358); on portrait phones it fills as
                cover with center-crop showing the valley + lake. Gradient
                fades to paper #F4EFE6 so the 3 button pills sit on solid
                ground and don't fight the image. */}
            <LinearGradient
              colors={['rgba(255,255,255,0.15)', 'transparent', 'rgba(244,239,230,0.5)', '#F4EFE6']}
              locations={[0, 0.4, 0.75, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          </ImageBackground>
        </Animated.View>

        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <Animated.View style={[styles.splashInner, { opacity: splashFade, transform: [{ translateY: splashTranslate }] }]}>
              {/* Hero area — cairn stack + CairnNZ wordmark + tagline */}
              <View style={styles.logoArea}>
                <View style={{ position: 'relative', alignItems: 'center' }}>
                {/* R22 iter-10 (2026-08-17 user request): "logo 也稍微放大
                    一点 往下一点". size 3 → 4 for bigger cairn stack. */}
                <AnimatedCairn key={splashMountKey} size={4} />
              </View>
              {/* Wordmark: "CairnNZ" per CONCEPT_TRUTH brand */}
              <Animated.Text style={[styles.appName, {
                opacity: wordmarkOpacity,
                transform: [{ translateY: wordmarkTranslate }],
              }]}>CairnNZ</Animated.Text>
              <View style={styles.taglineWrap}>
                <Animated.Text style={[styles.tagline, {
                  opacity: tagline1Opacity,
                  transform: [{ translateY: tagline1Translate }],
                }]}>Leave your mark,</Animated.Text>
                <Animated.Text style={[styles.tagline, {
                  opacity: tagline2Opacity,
                  transform: [{ translateY: tagline2Translate }],
                }]}>find your path.</Animated.Text>
              </View>
            </View>

            {/* CTA buttons — R21 v2 (2026-08-17): reordered per user preference
                to Email (primary CTA) → Google → Apple. Primary sits topmost
                so thumb sees it first; social auth methods rank by likelihood
                (Google > Apple for NZ market). */}
            <View style={styles.splashActions}>
              {/* OTA version badge — shows update group + auto-update trigger.
                  Positioned above Continue with Email so it's easily reachable
                  for confirming the running version. */}
              <OtaBadge inline />

              {/* Continue with Email — deep green primary CTA.
                  R22 iter-9 (2026-08-17 user request): route to 'login'
                  (Sign In), not 'register'. Sign In is the default action
                  because most users are returning; new users tap the
                  "Create an account" link inside the Sign In view. */}
              <PressBtn
                style={styles.landingEmailBtn}
                onPress={() => handleViewChange('login')}
                scale={0.98}
              >
                <View style={styles.btnContent}>
                  <Icon name="Mail" size={IconSize.sm} color="#fff" strokeWidth={2} />
                  <Text style={styles.landingEmailBtnText}>Continue with Email</Text>
                </View>
              </PressBtn>

              {/* Continue with Google — white pill, official Google G mark
                  R114/O25 (2026-08-17): route to intermediate 'google_confirm'
                  screen (concept 1.3) instead of firing OAuth directly. The
                  confirm screen tells the user what data is shared before we
                  invoke the real Google OAuth flow. */}
              <PressBtn
                style={styles.landingGoogleBtn}
                onPress={handleGoogleAuth}
                scale={0.98}
                disabled={googleLoading || loading}
              >
                <View style={styles.btnContent}>
                  {googleLoading
                    ? <ActivityIndicator size="small" color={Colors.primary} />
                    : <GoogleGIcon />}
                  <Text style={styles.landingGoogleBtnText}>
                    {googleLoading ? 'Connecting…' : 'Continue with Google'}
                  </Text>
                </View>
              </PressBtn>

              {/* Continue with Apple — white pill, official Apple glyph
                  R114/O25 (2026-08-17): same as Google — routes to 'apple_confirm'
                  intermediate screen before firing real Sign in with Apple. */}
              <PressBtn
                style={styles.landingAppleBtn}
                onPress={handleAppleAuth}
                scale={0.98}
                disabled={appleLoading || loading}
              >
                <View style={styles.btnContent}>
                  {appleLoading
                    ? <ActivityIndicator size="small" color={Colors.textPrimary} />
                    : <AppleIcon size={18} color="#000" />}
                  <Text style={styles.landingAppleBtnText}>
                    {appleLoading ? 'Connecting…' : 'Continue with Apple'}
                  </Text>
                </View>
              </PressBtn>

              {/* R21 (2026-08-17): removed "Already have an account? Sign in"
                  link. Concept 1.1 shows only 3 buttons, no bottom link.
                  Sign In flow lives at Concept 1.2 (Choose Sign In Method)
                  which the Sign Up flow's own footer handles. */}
            </View>
          </Animated.View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Email Verification ──────────────────────────────────────────────────
  if (view === 'verify') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={formStyles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            <TouchableOpacity style={formStyles.backBtn} onPress={() => handleViewChange('register')}>
              <Icon name="ChevronLeft" size={IconSize.sm} color={Colors.primary} strokeWidth={2.5} />
              <Text style={formStyles.backText}>Back</Text>
            </TouchableOpacity>

            <View style={formStyles.titleRow}>
              <CairnLogo size={28} />
              <Text style={formStyles.title}>Check your email</Text>
            </View>
            <Text style={formStyles.sub}>
              {'We sent a 6-digit code to '}
              <Text style={{ fontWeight: '600', color: Colors.textPrimary }}>{verifyEmail}</Text>
              {'. Enter it below to verify your account.'}
            </Text>

            {!!verifyError && (
              <View style={formStyles.apiBanner}>
                <Icon name="TriangleAlert" size={14} color={Colors.danger} strokeWidth={2} />
                <Text style={formStyles.apiError}>{verifyError}</Text>
              </View>
            )}

            <Text style={formStyles.label}>Verification Code</Text>
            {/* R114/O22 Bug D (2026-08-10): 6 独立格子 OTP + 输完自动 verify.
                去掉 Verify Email button — 用户输完 6 位就直接判断, 不需要
                多一步点击. 每个格子输入后自动 focus 下一格; 删除时自动
                focus 上一格. 粘贴 6 位数字支持一次填满. */}
            <OtpInput
              value={verifyCode_}
              onChange={(v) => { setVerifyCode_(v); if (verifyError) setVerifyError(''); }}
              onComplete={(code) => { void handleVerify(code); }}
              error={!!verifyError}
              autoFocus
            />
            {verifyLoading && (
              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: Spacing.md, gap: 8 }}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={{ fontSize: FontSize.small, color: Colors.textSecondary }}>Verifying…</Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.md, alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: FontSize.small, color: Colors.textSecondary }}>Didn't receive it?</Text>
              <TouchableOpacity onPress={handleResend} disabled={resendCooldown > 0} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Text style={[
                  { fontSize: FontSize.small, fontWeight: '600' },
                  resendCooldown > 0 ? { color: Colors.textSecondary } : { color: Colors.primary },
                ]}>
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Welcome (post-registration) ────────────────────────────────────────
  if (view === 'welcome') {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]} edges={['top', 'bottom']}>
        <Icon name="CircleCheck" size={56} color={Colors.primary} strokeWidth={1.5} />
        <Text style={[styles.appName, { marginTop: 16, marginBottom: 8 }]}>Welcome, {welcomeName}!</Text>
        <Text style={[styles.tagline, { textAlign: 'center', color: Colors.textSecondary }]}>Welcome to Cairn. Ready for your first hike?</Text>
      </SafeAreaView>
    );
  }

  // ── Concept 1.6 Account Created (success) ──────────────────────────────
  // R22 (2026-08-17) UI-refinement — pixel-scanned concept success.png:
  //   Circle y0=284/888 → ~30% from top (298pt on 932pt phone)
  //   Circle 84px diameter → 160pt (was 120)
  //   Title y=428  → 449pt
  //   Subtitle y=464 → 487pt
  //   BG mountain valley (landing-hero.jpg reused) w/ light paper fade
  // Auto-shown after register completes. Register handler schedules
  // setTimeout(() => nav.replace('Home'), 2000).
  if (view === 'success') {
    return (
      <View style={[styles.container, { backgroundColor: '#F4EFE6' }]}>
        <ImageBackground
          source={require('../../assets/auth/landing-hero.jpg')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          fadeDuration={0}
        >
          {/* Fade valley to paper so type stays readable — matches concept
              where upper 40% is high-key sky/mountains (title area) and
              lower half fades to darker foreground. Concept has NO scrim
              over check circle area, so keep top clear. */}
          <LinearGradient
            colors={['rgba(244,239,230,0.32)', 'rgba(244,239,230,0.10)', 'rgba(244,239,230,0.05)', 'rgba(244,239,230,0.20)']}
            locations={[0, 0.35, 0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </ImageBackground>
        <SafeAreaView
          style={{ flex: 1, alignItems: 'center', paddingTop: SCREEN_H * 0.29, paddingHorizontal: Spacing.xl }}
          edges={['top', 'bottom']}
        >
          {/* Deep-green disc with white check.
              R22 iter-2: concept scan 84/226 = 37% of viewport width →
              on 430pt phone = 160pt. But concept image itself is only 226px
              wide (proportionally cropped) so the DISC visible reads
              ~110-120pt in real UX terms. Sample color RGB(33,54,44) → #21362C. */}
          <View
            style={{
              width: 112, height: 112, borderRadius: 56,
              backgroundColor: '#21362C',
              alignItems: 'center', justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.22, shadowRadius: 18, elevation: 7,
            }}
          >
            {/* Check stroke thick+rounded to match concept ~4-5px stroke */}
            <Icon name="Check" size={52} color="#FFFFFF" strokeWidth={3.2} />
          </View>
          {/* Title — 24pt semibold near-black (matches concept dark text).
              R22 iter-2: bumped 22 → 24 to match concept title feel — reads
              as a proper H1 not a card heading. */}
          <Text
            style={{
              fontSize: 24, fontWeight: '700', color: '#1C1C1C',
              textAlign: 'center', marginTop: 32, letterSpacing: -0.3,
            }}
          >
            You're all set!
          </Text>
          {/* Subtitle — 15pt grey ~#8A8F95. R22 iter-2: marginTop 6 → 8. */}
          <Text
            style={{
              fontSize: 15, color: '#8A8F95',
              textAlign: 'center', marginTop: 8, letterSpacing: 0.1,
            }}
          >
            Welcome to your world.
          </Text>
        </SafeAreaView>
      </View>
    );
  }

  // ── Concept 3.4 Network Error ──────────────────────────────────────────
  // Shown when an API request fails with a network-level error. Gray
  // cloud-off icon, "No connection" title, guidance subtitle, and a
  // deep-green "Try Again" pill that returns the user to the previous
  // view so they can retry the same action.
  if (view === 'network_error') {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: '#F4EFE6', justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl }]}
        edges={['top', 'bottom']}
      >
        <Icon name="CloudOff" size={64} color="#8A8F95" strokeWidth={1.5} />
        <Text
          style={{
            fontSize: 24, fontWeight: '700', color: '#1C1C1C',
            textAlign: 'center', marginTop: Spacing.lg, marginBottom: Spacing.sm,
          }}
        >
          No connection
        </Text>
        <Text
          style={{
            fontSize: 16, color: '#8A8F95',
            textAlign: 'center', marginBottom: Spacing.xxl,
          }}
        >
          Please check your network and try again.
        </Text>
        <TouchableOpacity
          testID="btn-network-retry"
          style={[styles.primaryBtn, { alignSelf: 'stretch', backgroundColor: '#3E5F3A' }]}
          onPress={() => {
            // Return the user to whichever view they were on before the
            // network error interrupted them. Fallback to splash if we
            // somehow lost that state.
            setApiError('');
            setView(previousView || 'splash');
          }}
        >
          <Text style={styles.primaryBtnText}>Try Again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2026-08-16 concept batch (rows 01–06 of auth-scan) — 8 additional views.
  // All views use the concept-locked deep green #3E5F3A hard-coded per the
  // spec ("每个新 view 硬编码这个 hex"). API surface is unchanged; new
  // views reuse existing handlers (handleVerify, handleResend) where
  // applicable and drive setView transitions only.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Concept 1.4 Verify Email ────────────────────────────────────────────
  // R22 (2026-08-17): pixel-scan of verfiy 6.png concept refined layout:
  //   Title y0 =132 → 22pt bold near-black
  //   Sub line 1 y=184 grey  "We've sent a code to"
  //   Sub line 2 y=208 email — same size, darker/semibold
  //   OTP row y=264, 6 boxes h=32px → 48pt
  //   Resend y=380 grey "Resend code in 00:45"
  //   NO Continue button — auto-verify on 6 digits (matches concept).
  if (view === 'verify_email') {
    const mm = String(Math.floor(resendCooldown / 60)).padStart(2, '0');
    const ss = String(resendCooldown % 60).padStart(2, '0');
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: '#F4EFE6' }]}
        edges={['top', 'bottom']}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={formStyles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* R21 v3 (2026-08-17): back color unified to Colors.primary
                (Auth Sign In/Up standard). Was hardcoded '#3E5F3A' from
                the verify_email concept scan — inconsistent with register/
                login/verify backs in the same flow. */}
            <TouchableOpacity style={formStyles.backBtn} onPress={() => handleViewChange('register')}>
              <Icon name="ChevronLeft" size={IconSize.sm} color={Colors.primary} strokeWidth={2.5} />
              <Text style={formStyles.backText}>Back</Text>
            </TouchableOpacity>

            {/* Title — concept 22pt bold, dark near-black #1C1C1C.
                Concept scan y=132/904 (14.6% viewport top) → 136pt on 932pt. */}
            <Text style={{ fontSize: 22, fontWeight: '700', color: '#1C1C1C', marginTop: Spacing.xl, letterSpacing: -0.2 }}>
              Enter the 6-digit code
            </Text>
            {/* Subtitle: line 1 grey, line 2 email semibold dark, tight leading.
                R22 iter-1: split to 2 rows per concept.
                R22 iter-2: email line bumped to 15pt semibold, matches concept
                where "name@example.com" reads visibly larger than the grey line above. */}
            <Text style={{ fontSize: 14, color: '#8A8F95', marginTop: 10 }}>
              We've sent a code to
            </Text>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#1C1C1C', marginTop: 2, marginBottom: 8 }}>
              {verifyEmail || 'name@example.com'}
            </Text>
            {/* R21 (2026-08-17 user "加一句提示 如果找不到应该去垃圾邮件里找"):
                Gmail/Outlook sometimes route Cairn's verification email to
                Spam or Promotions. Tell the user upfront so they don't
                stall waiting for a mail that's already there. */}
            <Text style={{ fontSize: 13, color: '#8A8F95', marginBottom: 32, fontStyle: 'italic' }}>
              Can't find it? Check your spam or promotions folder.
            </Text>

            {!!verifyError && (
              <View style={formStyles.apiBanner}>
                <Icon name="TriangleAlert" size={14} color={Colors.danger} strokeWidth={2} />
                <Text style={formStyles.apiError}>{verifyError}</Text>
              </View>
            )}

            <OtpInput
              value={verifyCode_}
              onChange={(v) => { setVerifyCode_(v); if (verifyError) setVerifyError(''); }}
              onComplete={(code) => { void handleVerify(code); }}
              error={!!verifyError}
              autoFocus
            />

            {verifyLoading && (
              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: Spacing.md, gap: 8 }}>
                <ActivityIndicator size="small" color="#3E5F3A" />
                <Text style={{ fontSize: 13, color: '#8A8F95' }}>Verifying…</Text>
              </View>
            )}

            {/* Resend row — concept centered single line grey, or link when cooldown=0.
                R22 iter-3: gap tightened 36 → 28 to match concept visual (resend
                sits closer to OTP than initially thought — OTP y=272, resend y=380
                in concept = ~108px = ~28pt). */}
            <View style={{ marginTop: 28, alignItems: 'center' }}>
              {resendCooldown > 0 ? (
                <Text style={{ fontSize: 14, color: '#8A8F95' }}>
                  {`Resend code in ${mm}:${ss}`}
                </Text>
              ) : (
                <TouchableOpacity onPress={handleResend} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#3E5F3A' }}>Resend code</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* R22 (2026-08-17): removed manual Continue button. Concept shows
                only OTP + Resend + native keyboard — no CTA. Auto-verify already
                fires on 6th digit via OtpInput onComplete. */}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Concept 1.5 Complete Profile ────────────────────────────────────────
  // Standalone Display Name + DOB collector. Continue triggers setView(
  // 'success'). No API call — this view is decoupled from the register
  // happy path (which still collects name+DOB inline for the actual
  // register() request). Kept isolated per the "不改 API" rule.
  if (view === 'complete_profile') {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: '#F4EFE6' }]}
        edges={['top', 'bottom']}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={formStyles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={{ fontSize: 24, fontWeight: '700', color: '#1C1C1C', marginTop: Spacing.xl }}>
              Tell us about yourself
            </Text>
            <Text style={{ fontSize: 15, color: '#8A8F95', marginTop: Spacing.sm, marginBottom: Spacing.xl }}>
              This helps personalize your experience.
            </Text>

            {!!profileError && (
              <View style={formStyles.apiBanner}>
                <Icon name="TriangleAlert" size={14} color={Colors.danger} strokeWidth={2} />
                <Text style={formStyles.apiError}>{profileError}</Text>
              </View>
            )}

            <Text style={formStyles.label}>Display name</Text>
            <FieldInput
              icon="User"
              placeholder="Your name"
              value={profileName}
              onChangeText={(v) => { setProfileName(v); if (profileError) setProfileError(''); }}
            />

            <Text style={[formStyles.label, { marginTop: Spacing.lg }]}>Date of birth</Text>
            <DobInputs
              value={profileDob}
              onChange={(v) => { setProfileDob(v); if (profileError) setProfileError(''); }}
              onError={setProfileError}
              error={profileError}
            />

            <TouchableOpacity
              testID="btn-complete-profile-continue"
              style={[styles.primaryBtn, { backgroundColor: '#3E5F3A', marginTop: Spacing.xxl }]}
              onPress={() => {
                if (!profileName.trim()) { setProfileError('Please enter your name'); return; }
                const dErr = validateDob(profileDob);
                if (dErr) { setProfileError(dErr); return; }
                setProfileError('');
                setView('success');
              }}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Concept 1.7 Go to Home ──────────────────────────────────────────────
  // Mountain-landscape transition. No button; a useEffect below auto-navs
  // to Home after 2s. Rendered as the "success → home" bridge — kick off
  // by setView('go_to_home') and the effect will fire.
  if (view === 'go_to_home') {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require('../../assets/auth/o3-auth-background.png')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} edges={['top', 'bottom']}>
          <Text
            style={{
              fontSize: 12, fontWeight: '700', color: '#FFFFFF',
              letterSpacing: 2, marginBottom: 4, opacity: 0.9,
            }}
          >
            YOUR WORLD
          </Text>
          <Text style={{ fontSize: 15, color: '#FFFFFF', marginBottom: Spacing.md, opacity: 0.9 }}>
            You&apos;ve explored
          </Text>
          <Text
            style={{
              fontSize: 48, fontWeight: '800', color: '#FFFFFF',
              textShadowColor: 'rgba(0,0,0,0.35)',
              textShadowOffset: { width: 0, height: 2 },
              textShadowRadius: 6,
            }}
          >
            12.6 km²
          </Text>
          <Text style={{ fontSize: 16, color: '#FFFFFF', marginTop: 4, opacity: 0.9 }}>
            New Zealand
          </Text>
        </SafeAreaView>
      </View>
    );
  }

  // ── Concept 2.2 Restore Session ─────────────────────────────────────────
  // Landscape background + white spinner + "Restoring your journey".
  // Kept as a standalone view so it can be manually entered; the app's
  // real hydration gate lives in App.tsx.
  if (view === 'restore_session') {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={require('../../assets/auth/o3-auth-background.png')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} edges={['top', 'bottom']}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text
            style={{
              fontSize: 16, fontWeight: '600', color: '#FFFFFF',
              marginTop: Spacing.lg,
              textShadowColor: 'rgba(0,0,0,0.35)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 4,
            }}
          >
            Restoring your journey
          </Text>
        </SafeAreaView>
      </View>
    );
  }

  // ── Concept 2.4 Session Expired ─────────────────────────────────────────
  // Paper bg + large deep-green lock + "Session expired" + Sign In pill.
  if (view === 'session_expired') {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: '#F4EFE6', justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl }]}
        edges={['top', 'bottom']}
      >
        <View
          style={{
            width: 96, height: 96, borderRadius: 48,
            backgroundColor: 'rgba(62,95,58,0.10)',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: Spacing.xl,
          }}
        >
          <Icon name="Lock" size={48} color="#3E5F3A" strokeWidth={1.8} />
        </View>
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#1C1C1C', textAlign: 'center', marginBottom: Spacing.sm }}>
          Session expired
        </Text>
        <Text style={{ fontSize: 16, color: '#8A8F95', textAlign: 'center', marginBottom: Spacing.xxl }}>
          Please sign in again.
        </Text>
        <TouchableOpacity
          testID="btn-session-expired-signin"
          style={[styles.primaryBtn, { alignSelf: 'stretch', backgroundColor: '#3E5F3A' }]}
          onPress={() => setView('login')}
        >
          <Text style={styles.primaryBtnText}>Sign In</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Concept 3.2 Code Sent ───────────────────────────────────────────────
  // Paper bg + deep-green circle w/ white paper-plane + "Check your email"
  // + email echoed + wall-clock resend timer + Back to Sign In link.
  if (view === 'code_sent') {
    const mm = String(Math.floor(resendCooldown / 60)).padStart(2, '0');
    const ss = String(resendCooldown % 60).padStart(2, '0');
    const shownEmail = codeSentEmail || forgotEmail || verifyEmail || 'name@example.com';
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: '#F4EFE6', justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl }]}
        edges={['top', 'bottom']}
      >
        <View
          style={{
            width: 96, height: 96, borderRadius: 48,
            backgroundColor: '#3E5F3A',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: Spacing.xl,
            ...Shadow.fab,
          }}
        >
          <Icon name="Send" size={44} color="#FFFFFF" strokeWidth={2} />
        </View>
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#1C1C1C', textAlign: 'center', marginBottom: Spacing.sm }}>
          Check your email
        </Text>
        <Text style={{ fontSize: 16, color: '#8A8F95', textAlign: 'center', marginBottom: Spacing.lg }}>
          {"We've sent a 6-digit code to "}
          <Text style={{ fontWeight: '600', color: '#1C1C1C' }}>{shownEmail}</Text>
        </Text>
        {resendCooldown > 0 ? (
          <Text style={{ fontSize: 14, color: '#8A8F95', marginBottom: Spacing.xxl }}>
            {`Resend code in ${mm}:${ss}`}
          </Text>
        ) : (
          <TouchableOpacity onPress={handleResend} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginBottom: Spacing.xxl }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#3E5F3A' }}>Resend code</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          testID="link-code-sent-back"
          onPress={() => setView('login')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#3E5F3A' }}>Back to Sign In</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Concept 3.3 Invalid Code ────────────────────────────────────────────
  // Paper bg + peach/coral circle with white X + "Invalid code" +
  // resend timer + Back to Sign In link.
  if (view === 'invalid_code') {
    const mm = String(Math.floor(resendCooldown / 60)).padStart(2, '0');
    const ss = String(resendCooldown % 60).padStart(2, '0');
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: '#F4EFE6', justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl }]}
        edges={['top', 'bottom']}
      >
        <View
          style={{
            width: 96, height: 96, borderRadius: 48,
            backgroundColor: '#F5D6C4',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: Spacing.xl,
          }}
        >
          <Icon name="X" size={48} color="#FFFFFF" strokeWidth={2.5} />
        </View>
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#1C1C1C', textAlign: 'center', marginBottom: Spacing.sm }}>
          Invalid code
        </Text>
        <Text style={{ fontSize: 16, color: '#8A8F95', textAlign: 'center', marginBottom: Spacing.lg }}>
          Please check the code and try again.
        </Text>
        {resendCooldown > 0 ? (
          <Text style={{ fontSize: 14, color: '#8A8F95', marginBottom: Spacing.xxl }}>
            {`Resend code in ${mm}:${ss}`}
          </Text>
        ) : (
          <TouchableOpacity onPress={handleResend} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginBottom: Spacing.xxl }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#3E5F3A' }}>Resend code</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          testID="link-invalid-code-back"
          onPress={() => setView('login')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#3E5F3A' }}>Back to Sign In</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── O18 AUTH-01: restore confirmation modal ─────────────────────────────
  // Shown after login when backend flagged hint='pending_deletion'. User
  // must choose Restore (undo soft-delete, continue as normal) or Cancel
  // (sign out without restoring — account hard-deletes on cron sweep).
  //
  // AUTH-3 (2026-08-11): visual redo — Natural Warm glass card matching
  // the AuthScreen system (GlassPanel + warning icon + primary rounded
  // button + subtle secondary text button). Previously the modal was a
  // bare SafeAreaView with danger-red icon and inline styles that did
  // not match the rest of the auth flow.
  if (view === 'restore_confirm') {
    const deadlineStr = restoreDeadline
      ? (() => {
          // AUTH-3: with the 5-minute cooling-off test window, showing a
          // date alone is useless (deadline is minutes away). Show
          // date + time so the user sees an actionable countdown.
          const d = new Date(restoreDeadline);
          const now = new Date();
          const sameDay = d.toDateString() === now.toDateString();
          return sameDay
            ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        })()
      : '';
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: Spacing.lg }]} edges={['top', 'bottom']}>
        <LinearGradient
          colors={['rgba(250, 247, 242, 0.4)', 'rgba(250, 247, 242, 0)']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 240 }}
          pointerEvents="none"
        />
        <GlassPanel
          tint="light"
          borderRadius={24}
          style={{ padding: Spacing.xl, alignItems: 'center', width: '100%', maxWidth: 400, ...Shadow.fab }}
        >
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: Colors.warningBg || 'rgba(255, 178, 100, 0.15)',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: Spacing.base,
          }}>
            <Icon name="TriangleAlert" size={40} color={Colors.warning} strokeWidth={1.6} />
          </View>
          <Text style={[styles.appName, { marginBottom: Spacing.xs, textAlign: 'center' }]}>Restore your account?</Text>
          <Text style={{
            fontSize: FontSize.body,
            textAlign: 'center',
            color: Colors.textSecondary,
            lineHeight: 22,
            marginBottom: Spacing.lg,
          }}>
            You scheduled this account for deletion. It will be permanently deleted on <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>{deadlineStr}</Text>. Restore to keep your hikes and marks.
          </Text>
          <TouchableOpacity
            testID="btn-restore-account"
            style={[styles.primaryBtn, { width: '100%', marginTop: Spacing.xs }]}
            disabled={restoreLoading}
            onPress={async () => {
              setRestoreLoading(true);
              try {
                const r = await restoreAccount();
                if (r.error) {
                  // AUTH-3: explicit English OK button — no Chinese "好" from
                  // system locale default. If session missing, guide user
                  // back to sign-in rather than leaving them stuck in the modal.
                  if (r.hint === 'session_missing') {
                    Alert.alert('Session ended', r.error, [
                      { text: 'Sign in', onPress: () => setView('login') },
                    ]);
                  } else if (r.hint === 'account_gone') {
                    // AUTH-3 4:59-race fix (4-eyes review #2): row was
                    // hard-deleted between login and Restore tap. Modal
                    // is now unrecoverable — route user back to sign-in
                    // with a fresh form so they don't loop on a Restore
                    // button for an account that no longer exists.
                    Alert.alert('Account permanently deleted', r.error, [
                      { text: 'Sign in', onPress: () => handleViewChange('login') },
                    ]);
                  } else {
                    Alert.alert('Restore failed', r.error, [{ text: 'OK' }]);
                  }
                  return;
                }
                if (r.user) setUser(r.user);
                await hydrate();
                setLoggedIn(true);
              } finally {
                setRestoreLoading(false);
              }
            }}>
            {restoreLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryBtnText}>Restore account</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            testID="btn-cancel-restore"
            style={{ paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm, marginTop: Spacing.sm }}
            onPress={async () => {
              // Just sign out — do not restore. Account will hard-delete on cron.
              try {
                const { logout: logoutSvc } = require('../services/authService');
                await logoutSvc();
              } catch { /* silent */ }
              // AUTH-3 (2026-08-11): use handleViewChange so form inputs +
              // errors reset (previously setView('login') left stale
              // email/password prefilled from the account that was just
              // scheduled for deletion — tapping Sign In immediately
              // re-triggered the same restore modal loop).
              handleViewChange('login');
            }}>
            <Text style={{ color: Colors.textMuted, fontSize: FontSize.caption }}>Not now</Text>
          </TouchableOpacity>
        </GlassPanel>
      </SafeAreaView>
    );
  }

  // ── R114/O22 (2026-08-08): DOB backfill view REMOVED per user directive.
  // Legacy users get sentinel 2000-01-01 via migration 032_backfill_null_dob.sql.
  // Client never prompts for backfill.

  // ── O18 AUTH-04: forgot password step 1 — request code by email ─────────
  if (view === 'forgot_request') {
    return (
      <SafeAreaView style={[styles.container, { paddingHorizontal: 28, paddingTop: 24 }]} edges={['top', 'bottom']}>
        {/* R21 (2026-08-17 user "Sign in/up 等界面 back 都太靠上了 位置不好"):
            rewritten to match Sign In / Register visual system —
            Back chevron top-left, title 26pt/700/#21362C ("Reset password"),
            subtitle 14pt/#8A8F95, form input using formStyles, primary
            button #21362C radius 14 height 54 like Sign In button. */}
        {/* R21 v3 (2026-08-17): unified to shared formStyles.backBtn/backText
            (Auth Sign In/Up standard). Was inline styles with fontSize: 14
            hardcoded — diverged from Sign In (uses FontSize.caption = 13). */}
        <TouchableOpacity style={formStyles.backBtn} onPress={() => handleViewChange('login')}>
          <Icon name="ChevronLeft" size={IconSize.sm} color={Colors.primary} strokeWidth={2.5} />
          <Text style={formStyles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={{ marginTop: 40 }}>
          <Text style={{ fontSize: 26, fontWeight: '700', color: '#21362C', letterSpacing: -0.3 }}>
            Reset password
          </Text>
          <Text style={{ fontSize: 14, color: '#8A8F95', fontWeight: '400', marginTop: 6, marginBottom: 32 }}>
            Enter your account email. We'll send a 6-digit code.
          </Text>
          <Text style={formStyles.label}>Email</Text>
          <FieldInput
            icon="Mail"
            placeholder="your@email.com"
            value={forgotEmail}
            onChangeText={(v) => { setForgotEmail(v); if (forgotError) setForgotError(''); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={forgotError}
          />
          <PressBtn
            testID="btn-send-reset-code"
            style={{
              backgroundColor: '#21362C',
              borderRadius: 14,
              minHeight: 54,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 16,
              marginTop: 32,
              opacity: (forgotLoading || resendCooldown > 0) ? 0.6 : 1,
            }}
            disabled={forgotLoading || resendCooldown > 0}
            onPress={async () => {
              const eErr = validateEmail(forgotEmail);
              if (eErr) { setForgotError(eErr); return; }
              setForgotLoading(true);
              try {
                const r = await passwordResetRequest(forgotEmail.trim().toLowerCase());
                if (r.rateLimited) {
                  // R21 (2026-08-17 user "限流了应该告诉我 多久后再试"):
                  // Show explicit rate-limit message + start countdown so
                  // the button reads "Resend in Xs" until unlocked.
                  const secs = r.retryAfterSeconds || 900;
                  setForgotError(`Too many requests. Please wait ${Math.ceil(secs / 60)} min.`);
                  startResendCooldown(secs);
                  return;
                }
                if (r.error) { setForgotError(r.error); return; }
                if (r.devCode) setForgotCode(r.devCode);
                setForgotError('');
                setCodeSentEmail(forgotEmail.trim().toLowerCase());
                startResendCooldown(60);
                setView('forgot_verify');
              } finally {
                setForgotLoading(false);
              }
            }}
            scale={0.98}
          >
            {forgotLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 }}>
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Send code'}
                </Text>
            }
          </PressBtn>
        </View>
      </SafeAreaView>
    );
  }

  // ── O18 AUTH-04: forgot password step 2 — enter code + new password ─────
  if (view === 'forgot_verify') {
    return (
      <SafeAreaView style={[styles.container, { paddingHorizontal: 28, paddingTop: 24 }]} edges={['top', 'bottom']}>
        {/* R21 v3 (2026-08-17): unified to shared formStyles.backBtn/backText. */}
        <TouchableOpacity style={formStyles.backBtn} onPress={() => handleViewChange('forgot_request')}>
          <Icon name="ChevronLeft" size={IconSize.sm} color={Colors.primary} strokeWidth={2.5} />
          <Text style={formStyles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={{ marginTop: 40 }}>
          <Text style={{ fontSize: 26, fontWeight: '700', color: '#21362C', letterSpacing: -0.3 }}>
            Enter code
          </Text>
          <Text style={{ fontSize: 14, color: '#8A8F95', fontWeight: '400', marginTop: 6, marginBottom: 8 }}>
            Check {forgotEmail}. Enter the 6-digit code and choose a new password.
          </Text>
          {/* R21 (2026-08-17): spam hint for reset flow too. */}
          <Text style={{ fontSize: 13, color: '#8A8F95', fontStyle: 'italic', marginBottom: 24 }}>
            Can't find it? Check your spam or promotions folder.
          </Text>
          <Text style={formStyles.label}>Verification code</Text>
          {/* R21 (2026-08-17 user "reset password 6 位和注册的不一样, 参照注册,
              复制也能自动粘贴 但不 auto-submit, 错了停留显示错误"): use the
              same OtpInput 6-box component as register verify (auto-paste
              support, per-cell focus), but pass autoSubmit={false} so the
              user has to tap Reset password button. Errors show below
              (setForgotError) instead of navigating away. */}
          <OtpInput
            value={forgotCode}
            onChange={(v) => { setForgotCode(v); if (forgotError) setForgotError(''); }}
            onComplete={() => { /* no-op, autoSubmit=false */ }}
            error={!!forgotError}
            autoSubmit={false}
            autoFocus
          />
          <Text style={[formStyles.label, { marginTop: 20 }]}>New password</Text>
          <PasswordInput
            value={forgotNewPassword}
            onChangeText={(v) => { setForgotNewPassword(v); if (forgotError) setForgotError(''); }}
            placeholder="At least 8 characters"
            isNew
          />
          {forgotError ? <Text style={formStyles.errorText}>{forgotError}</Text> : null}
          <PressBtn
            testID="btn-reset-password"
            style={{
              backgroundColor: '#21362C',
              borderRadius: 14,
              minHeight: 54,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 16,
              marginTop: 32,
              opacity: forgotLoading ? 0.6 : 1,
            }}
            disabled={forgotLoading}
            onPress={async () => {
              if (forgotCode.length !== 6) { setForgotError('Enter the 6-digit code'); return; }
              if (forgotNewPassword.length < 8) { setForgotError('Password must be 8+ characters'); return; }
              setForgotLoading(true);
              try {
                const r = await passwordResetVerify(
                  forgotEmail.trim().toLowerCase(),
                  forgotCode,
                  forgotNewPassword,
                );
                if (r.error) { setForgotError(r.error); return; }
                if (r.user) setUser(r.user);
                await hydrate();
                setLoggedIn(true);
              } finally {
                setForgotLoading(false);
              }
            }}
            scale={0.98}
          >
            {forgotLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 }}>Reset password & sign in</Text>}
          </PressBtn>
        </View>
      </SafeAreaView>
    );
  }

  // ── Login / Register ────────────────────────────────────────────────────
  const isRegister = view === 'register';

  // v312 anchor: just before JSX return — all hooks and handlers defined.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('auth_screen_before_jsx_return');
  } catch {/* ignore */}

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={formStyles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* R21 (2026-08-17 user "create account 的 back 是回 sign in
              因为只有 sign in 的入口"): Back target depends on which view
              we're in — register backs to login (only entry to Auth is
              Sign In); login backs to splash. */}
          <TouchableOpacity style={formStyles.backBtn} onPress={() => handleViewChange(isRegister ? 'login' : 'splash')}>
            <Icon name="ChevronLeft" size={IconSize.sm} color={Colors.primary} strokeWidth={2.5} />
            <Text style={formStyles.backText}>Back</Text>
          </TouchableOpacity>

          {/* Title row: R22 (2026-08-17) concept-scanned Create Account layout:
              - Concept 1 (createAccount1.png) shows NO cairn icon inline —
                title alone, deep-green semibold, ~26pt.
              - R114/O25 (2026-08-17): Sign In (concept signinemail.png) also
                drops the cairn icon; concept shows plain deep-green title
                "Welcome back" + gray subtitle "Glad to see you again."
                Pixel-scanned: title y_top=123pt, subtitle y_top=178pt. */}
          {isRegister ? (
            <>
              <Text
                style={{
                  fontSize: 26, fontWeight: '700', color: '#21362C',
                  letterSpacing: -0.3, marginTop: Spacing.md, marginBottom: Spacing.lg,
                }}
              >
                Create your account
              </Text>
              {/* R21 (2026-08-17 user "Let's get started. 去掉"): Register
                  subtitle removed. Title alone is enough — subtitle only
                  ate vertical space that we want for the form fields. */}
            </>
          ) : (
            <>
              <Text
                style={{
                  fontSize: 26, fontWeight: '700', color: '#21362C',
                  letterSpacing: -0.3, marginTop: Spacing.md,
                }}
              >
                Welcome back
              </Text>
              <Text
                style={{
                  fontSize: 14, color: '#8A8F95',
                  marginTop: 6, marginBottom: Spacing.xl,
                }}
              >
                Glad to see you again.
              </Text>
            </>
          )}
          {/*
           * O12: removed the "You'll start in Explorer mode. Switch anytime in Settings."
           * hint — Explorer/Navigator mode system was deleted (was a dead double-switch).
           * No replacement copy needed here; the sign-up form is self-explanatory.
           */}

          {/* API error banner */}
          {!!apiError && (
            <View style={formStyles.apiBanner}>
              <Icon name="TriangleAlert" size={14} color={Colors.danger} strokeWidth={2} />
              <Text style={formStyles.apiError}>{apiError}</Text>
            </View>
          )}

          {/* Name field — register only */}
          {isRegister && (
            <>
              <Text style={formStyles.label}>Name</Text>
              <FieldInput
                icon="User"
                placeholder="How friends will see you"
                value={name}
                onChangeText={(v) => { setName(v); if (nameError) setNameError(''); }}
                error={nameError}
                // R114/O21 post-real-device fix: no auto-focus on Name in
                // Create Account — user reported "进去就默认点开第一个 name
                // 键盘会出来 不雅观 让用户自己来操作就好了". Explicit tap
                // required to open keyboard, matching iOS Settings sign-up
                // patterns (Apple ID, iCloud, etc).
              />
            </>
          )}

          <Text style={formStyles.label}>Email</Text>
          <FieldInput
            icon="Mail"
            placeholder="your@email.com"
            value={email}
            onChangeText={(v) => { setEmail(v); if (emailError) setEmailError(''); }}
            error={emailError}
            onBlur={() => { if (!googleFlowActive.current && submitAttempted.current) setEmailError(validateEmail(email)); }}
            keyboardType="email-address"
            autoCapitalize="none"
            // R114/O24 (2026-08-12): autoFocus removed per user rule —
            // no page auto-pops keyboard. User taps into the field.
            // R113 fix: 只在 Sign In 让 iOS autofill 已保存邮箱;
            // Create Account 时禁用 autofill 以避免 100% 干净新用户看到别人的旧邮箱.
            textContentType={isRegister ? 'none' : 'emailAddress'}
            autoComplete={isRegister ? 'off' : 'email'}
          />

          <Text style={formStyles.label}>Password</Text>
          <PasswordInput
            value={password}
            onChangeText={(v) => { setPassword(v); if (passwordError) setPasswordError(''); }}
            placeholder={'••••••••'}
            error={passwordError}
            onBlur={() => { if (!googleFlowActive.current && submitAttempted.current) setPasswordError(validatePassword(password)); }}
            isNew={isRegister}
          />
          {isRegister && !passwordError && (
            <>
              {/* R22 (2026-08-17): concept createAccount1.png shows a 3-rule
                  green-check list (At least 8 chars / One uppercase / One
                  number). Replaces the earlier single-line "Minimum 8
                  characters" hint. Actual submit validation still uses
                  validatePassword (which checks ≥8 chars) — the visible
                  checklist is a live guidance UI, ticking rules green as
                  they're satisfied. Deep green #21362C matches concept
                  checkmarks (RGB 33,54,44 sampled). */}
              {(() => {
                const has8 = password.length >= 8;
                const hasUpper = /[A-Z]/.test(password);
                const hasDigit = /\d/.test(password);
                const rules = [
                  { met: has8, label: 'At least 8 characters' },
                  { met: hasUpper, label: 'One uppercase letter' },
                  { met: hasDigit, label: 'One number' },
                ];
                return (
                  <View style={{ marginTop: 12, gap: 6 }}>
                    {rules.map((r, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Icon
                          name="Check"
                          size={14}
                          color={r.met ? '#21362C' : '#C8C0B4'}
                          strokeWidth={r.met ? 3 : 2}
                        />
                        <Text
                          style={{
                            fontSize: 13,
                            color: r.met ? '#21362C' : '#8A8F95',
                            fontWeight: r.met ? '500' : '400',
                          }}
                        >
                          {r.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })()}
            </>
          )}

          {/* Remember me + Forgot password — Sign In only.
              2026-08-16 Round 10: per concept Auth-2-signin.png, these two
              share the same row (Remember me left / Forgot right).
              Previously Forgot was on its own row above Remember me. */}
          {!isRegister && (
            <View style={[formStyles.rememberRow, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity
                  style={[formStyles.checkbox, rememberMe && formStyles.checkboxChecked]}
                  onPress={() => setRememberMe(v => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                >
                  {rememberMe && <Icon name="Check" size={14} color="#fff" strokeWidth={3} />}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRememberMe(v => !v)} activeOpacity={0.7}>
                  <Text style={[formStyles.rememberText, { marginLeft: 8 }]}>Remember me on this device</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                testID="link-forgot-password"
                onPress={() => {
                  setForgotEmail(email.trim().toLowerCase());
                  setForgotCode('');
                  setForgotNewPassword('');
                  setForgotError('');
                  setView('forgot_request');
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={{ color: Colors.primary, fontSize: FontSize.caption, fontWeight: '600' }}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
          )}

          {isRegister && (
            <>
              <Text style={formStyles.label}>Confirm Password</Text>
              <PasswordInput
                value={confirm}
                onChangeText={(v) => { setConfirm(v); if (confirmError) setConfirmError(''); }}
                placeholder="Re-enter password"
                error={confirmError}
                onBlur={() => { if (confirm && confirm !== password) setConfirmError('Passwords do not match'); }}
                isNew
              />
              {/* R114/O22 (2026-08-08) Bug 2 fix: DateTimePicker native
                  module was "unimplemented (pink screen)" on the current
                  EAS build because @react-native-community/datetimepicker
                  is a native dep and this bundle predates when it was
                  added. User rule "不 eas build" means we cannot ship a
                  new native binary in this OTA. Replaced with three
                  numeric inputs (Year / Month / Day) — plain JS, works
                  over OTA, no native module needed. Validation builds
                  the YYYY-MM-DD string in `dob` state so backend contract
                  is unchanged. */}
              <Text style={formStyles.label}>Date of birth</Text>
              <DobInputs
                value={dob}
                onChange={(v) => { setDob(v); if (dobError) setDobError(''); }}
                onError={setDobError}
                error={dobError}
              />
              {dobError ? <Text style={formStyles.errorText}>{dobError}</Text> : (
                <Text style={formStyles.hintText}>You must be 13+ to use Cairn.</Text>
              )}
            </>
          )}

          {/* Privacy row — register only */}
          {isRegister && (
            <>
              <View style={formStyles.privacyRow}>
                <TouchableOpacity
                  style={[formStyles.checkbox, privacyChecked && formStyles.checkboxChecked]}
                  onPress={() => { setPrivacyChecked(v => !v); setPrivacyError(''); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                >
                  {privacyChecked && <Icon name="Check" size={14} color="#fff" strokeWidth={3} />}
                </TouchableOpacity>
                <Text style={formStyles.privacyText}>
                  {'I have read and agree to the '}
                  <Text
                    style={formStyles.privacyLink}
                    onPress={() => setPrivacyExpanded(!privacyExpanded)}
                  >
                    Privacy Policy
                  </Text>
                </Text>
              </View>
              {!!privacyError && <Text style={formStyles.fieldError}>{privacyError}</Text>}

              {/* R110 P2-13: 隐私政策改用全屏 Modal 打开, 避免内嵌 ScrollView 的 nested scroll 冲突 */}
              <Modal
                visible={privacyExpanded}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setPrivacyExpanded(false)}
              >
                <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top', 'bottom']}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: Colors.textPrimary }}>Privacy Policy</Text>
                    <TouchableOpacity onPress={() => setPrivacyExpanded(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Text style={{ fontSize: 16, color: Colors.primary, fontWeight: '600' }}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
                    <Text style={formStyles.privacyContent}>{PRIVACY_POLICY}</Text>
                  </ScrollView>
                </SafeAreaView>
              </Modal>
            </>
          )}

          {/* R22 (2026-08-17): concept createAccount1.png button is deep forest
              green #21362C (RGB 33,57,46 sampled), radius ~14pt, height ~54pt,
              text "Continue" (not "Create Account").
              R114/O25 (2026-08-17): Sign In concept signinemail.png shows the
              SAME deep-green button (pixel-scanned RGB 34,54,45 = #22362D, band
              y=301..342 = ~92 device-pt but effective button height ~54pt after
              accounting for shadow band). Text is "Sign In" (no LogIn icon —
              concept shows text-only button). */}
          <PressBtn
            style={[
              styles.primaryBtn,
              formStyles.submitBtn,
              {
                backgroundColor: '#21362C',
                borderRadius: 14,
                minHeight: 54,
                shadowOpacity: 0,
                elevation: 0,
              },
            ]}
            onPress={handleAuth}
            disabled={loading}
          >
            <View style={styles.btnContent}>
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : null
              }
              <Text style={styles.primaryBtnText}>{isRegister ? 'Continue' : 'Sign In'}</Text>
            </View>
          </PressBtn>

          {/* Social login — Sign In and Create Account both. Apple Sign-In handles
              both new + returning users transparently (backend upserts on apple_sub_id),
              so showing on both screens follows industry norm (Instagram/Twitter).
              R113 change (2026-08-06): removed `!isRegister` gate. */}
          <>
              {!isRegister && (
              <View style={formStyles.divider}>
                <View style={formStyles.divLine} />
                <Text style={formStyles.divText}>or continue with</Text>
                <View style={formStyles.divLine} />
              </View>
              )}
              {isRegister && (
              <View style={formStyles.divider}>
                <View style={formStyles.divLine} />
                <Text style={formStyles.divText}>or sign up with</Text>
                <View style={formStyles.divLine} />
              </View>
              )}

              {/* Apple — R21 (2026-08-17): white pill + official Apple
                  glyph, matches Landing button style. */}
              <PressBtn
                style={formStyles.appleBtn}
                onPress={handleAppleAuth}
                scale={0.98}
                disabled={appleLoading || loading}
              >
                <View style={styles.btnContent}>
                  {appleLoading
                    ? <ActivityIndicator size="small" color={Colors.textPrimary} />
                    : <AppleIcon size={18} color="#000" />}
                  <View>
                    <Text style={formStyles.appleBtnText}>{appleLoading ? 'Connecting…' : 'Continue with Apple'}</Text>
                  </View>
                </View>
              </PressBtn>

              {/* Google — R21 (2026-08-17): white pill + official 4-color G
                  logo, matches Landing button style. __DEV__ gate removed. */}
              <PressBtn style={formStyles.googleBtn} onPress={handleGoogleAuth} scale={0.98} disabled={googleLoading || loading}>
                <View style={styles.btnContent}>
                  {googleLoading
                    ? <ActivityIndicator size="small" color={Colors.primary} />
                    : <GoogleGIcon size={18} />
                  }
                  <Text style={formStyles.googleBtnText}>{googleLoading ? 'Connecting…' : 'Continue with Google'}</Text>
                </View>
              </PressBtn>
            </>

          {/* R22 (2026-08-17): concept createAccount1.png footer — "Already
              have an account? Sign in". Register only. "Sign in" is deep
              green underlined, taps to switch view. */}
          {isRegister && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: Spacing.xxl, gap: 4 }}>
              <Text style={{ fontSize: 13, color: '#8A8F95' }}>Already have an account?</Text>
              <TouchableOpacity
                onPress={() => handleViewChange('login')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={{
                    fontSize: 13, color: '#21362C', fontWeight: '600',
                    textDecorationLine: 'underline',
                  }}
                >
                  Sign in
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* R114/O25 (2026-08-17): Sign In footer — "New here? Create account".
              Concept signinemail.png shows this line centered ~y=846pt (bottom).
              Mirror of the Register footer, but the CTA opens 'register'. */}
          {!isRegister && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: Spacing.xxl, gap: 4 }}>
              <Text style={{ fontSize: 13, color: '#8A8F95' }}>New here?</Text>
              <TouchableOpacity
                onPress={() => handleViewChange('register')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={{
                    fontSize: 13, color: '#21362C', fontWeight: '600',
                    textDecorationLine: 'underline',
                  }}
                >
                  Create account
                </Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  splashInner: {
    flex: 1, justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl,
    paddingTop: Spacing.xl,
  },
  // R22 iter-11 (2026-08-17 user request): "标题再往上点 logo 不动"
  // gap 12 → 0, logo pos unchanged. Title snaps up against cairn stack.
  logoArea: {
    alignItems: 'center',
    gap: 0,
    paddingTop: SCREEN_H * 0.22,
  },
  logoGlowWrap: {
    position: 'absolute',
    width: 200, height: 200,
    alignItems: 'center', justifyContent: 'center',
  },
  logoGlow: {
    width: 200, height: 200, borderRadius: 100,
  },
  // R22 iter-2 (2026-08-17): 22 → 30pt, bumped from Nunito-ish weight to
  // proper display size. Concept wordmark is the visual anchor — reads
  // as "brand" not "sub-label". letterSpacing tightened to -0.6 to match
  // the compact, custom-carved feel in the concept.
  // R22 iter-3 (2026-08-17): letterSpacing -0.6 → -0.8 (concept wordmark
  // has notably tight kerning that gives it that carved-stone feel).
  // marginTop 10 → 8 (concept shows tighter vertical stack).
  // R22 iter-4 (2026-08-17): color tweaked #2e4a2e → #2a4b34 — a touch
  // more saturated forest green (blue-shifted 4 pts). The old value was
  // olive-drab; concept 1.1 wordmark reads as living-forest green,
  // matching the fern/moss undertones in the hero image.
  // R22 iter-11 (2026-08-17 user request): marginTop 12 → 0 to pull title
  // up flush against cairn logo.
  appName: {
    fontSize: 48, fontWeight: '900', color: '#2a4b34',
    letterSpacing: -1.5, marginTop: 0,
  },
  // R22 iter-3 (2026-08-17): marginTop 10 → 6. Concept tagline hugs
  // wordmark much closer than a 10pt gap — reads as one grouped unit.
  taglineWrap: { alignItems: 'center', gap: 2, marginTop: 6 },
  // R22 iter-2 (2026-08-17): 12 → 13pt. Concept tagline reads noticeably
  // (not micro), color shifted #6f7677 → #7a8285 (warmer neutral grey to
  // match paper-toned foreground; the previous cool grey clashed with the
  // warm wordmark green). lineHeight tightened.
  tagline: {
    fontSize: 13, color: '#7a8285',
    textAlign: 'center', lineHeight: 17, fontWeight: '400',
    letterSpacing: 0.1,
  },
  // R22 iter-2 (2026-08-17): action gap 12 → 10pt (tighter cluster reads
  // as one unit). paddingBottom bumped for more thumb-safe area.
  // R22 iter-3 (2026-08-17): paddingBottom lg → xxl. Concept 1.1 shows
  // buttons sit clearly above the home-indicator area (~40pt bottom
  // breathe). Was hugging too close.
  splashActions: { gap: 10, paddingTop: 0, paddingBottom: Spacing.xxl },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: 28,
    paddingVertical: Spacing.lg, alignItems: 'center', minHeight: 56,
    justifyContent: 'center', ...Shadow.fab,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.body },
  secondaryBtn: {
    backgroundColor: Colors.surface, borderRadius: 28,
    paddingVertical: Spacing.lg, alignItems: 'center', minHeight: 56,
    justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  secondaryBtnText: { color: Colors.textPrimary, fontWeight: '600', fontSize: FontSize.body },
  btnContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  // ── Landing (splash / 1.1 Welcome) — CONCEPT_TRUTH 2026-08-15 ──────────
  // R21 (2026-08-17): pixel-scanned concept 1.1. Buttons 40-49px in 748-tall
  // mockup → 43-49pt real; scan showed:
  //   Apple 485-530 (45px→49pt), gap 14pt, Google 545-581 (36px→39pt),
  //   gap 23pt, Email 604-644 (40px→43pt).
  // Normalized to 46pt uniform (readable + concept-close). borderRadius 14pt.
  // R22 iter-2 (2026-08-17): pill radius 12 → 16pt (concept shows softer,
  // more capsule-like pills), height 46 → 50pt (matches concept button
  // presence — currently too thin against wordmark 30pt). Uniform across
  // all three pills so vertical rhythm stays clean.
  landingAppleBtn: {
    backgroundColor: '#fff', borderRadius: 16,
    paddingVertical: 14, alignItems: 'center', minHeight: 50,
    justifyContent: 'center',
    borderWidth: 1, borderColor: '#e5e0d5',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  landingAppleBtnText: { color: Colors.textPrimary, fontWeight: '600', fontSize: 15 },
  landingGoogleBtn: {
    backgroundColor: '#fff', borderRadius: 16,
    paddingVertical: 14, alignItems: 'center', minHeight: 50,
    justifyContent: 'center',
    borderWidth: 1, borderColor: '#e5e0d5',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  landingGoogleBtnText: { color: Colors.textPrimary, fontWeight: '600', fontSize: 15 },
  // R22 iter-2 (2026-08-17): filled Google blue circle (was white square
  // with monochrome grey outline — read as unbranded "G"). Concept 1.1
  // shows the recognisable multi-colour G; we approximate with a solid
  // Google Blue #4285F4 circle + white G glyph — same 20pt footprint,
  // instantly readable as "Google" without a 4-colour asset.
  landingGoogleG: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#4285F4',
    alignItems: 'center', justifyContent: 'center',
  },
  landingGoogleGText: { fontSize: 13, fontWeight: '800', color: '#fff', marginTop: -1 },
  landingEmailBtn: {
    backgroundColor: '#2a4b34', borderRadius: 16,
    paddingVertical: 14, alignItems: 'center', minHeight: 50,
    justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
  },
  landingEmailBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  landingSignInLink: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    marginTop: Spacing.xs,
  },
  landingSignInLinkText: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  landingSignInLinkAccent: {
    color: '#3E5F3A',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});

const formStyles = StyleSheet.create({
  // R21 (2026-08-17 user "争取不要 scroll 一个页面做掉"): tightened paddings
  // so register form fits on iPhone 14 Pro Max (932pt) without scroll on
  // R21 (2026-08-17 user "Sign in/up 等界面 back 都太靠上了 位置不好"):
  // Back button pushed down from top edge with paddingTop 24 (was 8).
  // ScrollView paddingTop stays small so form content doesn't waste space
  // — back gets its own vertical breathing room below the safe-area inset.
  scroll: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: Spacing.lg },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: Spacing.md, paddingVertical: 8 },
  backText: { fontSize: FontSize.caption, color: Colors.primary, fontWeight: '600' },

  // Title row: icon inline-left of title text
  titleRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  title: { fontSize: FontSize.h1, fontWeight: '800', color: Colors.textPrimary },
  sub: { fontSize: FontSize.caption, color: Colors.textSecondary, marginBottom: Spacing.xl, lineHeight: 20 },

  apiBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.dangerBg, borderRadius: Radius.button,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.danger,
  },
  apiError: { flex: 1, fontSize: FontSize.small, color: Colors.danger, fontWeight: '500' },

  // R22 (2026-08-17): concept createAccount1.png labels ("Email", "Password")
  // read as small deep-green semibold — same forest #21362C as button. Tight
  // 6pt gap below label to input. Previous olive Colors.textSecondary was
  // low-contrast against paper bg.
  // R21 (2026-08-17): marginTop base → sm to compress vertical stacking.
  label: { fontSize: 13, fontWeight: '600', color: '#21362C', marginTop: Spacing.sm, marginBottom: 4 },
  // O18 AUTH-06: bare TextInput used by DOB field (no PasswordInput wrapper).
  // Matches inputWrap + inputInner combined so visual is consistent with the
  // rest of the form.
  input: {
    // R22 (2026-08-17): match inputWrap paper tone.
    backgroundColor: '#FDFAF3', borderRadius: 14,
    borderWidth: 1, borderColor: '#EAE3D5', paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.body, color: Colors.textPrimary,
  },
  errorText: { fontSize: FontSize.small, color: Colors.danger, fontWeight: '600', marginTop: 3, marginLeft: 2 },
  hintText: { fontSize: FontSize.small, color: Colors.textMuted, marginTop: 3, marginLeft: 2 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    // R22 (2026-08-17): concept createAccount1.png inputs use a very-slightly-
    // lighter-than-paper fill (~#FDFAF3) with almost invisible border. Reads
    // as "recessed slot on paper", not a hard white card. Sample shows
    // input inner brightness ~253 vs paper bg 250 — a whisper of contrast.
    backgroundColor: '#FDFAF3', borderRadius: 14,
    borderWidth: 1, borderColor: '#EAE3D5', paddingHorizontal: Spacing.md,
    // No background color change on focus — only border changes
  },
  inputError: { borderColor: Colors.danger },
  inputFocused: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },  // border + subtle bg (Material 3 standard)
  inputIcon: { marginRight: Spacing.xs },
  inputInner: {
    flex: 1, paddingVertical: Spacing.md, paddingLeft: Spacing.xs,
    fontSize: FontSize.body, color: Colors.textPrimary,
    backgroundColor: 'transparent',
  },
  eyeBtn: { padding: Spacing.xs },
  clearBtn: { padding: Spacing.xs, marginRight: 2 },
  fieldError: { fontSize: FontSize.small, color: Colors.danger, fontWeight: '600', marginTop: 3, marginLeft: 2 },

  privacyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.base },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  rememberText: { fontSize: FontSize.caption, color: Colors.textSecondary, fontWeight: '500' },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface,
    flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  privacyText: { flex: 1, fontSize: FontSize.caption, color: Colors.textSecondary, lineHeight: 20 },
  privacyLink: { color: Colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  privacyExpanded: {
    backgroundColor: Colors.surface, borderRadius: Radius.button,
    padding: Spacing.md, marginTop: Spacing.sm, borderWidth: 1, borderColor: Colors.border,
  },
  privacyContent: { fontSize: FontSize.small, color: Colors.textSecondary, lineHeight: 18 },
  submitBtn: { marginTop: Spacing.lg },

  staySignedIn: {
    fontSize: FontSize.small, color: Colors.textMuted,
    textAlign: 'center', marginTop: Spacing.sm,
  },

  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginVertical: Spacing.base },
  divLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  divText: { fontSize: FontSize.small, color: Colors.textMuted, whiteSpace: 'nowrap' } as any,

  // O1 batch 39: socialHint removed — 0 JSX references.

  // R21 (2026-08-17 user "sign in up 的 google apple 和首页颜色风格一致"):
  // form-level Apple / Google buttons now mirror Landing style: white pill
  // with subtle border + shadow, 12pt radius, 46pt minHeight. Was black
  // Apple / grey border Google (inconsistent with Landing).
  appleBtn: {
    backgroundColor: '#fff', borderRadius: 12,
    paddingVertical: 12, alignItems: 'center', minHeight: 46,
    justifyContent: 'center', marginBottom: 12,
    borderWidth: 1, borderColor: '#e5e0d5',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  appleBtnText: { color: Colors.textPrimary, fontWeight: '600', fontSize: 14 },

  googleBtn: {
    backgroundColor: '#fff', borderRadius: 12,
    paddingVertical: 12, alignItems: 'center', minHeight: 46,
    justifyContent: 'center', marginBottom: 12,
    borderWidth: 1, borderColor: '#e5e0d5',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  googleBtnText: { color: Colors.textPrimary, fontWeight: '600', fontSize: 14 },
  googleG: {
    width: 20, height: 20, borderRadius: 4, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#e0e0e0',
  },
  googleGText: {
    fontSize: 14, fontWeight: '800',
    color: '#4285F4',
  },
});
