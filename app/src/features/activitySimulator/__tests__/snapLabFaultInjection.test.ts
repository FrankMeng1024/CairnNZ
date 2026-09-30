import {
  applySnapLabDiagnosticWriteDelay,
  clearSnapLabFaultPlan,
  configureSnapLabFaultPlan,
  consumeSnapLabTerminalWalReadFault,
  snapLabFaultPlanSnapshot,
} from '../snapLabFaultInjection';

describe('Snap Lab lower-boundary fault controls', () => {
  const activityId = 'qa-snap-fault-test';

  afterEach(() => clearSnapLabFaultPlan(activityId));

  test('never accepts a production Activity identity', () => {
    expect(() => configureSnapLabFaultPlan('production-activity', {}))
      .toThrow('snap_lab_fault_identity_required');
  });

  test('consumes only the configured terminal WAL read failure', () => {
    configureSnapLabFaultPlan(activityId, { terminalWalReadFaultsRemaining: 1 });
    expect(consumeSnapLabTerminalWalReadFault(activityId)).toBe(true);
    expect(consumeSnapLabTerminalWalReadFault(activityId)).toBe(false);
  });

  test('slows a bounded number of real diagnostic storage writes', async () => {
    configureSnapLabFaultPlan(activityId, {
      diagnosticWriteDelayMs: 5,
      diagnosticWritesRemaining: 2,
    });
    expect(await applySnapLabDiagnosticWriteDelay(activityId)).toBe(true);
    expect(await applySnapLabDiagnosticWriteDelay(activityId)).toBe(true);
    expect(await applySnapLabDiagnosticWriteDelay(activityId)).toBe(false);
    expect(snapLabFaultPlanSnapshot(activityId)?.diagnosticWritesRemaining).toBe(0);
  });
});
