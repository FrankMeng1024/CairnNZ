/**
 * PlantScreen — GPS-based plant flow (no AR).
 *
 * Standalone Plant uses three steps; an active Activity with a fresh trusted
 * fix enters directly at content and lets the user adjust if needed:
 *   Step 1 (GpsLockStep)    — 5s GPS sample with progress + accuracy live
 *   Step 2 (PinAdjustStep)  — Mapbox satellite mini-map, draggable pin
 *   Step 3 (ContentStep)    — optional name/note and durable commit
 *
 * On Plant Cairn (final commit):
 *   1. Write the marker via useMarkerStore.addMarker (existing API)
 *   2. Return to the active Activity, or open Cairn detail when standalone
 *
 * Title encoding: the marker model only has a single `note` field, so
 * we encode title/body using a Record Separator character (\u001E,
 * U+001E). This char is never produced by mobile keyboards, so the
 * round-trip via splitTitleBody (RevealedCairnSheet) is unambiguous.
 * Migrating the marker schema to add a real `title` column is deferred
 * to v0.2.7 and tracked there.
 *
 * Plant is locally durable and does not reveal Memory. Sync is a separate
 * state with an explicit retry path in Cairn detail.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  useMarkerStore,
  MarkerPermission,
  type CairnActivityContext,
} from '../store/useMarkerStore';
import { useAppStore } from '../store/useAppStore';
// v422 offline-first: 使 Plant flow 明确告知用户是否离线保存
import networkMonitor from '../services/networkMonitor';
import { MarkerType } from '../config/markerTypes';
import { GpsLockStep } from '../features/plant/components/GpsLockStep';
import { PinAdjustStep } from '../features/plant/components/PinAdjustStep';
import { ContentStep } from '../features/plant/components/ContentStep';
import { VisibilityConfig } from '../features/plant/config/plantConfig';
import { usePublicCairnStore } from '../features/public/services/publicCairns';
import { encodeTitleBody } from '../features/plant/services/noteEncoding';
import { log } from '../services/appLog';
import { haptic } from '../services/hapticService';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { useTrackingStore } from '../store/useTrackingStore';
import { activityFreshnessNow } from '../features/activitySimulator/simulatorTime';
import { getCurrentRegion } from '../config/regions';
import { storage } from '../store/storage';
import {
  executeCairnCommit,
  type CairnCommitGate,
} from '../features/cairns/cairnCommitBoundary';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { Icon } from '../components/Icon';
import { Spacing } from '../components/tokens';

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

// Plant v1 is a personal place trace. Hazard/water/junction reporting is a
// separate social/field-report decision and is not the moving default.
const DEFAULT_TYPE = 'cairn';

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

type PlantActivityTrackingContext = Pick<
  ReturnType<typeof useTrackingStore.getState>,
  | 'status'
  | 'locationProviderSource'
  | 'locationAvailable'
  | 'lastCoordinate'
  | 'lastCoordinateTime'
  | 'sessionId'
  | 'ownerUserId'
  | 'liveOwnerGeneration'
>;

export function resolveInitialPlantContext(
  trackingOverride?: PlantActivityTrackingContext,
): { step: Step; draft: PlantDraft; fromActivity: boolean; activityContext: CairnActivityContext | null } {
  try {
    const tracking = trackingOverride ?? useTrackingStore.getState();
    const active = tracking.status === 'tracking' || tracking.status === 'paused';
    const coordinate = tracking.lastCoordinate;
    const ageMs = activityFreshnessNow(tracking.locationProviderSource) - (tracking.lastCoordinateTime ?? 0);
    if (
      active
      && tracking.locationAvailable
      && coordinate
      && tracking.sessionId
      && tracking.ownerUserId
      && tracking.liveOwnerGeneration
      && ageMs >= 0
      && ageMs <= 30_000
    ) {
      return {
        step: 'content',
        fromActivity: true,
        activityContext: {
          ownerUserId: tracking.ownerUserId,
          clientActivityId: tracking.sessionId,
          ownerGeneration: tracking.liveOwnerGeneration,
        },
        draft: {
          ...INITIAL_DRAFT,
          gpsLat: coordinate.lat,
          gpsLng: coordinate.lng,
          lat: coordinate.lat,
          lng: coordinate.lng,
          accuracyM: coordinate.accuracy ?? null,
        },
      };
    }
  } catch { /* standalone Plant starts with the bounded GPS flow */ }
  return { step: 'gps', draft: INITIAL_DRAFT, fromActivity: false, activityContext: null };
}

export function PlantScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const addMarker = useMarkerStore((s) => s.addMarker);
  // R21 (2026-08-17): dark mode support. When isDark, the cream root swaps
  // to a deep slate so Plant matches Home/Settings/Friends at night. Child
  // step components read their text color from the passed-through tokens.
  const visualTheme = useVisualTheme();
  // O1: recordCircleUnlock selector removed (v351 stopped calling it, dead ref
  // triggered re-render every time useMemoryStore changed)
  const userId = useAppStore((s) => s.user?.id ?? '');
  const [initialContext] = useState(resolveInitialPlantContext);
  const [step, setStep] = useState<Step>(initialContext.step);
  const [draft, setDraft] = useState<PlantDraft>(initialContext.draft);
  const [submitting, setSubmitting] = useState(false);
  const [plantedResult, setPlantedResult] = useState<{ markerId: string; offline: boolean } | null>(null);
  const commitGateRef = useRef<CairnCommitGate>({ current: null });
  const mountedRef = useRef(true);
  const publicEnabled = usePublicCairnStore((state) => state.enabled);
  // v299: success modal removed. PlantScreen.commit now navigates
  // directly to MarkerDetailScreen.
  useEffect(() => () => { mountedRef.current = false; }, []);

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
      const activityContext = initialContext.activityContext;
      const initiatingOwnerId = userId;
      const ownerIsCurrent = () => (
        mountedRef.current
        && String(useAppStore.getState().user?.id ?? '') === initiatingOwnerId
        && String(useMarkerStore.getState().userId ?? '') === initiatingOwnerId
      );
      const contextIsCurrent = () => {
        if (!ownerIsCurrent()) return false;
        if (!activityContext) return true;
        const tracking = useTrackingStore.getState();
        return (
          (tracking.status === 'tracking' || tracking.status === 'paused')
          && tracking.ownerUserId === activityContext.ownerUserId
          && tracking.sessionId === activityContext.clientActivityId
          && tracking.liveOwnerGeneration === activityContext.ownerGeneration
        );
      };

      if (!contextIsCurrent()) {
        if (activityContext && ownerIsCurrent()) {
          Alert.alert(
            "Couldn't plant this cairn",
            'The Activity changed while Plant was open. Return to the current Activity and try again.',
            [{ text: 'OK' }],
          );
        }
        return;
      }

      return executeCairnCommit({
        gate: commitGateRef.current,
        isContextCurrent: contextIsCurrent,
        onLockChange: locked => {
          if (ownerIsCurrent()) setSubmitting(locked);
        },
        commit: () => {
          log('plant.commit_attempt', { hasTitle: !!final.title, textLen: final.text.length, vis: final.visibility });
          return addMarker({
            type: final.type,
            lat: final.lat!,
            lng: final.lng!,
            note: encodeTitleBody(final.title, final.text),
            authorId: initiatingOwnerId,
            permission: final.visibility,
            regionCode: getCurrentRegion().code,
            gpsAgeS: 0,
            approximate: false,
            voiceMemoUri: final.voiceUri ?? undefined,
            voiceMemoDurationMs: final.voiceMs ?? undefined,
            activityContext,
          });
        },
        onPreCommitFailure: async (error, contextCurrent) => {
          log('plant.commit_failed', { msg: String((error as any)?.message ?? error).slice(0, 200) });
          // The write was not accepted, so retain exactly one owner-scoped
          // draft. Account/activity changes suppress only stale UI feedback.
          try {
            await storage.setItem(draftKey(initiatingOwnerId), JSON.stringify(final));
          } catch { /* best-effort */ }
          if (!contextCurrent || !contextIsCurrent()) return;
          const raw = String((error as any)?.message ?? '').toLowerCase();
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
        },
        // Plant owns the durable Cairn object only. Movement remains the sole
        // Memory authority. Clear A's retry draft even if B is now visible.
        onCommitted: async result => {
          log('plant.commit_ok', { id: result.marker.id, projection: result.projection });
          try {
            await storage.removeItem(draftKey(initiatingOwnerId));
          } catch { /* best-effort */ }
        },
        onCommittedCurrent: async result => {
          try { haptic.notification('success'); } catch { /* silent */ }
          const isOnline = networkMonitor.getState()?.state === 'online';
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          if (!contextIsCurrent()) return;
          if (initialContext.fromActivity && nav.canGoBack()) {
            setPlantedResult({ markerId: result.marker.id, offline: !isOnline });
          } else {
            nav.replace('MarkerDetail', { markerId: result.marker.id });
          }
        },
        onPostCommitFailure: error => {
          log('plant.post_commit_effect_failed', { msg: String((error as any)?.message ?? error).slice(0, 200) });
        },
        // A durable full-Plant submit is terminal. A navigation/unmount race
        // must not reopen the button and mint a duplicate Cairn.
        releaseOnCommittedCurrent: false,
      });
    },
    [addMarker, userId, nav, initialContext]
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
    <SafeAreaView style={[styles.root, { backgroundColor: visualTheme.background }]} edges={['top', 'bottom']}>
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
            activityLocation={initialContext.fromActivity}
            submitting={submitting}
            publicEnabled={publicEnabled}
            onSubmit={onContentSubmit}
            onBack={() => setStep('pin')}
          />
        )}
      </View>
      <ModalCard visible={Boolean(plantedResult)} dismissible={false} testID="plant-success-modal">
        <ModalCardHeader
          title="Cairn planted"
          body={plantedResult?.offline
            ? "It is saved on this iPhone and will sync when you're online. Your Activity is still recording."
            : 'It is saved with this Activity. Your Activity is still recording.'}
        />
        <View style={styles.successActions}>
          <PrimaryButton
            label="View your Cairn"
            renderIcon={(color) => <Icon name="MapPin" size={17} color={color} strokeWidth={2.2} />}
            onPress={() => {
              if (!plantedResult) return;
              nav.replace('MarkerDetail', { markerId: plantedResult.markerId });
            }}
            testID="plant-success-view"
          />
          <PrimaryButton
            label="Back to Activity"
            variant="secondary"
            onPress={() => {
              setPlantedResult(null);
              nav.goBack();
            }}
            testID="plant-success-back"
          />
        </View>
      </ModalCard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1 },
  container: { flex: 1, padding: 20 },
  successActions: { gap: Spacing.sm },
});
