/**
 * useArSessionStoreV2.ts — RN-side AR session lifecycle store.
 *
 * Owns the canonical sessionInstanceId for the v025 AR session — pinned at
 * session bring-up, NEVER regenerated mid-session (re-anchoring keeps the
 * same id; only a full session destroy/reopen rolls a new id).
 *
 * Mirror of C# PhaseStepTracker.SessionInstanceId semantics (Phase 1A.6).
 *
 * State machine:
 *   - 'idle': no AR session active
 *   - 'bringing-up': bridge connect in flight
 *   - 'active': sessionInstanceId locked in; cairns can spawn
 *   - 'recovering': transient ARWorldMap reload, sessionInstanceId preserved
 *   - 'tearing-down': going back to idle
 */

import { create } from 'zustand';

export type ArSessionState =
    | 'idle'
    | 'bringing-up'
    | 'active'
    | 'recovering'
    | 'tearing-down';

interface ArSessionStoreV2 {
    state: ArSessionState;
    sessionInstanceId: string | null;
    bringUpAt: number | null; // unix ms
    lastError: string | null;

    /** Begin bring-up; assigns a fresh sessionInstanceId. Idempotent if already non-idle. */
    beginBringUp: () => string;
    /** Bridge handshake complete. */
    activate: () => void;
    /** Transient recovery (e.g. ARSession lost tracking). Keeps the same id. */
    enterRecovery: (reason: string) => void;
    /** Recovery cleared — back to active. */
    exitRecovery: () => void;
    /** Full teardown — id is cleared, next bring-up gets a new one. */
    teardown: () => void;
    /** Record an error string for telemetry / UI; non-fatal. */
    recordError: (msg: string) => void;
}

function genId(): string {
    // RFC4122-ish v4. Crypto-grade not required — sessionInstanceId is for telemetry
    // grouping, not security. Avoids dependency on Node `crypto` module so RN works.
    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 10);
    const rnd2 = Math.random().toString(36).slice(2, 6);
    return `arv2-${ts}-${rnd}-${rnd2}`;
}

export const useArSessionStoreV2 = create<ArSessionStoreV2>((set, get) => ({
    state: 'idle',
    sessionInstanceId: null,
    bringUpAt: null,
    lastError: null,

    beginBringUp: () => {
        const cur = get();
        // If already past idle, return existing id — no double bring-up.
        if (cur.state !== 'idle' && cur.sessionInstanceId !== null) {
            return cur.sessionInstanceId;
        }
        const id = genId();
        set({
            state: 'bringing-up',
            sessionInstanceId: id,
            bringUpAt: Date.now(),
            lastError: null,
        });
        return id;
    },

    activate: () => {
        set((s) => (s.state === 'bringing-up' ? { ...s, state: 'active' } : s));
    },

    enterRecovery: (reason) => {
        set((s) =>
            s.state === 'active' ? { ...s, state: 'recovering', lastError: reason } : s
        );
    },

    exitRecovery: () => {
        set((s) => (s.state === 'recovering' ? { ...s, state: 'active' } : s));
    },

    teardown: () => {
        set({ state: 'tearing-down', lastError: null });
        // synchronously go back to idle (no async cleanup at the store layer)
        set({
            state: 'idle',
            sessionInstanceId: null,
            bringUpAt: null,
            lastError: null,
        });
    },

    recordError: (msg) => {
        set((s) => ({ ...s, lastError: msg }));
    },
}));
