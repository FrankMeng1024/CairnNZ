/**
 * cairnSpawnV2.ts — RN-side spawn flow for v0.2.5 cairn placement.
 *
 * Replaces the legacy app/src/services/unityCairnSpawn.ts (kept until Phase 7
 * for ARScreenLegacy kill switch — see ADR-007).
 *
 * Responsibilities:
 *   1. Compute the cairn's target XYZ in the assumed-relocalized AR frame
 *      from (cairn lat/lng, saved space origin lat/lng) using geoMath.ts.
 *   2. Send a spawn request over CairnBridgeV2 carrying:
 *        { type: 'v025/spawn', spaceId, cairnId, targetXyz, candidateGroundY }
 *      where candidateGroundY is the device's current GPS-derived altitude
 *      (informational; CairnSpawnerV2.cs ignores it for actual ground resolution
 *      because Tier-G plane / raycast wins; carried only for telemetry).
 *   3. Wait for one of the bridge response messages:
 *        - v025/spawn-ok        → Promise resolves with AnchorAttachKind
 *        - v025/spawn-refused   → Promise rejects with SpawnRefusedError
 *        - v025/spawn-timeout   → after 8s of no response
 *
 * Rule G algorithmic lock-step: every math op delegates to geoMath.ts so the
 * Unity C# side sees the same XYZ result for the same lat/lng inputs.
 */

import { isFlagEnabled } from './featureFlagsClient';
import { latLngToEnuMeters } from './geoMath';

export interface SpawnRequestInput {
    /** Stable identifier for the AR space (matches markers.space_id column). */
    spaceId: string;
    /** Stable cairn identifier; round-trips through the bridge for telemetry. */
    cairnId: string;
    /** The space's saved origin (where ARWorldMap was initially captured). */
    savedOriginLat: number;
    savedOriginLng: number;
    /** Where the user wants the cairn (typically device GPS at plant time). */
    cairnLat: number;
    cairnLng: number;
    /** Optional altitude diff (meters above origin); 0 if unknown. */
    cairnAltAboveOriginM?: number;
    /** GPS-derived ground altitude — informational only. */
    candidateGroundAltM?: number;
}

export interface SpawnAttemptResult {
    cairnId: string;
    /** One of the AttachOutcomeKind values from C# AnchorAttachStrategy. */
    outcomeKind:
        | 'AttachedTierS'
        | 'AttachedTierGPlane'
        | 'AttachedTierGRaycast'
        | 'AttachedTierGFeature';
    diagnostic: string;
    /** Final attach position in AR world frame (XZ horizontal, Y vertical). */
    finalXyz: { x: number; y: number; z: number };
}

export class SpawnRefusedError extends Error {
    public readonly cairnId: string;
    public readonly diagnostic: string;
    constructor(cairnId: string, diagnostic: string) {
        super(`v025 spawn refused (${cairnId}): ${diagnostic}`);
        this.cairnId = cairnId;
        this.diagnostic = diagnostic;
    }
}

export class SpawnTimeoutError extends Error {
    public readonly cairnId: string;
    constructor(cairnId: string, timeoutMs: number) {
        super(`v025 spawn timed out after ${timeoutMs}ms (${cairnId})`);
        this.cairnId = cairnId;
    }
}

/**
 * Bridge contract — concrete impl provided by Phase 2A.8 CairnBridgeV2 (RN side).
 * Decoupled here so cairnSpawnV2 can be unit-tested with a fake.
 */
export interface CairnBridgeV2Adapter {
    /** Send a structured message to Unity. */
    send(message: { type: string; [k: string]: unknown }): void;
    /** Subscribe to inbound messages. Returns an unsubscribe fn. */
    on(handler: (message: { type: string; [k: string]: unknown }) => void): () => void;
}

export const DEFAULT_SPAWN_TIMEOUT_MS = 8000;

/**
 * Build the bridge payload for a spawn attempt. Pure function — exposed for
 * unit testing (no bridge IO).
 */
export function buildSpawnRequest(input: SpawnRequestInput): {
    type: 'v025/spawn';
    spaceId: string;
    cairnId: string;
    targetXyz: { x: number; y: number; z: number };
    candidateGroundAltM: number | null;
} {
    const enu = latLngToEnuMeters(
        input.savedOriginLat,
        input.savedOriginLng,
        input.cairnLat,
        input.cairnLng
    );
    const targetXyz = {
        x: enu.east,
        y: input.cairnAltAboveOriginM ?? 0,
        z: enu.north,
    };
    return {
        type: 'v025/spawn',
        spaceId: input.spaceId,
        cairnId: input.cairnId,
        targetXyz,
        candidateGroundAltM: input.candidateGroundAltM ?? null,
    };
}

/**
 * Send the spawn request and await the response. Honors the kill switch:
 *   - useV025=false → throws immediately (caller should fall back to legacy spawn).
 */
export function spawnCairnV2(
    bridge: CairnBridgeV2Adapter,
    input: SpawnRequestInput,
    timeoutMs: number = DEFAULT_SPAWN_TIMEOUT_MS
): Promise<SpawnAttemptResult> {
    if (!isFlagEnabled('useV025')) {
        return Promise.reject(
            new Error(
                'cairnSpawnV2 invoked but useV025 flag is disabled — caller must check first or fall back to legacy spawn'
            )
        );
    }

    const request = buildSpawnRequest(input);

    return new Promise<SpawnAttemptResult>((resolve, reject) => {
        let settled = false;
        const settleOnce = (fn: () => void) => {
            if (settled) return;
            settled = true;
            fn();
        };

        const timer = setTimeout(() => {
            settleOnce(() => {
                unsubscribe();
                reject(new SpawnTimeoutError(input.cairnId, timeoutMs));
            });
        }, timeoutMs);

        const unsubscribe = bridge.on((message) => {
            // Filter by cairnId so concurrent spawns don't cross-route.
            if ((message as { cairnId?: string }).cairnId !== input.cairnId) return;

            if (message.type === 'v025/spawn-ok') {
                settleOnce(() => {
                    clearTimeout(timer);
                    unsubscribe();
                    const outcomeKind = message.outcomeKind as SpawnAttemptResult['outcomeKind'];
                    const finalXyz = message.finalXyz as SpawnAttemptResult['finalXyz'];
                    const diagnostic = (message.diagnostic as string) ?? '';
                    resolve({ cairnId: input.cairnId, outcomeKind, diagnostic, finalXyz });
                });
            } else if (message.type === 'v025/spawn-refused') {
                settleOnce(() => {
                    clearTimeout(timer);
                    unsubscribe();
                    const diagnostic = (message.diagnostic as string) ?? 'no diagnostic';
                    reject(new SpawnRefusedError(input.cairnId, diagnostic));
                });
            }
            // Ignore other message types.
        });

        bridge.send(request);
    });
}
