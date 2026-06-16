/**
 * useCairnStoreV2.test.ts
 */
import { useCairnStoreV2 } from './useCairnStoreV2';

describe('useCairnStoreV2', () => {
    beforeEach(() => {
        useCairnStoreV2.getState().clear();
    });

    test('addPending records cairn with status=pending', () => {
        useCairnStoreV2.getState().addPending('c1', 40.7, -74.0);
        const e = useCairnStoreV2.getState().entries['c1'];
        expect(e.status).toBe('pending');
        expect(e.requestedLat).toBe(40.7);
        expect(e.outcomeKind).toBeNull();
        expect(e.settledAt).toBeNull();
        expect(e.requestedAt).toBeGreaterThan(0);
    });

    test('confirm moves pending → confirmed with outcome + xyz', () => {
        useCairnStoreV2.getState().addPending('c1', 40.7, -74.0);
        useCairnStoreV2.getState().confirm('c1', 'AttachedTierGPlane', { x: 1, y: 0, z: 2 }, 'plane 0 ok');
        const e = useCairnStoreV2.getState().entries['c1'];
        expect(e.status).toBe('confirmed');
        expect(e.outcomeKind).toBe('AttachedTierGPlane');
        expect(e.finalXyz).toEqual({ x: 1, y: 0, z: 2 });
        expect(e.diagnostic).toBe('plane 0 ok');
        expect(e.settledAt).not.toBeNull();
    });

    test('refuse marks status=refused with diagnostic', () => {
        useCairnStoreV2.getState().addPending('c1', 40.7, -74.0);
        useCairnStoreV2.getState().refuse('c1', 'all tiers failed');
        const e = useCairnStoreV2.getState().entries['c1'];
        expect(e.status).toBe('refused');
        expect(e.diagnostic).toBe('all tiers failed');
    });

    test('confirm on unknown id is a no-op', () => {
        useCairnStoreV2.getState().confirm('unknown', 'AttachedTierS', { x: 0, y: 0, z: 0 }, '');
        expect(useCairnStoreV2.getState().entries['unknown']).toBeUndefined();
    });

    test('listPending / listConfirmed filter correctly', () => {
        useCairnStoreV2.getState().addPending('a', 1, 1);
        useCairnStoreV2.getState().addPending('b', 2, 2);
        useCairnStoreV2.getState().addPending('c', 3, 3);
        useCairnStoreV2.getState().confirm('b', 'AttachedTierS', { x: 0, y: 0, z: 0 }, '');
        useCairnStoreV2.getState().refuse('c', 'no');

        expect(useCairnStoreV2.getState().listPending().map((e) => e.cairnId)).toEqual(['a']);
        expect(useCairnStoreV2.getState().listConfirmed().map((e) => e.cairnId)).toEqual(['b']);
        expect(useCairnStoreV2.getState().list()).toHaveLength(3);
    });

    test('clear empties entries', () => {
        useCairnStoreV2.getState().addPending('a', 1, 1);
        useCairnStoreV2.getState().clear();
        expect(useCairnStoreV2.getState().list()).toEqual([]);
    });
});
