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
import { useMarkerStore, MarkerPermission } from '../store/useMarkerStore';
import { useAppStore } from '../store/useAppStore';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { MemoryColors, UnlockConfig } from '../features/memory/config/memoryConfig';
import { GpsLockStep } from '../features/plant/components/GpsLockStep';
import { PinAdjustStep } from '../features/plant/components/PinAdjustStep';
import { ContentStep } from '../features/plant/components/ContentStep';
import { VisibilityConfig } from '../features/plant/config/plantConfig';
import { encodeTitleBody } from '../features/plant/services/noteEncoding';

type Step = 'gps' | 'pin' | 'content';

// Re-exported for backwards compatibility — prefer importing from
// '../features/plant/services/noteEncoding' directly.
export { TITLE_BODY_SEP, encodeTitleBody } from '../features/plant/services/noteEncoding';

interface PlantDraft {
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  type: string;
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
          setDraft(parsed);
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
      setSubmitting(true);
      try {
        await addMarker({
          type: final.type,
          lat: final.lat,
          lng: final.lng,
          // Title + body encoded with U+001E so RevealedCairnSheet can
          // split unambiguously. No data loss for multiline text.
          note: encodeTitleBody(final.title, final.text),
          authorId: userId,
          permission: final.visibility,
          regionCode: '',
          gpsAgeS: 0,
          approximate: false,
          voiceMemoUri: final.voiceUri ?? undefined,
          voiceMemoDurationMs: final.voiceMs ?? undefined,
        } as any);
        // L3 fix (v0.2.6.3): use recordCircleUnlock — it bypasses the
        // 12.5m cull that recordPoint applies. Plant always clears fog
        // around the plant location regardless of recent visit history.
        recordCircleUnlock(final.lat, final.lng, UnlockConfig.radiusMeters, Date.now());
        // K3 fix: clear any previously saved draft on successful commit.
        try {
          const { storage } = await import('../store/storage');
          await storage.removeItem(draftKey(userId));
        } catch { /* best-effort */ }
        nav.goBack();
      } catch (e: any) {
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
              setDraft((d) => ({ ...d, lat, lng, accuracyM }));
              setStep('pin');
            }}
            onCancel={() => nav.goBack()}
          />
        )}
        {step === 'pin' && draft.lat != null && draft.lng != null && (
          <PinAdjustStep
            lat={draft.lat}
            lng={draft.lng}
            accuracyM={draft.accuracyM ?? 5}
            onConfirm={(lat, lng) => {
              setDraft((d) => ({ ...d, lat, lng }));
              setStep('content');
            }}
            onBack={() => setStep('gps')}
          />
        )}
        {step === 'content' && (
          <ContentStep
            initialTitle={draft.title}
            initialText={draft.text}
            initialVisibility={draft.visibility}
            submitting={submitting}
            onSubmit={onContentSubmit}
            onBack={() => setStep('pin')}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: MemoryColors.cream },
  container: { flex: 1, padding: 20 },
});
