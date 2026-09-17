import {
  createRouteEditorSaveCoordinator,
  executeRouteEditorLeaveChoice,
  routeEditorLeaveDecision,
} from '../routeEditorSaveCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('Route editor save and leave coordination', () => {
  test('unsaved Back supports Stay and deliberate Discard decisions', () => {
    expect(routeEditorLeaveDecision({
      allowLeave: false,
      hasUnsavedChanges: true,
      saving: false,
    })).toBe('confirm-discard');
    expect(routeEditorLeaveDecision({
      allowLeave: true,
      hasUnsavedChanges: true,
      saving: false,
    })).toBe('allow');

    const actions = {
      discardDraft: jest.fn(),
      suppressLateNavigation: jest.fn(),
      allowAndDispatch: jest.fn(),
    };
    executeRouteEditorLeaveChoice('confirm-discard', 'stay', actions);
    expect(actions.discardDraft).not.toHaveBeenCalled();
    expect(actions.allowAndDispatch).not.toHaveBeenCalled();
    executeRouteEditorLeaveChoice('confirm-discard', 'discard', actions);
    expect(actions.discardDraft).toHaveBeenCalledTimes(1);
    expect(actions.allowAndDispatch).toHaveBeenCalledTimes(1);
  });

  test('Back during Save is intercepted and leaving suppresses late navigation', async () => {
    const operation = deferred<void>();
    const coordinator = createRouteEditorSaveCoordinator();
    const token = coordinator.begin('route-a');
    expect(token).not.toBeNull();
    expect(routeEditorLeaveDecision({
      allowLeave: false,
      hasUnsavedChanges: true,
      saving: coordinator.isSaving(),
    })).toBe('confirm-saving');

    coordinator.suppressLateNavigation();
    operation.resolve();
    await operation.promise;
    expect(coordinator.claimNavigation(token!, 'route-a')).toBe(false);
    coordinator.finish(token!);
    expect(coordinator.isSaving()).toBe(false);
  });

  test('the save-in-flight Leave handler suppresses navigation and dispatches once', () => {
    const actions = {
      discardDraft: jest.fn(),
      suppressLateNavigation: jest.fn(),
      allowAndDispatch: jest.fn(),
    };
    executeRouteEditorLeaveChoice('confirm-saving', 'leave-saving', actions);
    expect(actions.discardDraft).not.toHaveBeenCalled();
    expect(actions.suppressLateNavigation).toHaveBeenCalledTimes(1);
    expect(actions.allowAndDispatch).toHaveBeenCalledTimes(1);
  });

  test('repeated Save cannot start a parallel transaction', () => {
    const coordinator = createRouteEditorSaveCoordinator();
    const first = coordinator.begin('route-a');
    expect(first).not.toBeNull();
    expect(coordinator.begin('route-a')).toBeNull();
    coordinator.finish(first!);
    expect(coordinator.begin('route-a')).not.toBeNull();
  });

  test('success claims exactly one intended navigation', () => {
    const coordinator = createRouteEditorSaveCoordinator();
    const token = coordinator.begin('route-a')!;
    expect(coordinator.claimNavigation(token, 'route-a')).toBe(true);
    expect(coordinator.claimNavigation(token, 'route-a')).toBe(false);
    coordinator.finish(token);
  });

  test('account/object change blocks a delayed response from navigating', () => {
    const coordinator = createRouteEditorSaveCoordinator();
    const token = coordinator.begin('owner-a:route-a')!;
    expect(coordinator.claimNavigation(token, 'owner-b:route-a')).toBe(false);
    coordinator.finish(token);
  });

  test('failed/timeout operation releases the gate for a real retry', () => {
    const coordinator = createRouteEditorSaveCoordinator();
    const failed = coordinator.begin('route-a')!;
    coordinator.finish(failed);
    const retry = coordinator.begin('route-a');
    expect(retry).not.toBeNull();
    expect(retry?.sequence).toBeGreaterThan(failed.sequence);
  });
});
