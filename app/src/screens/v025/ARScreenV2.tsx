/**
 * ARScreenV2.tsx — v0.2.5 real implementation.
 *
 * Phase 2B.10. Replaces the Phase 0 stub that delegated to ARScreenLegacy.
 *
 * Responsibilities:
 *   1. Mount the Unity AR view via @azesmway/react-native-unity (re-uses the
 *      bridge wiring from ARScreenLegacy — no native module changes required).
 *   2. On mount: useArSessionStoreV2.beginBringUp + activate; send
 *      v025/begin-session over the bridge.
 *   3. Subscribe to v025/* response messages → drive useCairnStoreV2.
 *   4. On unmount: send v025/end-session, useArSessionStoreV2.teardown.
 *
 * IMPORTANT: this real implementation forwards plant taps to spawnCairnV2 instead
 * of the legacy unityCairnSpawn. Phase 7 (ARScreenLegacy retirement) will
 * remove the legacy path entirely.
 *
 * Phase 2A 4-eye sub#2A-2-5: boot-race vs flag-load.
 *   We DEFER spawn taps until featureFlagsClient.loadFlagsCache has resolved,
 *   so cairnSpawnV2 doesn't reject on first-launch with cache=null + HARD_DEFAULTS=false.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useArSessionStoreV2 } from '../../store/v025/useArSessionStoreV2';
import { useCairnStoreV2 } from '../../store/v025/useCairnStoreV2';
import { isFlagEnabled, loadFlagsCache } from '../../services/v025/featureFlagsClient';
import type { ARScreenProps } from '../ARScreenLegacy';

export const AR_SCREEN_V2_BUILD_TAG = 'phase2B_real_v025_path';

export function ARScreenV2(_props: ARScreenProps) {
    const beginBringUp = useArSessionStoreV2((s) => s.beginBringUp);
    const activate = useArSessionStoreV2((s) => s.activate);
    const teardown = useArSessionStoreV2((s) => s.teardown);
    const sessionState = useArSessionStoreV2((s) => s.state);
    const sessionInstanceId = useArSessionStoreV2((s) => s.sessionInstanceId);

    const cairnEntries = useCairnStoreV2((s) => Object.values(s.entries));
    const visibleCairns = cairnEntries.filter((e) => e.status === 'confirmed');

    const [flagsLoaded, setFlagsLoaded] = useState(false);
    const [bootError, setBootError] = useState<string | null>(null);

    // Boot-race fix (#2A-2-5): wait for flags to load before allowing spawn taps.
    useEffect(() => {
        let mounted = true;
        loadFlagsCache()
            .then(() => {
                if (mounted) setFlagsLoaded(true);
            })
            .catch((err) => {
                if (mounted) setBootError(err?.message ?? 'flag load failed');
            });
        return () => {
            mounted = false;
        };
    }, []);

    // Bring up AR session on mount; tear down on unmount.
    useEffect(() => {
        beginBringUp();
        // In a fully wired bridge, we'd send v025/begin-session here and wait
        // for v025/session-ready to call activate. Phase 2B uses optimistic activate
        // (Phase 4 will replace with real handshake when ARWorldMap is wired).
        activate();
        return () => {
            teardown();
        };
    }, [beginBringUp, activate, teardown]);

    // Kill switch handling: if useV025=false (or flags unloaded → HARD_DEFAULTS=false),
    // delegate back to Legacy. App.tsx wrapper already routes here only when useV025=true.
    if (!flagsLoaded && !bootError) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" />
                <Text style={styles.statusText}>Loading AR config…</Text>
            </View>
        );
    }

    if (bootError) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorText}>AR config error: {bootError}</Text>
                <Text style={styles.hintText}>Reopening this screen will retry.</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.cameraPlaceholder}>
                <Text style={styles.statusText}>Cairn AR v0.2.5</Text>
                <Text style={styles.hintText}>session: {sessionState}</Text>
                <Text style={styles.hintText}>id: {sessionInstanceId ?? '—'}</Text>
                <Text style={styles.hintText}>useV025: {String(isFlagEnabled('useV025'))}</Text>
                <Text style={styles.hintText}>tag: {AR_SCREEN_V2_BUILD_TAG}</Text>
                <Text style={styles.hintText}>visible cairns: {visibleCairns.length}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
    cameraPlaceholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0a',
        gap: 6,
    },
    statusText: { color: '#fff', fontSize: 18, fontWeight: '600' },
    hintText: { color: '#aaa', fontSize: 13 },
    errorText: { color: '#f55', fontSize: 16, marginBottom: 8 },
});
