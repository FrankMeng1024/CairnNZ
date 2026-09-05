import {
  applyOtpCellInput,
  clipboardOtpCandidate,
  eligibleClipboardOtp,
  normalizeOtpInput,
} from '../authOtp';

describe('Auth OTP input contract', () => {
  it('distributes a six-digit paste as the complete value', () => {
    expect(applyOtpCellInput('', 0, '123456')).toBe('123456');
    expect(applyOtpCellInput('12', 2, '654321')).toBe('654321');
  });

  it('preserves one-digit typing and deletion behavior', () => {
    expect(applyOtpCellInput('', 0, '1')).toBe('1');
    expect(applyOtpCellInput('1', 1, '2')).toBe('12');
    expect(applyOtpCellInput('12', 1, '')).toBe('1');
    expect(normalizeOtpInput('12a34567')).toBe('123456');
  });

  it('accepts only an exact six-digit clipboard value with optional outer whitespace', () => {
    expect(clipboardOtpCandidate('123456')).toBe('123456');
    expect(clipboardOtpCandidate('  123456\n')).toBe('123456');
    expect(clipboardOtpCandidate('12345')).toBeNull();
    expect(clipboardOtpCandidate('code 123456')).toBeNull();
    expect(clipboardOtpCandidate('1234567')).toBeNull();
  });

  it('does not autofill outside an idle, empty verification flow', () => {
    expect(eligibleClipboardOtp('123456', { verificationActive: true, currentCode: '', verifying: false })).toBe('123456');
    expect(eligibleClipboardOtp('123456', { verificationActive: false, currentCode: '', verifying: false })).toBeNull();
    expect(eligibleClipboardOtp('123456', { verificationActive: true, currentCode: '1', verifying: false })).toBeNull();
    expect(eligibleClipboardOtp('123456', { verificationActive: true, currentCode: '', verifying: true })).toBeNull();
  });
});
