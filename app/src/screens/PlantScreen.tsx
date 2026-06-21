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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View, Modal, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMarkerStore, MarkerPermission } from '../store/useMarkerStore';
import { useAppStore } from '../store/useAppStore';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { MemoryColors, UnlockConfig } from '../features/memory/config/memoryConfig';
import { Icon } from '../components/Icon';
import { MARKER_TYPES, MarkerType } from '../config/markerTypes';
import { GpsLockStep } from '../features/plant/components/GpsLockStep';
import { PinAdjustStep } from '../features/plant/components/PinAdjustStep';
import { ContentStep } from '../features/plant/components/ContentStep';
import { VisibilityConfig } from '../features/plant/config/plantConfig';
import { encodeTitleBody } from '../features/plant/services/noteEncoding';
import { log } from '../services/appLog';

type Step = 'gps' | 'pin' | 'content';

// Re-exported for backwards compatibility — prefer importing from
// '../features/plant/services/noteEncoding' directly.
export { TITLE_BODY_SEP, encodeTitleBody } from '../features/plant/services/noteEncoding';

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

export function PlantScreen() {
  const nav = useNavigation<any>();
  const addMarker = useMarkerStore((s) => s.addMarker);
  const recordCircleUnlock = useMemoryStore((s) => s.recordCircleUnlock);
  const userId = useAppStore((s) => s.user?.id ?? '');
  const [step, setStep] = useState<Step>('gps');
  const [draft, setDraft] = useState<PlantDraft>(INITIAL_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  // V5: show success modal after a successful plant
  const [successType, setSuccessType] = useState<MarkerType | null>(null);
  // R-round B1 fix: hold the dismiss timer so it can be cleared on
  // unmount. Without this, an iOS suspension or fast nav.goBack causes
  // the timer to fire on a stale nav ref and pop the wrong screen.
  const successDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (successDismissTimer.current) clearTimeout(successDismissTimer.current);
  }, []);

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
        await addMarker({
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
        log('plant.commit_ok');
        recordCircleUnlock(final.lat, final.lng, UnlockConfig.radiusMeters, Date.now());
        // K3 fix: clear any previously saved draft on successful commit.
        try {
          const { storage } = await import('../store/storage');
          await storage.removeItem(draftKey(userId));
        } catch { /* best-effort */ }
        // V5: show a success modal — auto-dismisses to the home screen.
        setSubmitting(false);
        setSuccessType(final.type ?? 'cairn');
        if (successDismissTimer.current) clearTimeout(successDismissTimer.current);
        successDismissTimer.current = setTimeout(() => {
          successDismissTimer.current = null;
          if (nav.canGoBack()) nav.goBack();
        }, 1600);
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
        Alert.alert(
          'Could not plant cairn',
          (e?.message ? String(e.message) : 'Please try again in a moment.') +
          '\n\nYour draft is saved — try again or come back later.',
        );
      }
    },
    [addMarker, recordCircleUnlock, userId, nav, submitting]
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
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
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
            accuracyM={draft.accuracyM ?? 5}
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

      {/* V5: success modal — auto-dismisses to home after 1.6s. */}
      <Modal visible={successType != null} transparent animationType="fade">
        <View style={styles.successBackdrop}>
          <View style={styles.successCard}>
            <View style={[styles.successIconWrap, {
              backgroundColor: successType ? MARKER_TYPES[successType].bg : MemoryColors.cream,
            }]}>
              {successType && (
                <Icon
                  name={MARKER_TYPES[successType].icon as any}
                  size={28}
                  color={MARKER_TYPES[successType].color}
                  strokeWidth={2.2}
                />
              )}
            </View>
            <Text style={styles.successTitle}>Cairn planted</Text>
            <Text style={styles.successSub}>
              {successType ? MARKER_TYPES[successType].label : 'Cairn'} · Saved to your Memory
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: MemoryColors.cream },
  container: { flex: 1, padding: 20 },
  successBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,20,20,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  successCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    width: '85%',
    maxWidth: 320,
  },
  successIconWrap: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  successTitle: { fontSize: 17, fontWeight: '600', color: MemoryColors.sepiaDeep },
  successSub:   { fontSize: 12, color: MemoryColors.cairnPublic, marginTop: 6, textAlign: 'center' },
});
