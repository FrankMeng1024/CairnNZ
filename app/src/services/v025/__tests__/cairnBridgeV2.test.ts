/**
 * cairnBridgeV2.test.ts — adapter wraps RawBridge correctly.
 */
import { makeCairnBridgeV2, type RawBridge } from '../cairnBridgeV2';

function makeFakeRaw(): RawBridge & { sent: string[]; emit: (s: string) => void } {
    const listeners: Array<(s: string) => void> = [];
    const sent: string[] = [];
    return {
        sent,
        postMessage(p) {
            sent.push(p);
        },
        addMessageListener(l) {
            listeners.push(l);
            return () => {
                const i = listeners.indexOf(l);
                if (i >= 0) listeners.splice(i, 1);
            };
        },
        emit(s: string) {
            for (const l of [...listeners]) l(s);
        },
    };
}

describe('cairnBridgeV2', () => {
    test('send serializes message to JSON via raw.postMessage', () => {
        const raw = makeFakeRaw();
        const bridge = makeCairnBridgeV2(raw);
        bridge.send({ type: 'v025/spawn', cairnId: 'c1', spaceId: 's1', targetXyz: { x: 1, y: 2, z: 3 } });
        expect(raw.sent).toHaveLength(1);
        const parsed = JSON.parse(raw.sent[0]);
        expect(parsed.type).toBe('v025/spawn');
        expect(parsed.cairnId).toBe('c1');
    });

    test('on parses inbound JSON and forwards v025/ messages only', () => {
        const raw = makeFakeRaw();
        const bridge = makeCairnBridgeV2(raw);
        const received: Array<{ type: string }> = [];
        const unsub = bridge.on((m) => received.push(m as { type: string }));

        // Valid v025 message — forwarded
        raw.emit(JSON.stringify({ type: 'v025/spawn-ok', cairnId: 'c1' }));
        // Legacy non-v025 message — IGNORED
        raw.emit(JSON.stringify({ type: 'legacy/event', payload: 'x' }));
        // Garbage — IGNORED, must not throw
        raw.emit('not-json');
        // Wrong shape — IGNORED
        raw.emit(JSON.stringify({ noTypeField: true }));

        expect(received).toHaveLength(1);
        expect(received[0].type).toBe('v025/spawn-ok');

        unsub();
    });

    test('unsubscribe stops further forwarding', () => {
        const raw = makeFakeRaw();
        const bridge = makeCairnBridgeV2(raw);
        const received: Array<{ type: string }> = [];
        const unsub = bridge.on((m) => received.push(m as { type: string }));
        raw.emit(JSON.stringify({ type: 'v025/spawn-ok', cairnId: 'c1' }));
        unsub();
        raw.emit(JSON.stringify({ type: 'v025/spawn-ok', cairnId: 'c2' }));
        expect(received).toHaveLength(1);
    });
});
