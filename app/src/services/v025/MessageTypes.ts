/**
 * MessageTypes.ts — v025 RN ↔ Unity bridge message contract.
 *
 * Mirrors UnityARLib/Assets/Scripts/v025/Bridge/CairnBridgeV2.cs (Phase 2A.8 C# side).
 *
 * Wire format: JSON-encoded objects with a discriminator `type` field.
 * Every request from RN to Unity carries a cairnId; every response from Unity
 * to RN echoes the same cairnId so concurrent spawns don't cross-route.
 *
 * Design constraints (from Phase 1A 4-eye review concerns_for_phase_2A):
 *   - sessionInstanceId echoed by Unity in every event payload (Rule H)
 *   - phase/step/seq propagated for telemetry attribution
 */

// ───────────────────────────────────────────────────────────────
// RN → Unity (requests)
// ───────────────────────────────────────────────────────────────

export interface SpawnRequest {
    type: 'v025/spawn';
    spaceId: string;
    cairnId: string;
    targetXyz: { x: number; y: number; z: number };
}

export interface SaveSpaceRequest {
    type: 'v025/save-space';
    spaceId: string;
}

export interface BeginSessionRequest {
    type: 'v025/begin-session';
    sessionInstanceId: string;
}

export interface EndSessionRequest {
    type: 'v025/end-session';
}

export type V025RequestMessage =
    | SpawnRequest
    | SaveSpaceRequest
    | BeginSessionRequest
    | EndSessionRequest;

// ───────────────────────────────────────────────────────────────
// Unity → RN (responses + events)
// ───────────────────────────────────────────────────────────────

export interface SpawnOk {
    type: 'v025/spawn-ok';
    cairnId: string;
    outcomeKind:
        | 'AttachedTierS'
        | 'AttachedTierGPlane'
        | 'AttachedTierGRaycast'
        | 'AttachedTierGFeature';
    finalXyz: { x: number; y: number; z: number };
    diagnostic: string;
}

export interface SpawnRefused {
    type: 'v025/spawn-refused';
    cairnId: string;
    diagnostic: string;
}

export interface SaveSpaceOk {
    type: 'v025/save-space-ok';
    spaceId: string;
}

export interface SaveSpaceFailed {
    type: 'v025/save-space-failed';
    spaceId: string;
    outcome: string; // PersistenceOutcome enum string
    diagnostic: string;
}

export interface SessionReady {
    type: 'v025/session-ready';
    sessionInstanceId: string;
}

export interface SessionLost {
    type: 'v025/session-lost';
    sessionInstanceId: string;
    reason: string;
}

export interface TelemetryEvent {
    type: 'v025/telemetry';
    phase: string;
    step: string;
    seq: number;
    sessionInstanceId: string;
    timestampUnixMs: number;
    outcome: string;
    diagnostic: string;
}

export type V025ResponseMessage =
    | SpawnOk
    | SpawnRefused
    | SaveSpaceOk
    | SaveSpaceFailed
    | SessionReady
    | SessionLost
    | TelemetryEvent;

export type V025AnyMessage = V025RequestMessage | V025ResponseMessage;
