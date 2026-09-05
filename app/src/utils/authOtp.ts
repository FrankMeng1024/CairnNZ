export const OTP_LENGTH = 6;

/** Digits accepted by the six-cell control, capped to the full OTP length. */
export function normalizeOtpInput(raw: string): string {
  return String(raw || '').replace(/\D/g, '').slice(0, OTP_LENGTH);
}

/**
 * Apply native typing, paste, or one-time-code insertion to the controlled
 * value. Multi-character input replaces the whole OTP; a single character
 * updates only the active cell.
 */
export function applyOtpCellInput(current: string, index: number, raw: string): string {
  const clean = normalizeOtpInput(raw);
  if (clean.length > 1) return clean;

  const cells = Array.from({ length: OTP_LENGTH }, (_, cell) => current[cell] ?? '');
  cells[index] = clean;
  return cells.join('').slice(0, OTP_LENGTH);
}

/** Accept only an exact six-digit clipboard value, allowing outer whitespace. */
export function clipboardOtpCandidate(raw: unknown): string | null {
  const trimmed = String(raw ?? '').trim();
  return /^\d{6}$/.test(trimmed) ? trimmed : null;
}

export function eligibleClipboardOtp(
  raw: unknown,
  options: { verificationActive: boolean; currentCode: string; verifying: boolean },
): string | null {
  if (!options.verificationActive || options.currentCode || options.verifying) return null;
  return clipboardOtpCandidate(raw);
}
