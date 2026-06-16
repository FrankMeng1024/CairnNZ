/**
 * useArSessionStoreV2.test.ts — state machine tests.
 */
import { useArSessionStoreV2 } from './useArSessionStoreV2';

describe('useArSessionStoreV2', () => {
    beforeEach(() => {
        useArSessionStoreV2.getState().teardown();
    });

    test('initial state is idle with no sessionInstanceId', () => {
        const s = useArSessionStoreV2.getState();
        expect(s.state).toBe('idle');
        expect(s.sessionInstanceId).toBeNull();
    });

    test('beginBringUp issues a fresh sessionInstanceId and moves to bringing-up', () => {
        const id = useArSessionStoreV2.getState().beginBringUp();
        expect(id).toMatch(/^arv2-/);
        const s = useArSessionStoreV2.getState();
        expect(s.state).toBe('bringing-up');
        expect(s.sessionInstanceId).toBe(id);
    });

    test('beginBringUp is idempotent — re-call returns same id', () => {
        const id1 = useArSessionStoreV2.getState().beginBringUp();
        const id2 = useArSessionStoreV2.getState().beginBringUp();
        expect(id2).toBe(id1);
    });

    test('activate moves bringing-up → active without changing id', () => {
        const id = useArSessionStoreV2.getState().beginBringUp();
        useArSessionStoreV2.getState().activate();
        const s = useArSessionStoreV2.getState();
        expect(s.state).toBe('active');
        expect(s.sessionInstanceId).toBe(id);
    });

    test('enterRecovery PRESERVES sessionInstanceId (Phase 1A.6 contract)', () => {
        const id = useArSessionStoreV2.getState().beginBringUp();
        useArSessionStoreV2.getState().activate();
        useArSessionStoreV2.getState().enterRecovery('tracking lost');
        const s = useArSessionStoreV2.getState();
        expect(s.state).toBe('recovering');
        expect(s.sessionInstanceId).toBe(id);
        expect(s.lastError).toBe('tracking lost');
    });

    test('exitRecovery returns to active without rotating id', () => {
        const id = useArSessionStoreV2.getState().beginBringUp();
        useArSessionStoreV2.getState().activate();
        useArSessionStoreV2.getState().enterRecovery('lost');
        useArSessionStoreV2.getState().exitRecovery();
        const s = useArSessionStoreV2.getState();
        expect(s.state).toBe('active');
        expect(s.sessionInstanceId).toBe(id);
    });

    test('teardown clears sessionInstanceId — next bring-up gets new id', () => {
        const id1 = useArSessionStoreV2.getState().beginBringUp();
        useArSessionStoreV2.getState().activate();
        useArSessionStoreV2.getState().teardown();

        const after = useArSessionStoreV2.getState();
        expect(after.state).toBe('idle');
        expect(after.sessionInstanceId).toBeNull();

        const id2 = useArSessionStoreV2.getState().beginBringUp();
        expect(id2).not.toBe(id1);
    });

    test('activate from idle is a no-op (only valid from bringing-up)', () => {
        useArSessionStoreV2.getState().activate();
        expect(useArSessionStoreV2.getState().state).toBe('idle');
    });

    test('enterRecovery from idle is a no-op', () => {
        useArSessionStoreV2.getState().enterRecovery('x');
        expect(useArSessionStoreV2.getState().state).toBe('idle');
    });
});
