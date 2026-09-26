/**
 * Process-local single-flight authority for account-changing work.
 *
 * A lease starts synchronously, before the first await, and remains active
 * through token mutation, account-cache cleanup/hydration, and the final
 * Zustand session publication. This prevents an outgoing account cleanup
 * from overlapping an incoming account installation.
 */
export type AccountTransitionKind =
  | 'cold-hydrate'
  | 'login'
  | 'verify-registration'
  | 'google-login'
  | 'apple-login'
  | 'password-reset'
  | 'restore-account'
  | 'refresh-token'
  | 'logout'
  | 'delete-account'
  | 'change-password';

export interface AccountTransitionAuthority {
  id: number;
  kind: AccountTransitionKind;
  expectedOwnerUserId: string | null;
  reconciliationKey: string | null;
}

export interface AccountTransitionStart {
  authority?: AccountTransitionAuthority;
  error?: 'transition_in_progress' | 'result_unknown';
}

let nextId = 0;
let active: AccountTransitionAuthority | null = null;
const unknownResults = new Set<string>();

function normalized(value: string | null | undefined): string | null {
  if (value == null) return null;
  const result = String(value).trim();
  return result || null;
}

export function beginAccountTransition(input: {
  kind: AccountTransitionKind;
  expectedOwnerUserId?: string | null;
  reconciliationKey?: string | null;
}): AccountTransitionStart {
  const key = normalized(input.reconciliationKey);
  if (key && unknownResults.has(key)) return { error: 'result_unknown' };
  if (active) {
    const nextOwner = normalized(input.expectedOwnerUserId);
    const canPreemptRefresh = active.kind === 'refresh-token'
      && input.kind !== 'refresh-token'
      && !!nextOwner
      && active.expectedOwnerUserId === nextOwner;
    // Refresh is a replaceable background lease. A same-owner foreground
    // account boundary must not wait behind its network request: taking the
    // new lease synchronously makes the delayed refresh fail its final CAS.
    // Different-owner or ownerless transitions remain excluded.
    if (!canPreemptRefresh) return { error: 'transition_in_progress' };
  }
  active = Object.freeze({
    id: ++nextId,
    kind: input.kind,
    expectedOwnerUserId: normalized(input.expectedOwnerUserId),
    reconciliationKey: key,
  });
  return { authority: active };
}

export function isAccountTransitionCurrent(
  authority: AccountTransitionAuthority | null | undefined,
): boolean {
  return !!authority && active?.id === authority.id;
}

/**
 * Capture a process-local account-stability epoch for work that must not run
 * across login/logout/delete/restore boundaries but does not itself own the
 * account-transition lease. `null` means a transition is already active.
 * A completed A→B→A cycle still changes the epoch, preventing ABA reuse.
 */
export function captureStableAccountEpoch(): number | null {
  return active ? null : nextId;
}

export function isStableAccountEpoch(epoch: number | null | undefined): boolean {
  return typeof epoch === 'number' && active === null && nextId === epoch;
}

export function finishAccountTransition(authority: AccountTransitionAuthority): boolean {
  if (!isAccountTransitionCurrent(authority)) return false;
  active = null;
  return true;
}

/**
 * A dispatched mutation returned an ambiguous outcome. Release the device
 * transition slot but reject an identical retry until an explicit
 * reconciliation path clears the operation key.
 */
export function markAccountTransitionResultUnknown(
  authority: AccountTransitionAuthority,
  reconciliationKey?: string,
): boolean {
  if (!isAccountTransitionCurrent(authority)) return false;
  const key = normalized(reconciliationKey) ?? authority.reconciliationKey;
  if (key) unknownResults.add(key);
  active = null;
  return true;
}

export function clearUnknownAccountTransitionResult(reconciliationKey: string): void {
  const key = normalized(reconciliationKey);
  if (key) unknownResults.delete(key);
}

export function hasUnknownAccountTransitionResult(reconciliationKey: string): boolean {
  const key = normalized(reconciliationKey);
  return !!key && unknownResults.has(key);
}

/** Test-only reset. Never called by production account flows. */
export function __resetAccountTransitionAuthorityForTests(): void {
  active = null;
  unknownResults.clear();
  nextId = 0;
}
