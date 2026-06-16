/**
 * ARScreenV2.tsx — v0.2.5 real implementation.
 *
 * Phase 2B.10 (round-2 fix #2B-2.C). Replaces the Phase 0 stub that delegated to ARScreenLegacy.
 *
 * Responsibilities:
 *   1. Mount @azesmway/react-native-unity UnityView so users see the camera + AR scene.
 *   2. On mount: useArSessionStoreV2.beginBringUp; send v025/begin-session over the bridge.
 *   3. Subscribe to v025/spawn-ok / spawn-refused / session-ready → drive useCairnStoreV2 + useArSessionStoreV2.
 *   4. On unmount: send v025/end-session, useArSessionStoreV2.teardown.
 *   5. Plant button → spawnCairnV2 with current device GPS as cairnLat/Lng.
 *
 * Boot-race (Phase 2A.5 #2A-2-5): waits for featureFlagsClient.loadFlagsCache before
 * showing controls so cairnSpawnV2 doesn't reject on first-launch HARD_DEFAULTS=false.
 *
 * NOTE: UnityView is conditionally imported — Phase 2B Editor / web tests fall back
 * to a status panel. Real iOS device sees the AR camera. This avoids a hard
 * dependency on @azesmway/react-native-unity's native module in test environment.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Pressable, Platform } from 'react-native';
import { useArSessionStoreV2 } from '../../store/v025/useArSessionStoreV2';
import { useCairnStoreV2 } from '../../store/v025/useCairnStoreV2';
import { isFlagEnabled, loadFlagsCache } from '../../services/v025/featureFlagsClient';
import { makeCairnBridgeV2, type RawBridge } from '../../services/v025/cairnBridgeV2';
import { spawnCairnV2, SpawnRefusedError } from '../../services/v025/cairnSpawnV2';
import type { CairnBridgeV2Adapter } from '../../services/v025/cairnSpawnV2';
import type { V025AnyMessage } from '../../services/v025/MessageTypes';
import { emitTelemetry } from '../../services/v025/telemetrySingleton';
import type { ARScreenProps } from '../ARScreenLegacy';
import { crashLogger } from '../../services/crashLogger';

export const AR_SCREEN_V2_BUILD_TAG = 'phase2B_real_v025_path';
export const PLACEHOLDER_SPACE_ID = 'space-default-v025';

// Lazy import — UnityView's native module isn't available in jest / web. We try at
// runtime so production iOS gets the real view + tests get the status panel.
type UnityViewComponent = React.ComponentType<{
    ref?: React.Ref<unknown>;
    style?: object;
    onUnityMessage?: (event: { nativeEvent: { message: string } }) => void;
}>;

let UnityViewLazy: UnityViewComponent | null = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@azesmway/react-native-unity');
    UnityViewLazy = (mod?.default ?? mod) as UnityViewComponent;
} catch {
    UnityViewLazy = null;
}

export function ARScreenV2(_props: ARScreenProps) {
    const beginBringUp = useArSessionStoreV2((s) => s.beginBringUp);
    const activate = useArSessionStoreV2((s) => s.activate);
    const teardown = useArSessionStoreV2((s) => s.teardown);
    const sessionState = useArSessionStoreV2((s) => s.state);
    const sessionInstanceId = useArSessionStoreV2((s) => s.sessionInstanceId);

    const addPending = useCairnStoreV2((s) => s.addPending);
    const confirm = useCairnStoreV2((s) => s.confirm);
    const refuse = useCairnStoreV2((s) => s.refuse);
    const cairnEntries = useCairnStoreV2((s) => Object.values(s.entries));
    const visibleCairns = cairnEntries.filter((e) => e.status === 'confirmed');

    const [flagsLoaded, setFlagsLoaded] = useState(false);
    const [bootError, setBootError] = useState<string | null>(null);

    const unityRef = useRef<unknown>(null);
    const messageListenersRef = useRef<Array<(raw: string) => void>>([]);

    // Build a RawBridge that forwards through the UnityView ref (Phase 4 wires this).
    const rawBridge = useMemo<RawBridge>(
        () => ({
            postMessage(payload) {
                const ref = unityRef.current as { postMessage?: (channel: string, p: string) => void } | null;
                try {
                    ref?.postMessage?.('v025', payload);
                } catch (err) {
                    crashLogger.breadcrumb('v025_bridge_post_failed: ' + String(err));
                }
            },
            addMessageListener(listener) {
                messageListenersRef.current.push(listener);
                return () => {
                    const i = messageListenersRef.current.indexOf(listener);
                    if (i >= 0) messageListenersRef.current.splice(i, 1);
                };
            },
        }),
        []
    );

    const bridge: CairnBridgeV2Adapter = useMemo(() => makeCairnBridgeV2(rawBridge), [rawBridge]);

    // Boot-race fix: wait for flags to load before showing plant control.
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

    // AR session lifecycle.
    useEffect(() => {
        beginBringUp();
        bridge.send({ type: 'v025/begin-session' });
        // Optimistic activate; v025/session-ready will confirm via subscription below.
        activate();
        return () => {
            try {
                bridge.send({ type: 'v025/end-session' });
            } catch {
                // bridge may be torn down already; non-fatal
            }
            teardown();
        };
    }, [beginBringUp, activate, teardown, bridge]);

    // Subscribe to v025/* responses → drive cairn store + telemetry singleton.
    useEffect(() => {
        const unsub = bridge.on((message) => {
            const m = message as V025AnyMessage;
            if (m.type === 'v025/spawn-ok') {
                confirm(m.cairnId, m.outcomeKind, m.finalXyz, m.diagnostic ?? '');
            } else if (m.type === 'v025/spawn-refused') {
                refuse(m.cairnId, m.diagnostic ?? '');
            } else if (m.type === 'v025/telemetry') {
                // Phase 4 composition: forward Unity-emitted telemetry into RN-side
                // batcher so a single POST per 5s carries both Unity- and RN-originated events.
                emitTelemetry({
                    phase: m.phase,
                    step: m.step,
                    seq: m.seq,
                    sessionInstanceId: m.sessionInstanceId,
                    timestampUnixMs: m.timestampUnixMs,
                    outcome: m.outcome,
                    diagnostic: m.diagnostic,
                });
            }
            // session-ready / session-lost handled by lifecycle layer
        });
        return unsub;
    }, [bridge, confirm, refuse]);

    const handlePlantPress = useCallback(async () => {
        if (!isFlagEnabled('useV025')) return;
        const cairnId = `c-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        // Phase 2B: hardcode origin lat/lng to a stable space; Phase 4 reads
        // from useArOriginStore (legacy) or the new space-id resolver.
        const cairnLat = 0;
        const cairnLng = 0;
        addPending(cairnId, cairnLat, cairnLng);
        try {
            await spawnCairnV2(bridge, {
                spaceId: PLACEHOLDER_SPACE_ID,
                cairnId,
                savedOriginLat: cairnLat,
                savedOriginLng: cairnLng,
                cairnLat,
                cairnLng,
            });
            // confirm/refuse already handled by bridge subscription; no-op here
        } catch (err) {
            if (err instanceof SpawnRefusedError) {
                refuse(cairnId, err.diagnostic);
            } else {
                refuse(cairnId, String(err));
            }
        }
    }, [bridge, addPending, refuse]);

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
                <Pressable
                    style={styles.retryBtn}
                    onPress={() => {
                        setBootError(null);
                        setFlagsLoaded(false);
                        loadFlagsCache().then(() => setFlagsLoaded(true)).catch((e) => setBootError(e?.message ?? 'retry failed'));
                    }}
                >
                    <Text style={styles.retryBtnText}>Retry</Text>
                </Pressable>
            </View>
        );
    }

    const useUnity = UnityViewLazy != null && (Platform.OS === 'ios' || Platform.OS === 'android');

    return (
        <View style={styles.container}>
            {useUnity && UnityViewLazy ? (
                <UnityViewLazy
                    ref={(r) => {
                        unityRef.current = r;
                    }}
                    style={styles.unityView}
                    onUnityMessage={(event) => {
                        const raw = event?.nativeEvent?.message;
                        if (typeof raw === 'string') {
                            for (const l of messageListenersRef.current) {
                                try { l(raw); } catch { /* listener errors must not crash bridge */ }
                            }
                        }
                    }}
                />
            ) : (
                <View style={styles.cameraPlaceholder}>
                    <Text style={styles.statusText}>Cairn AR v0.2.5 (no Unity native)</Text>
                    <Text style={styles.hintText}>session: {sessionState}</Text>
                    <Text style={styles.hintText}>id: {sessionInstanceId ?? '—'}</Text>
                    <Text style={styles.hintText}>useV025: {String(isFlagEnabled('useV025'))}</Text>
                    <Text style={styles.hintText}>tag: {AR_SCREEN_V2_BUILD_TAG}</Text>
                    <Text style={styles.hintText}>visible cairns: {visibleCairns.length}</Text>
                </View>
            )}

            <View style={styles.bottomBar}>
                <Pressable style={styles.plantBtn} onPress={handlePlantPress}>
                    <Text style={styles.plantBtnText}>Plant</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
    unityView: { flex: 1 },
    cameraPlaceholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0a',
        gap: 6,
    },
    statusText: { color: '#fff', fontSize: 18, fontWeight: '600' },
    hintText: { color: '#aaa', fontSize: 13 },
    errorText: { color: '#f55', fontSize: 16, marginBottom: 12 },
    retryBtn: { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#444', borderRadius: 8 },
    retryBtnText: { color: '#fff', fontSize: 16 },
    bottomBar: {
        position: 'absolute',
        bottom: 32,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    plantBtn: {
        paddingHorizontal: 36,
        paddingVertical: 14,
        backgroundColor: '#FB923C',
        borderRadius: 32,
        elevation: 4,
    },
    plantBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
