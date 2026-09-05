import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, '..', 'AuthScreen.tsx'), 'utf8');

describe('Auth verification integration contract', () => {
  it('lets native paste/one-time-code insertion reach JavaScript intact', () => {
    expect(source).toContain('maxLength={OTP_LENGTH}');
    expect(source).not.toContain('maxLength={1}');
    expect(source).toContain("Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'");
    expect(source).toContain("textContentType={i === 0 ? 'oneTimeCode' : 'none'}");
  });

  it('keeps clipboard checks scoped to verification entry and app foreground', () => {
    expect(source).toContain("if (view !== 'verify') return;");
    expect(source).toContain("void tryAutoFill('view')");
    expect(source).toContain("if (s === 'active') void tryAutoFill('foreground')");
    expect(source).toContain('verificationActive: view === \'verify\'');
    expect(source).toContain('auth:otp_clipboard trigger=${trigger} outcome=');
  });
});
