import type { AuthResult } from './authService';
import {
  clearTokenIfCurrent,
  isTokenAuthorityCurrent,
  type TokenAuthority,
} from './tokenStore';
import {
  finishAccountTransition,
  isAccountTransitionCurrent,
  type AccountTransitionAuthority,
} from './accountTransitionAuthority';
import type { HydrateResult } from '../store/useAppStore';

/**
 * AuthScreen owns pending, not-yet-installed auth results. Once installation
 * enters hydrate, however, installAuthenticatedSession owns retirement of the
 * token and transition. Releasing that lease from an unmount cleanup would let
 * another account install while the first owner's hydrate is still mutating
 * account stores.
 */
export function releaseAuthScreenAuthorityOnUnmount(input: {
  installationInFlight: boolean;
  transition: AccountTransitionAuthority | null;
  token: TokenAuthority | null;
}): boolean {
  if (input.installationInFlight) return false;
  if (input.token) void clearTokenIfCurrent(input.token);
  if (input.transition) finishAccountTransition(input.transition);
  return true;
}

export async function installAuthenticatedSession(input: {
  result: AuthResult;
  hydrate: (options: {
    transitionAuthority: NonNullable<AuthResult['transitionAuthority']>;
    expectedUserId: string;
    deferSessionInstall: true;
  }) => Promise<HydrateResult>;
  shouldContinue: () => boolean;
  beforeHydrate?: () => Promise<void>;
  beforePublish?: () => Promise<void>;
  publish: (user: NonNullable<AuthResult['user']>) => void;
}): Promise<boolean> {
  const { result } = input;
  const transition = result.transitionAuthority;
  const tokenAuthority = result.tokenAuthority;
  const user = result.user;
  const ownerId = user?.id == null ? null : String(user.id);

  const abandon = async () => {
    if (tokenAuthority) await clearTokenIfCurrent(tokenAuthority);
    if (transition) finishAccountTransition(transition);
    return false;
  };

  if (!transition || !tokenAuthority || !user || !ownerId
    || !input.shouldContinue()
    || !isAccountTransitionCurrent(transition)
    || !(await isTokenAuthorityCurrent(tokenAuthority))) {
    return abandon();
  }

  if (input.beforeHydrate) await input.beforeHydrate();
  if (!input.shouldContinue()
    || !isAccountTransitionCurrent(transition)
    || !(await isTokenAuthorityCurrent(tokenAuthority))) {
    return abandon();
  }

  const hydration = await input.hydrate({
    transitionAuthority: transition,
    expectedUserId: ownerId,
    deferSessionInstall: true,
  });
  if (hydration.authenticatedOwnerUserId !== ownerId) return abandon();
  if (input.beforePublish) await input.beforePublish();

  if (!input.shouldContinue()
    || !isAccountTransitionCurrent(transition)
    || !(await isTokenAuthorityCurrent(tokenAuthority))) {
    return abandon();
  }

  input.publish(user);
  finishAccountTransition(transition);
  return true;
}
