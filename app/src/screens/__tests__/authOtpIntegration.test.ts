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

  it('does not silently inspect the clipboard for verification codes', () => {
    expect(source).not.toContain("require('expo-clipboard')");
    expect(source).not.toContain('getStringAsync()');
    expect(source).toContain('Native paste/autofill can provide the complete code to one cell.');
  });

  it('lets the conditional auth navigator own the Home transition', () => {
    expect(source).toContain('login_auth_state_published');
    expect(source).not.toContain('login_settimeout_fired');
    expect(source).toContain('RootNavigator reacts to the single installed auth state.');
  });
});
