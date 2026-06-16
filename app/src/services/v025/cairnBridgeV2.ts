/**
 * cairnBridgeV2.ts — RN-side adapter wrapping the existing @azesmway/react-native-unity bridge.
 *
 * v0.2.5 Phase 2A.8.
 *
 * Two bridge modes:
 *   - production: real react-native-unity message channel
 *   - test/mock:  in-memory bridge for unit tests (cairnSpawnV2.test.ts uses this pattern)
 *
 * The CairnBridgeV2Adapter interface is what cairnSpawnV2 consumes; this file
 * provides the production implementation. Tests inject their own fake.
 *
 * NOTE: this file does NOT import @azesmway/react-native-unity directly — it
 * receives a thin "raw bridge" handle from the caller. This keeps unit tests
 * runnable without the native module + lets ARScreenLegacy keep the legacy
 * bridge wiring untouched (Phase 7 unifies).
 */

import type { CairnBridgeV2Adapter } from './cairnSpawnV2';
import type {
    V025AnyMessage,
    V025RequestMessage,
    V025ResponseMessage,
} from './MessageTypes';

/**
 * Minimal contract the underlying transport must satisfy.
 * @azesmway/react-native-unity exposes a UnityView ref with postMessage / onUnityMessage.
 * Test transports can mock this same shape.
 */
export interface RawBridge {
    postMessage(payload: string): void;
    addMessageListener(listener: (raw: string) => void): () => void;
}

export function makeCairnBridgeV2(raw: RawBridge): CairnBridgeV2Adapter {
    return {
        send(message) {
            try {
                raw.postMessage(JSON.stringify(message as V025RequestMessage));
            } catch (err) {
                // Serialisation failure shouldn't blow up the spawn flow. Log + drop.
                // (Phase 3 telemetry will pick this up via crashLogger.)
                // eslint-disable-next-line no-console
                console.warn('[v025/bridge] send serialize failed', err);
            }
        },
        on(handler) {
            return raw.addMessageListener((rawMessage) => {
                let parsed: V025AnyMessage | null = null;
                try {
                    parsed = JSON.parse(rawMessage) as V025AnyMessage;
                } catch {
                    return;
                }
                if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
                    return;
                }
                // Only forward v025/ responses to the handler. Legacy bridge messages
                // (which travel on the same RN ↔ Unity channel for ARScreenLegacy)
                // are ignored here.
                if (!(parsed as { type: string }).type.startsWith('v025/')) return;
                handler(parsed as V025ResponseMessage);
            });
        },
    };
}
