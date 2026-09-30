/**
 * Scoped failure controls for Snap Lab only. These hooks sit below the real
 * diagnostic writer and terminal WAL reader so acceptance can exercise actual
 * storage boundaries without patching high-level success values. Production
 * Activity ids can never enter this table.
 */

interface SnapLabFaultPlan {
  diagnosticWriteDelayMs: number;
  diagnosticWritesRemaining: number;
  terminalWalReadFaultsRemaining: number;
}

const plans = new Map<string, SnapLabFaultPlan>();

function assertQaIdentity(activityId: string): void {
  if (!activityId.startsWith('qa-snap-')) throw new Error('snap_lab_fault_identity_required');
}

export function configureSnapLabFaultPlan(activityId: string, input: Partial<SnapLabFaultPlan>): void {
  assertQaIdentity(activityId);
  plans.set(activityId, {
    diagnosticWriteDelayMs: Math.max(0, Math.min(2_000, Math.floor(input.diagnosticWriteDelayMs ?? 0))),
    diagnosticWritesRemaining: Math.max(0, Math.min(16, Math.floor(input.diagnosticWritesRemaining ?? 0))),
    terminalWalReadFaultsRemaining: Math.max(0, Math.min(2, Math.floor(input.terminalWalReadFaultsRemaining ?? 0))),
  });
}

export function clearSnapLabFaultPlan(activityId: string): void {
  if (activityId.startsWith('qa-snap-')) plans.delete(activityId);
}

export async function applySnapLabDiagnosticWriteDelay(activityId: string): Promise<boolean> {
  if (!activityId.startsWith('qa-snap-')) return false;
  const plan = plans.get(activityId);
  if (!plan || plan.diagnosticWritesRemaining <= 0 || plan.diagnosticWriteDelayMs <= 0) return false;
  plan.diagnosticWritesRemaining -= 1;
  await new Promise<void>(resolve => setTimeout(resolve, plan.diagnosticWriteDelayMs));
  return true;
}

export function consumeSnapLabTerminalWalReadFault(activityId: string): boolean {
  if (!activityId.startsWith('qa-snap-')) return false;
  const plan = plans.get(activityId);
  if (!plan || plan.terminalWalReadFaultsRemaining <= 0) return false;
  plan.terminalWalReadFaultsRemaining -= 1;
  return true;
}

export function snapLabFaultPlanSnapshot(activityId: string): SnapLabFaultPlan | null {
  const plan = plans.get(activityId);
  return plan ? { ...plan } : null;
}
