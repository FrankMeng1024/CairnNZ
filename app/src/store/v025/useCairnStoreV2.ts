/**
 * useCairnStoreV2.ts — RN-side store for in-flight v025 cairn spawn attempts
 * and the resulting confirmed cairns.
 *
 * Distinct from the legacy useMarkerStore (which persists markers to backend).
 * useCairnStoreV2 is purely about the AR-session-local view of cairns:
 *   - which cairns are currently being spawned (pending)
 *   - which have confirmed (with their AnchorAttachKind from C# strategy)
 *   - which were refused (so UI can show "move to open ground" message)
 */

import { create } from 'zustand';
import type { SpawnAttemptResult } from '../../services/v025/cairnSpawnV2';

export type CairnEntryStatus = 'pending' | 'confirmed' | 'refused';

export interface CairnEntry {
    cairnId: string;
    /** Server-side marker.id once persisted; null while local-only. */
    markerId: string | null;
    /** Lat/lng requested by user. */
    requestedLat: number;
    requestedLng: number;
    /** Spawn status. */
    status: CairnEntryStatus;
    /** Final attach kind from C# AnchorAttachStrategy (null while pending). */
    outcomeKind: SpawnAttemptResult['outcomeKind'] | null;
    /** Final XYZ in AR frame (null while pending or refused). */
    finalXyz: { x: number; y: number; z: number } | null;
    /** Last diagnostic string. */
    diagnostic: string;
    /** Unix ms when pending was registered. */
    requestedAt: number;
    /** Unix ms when status moved to confirmed/refused. */
    settledAt: number | null;
}

interface CairnStoreV2 {
    entries: Record<string, CairnEntry>;

    addPending: (
        cairnId: string,
        requestedLat: number,
        requestedLng: number
    ) => void;
    confirm: (
        cairnId: string,
        outcomeKind: SpawnAttemptResult['outcomeKind'],
        finalXyz: { x: number; y: number; z: number },
        diagnostic: string
    ) => void;
    refuse: (cairnId: string, diagnostic: string) => void;
    clear: () => void;
    /** Read-only snapshot of all entries; helpers below avoid Object.values churn in selectors. */
    list: () => CairnEntry[];
    listPending: () => CairnEntry[];
    listConfirmed: () => CairnEntry[];
}

export const useCairnStoreV2 = create<CairnStoreV2>((set, get) => ({
    entries: {},

    addPending: (cairnId, requestedLat, requestedLng) => {
        set((s) => ({
            entries: {
                ...s.entries,
                [cairnId]: {
                    cairnId,
                    markerId: null,
                    requestedLat,
                    requestedLng,
                    status: 'pending',
                    outcomeKind: null,
                    finalXyz: null,
                    diagnostic: '',
                    requestedAt: Date.now(),
                    settledAt: null,
                },
            },
        }));
    },

    confirm: (cairnId, outcomeKind, finalXyz, diagnostic) => {
        set((s) => {
            const cur = s.entries[cairnId];
            if (!cur) return s;
            return {
                entries: {
                    ...s.entries,
                    [cairnId]: {
                        ...cur,
                        status: 'confirmed',
                        outcomeKind,
                        finalXyz,
                        diagnostic,
                        settledAt: Date.now(),
                    },
                },
            };
        });
    },

    refuse: (cairnId, diagnostic) => {
        set((s) => {
            const cur = s.entries[cairnId];
            if (!cur) return s;
            return {
                entries: {
                    ...s.entries,
                    [cairnId]: {
                        ...cur,
                        status: 'refused',
                        diagnostic,
                        settledAt: Date.now(),
                    },
                },
            };
        });
    },

    clear: () => {
        set({ entries: {} });
    },

    list: () => Object.values(get().entries),
    listPending: () => Object.values(get().entries).filter((e) => e.status === 'pending'),
    listConfirmed: () => Object.values(get().entries).filter((e) => e.status === 'confirmed'),
}));
