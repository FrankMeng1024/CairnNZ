import { authenticatedFetch } from './apiService';
import {
  applyAutomaticDiagnosticPolicySnapshot,
  type AutomaticDiagnosticPolicySnapshot,
} from './automaticDiagnosticOutbox';

export const AUTOMATIC_DIAGNOSTIC_CONSENT_VERSION = 'activity-precise-v1';

type DiagnosticConsentError = Error & { code?: string; status?: number };

function error(code: string, message: string, status?: number): DiagnosticConsentError {
  const result = new Error(message) as DiagnosticConsentError;
  result.code = code;
  result.status = status;
  return result;
}

function parsePolicy(value: unknown): AutomaticDiagnosticPolicySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw error('DIAGNOSTIC_POLICY_INVALID', 'Diagnostic policy response is invalid.');
  }
  const body = value as Record<string, unknown>;
  const enabled = body.enabled === true;
  const tier = body.tier;
  const consentVersion = typeof body.consentVersion === 'string' ? body.consentVersion : null;
  const enrolledAt = typeof body.enrolledAt === 'string' ? body.enrolledAt : null;
  const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : null;
  if ((!enabled && tier !== 'disabled')
    || (enabled && tier !== 'tier_a' && tier !== 'tier_b')
    || (enabled && !consentVersion)
    || (enabled && tier === 'tier_b'
      && (consentVersion !== AUTOMATIC_DIAGNOSTIC_CONSENT_VERSION
        || !expiresAt
        || !Number.isFinite(Date.parse(expiresAt))))) {
    throw error('DIAGNOSTIC_POLICY_INVALID', 'Diagnostic policy response is invalid.');
  }
  return {
    enabled,
    tier: tier as AutomaticDiagnosticPolicySnapshot['tier'],
    consentVersion,
    enrolledAt,
    expiresAt,
  };
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await response.json(); } catch {
    throw error('DIAGNOSTIC_POLICY_INVALID', 'Diagnostic policy response is invalid.', response.status);
  }
  if (!response.ok) {
    const object = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    throw error(
      typeof object.code === 'string' ? object.code : `HTTP_${response.status}`,
      'Diagnostic consent could not be updated.',
      response.status,
    );
  }
  return body as Record<string, unknown>;
}

export async function getAutomaticDiagnosticConsent(
  ownerUserId: string,
): Promise<AutomaticDiagnosticPolicySnapshot> {
  const response = await authenticatedFetch('/api/telemetry/diagnostics/policy', {
    method: 'GET',
    expectedUserId: ownerUserId,
    skipLogoutOn401: true,
  });
  const policy = parsePolicy(await responseBody(response));
  await applyAutomaticDiagnosticPolicySnapshot(ownerUserId, policy);
  return policy;
}

export async function setAutomaticDiagnosticConsent(
  ownerUserId: string,
  enabled: boolean,
): Promise<AutomaticDiagnosticPolicySnapshot> {
  const response = await authenticatedFetch('/api/telemetry/diagnostics/consent', {
    method: 'PUT',
    expectedUserId: ownerUserId,
    skipLogoutOn401: true,
    body: JSON.stringify({ enabled, consentVersion: AUTOMATIC_DIAGNOSTIC_CONSENT_VERSION }),
  });
  const policy = parsePolicy(await responseBody(response));
  await applyAutomaticDiagnosticPolicySnapshot(ownerUserId, policy);
  return policy;
}
