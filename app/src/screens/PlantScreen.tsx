/**
 * PlantScreen — GPS-based plant flow (no AR).
 *
 * 3 steps, each in its own component so iteration is independent:
 *   Step 1 (GpsLockStep)    — 5s GPS sample with progress + accuracy live
 *   Step 2 (PinAdjustStep)  — Mapbox satellite mini-map, draggable pin
 *   Step 3 (ContentStep)    — title / text / voice (UI stub) / visibility
 *
 * On Plant Cairn (final commit):
 *   1. Write the marker via useMarkerStore.addMarker (existing API)
 *   2. Trigger memoryStore.recordCircleUnlock to clear fog around the
 *      planted spot (UnlockConfig.radiusMeters)
 *   3. Navigate back
 *
 * Title encoding: the marker model only has a single `note` field, so
 * we encode title/body using a Record Separator character (\u001E,
 * U+001E). This char is never produced by mobile keyboards, so the
 * round-trip via splitTitleBody (RevealedCairnSheet) is unambiguous.
 * Migrating the marker schema to add a real `title` column is deferred
 * to v0.2.7 and tracked there.
 *
 * Commit failure: if addMarker throws (network error, etc.), we surface
 * an Alert and STAY on the content step. Previously a `try/finally
 * nav.goBack()` swallowed errors and left the user with no plant and
 * no message.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useMarkerStore, MarkerPermission } from '../store/useMarkerStore';
import { useAppStore } from '../store/useAppStore';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
// v422 offline-first: 使 Plant flow 明确告知用户是否离线保存
import networkMonitor from '../services/networkMonitor';
import { MemoryColors } from '../features/memory/config/memoryConfig';
import { MarkerType } from '../config/markerTypes';
import { GpsLockStep } from '../features/plant/components/GpsLockStep';
import { PinAdjustStep } from '../features/plant/components/PinAdjustStep';
import { ContentStep } from '../features/plant/components/ContentStep';
import { VisibilityConfig } from '../features/plant/config/plantConfig';
import { encodeTitleBody } from '../features/plant/services/noteEncoding';
import { log } from '../services/appLog';
import { haptic } from '../services/hapticService';
import { useAppearance } from '../hooks/useAppearance';

type Step = 'gps' | 'pin' | 'content';


interface PlantDraft {
  /** v298 N5: GPS-locked anchor — set ONCE in step 1, never modified
   *  by step 2 confirm. The 50m ring is centered here regardless of
   *  step transitions, so back-from-content can never expand the
   *  allowed pin radius. */
  gpsLat: number | null;
  gpsLng: number | null;
  /** Current pin position. May be moved by step 2 (up to 50m from
   *  gpsLat/gpsLng). On first entry to step 2, equals gpsLat/gpsLng. */
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  type: MarkerType;
  title: string;
  text: string;
  voiceUri: string | null;
  voiceMs: number | null;
  visibility: MarkerPermission;
}

// v299 N6: default to 'danger' per user request — "默认是 danger".
// Most common plant scenario is flagging a hazard; this saves the
// user from selecting it every time.
const DEFAULT_TYPE = 'danger';

/** AsyncStorage key for a failed-plant draft, scoped by user. */
function draftKey(uid: string): string {
  return `cairn:plant:draft:v3:${uid}`;
}

function defaultVisibility(): MarkerPermission {
  switch (VisibilityConfig.defaultLevel) {
    case 'self':   return 'personal';
    case 'public': return 'public';
    case 'friends':
    default:       return 'group';
  }
}

const INITIAL_DRAFT: PlantDraft = {
  gpsLat: null,
  gpsLng: null,
  lat: null,
  lng: null,
  accuracyM: null,
  type: DEFAULT_TYPE,
  title: '',
  text: '',
  voiceUri: null,
  voiceMs: null,
  visibility: defaultVisibility(),
};

export function PlantScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const addMarker = useMarkerStore((s) => s.addMarker);
  // R21 (2026-08-17): dark mode support. When isDark, the cream root swaps
  // to a deep slate so Plant matches Home/Settings/Friends at night. Child
  // step components read their text color from the passed-through tokens.
  const { isDark } = useAppearance();
  // O1: recordCircleUnlock selector removed (v351 stopped calling it, dead ref
  // triggered re-render every time useMemoryStore changed)
  const userId = useAppStore((s) => s.user?.id ?? '');
  const [step, setStep] = useState<Step>('gps');
  const [draft, setDraft] = useState<PlantDraft>(INITIAL_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  // v299: success modal removed. PlantScreen.commit now navigates
  // directly to MarkerDetailScreen.

  /**
   * K3 fix (v0.2.6.3): on mount, hydrate any failed-plant draft from
   * AsyncStorage. Gated on userId — won't read with key
   * '...:undefined'. Single draft per user; latest failure overwrites
   * the previous (intentional, simpler than a draft list).
   */
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { storage } = await import('../store/storage');
        const raw = await storage.getItem(draftKey(userId));
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as PlantDraft;
        if (
          parsed && typeof parsed === 'object' &&
          typeof parsed.title === 'string' &&
          typeof parsed.text === 'string'
        ) {
          // v298 N5 migration: drafts persisted before this version
          // didn't have gpsLat/gpsLng. Fall back to the persisted
          // pin coord so step 2 (if re-entered from step 3 back) has
          // a valid anchor — yielding pre-v298 behavior for legacy
          // drafts only.
          const migrated: PlantDraft = {
            ...parsed,
            gpsLat: parsed.gpsLat ?? parsed.lat ?? null,
            gpsLng: parsed.gpsLng ?? parsed.lng ?? null,
          };
          setDraft(migrated);
          // If the saved draft already has a GPS lock, skip to content step.
          if (parsed.lat != null && parsed.lng != null) {
            setStep('content');
          }
        }
      } catch {
        // Ignore — corrupt draft is silently dropped.
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const commit = useCallback(
    async (final: PlantDraft) => {
      if (final.lat == null || final.lng == null) return;
      if (submitting) return;          // belt-and-suspenders
      log('plant.commit_attempt', { hasTitle: !!final.title, textLen: final.text.length, vis: final.visibility });
      setSubmitting(true);
      try {
        const created = await addMarker({
          type: final.type,
          lat: final.lat,
          lng: final.lng,
          note: encodeTitleBody(final.title, final.text),
          authorId: userId,
          permission: final.visibility,
          regionCode: '',
          gpsAgeS: 0,
          approximate: false,
          voiceMemoUri: final.voiceUri ?? undefined,
          voiceMemoDurationMs: final.voiceMs ?? undefined,
        } as any);
        log('plant.commit_ok', { id: created?.id });
        // v351: removed recordCircleUnlock — planting a cairn no longer
        // unlocks fog around the plant location. User feedback: "I planted
        // 8 cairns, those plant points became fog reveal circles around
        // my current location which I don't want — only hikes should
        // unlock fog."
        // Pre-v351 PlantScreen.tsx:180 called
        // recordCircleUnlock(lat, lng, UnlockConfig.radiusMeters=25, ...)
        // which writes a single VisitedPoint per plant into
        // useMemoryStore.points. Those points then get turf.buffer'd by
        // FogLayer into a corridor — visually a lumpy circle around each
        // planted cairn. Pin still drops via addMarker; only the fog
        // reveal side effect is removed.
        // Server-side cleanup of legacy plant-origin points is a separate
        // one-off SQL operation (delete from memory_points where
        // client_id NOT LIKE 'migration-%').
        // recordCircleUnlock(final.lat, final.lng, UnlockConfig.radiusMeters, Date.now());
        // K3 fix: clear any previously saved draft on successful commit.
        try {
          const { storage } = await import('../store/storage');
          await storage.removeItem(draftKey(userId));
        } catch { /* best-effort */ }
        setSubmitting(false);
        // v299 N7: instead of an auto-dismiss success modal, push the
        // user straight to the read-only MarkerDetailScreen. Same screen
        // is reused for the Flags tab tap (RoutesScreen). Use `replace`
        // so the navigation back stack is: Home → MarkerDetail (no
        // intermediate Plant flow tombstone the user would Back through).
        //
        // v418 ceremony: fire a success haptic + short 250ms delay before
        // navigating so users physically feel "cairn planted" instead of
        // an instant flash of a new screen. Non-blocking (haptics is fire-
        // and-forget) so total added latency = 250ms of visible pause on
        // step 3 UI, which reads as "committing…" rather than a jerk.
        if (created?.id) {
          try { haptic.notification('success'); } catch { /* silent */ }
          // v422: 若离线保存, 弹一次性 Alert 让用户知道 "已存本地, 联网自动上传".
          // 有网时不弹 (Haptic + 无缝跳转足以传达成功).
          const isOnline = networkMonitor.getState()?.state === 'online';
          if (!isOnline) {
            Alert.alert(
              'Cairn planted (offline)',
              "Saved locally. We'll upload it as soon as you're back online.",
              [{ text: 'OK' }],
            );
          }
          await new Promise<void>((r) => setTimeout(r, 250));
          nav.replace('MarkerDetail', { markerId: created.id });
        } else {
          // Defensive fallback — never expected; addMarker contract
          // says it returns a Marker, but if persistence is mocked or
          // the id field is empty, just go home rather than navigate
          // to a broken detail page.
          if (nav.canGoBack()) nav.goBack();
        }
        return;
      } catch (e: any) {
        log('plant.commit_failed', { msg: String(e?.message ?? e).slice(0, 200) });
        // Stay on the content step so the user can retry without
        // re-entering everything. No silent failure.
        try {
          const { storage } = await import('../store/storage');
          await storage.setItem(draftKey(userId), JSON.stringify(final));
        } catch {
          // Best-effort — can't help if storage itself is broken.
        }
        setSubmitting(false);
        // O18 VER-05: map known backend error codes to human copy so a
        // permanent failure (rate limited / duplicate / too close) isn't
        // presented as "try again in a moment" — which invites the user
        // into an infinite retry loop.
        const raw = String(e?.message ?? '').toLowerCase();
        let body: string;
        if (raw.includes('rate') && raw.includes('limit')) {
          body = 'You are creating cairns very quickly. Wait a minute and try again.';
        } else if (raw.includes('too close') || raw.includes('duplicate')) {
          body = 'There is already a cairn near here. Try a different spot.';
        } else if (raw.includes('unauthor') || raw.includes('401')) {
          body = 'Your session expired. Sign in again and your draft will be waiting.';
        } else if (raw.includes('network') || raw.includes('fetch')) {
          body = 'Your draft is saved. We\'ll try again once you have signal.';
        } else {
          body = 'Your draft is saved — try again in a moment.';
        }
        Alert.alert("Couldn't plant this cairn", body, [{ text: 'OK' }]);
      }
    },
    [addMarker, userId, nav, submitting]
  );

  const onContentSubmit = (payload: {
    type: MarkerType;
    title: string;
    text: string;
    visibility: MarkerPermission;
    voiceUri: string | null;
    voiceMs: number | null;
  }) => {
    const final: PlantDraft = { ...draft, ...payload };
    setDraft(final);
    void commit(final);
  };

  return (
    <SafeAreaView style={[styles.root, isDark ? { backgroundColor: '#0F1620' } : null]} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {step === 'gps' && (
          <GpsLockStep
            onLocked={(lat, lng, accuracyM) => {
              log('plant.step_gps_to_pin', { accuracyM });
              // v298 N5: GPS anchor + initial pin both = locked point,
              // but gpsLat/gpsLng is then frozen — step 2 confirm only
              // updates lat/lng, leaving the anchor intact for step
              // 3 → step 2 back navigation.
              setDraft((d) => ({ ...d, gpsLat: lat, gpsLng: lng, lat, lng, accuracyM }));
              setStep('pin');
            }}
            onCancel={() => { log('plant.cancel'); nav.goBack(); }}
          />
        )}
        {step === 'pin' && draft.gpsLat != null && draft.gpsLng != null && draft.lat != null && draft.lng != null && (
          <PinAdjustStep
            gpsLat={draft.gpsLat}
            gpsLng={draft.gpsLng}
            initialLat={draft.lat}
            initialLng={draft.lng}
            onConfirm={(lat, lng) => {
              log('plant.step_pin_to_content');
              // Only update the pin coord — gpsLat/gpsLng stays frozen.
              setDraft((d) => ({ ...d, lat, lng }));
              setStep('content');
            }}
            // Back from Pin Adjust exits the whole Plant flow.
            // Going back to step='gps' is useless: gps step auto-
            // advances the moment it gets a fix (which we already have),
            // so the user would just bounce right back to 'pin'. Closing
            // the screen is the only behavior that matches user intent.
            onBack={() => { log('plant.step_back_pin_to_home'); nav.goBack(); }}
          />
        )}
        {step === 'content' && (
          <ContentStep
            initialTitle={draft.title}
            initialText={draft.text}
            initialVisibility={draft.visibility}
            initialType={draft.type}
            submitting={submitting}
            onSubmit={onContentSubmit}
            onBack={() => setStep('pin')}
          />
        )}
      </View>
      {/* v299: success modal removed — commit() now navigates directly
          to MarkerDetailScreen. */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: MemoryColors.cream },
  container: { flex: 1, padding: 20 },
});
