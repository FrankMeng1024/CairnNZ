/**
 * cairnSpawnV2.test.ts — unit tests for Phase 2A.1.
 *
 * Coverage:
 *   - buildSpawnRequest pure-math correctness (uses geoMath; result XYZ matches geoMath.latLngToEnuMeters)
 *   - spawnCairnV2 promise resolution on v025/spawn-ok
 *   - spawnCairnV2 promise rejection on v025/spawn-refused
 *   - spawnCairnV2 promise rejection on timeout
 *   - cairnId routing — concurrent spawns don't cross-route
 *   - kill switch: useV025=false rejects immediately
 */

import {
    buildSpawnRequest,
    spawnCairnV2,
    DEFAULT_SPAWN_TIMEOUT_MS,
    SpawnRefusedError,
    SpawnTimeoutError,
    type CairnBridgeV2Adapter,
    type SpawnRequestInput,
} from '../cairnSpawnV2';
import { latLngToEnuMeters } from '../geoMath';

// --- featureFlagsClient mock ---
jest.mock('../featureFlagsClient', () => {
    let enabled = true;
    return {
        isFlagEnabled: (key: string) => (key === 'useV025' ? enabled : false),
        __setUseV025: (v: boolean) => {
            enabled = v;
        },
        loadFlagsCache: jest.fn(),
        refreshFlagsFromBackend: jest.fn(),
    };
});
const ffMock = jest.requireMock('../featureFlagsClient');

interface FakeBridge extends CairnBridgeV2Adapter {
    sent: Array<{ type: string; [k: string]: unknown }>;
    emit: (message: { type: string; [k: string]: unknown }) => void;
}

function makeFakeBridge(): FakeBridge {
    const handlers: Array<(m: { type: string; [k: string]: unknown }) => void> = [];
    const sent: Array<{ type: string; [k: string]: unknown }> = [];
    return {
        sent,
        send(message) {
            sent.push(message);
        },
        on(handler) {
            handlers.push(handler);
            return () => {
                const i = handlers.indexOf(handler);
                if (i >= 0) handlers.splice(i, 1);
            };
        },
        emit(message) {
            for (const h of [...handlers]) h(message);
        },
    };
}

const baseInput: SpawnRequestInput = {
    spaceId: 'space-1',
    cairnId: 'cairn-1',
    savedOriginLat: 40.7128,
    savedOriginLng: -74.0060,
    cairnLat: 40.7128,
    cairnLng: -74.0060,
};

describe('cairnSpawnV2', () => {
    beforeEach(() => {
        ffMock.__setUseV025(true);
    });

    test('buildSpawnRequest returns same XYZ as geoMath.latLngToEnuMeters', () => {
        const input: SpawnRequestInput = {
            ...baseInput,
            cairnLat: 40.7128 + 0.001, // ~111m north
            cairnLng: -74.0060 + 0.001, // ~84m east at this latitude
            cairnAltAboveOriginM: 1.5,
        };
        const expected = latLngToEnuMeters(input.savedOriginLat, input.savedOriginLng, input.cairnLat, input.cairnLng);

        const req = buildSpawnRequest(input);

        expect(req.type).toBe('v025/spawn');
        expect(req.spaceId).toBe('space-1');
        expect(req.cairnId).toBe('cairn-1');
        expect(req.targetXyz.x).toBeCloseTo(expected.east, 5);
        expect(req.targetXyz.z).toBeCloseTo(expected.north, 5);
        expect(req.targetXyz.y).toBe(1.5);
        // Round-2 #2A-1-C01: candidateGroundAltM removed from wire
        expect(req).not.toHaveProperty('candidateGroundAltM');
    });

    test('buildSpawnRequest defaults Y=0 when alt missing', () => {
        const req = buildSpawnRequest(baseInput);
        expect(req.targetXyz.y).toBe(0);
    });

    test('spawn resolves on v025/spawn-ok matching cairnId', async () => {
        const bridge = makeFakeBridge();
        const promise = spawnCairnV2(bridge, baseInput);

        // Bridge should have received the request
        expect(bridge.sent).toHaveLength(1);
        expect(bridge.sent[0].type).toBe('v025/spawn');

        bridge.emit({
            type: 'v025/spawn-ok',
            cairnId: 'cairn-1',
            outcomeKind: 'AttachedTierGPlane',
            finalXyz: { x: 1, y: 0, z: 2 },
            diagnostic: 'plane 0 accepted',
        });

        const result = await promise;
        expect(result.cairnId).toBe('cairn-1');
        expect(result.outcomeKind).toBe('AttachedTierGPlane');
        expect(result.finalXyz).toEqual({ x: 1, y: 0, z: 2 });
        expect(result.diagnostic).toBe('plane 0 accepted');
    });

    test('spawn rejects with SpawnRefusedError on v025/spawn-refused', async () => {
        const bridge = makeFakeBridge();
        const promise = spawnCairnV2(bridge, baseInput);

        bridge.emit({
            type: 'v025/spawn-refused',
            cairnId: 'cairn-1',
            diagnostic: 'all tiers failed',
        });

        await expect(promise).rejects.toBeInstanceOf(SpawnRefusedError);
        await expect(promise).rejects.toMatchObject({ cairnId: 'cairn-1', diagnostic: 'all tiers failed' });
    });

    test('spawn ignores messages for other cairnIds (concurrent spawns)', async () => {
        const bridge = makeFakeBridge();
        const promise = spawnCairnV2(bridge, baseInput, 1000);

        // emit a result for a DIFFERENT cairn — must be ignored
        bridge.emit({
            type: 'v025/spawn-ok',
            cairnId: 'cairn-other',
            outcomeKind: 'AttachedTierS',
            finalXyz: { x: 9, y: 9, z: 9 },
        });
        // then for the right cairn
        bridge.emit({
            type: 'v025/spawn-ok',
            cairnId: 'cairn-1',
            outcomeKind: 'AttachedTierS',
            finalXyz: { x: 1, y: 1, z: 1 },
        });

        const result = await promise;
        expect(result.finalXyz).toEqual({ x: 1, y: 1, z: 1 });
    });

    test('spawn rejects with SpawnTimeoutError after timeout', async () => {
        const bridge = makeFakeBridge();
        const promise = spawnCairnV2(bridge, baseInput, 50);
        await expect(promise).rejects.toBeInstanceOf(SpawnTimeoutError);
    });

    test('spawn rejects immediately when useV025 is disabled (kill switch)', async () => {
        ffMock.__setUseV025(false);
        const bridge = makeFakeBridge();
        await expect(spawnCairnV2(bridge, baseInput)).rejects.toThrow(/useV025 flag is disabled/);
        // Bridge must NOT have received any send (early reject before send).
        expect(bridge.sent).toHaveLength(0);
    });

    test('default timeout constant is 8000ms (matches plan §SPAWN_TIMEOUT)', () => {
        expect(DEFAULT_SPAWN_TIMEOUT_MS).toBe(8000);
    });
});
