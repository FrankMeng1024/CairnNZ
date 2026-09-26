import fs from 'node:fs';
import path from 'node:path';
import React, { useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PasswordField } from '../PasswordField';

jest.mock('../../hooks/useVisualTheme', () => {
  const { DAY_VISUAL_THEME } = jest.requireActual('../tokens');
  return { useVisualTheme: () => DAY_VISUAL_THEME };
});
jest.mock('../Icon', () => ({ Icon: () => null }));

function Harness() {
  const [value, setValue] = useState('TrailSecret9');
  return <PasswordField testID="password" value={value} onChangeText={setValue} />;
}

describe('shared PasswordField', () => {
  beforeEach(() => {
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('visibility is keyboard-safe and preserves the controlled text', () => {
    const screen = render(<Harness />);
    const input = screen.getByTestId('password');
    fireEvent(input, 'focus', {});
    fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 2, end: 7 } } });

    fireEvent.press(screen.getByRole('button', { name: 'Show password' }));

    expect(screen.getByTestId('password').props.value).toBe('TrailSecret9');
    expect(screen.getByTestId('password').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });

  test('cursor edits preserve the existing password instead of clearing it', () => {
    const screen = render(<Harness />);
    const input = screen.getByTestId('password');
    fireEvent(input, 'focus', {});
    fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 0 } } });
    fireEvent.changeText(input, 'gTrailSecret9');
    expect(screen.getByTestId('password').props.value).toBe('gTrailSecret9');

    fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 6, end: 12 } } });
    fireEvent.changeText(input, 'gTrailPath9');
    expect(screen.getByTestId('password').props.value).toBe('gTrailPath9');
  });

  test('all live password callers use the shared field', () => {
    const appRoot = path.resolve(__dirname, '../../..');
    const auth = fs.readFileSync(path.join(appRoot, 'src/screens/AuthScreen.tsx'), 'utf8');
    const settings = fs.readFileSync(path.join(appRoot, 'src/screens/SettingsScreen.tsx'), 'utf8');
    expect(auth.match(/<PasswordField/g)).toHaveLength(3);
    expect(auth).not.toContain('function PasswordInput');
    expect(settings.match(/<PasswordField/g)).toHaveLength(3);
    expect(settings).not.toMatch(/<TextField[^>]+secureTextEntry/);
  });
});
