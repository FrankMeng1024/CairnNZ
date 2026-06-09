/**
 * MigratorRetryPrompt — Watches useRouteEditStore.migratorRetry and shows
 * a Retry / Skip / Report alert when migration fails.
 *
 * Mounts at app root alongside EditResumePrompt. Uses zustand subscribe
 * so it reacts the moment beginEdit sets the retry state.
 *
 * Sprint 66 Fix-5 (review v3.1 §C5 + Phase 6b retro fix).
 */
import { useEffect, useRef } from 'react';
import { Alert, Linking } from 'react-native';
import { useRouteEditStore } from './src/store/useRouteEditStore';
import { getFlagsSync } from './src/config/featureFlags';

export function MigratorRetryPrompt(): null {
  // Track last seen retry state so we only fire alert on transition.
  const lastShownErrorRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = useRouteEditStore.subscribe(state => {
      const retry = state.migratorRetry;
      if (!retry) {
        lastShownErrorRef.current = null;
        return;
      }
      // Post-merge audit (ARCH-019): defense-in-depth — refuse to surface
      // a migration alert when edit mode is disabled. beginEdit is already
      // gated, but a stale migratorRetry from a prior dev override that
      // got toggled off should not leak into production UI.
      // v4-audit (ARCH-011): use direct setState to clear the retry
      // state. Calling skipMigration() destroys legitimate retry state
      // by piggybacking on a user-visible action that sets a misleading
      // 'Migration skipped — edit disabled for this route' lastError.
      if (!getFlagsSync().editModeEnabled) {
        useRouteEditStore.setState({ migratorRetry: null });
        lastShownErrorRef.current = null;
        return;
      }
      if (retry.error === lastShownErrorRef.current) return;
      lastShownErrorRef.current = retry.error;

      const buttons: Array<{ text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }> = [
        {
          text: 'Skip',
          style: 'cancel',
          onPress: () => useRouteEditStore.getState().skipMigration(),
        },
      ];

      if (retry.retry) {
        buttons.push({
          text: 'Retry',
          onPress: () => {
            // Caller (RouteEditor) will detect cleared migratorRetry via subscribe
            // and re-issue beginEdit. We just clear the retry state here.
            useRouteEditStore.getState().retryMigration();
          },
        });
      }

      buttons.push({
        text: 'Report',
        onPress: () => {
          // Open mailto with prefilled diagnostic info. Best-effort; if no
          // mail client, just log.
          // v2-audit (ARCH-003): clear migratorRetry on BOTH success and
          // failure paths. The old code only cleared on catch, leaving
          // store.migratorRetry permanently set after a successful Report
          // — RouteEditorScreen and other subscribers would believe a
          // pending action existed forever.
          const subject = encodeURIComponent('Cairn route edit migration failed');
          const body = encodeURIComponent(
            `Error: ${retry.error}\nRetry-able: ${retry.retry}\nTime: ${new Date().toISOString()}`,
          );
          Linking.openURL(`mailto:support@cairn.app?subject=${subject}&body=${body}`)
            .catch(() => {})
            .finally(async () => {
              // v5-audit (FUNC-001): use direct setState to clear, not
              // skipMigration() which taints lastError with the misleading
              // 'edit disabled' message (mirrors the v4 ARCH-011 fix).
              useRouteEditStore.setState({ migratorRetry: null });
              // v23-audit (F-V22-B1): also discard the persisted session
              // record. Report is a terminal user choice — without
              // clearing, the next AppState 'active' would re-fire the
              // resume modal indefinitely on a route whose migration
              // permanently fails.
              try {
                const { clearSession } = await import('./src/services/EditSessionPersistence');
                const { chainSessionWrite } = await import('./src/store/useRouteEditStore');
                chainSessionWrite(() => clearSession()).catch(() => {});
              } catch {
                // ignore
              }
            });
        },
      });

      Alert.alert(
        'Migration failed',
        `Could not prepare this route for editing.\n\n${retry.error}`,
        buttons,
      );
    });
    return () => unsub();
  }, []);

  return null;
}
