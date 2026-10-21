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
import { ActivityIndicator, Alert, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  useMarkerStore,
  MarkerPermission,
  type CairnActivityContext,
} from '../store/useMarkerStore';
import { useAppStore } from '../store/useAppStore';
import { MarkerType } from '../config/markerTypes';
import { GpsLockStep } from '../features/plant/components/GpsLockStep';
import type { PlantLocationCaptureMethod, PlantLocationProvenance } from '../features/plant/components/GpsLockStep';
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
import { CairnStoneMark, useReduceMotion } from '../features/cairns/components/CairnPaper';
import { CAIRN_MOTION, cairnPublicationTruth } from '../features/cairns/cairnExperience';
import { cairnMatchesIdentity } from '../features/cairns/cairnIdentity';
import {
  claimPlantDraftSession,
  legacyPlantDraftStorageKey,
  persistPlantDraft,
  plantDraftScopeId,
  plantDraftStorageKey,
  readPlantDraft,
  releasePlantDraftSession,
  removeLegacyDraftIfUnchanged,
  removePlantDraftIfSessionMatches,
  type PlantDraftScope,
} from '../features/plant/plantDraftLifecycle';

type Step = 'gps' | 'pin' | 'content';
const MAX_PLANT_LOCATION_AGE_MS = 2 * 60 * 1000;


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
  locationProvenance: PlantLocationProvenance | null;
  /** Trusted observation time. Never reconstructed from draft restore time. */
  locationCapturedAtMs: number | null;
  locationSampleCount: number | null;
  locationCaptureMethod: PlantLocationCaptureMethod | null;
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

interface PersistedPlantDraft {
  v: 5;
  ownerUserId: string;
  sessionId: string;
  scopeId: string;
  origin: PlantOrigin;
  activityContext: CairnActivityContext | null;
  savedAtMs: number;
  draft: PlantDraft;
}

interface LegacyPersistedPlantDraft extends Omit<PersistedPlantDraft, 'v' | 'scopeId'> {
  v: 4;
}

type LocationFlow = 'initial' | 'adjust' | 'refresh';

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
  locationProvenance: null,
  locationCapturedAtMs: null,
  locationSampleCount: null,
  locationCaptureMethod: null,
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
> & { activityMode?: 'hiking' | 'running' };

type PlantOrigin = NonNullable<RootStackParamList['Plant']>['origin'];

export function resolveInitialPlantContext(
  trackingOverride?: PlantActivityTrackingContext,
  origin?: PlantOrigin,
): { step: Step; draft: PlantDraft; fromActivity: boolean; activityContext: CairnActivityContext | null } {
  if (origin?.kind === 'standalone') {
    return { step: 'gps', draft: INITIAL_DRAFT, fromActivity: false, activityContext: null };
  }
  try {
    const tracking = trackingOverride ?? useTrackingStore.getState();
    const active = tracking.status === 'tracking' || tracking.status === 'paused';
    const coordinate = tracking.lastCoordinate;
    const ageMs = activityFreshnessNow(tracking.locationProviderSource) - (tracking.lastCoordinateTime ?? 0);
    const exactActivityIdentity = Boolean(
      active
      && tracking.sessionId
      && tracking.ownerUserId
      && tracking.liveOwnerGeneration
      && (!origin || (
        origin.kind === 'activity'
        && origin.clientActivityId === tracking.sessionId
        && origin.ownerGeneration === tracking.liveOwnerGeneration
        && origin.activityMode === tracking.activityMode
      )),
    );
    if (
      exactActivityIdentity
      && tracking.locationAvailable
      && coordinate
      && Number.isFinite(coordinate.accuracy)
      && Number(coordinate.accuracy) >= 0
      && Number(coordinate.accuracy) <= 100
      && ageMs >= 0
      && ageMs <= 30_000
    ) {
      return {
        step: 'content',
        fromActivity: true,
        activityContext: {
          ownerUserId: tracking.ownerUserId!,
          clientActivityId: tracking.sessionId!,
          ownerGeneration: tracking.liveOwnerGeneration!,
        },
        draft: {
          ...INITIAL_DRAFT,
          gpsLat: coordinate.lat,
          gpsLng: coordinate.lng,
          lat: coordinate.lat,
          lng: coordinate.lng,
          accuracyM: coordinate.accuracy ?? null,
          locationProvenance: tracking.locationProviderSource === 'simulator' ? 'simulator_test' : 'real',
          locationCapturedAtMs: tracking.lastCoordinateTime ?? null,
          locationSampleCount: 1,
          locationCaptureMethod: 'activity',
        },
      };
    }
    if (exactActivityIdentity) {
      return {
        step: 'gps',
        draft: INITIAL_DRAFT,
        fromActivity: true,
        activityContext: {
          ownerUserId: tracking.ownerUserId!,
          clientActivityId: tracking.sessionId!,
          ownerGeneration: tracking.liveOwnerGeneration!,
        },
      };
    }
  } catch { /* standalone Plant starts with the bounded GPS flow */ }
  return { step: 'gps', draft: INITIAL_DRAFT, fromActivity: false, activityContext: null };
}

export function PlantScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Plant'>>();
  const addMarker = useMarkerStore((s) => s.addMarker);
  // R21 (2026-08-17): dark mode support. When isDark, the cream root swaps
  // to a deep slate so Plant matches Home/Settings/Friends at night. Child
  // step components read their text color from the passed-through tokens.
  const visualTheme = useVisualTheme();
  const reduceMotion = useReduceMotion();
  const leaveReveal = useRef(new Animated.Value(0)).current;
  // O1: recordCircleUnlock selector removed (v351 stopped calling it, dead ref
  // triggered re-render every time useMemoryStore changed)
  const userId = useAppStore((s) => s.user?.id ?? '');
  const [initialContext] = useState(() => resolveInitialPlantContext(
    undefined,
    route.params?.origin ?? { kind: 'standalone' },
  ));
  const [draftScope] = useState<PlantDraftScope>(() => {
    const origin = route.params?.origin ?? { kind: 'standalone' as const };
    if (origin.kind === 'activity' && initialContext.activityContext) {
      return {
        kind: 'activity',
        clientActivityId: origin.clientActivityId,
        ownerGeneration: origin.ownerGeneration,
        activityMode: origin.activityMode,
      };
    }
    return { kind: 'standalone' };
  });
  const [step, setStep] = useState<Step>(initialContext.step);
  const [draft, setDraft] = useState<PlantDraft>(initialContext.draft);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const plantSessionId = useRef(`plant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`).current;
  const scopedDraftKey = userId ? plantDraftStorageKey(userId, draftScope) : '';
  const [pendingResume, setPendingResume] = useState<{
    draft: PlantDraft;
    storedSessionId: string;
    sourceKey: string;
    sourceRaw: string;
    savedAtMs: number | null;
  } | null>(null);
  const [locationFlow, setLocationFlow] = useState<LocationFlow>('initial');
  const locationSnapshotRef = useRef<PlantDraft | null>(null);
  const draftRef = useRef(draft);
  const draftHydratedRef = useRef(false);
  const plantedResultRef = useRef(false);
  const draftTerminalRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [plantedResult, setPlantedResult] = useState<{
    markerId: string;
    qa: boolean;
    fromActivity: boolean;
    visibility: MarkerPermission;
  } | null>(null);
  const markers = useMarkerStore((state) => state.markers);
  const commitGateRef = useRef<CairnCommitGate>({ current: null });
  const mountedRef = useRef(true);
  const publicEnabled = usePublicCairnStore((state) => state.enabled);
  draftRef.current = draft;
  draftHydratedRef.current = draftHydrated;
  plantedResultRef.current = Boolean(plantedResult);
  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => {
    if (!plantedResult) {
      leaveReveal.setValue(0);
      return;
    }
    leaveReveal.setValue(reduceMotion ? 1 : 0);
    Animated.timing(leaveReveal, {
      toValue: 1,
      duration: reduceMotion ? CAIRN_MOTION.reducedMs : CAIRN_MOTION.leaveMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [leaveReveal, plantedResult, reduceMotion]);
  const plantedMarker = plantedResult
    ? markers.find(marker => cairnMatchesIdentity(marker, plantedResult.markerId))
    : null;
  const activitySuffix = plantedResult?.fromActivity ? ' Your Activity remains open.' : '';
  const successCopy = (() => {
    if (!plantedResult) return { title: '', body: '' };
    if (plantedResult.qa) {
      return {
        title: 'Cairn saved for this test',
        body: `It stays in the Simulator test workspace and will not sync to your real Cairns.${activitySuffix}`,
      };
    }
    if (plantedMarker?.syncState === 'failed') {
      return {
        title: 'Cairn saved on this iPhone',
        body: `Sync needs attention, but your note and place are still saved here. Open the Cairn to retry.${activitySuffix}`,
      };
    }
    const synced = plantedMarker?.synced === true || plantedMarker?.syncState === 'synced';
    if (!synced) {
      if (plantedResult.visibility === 'public' && plantedMarker) {
        const truth = cairnPublicationTruth(plantedMarker);
        if (truth) return { title: truth.successTitle, body: `${truth.explanation}${activitySuffix}` };
      }
      return {
            title: 'Cairn saved on this iPhone',
            body: `It is queued to sync. You can read it now, and retry from the Cairn if sync needs attention.${activitySuffix}`,
          };
    }
    if (plantedResult.visibility === 'public') {
      const truth = plantedMarker ? cairnPublicationTruth(plantedMarker) : null;
      return truth
        ? { title: truth.successTitle, body: `${truth.explanation}${activitySuffix}` }
        : { title: 'Cairn saved', body: `Public status is not available yet.${activitySuffix}` };
    }
    return {
      title: 'Cairn left here',
      body: plantedResult.fromActivity
        ? 'It is synced with this Activity. Your Activity remains open.'
        : 'It is synced in your Memory at this place.',
    };
  })();

  const makeDraftEnvelope = useCallback((value: PlantDraft): PersistedPlantDraft => ({
    v: 5,
    ownerUserId: userId,
    sessionId: plantSessionId,
    scopeId: plantDraftScopeId(draftScope),
    origin: route.params?.origin ?? { kind: 'standalone' },
    activityContext: initialContext.activityContext,
    savedAtMs: Date.now(),
    draft: value,
  }), [draftScope, initialContext.activityContext, plantSessionId, route.params?.origin, userId]);

  const normalizeStoredDraft = useCallback((value: unknown): PlantDraft | null => {
    if (!value || typeof value !== 'object') return null;
    const parsed = value as Partial<PlantDraft>;
    if (typeof parsed.title !== 'string' || typeof parsed.text !== 'string') return null;
    const coordinate = (candidate: unknown): number | null => {
      if (candidate == null) return null;
      return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
    };
    return {
      ...initialContext.draft,
      gpsLat: coordinate(parsed.gpsLat),
      gpsLng: coordinate(parsed.gpsLng),
      lat: coordinate(parsed.lat),
      lng: coordinate(parsed.lng),
      accuracyM: coordinate(parsed.accuracyM),
      locationProvenance: parsed.locationProvenance ?? null,
      locationCapturedAtMs: coordinate(parsed.locationCapturedAtMs),
      locationSampleCount: coordinate(parsed.locationSampleCount),
      locationCaptureMethod: parsed.locationCaptureMethod ?? null,
      type: parsed.type ?? initialContext.draft.type,
      title: parsed.title,
      text: parsed.text,
      voiceUri: typeof parsed.voiceUri === 'string' ? parsed.voiceUri : null,
      voiceMs: coordinate(parsed.voiceMs),
      visibility: parsed.visibility ?? initialContext.draft.visibility,
    };
  }, [initialContext.draft]);

  const storedEnvelopeMatchesScope = useCallback((value: PersistedPlantDraft | LegacyPersistedPlantDraft): boolean => {
    if (value.ownerUserId !== userId) return false;
    if (value.v === 5) return value.scopeId === plantDraftScopeId(draftScope);
    if (draftScope.kind === 'standalone') return value.origin?.kind === 'standalone';
    return value.origin?.kind === 'activity'
      && value.origin.clientActivityId === draftScope.clientActivityId
      && value.origin.ownerGeneration === draftScope.ownerGeneration
      && value.origin.activityMode === draftScope.activityMode
      && value.activityContext?.ownerUserId === userId
      && value.activityContext.clientActivityId === draftScope.clientActivityId
      && value.activityContext.ownerGeneration === draftScope.ownerGeneration;
  }, [draftScope, userId]);

  const applyResumedDraft = useCallback(async (
    resumedDraft: PlantDraft,
    sourceKey: string,
    sourceRaw: string,
  ) => {
    const adopted = makeDraftEnvelope(resumedDraft);
    await persistPlantDraft(storage, scopedDraftKey, plantSessionId, JSON.stringify(adopted));
    if (sourceKey !== scopedDraftKey) {
      await removeLegacyDraftIfUnchanged(storage, sourceKey, sourceRaw);
    }
    if (!mountedRef.current) return;
    setDraft(resumedDraft);
    setStep(resumedDraft.lat != null && resumedDraft.lng != null ? 'content' : initialContext.step);
    setPendingResume(null);
    setDraftHydrated(true);
  }, [initialContext.step, makeDraftEnvelope, plantSessionId, scopedDraftKey]);

  // Hydration is an honest gate: the editor does not accept typing until the
  // exact owner/origin draft decision has resolved. Activity drafts resume
  // only for the identical Activity identity. Standalone drafts require an
  // explicit continue-or-discard choice, so old words are never silently
  // reinterpreted at a new place.
  useEffect(() => {
    if (!userId || !scopedDraftKey) {
      setDraftHydrated(false);
      return undefined;
    }
    let cancelled = false;
    claimPlantDraftSession(scopedDraftKey, plantSessionId);
    (async () => {
      let sourceKey = scopedDraftKey;
      let raw = await readPlantDraft(storage, sourceKey);
      if (!raw) {
        sourceKey = legacyPlantDraftStorageKey(userId);
        raw = await readPlantDraft(storage, sourceKey);
      }
      if (cancelled) return;
      if (!raw) {
        setDraftHydrated(true);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as PersistedPlantDraft | LegacyPersistedPlantDraft | PlantDraft;
        const hasEnvelope = Boolean(parsed && typeof parsed === 'object' && 'draft' in parsed);
        const envelope = hasEnvelope ? parsed as PersistedPlantDraft | LegacyPersistedPlantDraft : null;
        const storedDraft = normalizeStoredDraft(envelope ? envelope.draft : parsed);
        const matches = envelope
          ? storedEnvelopeMatchesScope(envelope)
          : draftScope.kind === 'standalone';
        if (!storedDraft || !matches) {
          setDraftHydrated(true);
          return;
        }
        if (draftScope.kind === 'standalone'
          && (!envelope || envelope.sessionId !== plantSessionId)) {
          setPendingResume({
            draft: storedDraft,
            storedSessionId: envelope?.sessionId ?? 'legacy-unscoped',
            sourceKey,
            sourceRaw: raw,
            savedAtMs: envelope?.savedAtMs ?? null,
          });
          return;
        }
        await applyResumedDraft(storedDraft, sourceKey, raw);
      } catch {
        if (!cancelled) setDraftHydrated(true);
      }
    })().catch(() => {
      if (!cancelled) setDraftHydrated(true);
    });
    return () => {
      cancelled = true;
      if (draftHydratedRef.current && !draftTerminalRef.current && !plantedResultRef.current) {
        const envelope = makeDraftEnvelope(draftRef.current);
        void persistPlantDraft(storage, scopedDraftKey, plantSessionId, JSON.stringify(envelope));
      }
      releasePlantDraftSession(scopedDraftKey, plantSessionId);
    };
  }, [
    applyResumedDraft,
    draftScope,
    makeDraftEnvelope,
    normalizeStoredDraft,
    plantSessionId,
    scopedDraftKey,
    storedEnvelopeMatchesScope,
    userId,
  ]);

  useEffect(() => {
    if (!userId || !scopedDraftKey || !draftHydrated || plantedResult || draftTerminalRef.current) return undefined;
    const timeout = setTimeout(() => {
      const envelope = makeDraftEnvelope(draft);
      void persistPlantDraft(storage, scopedDraftKey, plantSessionId, JSON.stringify(envelope));
    }, 120);
    return () => clearTimeout(timeout);
  }, [draft, draftHydrated, makeDraftEnvelope, plantSessionId, plantedResult, scopedDraftKey, userId]);

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
            gpsAgeS: final.locationCapturedAtMs == null
              ? undefined
              : Math.max(0, Math.floor((Date.now() - final.locationCapturedAtMs) / 1000)),
            approximate: false,
            placementAccuracyM: final.accuracyM ?? undefined,
            placementObservedAtMs: final.locationCapturedAtMs ?? undefined,
            placementSource: final.locationCaptureMethod ?? undefined,
            placementSampleCount: final.locationSampleCount ?? undefined,
            voiceMemoUri: final.voiceUri ?? undefined,
            voiceMemoDurationMs: final.voiceMs ?? undefined,
            qaProvenance: final.locationProvenance === 'simulator_test' ? 'simulator_test' : undefined,
            activityContext,
          });
        },
        onPreCommitFailure: async (error, contextCurrent) => {
          log('plant.commit_failed', { msg: String((error as any)?.message ?? error).slice(0, 200) });
          // The write was not accepted, so retain exactly one owner-scoped
          // draft. Account/activity changes suppress only stale UI feedback.
          try {
            const envelope: PersistedPlantDraft = {
              v: 5,
              ownerUserId: initiatingOwnerId,
              sessionId: plantSessionId,
              scopeId: plantDraftScopeId(draftScope),
              origin: route.params?.origin ?? { kind: 'standalone' },
              activityContext,
              savedAtMs: Date.now(),
              draft: final,
            };
            await persistPlantDraft(
              storage,
              plantDraftStorageKey(initiatingOwnerId, draftScope),
              plantSessionId,
              JSON.stringify(envelope),
            );
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
        onCommitted: async result => {
          log('plant.commit_ok', { id: result.marker.id, projection: result.projection });
          draftTerminalRef.current = true;
          // Plant's bounded five-second lock proves placement quality, not the
          // server's 15-second passive-presence contract. Personal Memory is
          // produced by the independent recorder (or canonical Activity), so
          // a single Cairn placement can never manufacture shareable Fog.
          try {
            await removePlantDraftIfSessionMatches(
              storage,
              plantDraftStorageKey(initiatingOwnerId, draftScope),
              plantSessionId,
              plantSessionId,
            );
          } catch { /* best-effort */ }
        },
        onCommittedCurrent: async result => {
          try { haptic.notification('success'); } catch { /* silent */ }
          if (!contextIsCurrent()) return;
          setPlantedResult({
            markerId: result.marker.id,
            qa: result.marker.qaProvenance === 'simulator_test',
            fromActivity: initialContext.fromActivity,
            visibility: final.visibility,
          });
        },
        onPostCommitFailure: error => {
          log('plant.post_commit_effect_failed', { msg: String((error as any)?.message ?? error).slice(0, 200) });
        },
        // A durable full-Plant submit is terminal. A navigation/unmount race
        // must not reopen the button and mint a duplicate Cairn.
        releaseOnCommittedCurrent: false,
      });
    },
    [addMarker, userId, initialContext, plantSessionId, draftScope, route.params?.origin]
  );

  const beginLocationFlow = useCallback((kind: Exclude<LocationFlow, 'initial'>, snapshot = draftRef.current) => {
    locationSnapshotRef.current = snapshot;
    setLocationFlow(kind);
    setStep('gps');
  }, []);

  const cancelLocationFlow = useCallback(() => {
    if (locationFlow === 'initial' || !locationSnapshotRef.current) {
      log('plant.cancel');
      nav.goBack();
      return;
    }
    const snapshot = locationSnapshotRef.current;
    locationSnapshotRef.current = null;
    setDraft(snapshot);
    setLocationFlow('initial');
    setStep('content');
  }, [locationFlow, nav]);

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
    const locationAgeMs = final.locationCapturedAtMs == null
      ? Number.POSITIVE_INFINITY
      : activityFreshnessNow(final.locationProvenance === 'simulator_test' ? 'simulator' : 'real')
        - final.locationCapturedAtMs;
    if (locationAgeMs < 0 || locationAgeMs > MAX_PLANT_LOCATION_AGE_MS) {
      Alert.alert(
        'Refresh this place',
        'Your position is no longer fresh enough to leave this Cairn accurately. Your note and audience are saved while Cairn confirms the place again.',
        [{ text: 'Confirm position', onPress: () => beginLocationFlow('refresh', final) }],
      );
      return;
    }
    void commit(final);
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: visualTheme.background }]} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {!draftHydrated && !pendingResume ? (
          <View style={styles.hydrationState} testID="plant-draft-hydration">
            <ActivityIndicator color={visualTheme.primary} />
            <Text style={[styles.hydrationTitle, { color: visualTheme.textPrimary }]}>Checking your saved note…</Text>
            <Text style={[styles.hydrationBody, { color: visualTheme.textMuted }]}>Your words stay closed until the right place and Activity are confirmed.</Text>
          </View>
        ) : null}
        {draftHydrated && step === 'gps' && (
          <GpsLockStep
            onLocked={(lat, lng, accuracyM, locationProvenance, observedAtMs, sampleCount, captureMethod) => {
              log('plant.step_gps_to_pin', { accuracyM });
              // v298 N5: GPS anchor + initial pin both = locked point,
              // but gpsLat/gpsLng is then frozen — step 2 confirm only
              // updates lat/lng, leaving the anchor intact for step
              // 3 → step 2 back navigation.
              setDraft((d) => ({
                ...d,
                gpsLat: lat,
                gpsLng: lng,
                lat,
                lng,
                accuracyM,
                locationProvenance,
                locationCapturedAtMs: observedAtMs,
                locationSampleCount: sampleCount,
                locationCaptureMethod: captureMethod,
              }));
              setStep('pin');
            }}
            onCancel={cancelLocationFlow}
          />
        )}
        {draftHydrated && step === 'pin' && draft.gpsLat != null && draft.gpsLng != null && draft.lat != null && draft.lng != null && (
          <PinAdjustStep
            gpsLat={draft.gpsLat}
            gpsLng={draft.gpsLng}
            initialLat={draft.lat}
            initialLng={draft.lng}
            onConfirm={(lat, lng) => {
              log('plant.step_pin_to_content');
              // Only update the pin coord — gpsLat/gpsLng stays frozen.
              setDraft((d) => ({ ...d, lat, lng }));
              locationSnapshotRef.current = null;
              setLocationFlow('initial');
              setStep('content');
            }}
            onBack={() => {
              if (locationFlow !== 'initial' && locationSnapshotRef.current) {
                log('plant.location_adjustment_cancelled');
                cancelLocationFlow();
                return;
              }
              log('plant.step_back_pin_to_home');
              nav.goBack();
            }}
          />
        )}
        {draftHydrated && step === 'content' && (
          <ContentStep
            title={draft.title}
            text={draft.text}
            visibility={draft.visibility}
            type={draft.type}
            onDraftChange={patch => setDraft(current => ({ ...current, ...patch }))}
            activityLocation={initialContext.fromActivity}
            accuracyM={draft.accuracyM}
            capturedAtMs={draft.locationCapturedAtMs}
            locationProvenance={draft.locationProvenance}
            submitting={submitting}
            publicEnabled={publicEnabled}
            onSubmit={onContentSubmit}
            onBack={() => initialContext.fromActivity ? nav.goBack() : setStep('pin')}
            // A deliberate adjustment starts with a fresh physical fix. The
            // parent-owned draft remains mounted in state/storage, including
            // the Activity identity; only location evidence is replaced.
            onAdjustLocation={() => beginLocationFlow('adjust')}
          />
        )}
      </View>
      <ModalCard visible={Boolean(pendingResume)} dismissible={false} testID="plant-resume-modal">
        <ModalCardHeader
          title="Continue your saved note?"
          body={pendingResume?.savedAtMs
            ? `It still belongs to its original place and was saved ${new Date(pendingResume.savedAtMs).toLocaleString()}. You can refresh the position before leaving it.`
            : 'It still belongs to its original place. You can refresh the position before leaving it.'}
        />
        <View style={styles.successActions}>
          <PrimaryButton
            label="Continue saved note"
            onPress={() => {
              if (!pendingResume) return;
              void applyResumedDraft(pendingResume.draft, pendingResume.sourceKey, pendingResume.sourceRaw);
            }}
            testID="plant-resume-continue"
          />
          <PrimaryButton
            label="Discard and start new"
            variant="secondary"
            onPress={() => {
              if (!pendingResume) return;
              const pending = pendingResume;
              void (async () => {
                if (pending.sourceKey === scopedDraftKey) {
                  await removePlantDraftIfSessionMatches(
                    storage,
                    pending.sourceKey,
                    pending.storedSessionId,
                    plantSessionId,
                  );
                } else {
                  await removeLegacyDraftIfUnchanged(storage, pending.sourceKey, pending.sourceRaw);
                }
                if (!mountedRef.current) return;
                setPendingResume(null);
                setDraft(initialContext.draft);
                setStep(initialContext.step);
                setDraftHydrated(true);
              })();
            }}
            testID="plant-resume-discard"
          />
        </View>
      </ModalCard>
      <ModalCard visible={Boolean(plantedResult)} dismissible={false} testID="plant-success-modal">
        <Animated.View style={[
          styles.successMark,
          {
            opacity: leaveReveal,
            transform: [
              { translateY: leaveReveal.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) },
              { scale: leaveReveal.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
            ],
          },
        ]}>
          <CairnStoneMark
            size={54}
            tone={plantedResult?.visibility === 'group' ? 'friends' : plantedResult?.visibility === 'public' ? 'public' : 'owner'}
          />
        </Animated.View>
        <ModalCardHeader
          title={successCopy.title}
          body={successCopy.body}
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
          {plantedResult?.fromActivity ? (
            <PrimaryButton
              label="Back to Activity"
              variant="secondary"
              onPress={() => {
                setPlantedResult(null);
                nav.goBack();
              }}
              testID="plant-success-back"
            />
          ) : null}
        </View>
      </ModalCard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1 },
  container: { flex: 1, padding: 20 },
  hydrationState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  hydrationTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  hydrationBody: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  successActions: { gap: Spacing.sm },
  successMark: { alignItems: 'center', marginBottom: Spacing.sm },
});
