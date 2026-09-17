export type RouteEditorLeaveDecision = 'allow' | 'confirm-discard' | 'confirm-saving';
export type RouteEditorLeaveChoice = 'stay' | 'discard' | 'leave-saving';

export function routeEditorLeaveDecision(args: {
  allowLeave: boolean;
  hasUnsavedChanges: boolean;
  saving: boolean;
}): RouteEditorLeaveDecision {
  if (args.allowLeave || !args.hasUnsavedChanges) return 'allow';
  return args.saving ? 'confirm-saving' : 'confirm-discard';
}

export function executeRouteEditorLeaveChoice(
  decision: RouteEditorLeaveDecision,
  choice: RouteEditorLeaveChoice,
  actions: {
    discardDraft: () => void;
    suppressLateNavigation: () => void;
    allowAndDispatch: () => void;
  },
): void {
  if (choice === 'stay') return;
  if (decision === 'confirm-discard' && choice === 'discard') {
    actions.discardDraft();
    actions.allowAndDispatch();
    return;
  }
  if (decision === 'confirm-saving' && choice === 'leave-saving') {
    actions.suppressLateNavigation();
    actions.allowAndDispatch();
  }
}

export interface RouteSaveToken {
  sequence: number;
  objectKey: string;
}

/**
 * Keeps save completion and navigation ordered without treating request abort
 * as proof that the server did not commit. The screen owns the durable draft;
 * this coordinator only suppresses duplicate work and unsolicited late nav.
 */
export function createRouteEditorSaveCoordinator() {
  let sequence = 0;
  let active: RouteSaveToken | null = null;
  let navigationSuppressed = false;
  let navigationClaimed = false;

  return {
    begin(objectKey: string): RouteSaveToken | null {
      if (active) return null;
      active = { sequence: ++sequence, objectKey };
      navigationSuppressed = false;
      navigationClaimed = false;
      return active;
    },

    suppressLateNavigation(): void {
      navigationSuppressed = true;
    },

    claimNavigation(token: RouteSaveToken, currentObjectKey: string): boolean {
      if (!active
        || active.sequence !== token.sequence
        || active.objectKey !== token.objectKey
        || token.objectKey !== currentObjectKey
        || navigationSuppressed
        || navigationClaimed) {
        return false;
      }
      navigationClaimed = true;
      return true;
    },

    finish(token: RouteSaveToken): void {
      if (active?.sequence === token.sequence) active = null;
    },

    isSaving(): boolean {
      return active !== null;
    },
  };
}
