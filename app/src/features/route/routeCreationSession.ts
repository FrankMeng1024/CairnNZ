import { uuidv4 } from '../../services/offlineQueue';

export interface RouteCreationIdentity {
  creationSource?: 'plan' | 'activity' | 'shared-copy';
  fromSessionId?: string;
  creationSessionId?: string;
}

/**
 * A source Activity identifies an immutable template, never a resumable
 * creation draft. Every explicit chooser action receives a fresh session id.
 */
export function createRouteCreationSessionId(): string {
  return uuidv4();
}

export function activityCreationDraftId(input: RouteCreationIdentity): string | null {
  if (input.creationSource !== 'activity' || !input.fromSessionId || !input.creationSessionId) return null;
  return `activity:${input.fromSessionId}:${input.creationSessionId}`;
}

export function mayRecoverRouteCreationDraft(input: RouteCreationIdentity): boolean {
  return input.creationSource !== 'activity';
}

