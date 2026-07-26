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
  ActivityIndicator,
} from 'react-native';
import Svg, { Path, Ellipse, Line, G } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
// v412: UnfinishedSessionBanner 已被 v412 UnfinishedRecoveryModal 取代 (HikingScreen 内)
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAppStore } from '../store/useAppStore';
import { storage } from '../store/storage';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon } from '../components/Icon';
import { login, register, loginWithGoogle, verifyCode, resendCode } from '../services/authService';
import { CairnLogo } from '../components/ActivityIcons/CairnLogo';
import * as Google from 'expo-auth-session/providers/google';
import { makeRedirectUri, Prompt } from 'expo-auth-session';
import { crashLogger } from '../services/crashLogger';
import { OtaBadge } from '../components/OtaBadge';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const { height: SCREEN_H } = Dimensions.get('window');

// ── Trail path SVG (draws from bottom to top over ~500ms) ─────────────────
const TRAIL_PATH = 'M 60 160 Q 40 130 55 100 Q 70 70 50 45 Q 42 32 50 20';
const TRAIL_LENGTH = 160;
const AnimatedPath = Animated.createAnimatedComponent(Path);

function TrailPath({ onComplete }: { onComplete?: () => void }) {
  const dashOffset = useRef(new Animated.Value(TRAIL_LENGTH)).current;
  useEffect(() => {
    Animated.timing(dashOffset, {
      toValue: 0, duration: 500, useNativeDriver: false,
    }).start(() => onComplete?.());
  }, []);
  return (
    <Svg width={120} height={180} style={{ position: 'absolute', bottom: 0, left: '50%', marginLeft: -60 }}>
      <AnimatedPath
        d={TRAIL_PATH}
        stroke={Colors.primary}
        strokeWidth={2.5}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${TRAIL_LENGTH} ${TRAIL_LENGTH}`}
        strokeDashoffset={dashOffset}
        opacity={0.5}
      />
    </Svg>
  );
}

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
  return (
    <>
      <View style={[formStyles.inputWrap, !!error && formStyles.inputError, focused && !error && formStyles.inputFocused]}>
        <View style={formStyles.inputIcon}>
          <Icon name="KeyRound" size={IconSize.sm} color={focused ? Colors.primary : Colors.textMuted} strokeWidth={1.8} />
        </View>
        <TextInput
          style={formStyles.inputInner}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          textContentType={isNew ? 'newPassword' : 'password'}
          autoComplete={isNew ? 'password-new' : 'password'}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); onBlur?.(); }}
        />
        <TouchableOpacity style={formStyles.eyeBtn} onPress={() => setShow(v => !v)}>
          <Icon name={show ? 'EyeOff' : 'Eye'} size={IconSize.sm} color={Colors.textMuted} strokeWidth={1.8} />
        </TouchableOpacity>
      </View>
      {!!error && <Text style={formStyles.fieldError}>{error}</Text>}
    </>
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
• Portability: export your track history as GPX at any time
• Correction: update your profile information at any time

6. Applicable law
Cairn complies with the New Zealand Privacy Act 2020 and, where applicable, the EU General Data Protection Regulation (GDPR).

7. Contact
privacy@cairnapp.nz`;

// ── Auth Screen ────────────────────────────────────────────────────────────
type AuthView = 'splash' | 'login' | 'register' | 'verify' | 'welcome';

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
  const { setLoggedIn, setUIMode, setUser, hydrate } = useAppStore();
  const [view, setView] = useState<AuthView>('splash');
  const [welcomeName, setWelcomeName] = useState('');
  const [verifyEmail, setVerifyEmail] = useState('');   // email to verify after register
  const [verifyCode_, setVerifyCode_] = useState('');   // 6-digit code input
  const [verifyError, setVerifyError] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0); // seconds remaining
  const [devCode, setDevCode] = useState('');            // dev-only: code returned by backend
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);  // STORY-00132: separate state
  const [apiError, setApiError] = useState('');
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [privacyError, setPrivacyError] = useState('');
  const googleFlowActive = useRef(false);
  const submitAttempted = useRef(false);  // STORY-00133: only validate on blur after first submit

  // Google OAuth hook — CONFIRMED as sign-out crash root cause via OTA
  // bisect on 2026-05-21. Re-disabled. Real fix requires app.json scheme
  // for makeRedirectUri to work — coming in next build. Until then,
  // Google sign-in shows alert and AnimatedCairn animation can be
  // re-enabled (it's safe).
  crashLogger.breadcrumb('AuthScreen:google_hook_skipped');
  const googleRequest: any = null;
  const googleResponse: any = null;
  const promptGoogleAsync = async () => {
    Alert.alert('Google Sign In', 'Coming in next app update. Please use email sign-in.');
    return { type: 'dismiss' as const };
  };
  void googleRequest;
  void googleResponse;

  const splashFade = useRef(new Animated.Value(0)).current;
  const splashTranslate = useRef(new Animated.Value(8)).current;
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
  const [trailComplete, setTrailComplete] = useState(false);
  void trailComplete;
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

  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/bootDiagnostics').markBootPhase('auth_view_effect', { view });
    } catch {/* ignore */}
    if (view === 'splash') {
      // Reset every animation back to its starting state so re-entering the
      // splash from Sign In replays the full sequence from scratch.
      splashFade.setValue(0);
      splashTranslate.setValue(8);
      wordmarkOpacity.setValue(0);
      wordmarkTranslate.setValue(-8);
      tagline1Opacity.setValue(0);
      tagline1Translate.setValue(-8);
      tagline2Opacity.setValue(0);
      tagline2Translate.setValue(-8);
      setSplashMountKey(k => k + 1);
      Animated.parallel([
        Animated.timing(splashFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(splashTranslate, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
      // Wordmark + tagline animate in parallel with the first stone — the
      // word "Cairn" should appear together with the base stone landing.
      animateWordmark();
    }
  }, [view]);

  const resetErrors = () => {
    setNameError(''); setEmailError(''); setPasswordError(''); setConfirmError('');
    setPrivacyError(''); setApiError('');
  };

  const handleViewChange = (v: AuthView) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/bootDiagnostics').markBootPhase('auth_view_change', { to: v });
    } catch {/* ignore */}
    resetErrors();
    submitAttempted.current = false;
    setView(v);
  };

  const validateEmail = (val: string) => {
    if (!val.trim()) return 'Email is required';
    // TEMP DEMO REMOVE LATER: email format validation disabled so that
    // pure-numeric demo logins ("1", "2", …) work. Restore the regex line
    // below before production. The original validator was:
    //   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) return 'Please enter a valid email';
    return '';
  };

  const validatePassword = (val: string) => {
    if (!val) return 'Password is required';
    // TEMP DEMO REMOVE LATER: 8-char minimum removed so single-char demo
    // account passwords (1, 2, 3, …) work. Restore:
    //   if (val.length < 8) return 'Minimum 8 characters';
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
    if (isRegister && !privacyChecked) { setPrivacyError('Please agree to continue'); valid = false; }
    if (!valid) return;

    setLoading(true);
    setApiError('');
    try {
      const result = isRegister
        ? await register(name.trim(), email.trim().toLowerCase(), password)
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
        setResendCooldown(60);
        if (result.devCode) setDevCode(result.devCode);
        setView('verify');
        return;
      }

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
      setLoggedIn(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('login_after_setLoggedIn');
      } catch {/* ignore */}
      if (isRegister) {
        setUIMode('beginner');
        setWelcomeName(result.user?.name || name.trim() || 'Explorer');
        setView('welcome');
        setTimeout(() => nav.replace('Home'), 1800);
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
          nav.replace('Home');
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../services/bootDiagnostics').markBootPhase('login_after_nav_home');
          } catch {/* ignore */}
        }, 0);
      }
    } catch (e: any) {
      const msg: string = e?.message || '';
      // TypeError / "Failed to fetch" / "Network request failed" = network unreachable
      if (
        e?.name === 'TypeError' ||
        msg.includes('Network request failed') ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('net::') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND')
      ) {
        setApiError('Cannot reach the server. Check your internet connection and try again.');
      } else if (msg) {
        setApiError(msg);
      } else {
        setApiError('Something went wrong. Please try again.');
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

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleVerify = async () => {
    const trimmed = verifyCode_.replace(/\s/g, '');
    if (trimmed.length !== 6) { setVerifyError('Please enter the 6-digit code.'); return; }
    setVerifyLoading(true);
    setVerifyError('');
    const result = await verifyCode(verifyEmail, trimmed);
    setVerifyLoading(false);
    if (result.error) { setVerifyError(result.error); return; }
    // Sprint 72 STORY-00549: verify (registration) also counts as fresh login
    try {
      await storage.removeItem('cairn_logout_marker');
      crashLogger.breadcrumb('login:marker_cleared');
    } catch {/* ignore */}
    setLoggedIn(true);
    if (result.user) setUser(result.user);
    await hydrate();
    setUIMode('beginner');
    setWelcomeName(result.user?.name || 'Explorer');
    setView('welcome');
    setTimeout(() => nav.replace('Home'), 1800);
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setVerifyError('');
    const result = await resendCode(verifyEmail);
    if (result.error) { setVerifyError(result.error); return; }
    setResendCooldown(60);
  };

  // ── Splash ─────────────────────────────────────────────────────────────
  if (view === 'splash') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* v412: v409 UnfinishedSessionBanner 已删除, 恢复流程走 HikingScreen 的 UnfinishedRecoveryModal */}
      <Animated.View style={[styles.splashInner, { opacity: splashFade, transform: [{ translateY: splashTranslate }] }]}>
          {/* Hero area */}
          <View style={styles.logoArea}>
            <View style={styles.logoGlowWrap} pointerEvents="none">
              <LinearGradient
                colors={[Colors.primaryLight, 'transparent']}
                style={styles.logoGlow}
                start={{ x: 0.5, y: 0.5 }}
                end={{ x: 1, y: 1 }}
              />
            </View>
            {/* Trail path draws first, then cairn stacks up. The key forces
                a fresh mount when the user returns to splash via Back so
                the rise animation replays. */}
            <View style={{ position: 'relative', alignItems: 'center' }}>
              <AnimatedCairn key={splashMountKey} />
            </View>
            {/* Wordmark fades in after cairn completes */}
            <Animated.Text style={[styles.appName, {
              opacity: wordmarkOpacity,
              transform: [{ translateY: wordmarkTranslate }],
            }]}>Cairn</Animated.Text>
            <View style={styles.taglineWrap}>
              <Animated.Text style={[styles.tagline, {
                opacity: tagline1Opacity,
                transform: [{ translateY: tagline1Translate }],
              }]}>Leave a mark.</Animated.Text>
              <Animated.Text style={[styles.tagline, {
                opacity: tagline2Opacity,
                transform: [{ translateY: tagline2Translate }],
              }]}>Guide the next.</Animated.Text>
            </View>
          </View>
          {/* CTA buttons + OTA status above them */}
          <View style={styles.splashActions}>
            <View style={styles.splashOtaWrap}>
              <OtaBadge inline />
            </View>
            <PressBtn style={styles.primaryBtn} onPress={() => handleViewChange('login')}>
              <View style={styles.btnContent}>
                <Icon name="LogIn" size={IconSize.sm} color="#fff" strokeWidth={2} />
                <Text style={styles.primaryBtnText}>Sign In</Text>
              </View>
            </PressBtn>
            <PressBtn style={styles.secondaryBtn} onPress={() => handleViewChange('register')}>
              <View style={styles.btnContent}>
                <Icon name="UserPlus" size={IconSize.sm} color={Colors.textPrimary} strokeWidth={2} />
                <Text style={styles.secondaryBtnText}>Create Account</Text>
              </View>
            </PressBtn>
            {/* Sprint 72 STORY-00556: reassurance that local data survives 30-day token expiry */}
            <Text
              testID="auth-data-local-hint"
              style={{
                marginTop: 12,
                fontSize: 12,
                color: Colors.textSecondary,
                textAlign: 'center',
                paddingHorizontal: 24,
                lineHeight: 16,
              }}
            >
              Your tracks stay on this device. Sign in to sync new activity to the cloud.
            </Text>
          </View>
        </Animated.View>
      </SafeAreaView>
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

            {/* DEV ONLY: show code inline since email SMTP may not be configured */}
            {!!devCode && (
              <View style={{ backgroundColor: '#fff3cd', borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#ffc107' }}>
                <Text style={{ fontSize: 12, color: '#856404', fontWeight: '600' }}>DEV MODE — verification code:</Text>
                <Text style={{ fontSize: 28, fontWeight: '900', color: '#856404', letterSpacing: 8, marginTop: 4 }}>{devCode}</Text>
              </View>
            )}

            {!!verifyError && (
              <View style={formStyles.apiBanner}>
                <Icon name="TriangleAlert" size={14} color={Colors.danger} strokeWidth={2} />
                <Text style={formStyles.apiError}>{verifyError}</Text>
              </View>
            )}

            <Text style={formStyles.label}>Verification Code</Text>
            <View style={[formStyles.inputWrap, verifyError ? formStyles.inputError : null]}>
              <View style={formStyles.inputIcon}>
                <Icon name="Lock" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={1.8} />
              </View>
              <TextInput
                style={formStyles.inputInner}
                placeholder="123456"
                placeholderTextColor={Colors.textMuted}
                value={verifyCode_}
                onChangeText={(v) => { setVerifyCode_(v.replace(/[^0-9]/g, '').slice(0, 6)); setVerifyError(''); }}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                textContentType="oneTimeCode"
              />
            </View>

            <PressBtn
              style={[styles.primaryBtn, formStyles.submitBtn]}
              onPress={handleVerify}
              disabled={verifyLoading}
            >
              <View style={styles.btnContent}>
                {verifyLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Icon name="CircleCheck" size={IconSize.sm} color="#fff" strokeWidth={2} />
                }
                <Text style={styles.primaryBtnText}>Verify Email</Text>
              </View>
            </PressBtn>

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
        <Text style={[styles.tagline, { textAlign: 'center', color: Colors.textSecondary, marginBottom: 4 }]}>Nau mai, haere mai</Text>
        <Text style={[styles.tagline, { textAlign: 'center', color: Colors.textSecondary }]}>Your track starts now.</Text>
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

          <TouchableOpacity style={formStyles.backBtn} onPress={() => handleViewChange('splash')}>
            <Icon name="ChevronLeft" size={IconSize.sm} color={Colors.primary} strokeWidth={2.5} />
            <Text style={formStyles.backText}>Back</Text>
          </TouchableOpacity>

          {/* Title row: small icon inline-left of title */}
          <View style={formStyles.titleRow}>
            {/* CairnLogo's viewBox has asymmetric vertical padding (7.8u top
                vs 0.6u bottom out of 24u) AND its stones are top-light /
                bottom-heavy. Pull it up so the cairn visually sits with
                the title's optical center, not the geometric one. */}
            <View style={{ marginTop: -7 }}>
              <CairnLogo size={28} />
            </View>
            <Text style={formStyles.title}>{isRegister ? 'Create Account' : 'Sign In'}</Text>
          </View>
          {isRegister && (
            <Text style={formStyles.sub}>You'll start in Explorer mode. Switch anytime in Settings.</Text>
          )}

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
                placeholder="Your name"
                value={name}
                onChangeText={(v) => { setName(v); if (nameError) setNameError(''); }}
                error={nameError}
                autoFocus={isRegister}
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
            autoFocus={!isRegister}
            textContentType="emailAddress"
            autoComplete="email"
          />

          <Text style={formStyles.label}>Password</Text>
          <PasswordInput
            value={password}
            onChangeText={(v) => { setPassword(v); if (passwordError) setPasswordError(''); }}
            placeholder={isRegister ? 'Min. 8 characters' : '••••••••'}
            error={passwordError}
            onBlur={() => { if (!googleFlowActive.current && submitAttempted.current) setPasswordError(validatePassword(password)); }}
            isNew={isRegister}
          />
          {isRegister && !passwordError && (
            <Text style={[formStyles.fieldError, { color: Colors.textSecondary, fontWeight: '400' }]}>Minimum 8 characters</Text>
          )}

          {/* Remember me — Sign In only. Saves email + password to local
              storage on a successful Sign In so the form is pre-filled
              next launch. The user must still tap Sign In every time —
              we never bypass the auth screen. */}
          {!isRegister && (
            <View style={formStyles.rememberRow}>
              <TouchableOpacity
                style={[formStyles.checkbox, rememberMe && formStyles.checkboxChecked]}
                onPress={() => setRememberMe(v => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
              >
                {rememberMe && <Icon name="Check" size={14} color="#fff" strokeWidth={3} />}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRememberMe(v => !v)} activeOpacity={0.7}>
                <Text style={formStyles.rememberText}>Remember me on this device</Text>
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

              {privacyExpanded && (
                <View style={formStyles.privacyExpanded}>
                  <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled showsVerticalScrollIndicator>
                    <Text style={formStyles.privacyContent}>{PRIVACY_POLICY}</Text>
                  </ScrollView>
                </View>
              )}
            </>
          )}

          <PressBtn
            style={[styles.primaryBtn, formStyles.submitBtn]}
            onPress={handleAuth}
            disabled={loading}
          >
            <View style={styles.btnContent}>
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Icon name={isRegister ? 'UserPlus' : 'LogIn'} size={IconSize.sm} color="#fff" strokeWidth={2} />
              }
              <Text style={styles.primaryBtnText}>{isRegister ? 'Create Account' : 'Sign In'}</Text>
            </View>
          </PressBtn>

          {/* Social login — Sign In only, not on Create Account */}
          {!isRegister && (
            <>
              <Text style={formStyles.staySignedIn}>
                You'll stay signed in for 30 days.
              </Text>

              <View style={formStyles.divider}>
                <View style={formStyles.divLine} />
                <Text style={formStyles.divText}>or continue with</Text>
                <View style={formStyles.divLine} />
              </View>

              {/* Apple — disabled on web, requires physical iOS device */}
              <PressBtn
                style={formStyles.appleBtn}
                onPress={() => Alert.alert('Apple Sign In', 'Apple Sign In is available on iOS devices. Download the Cairn app from the App Store to use this feature.')}
                scale={0.98}
              >
                <View style={styles.btnContent}>
                  <Icon name="Apple" size={IconSize.sm} color="#fff" strokeWidth={1.8} />
                  <View>
                    <Text style={formStyles.appleBtnText}>Continue with Apple</Text>
                  </View>
                </View>
              </PressBtn>

              {/* Google */}
              <PressBtn style={formStyles.googleBtn} onPress={handleGoogleAuth} scale={0.98} disabled={googleLoading || loading}>
                <View style={styles.btnContent}>
                  {googleLoading
                    ? <ActivityIndicator size="small" color={Colors.primary} />
                    : <View style={formStyles.googleG}><Text style={formStyles.googleGText}>G</Text></View>
                  }
                  <Text style={formStyles.googleBtnText}>{googleLoading ? 'Connecting…' : 'Continue with Google'}</Text>
                </View>
              </PressBtn>
            </>
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
  logoArea: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    gap: Spacing.md,
    minHeight: SCREEN_H * 0.42,
  },
  logoGlowWrap: {
    position: 'absolute',
    width: 200, height: 200,
    alignItems: 'center', justifyContent: 'center',
  },
  logoGlow: {
    width: 200, height: 200, borderRadius: 100,
  },
  appName: {
    fontSize: 56, fontWeight: '900', color: Colors.textPrimary,
    letterSpacing: -2.5, marginTop: -2,
  },
  taglineWrap: { alignItems: 'center', gap: 2 },
  tagline: {
    fontSize: FontSize.h3, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 26, fontWeight: '400',
  },
  splashActions: { gap: Spacing.sm, paddingTop: Spacing.xl },
  // OTA pill row — fixed height so the layout never shifts whether the
  // pill is visible or not. Sits at the very top of the CTA stack.
  splashOtaWrap: {
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
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
});

const formStyles = StyleSheet.create({
  scroll: { padding: Spacing.xl, paddingBottom: Spacing.xxl },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: Spacing.lg },
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

  label: { fontSize: FontSize.caption, fontWeight: '600', color: Colors.textSecondary, marginTop: Spacing.md, marginBottom: Spacing.xs },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.button,
    borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: Spacing.md,
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

  socialHint: {
    fontSize: FontSize.tiny, color: Colors.textMuted, textAlign: 'center',
    marginTop: -Spacing.xs, marginBottom: Spacing.sm,
  },

  // Apple — black
  appleBtn: {
    backgroundColor: '#1a1a1a', borderRadius: 28,
    paddingVertical: Spacing.md, alignItems: 'center', minHeight: 52,
    justifyContent: 'center', marginBottom: 2,
  },
  appleBtnText: { fontSize: FontSize.body, fontWeight: '600', color: '#fff' },

  // Google — white + border
  googleBtn: {
    backgroundColor: Colors.surface, borderRadius: 28,
    paddingVertical: Spacing.md, alignItems: 'center', minHeight: 52,
    justifyContent: 'center', marginBottom: Spacing.sm,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  googleBtnText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
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
