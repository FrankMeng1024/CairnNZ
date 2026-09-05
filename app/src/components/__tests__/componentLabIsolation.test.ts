import fs from 'node:fs';
import path from 'node:path';

describe('three-theme component lab isolation', () => {
  const appRoot = path.resolve(__dirname, '..', '..', '..');
  const navigator = fs.readFileSync(path.join(appRoot, 'src/navigation/RootNavigator.tsx'), 'utf8');
  const lab = fs.readFileSync(path.join(appRoot, 'src/components/dev/ThreeThemeComponentLabScreen.tsx'), 'utf8');

  it('has no production eager import and is registered only behind __DEV__', () => {
    expect(navigator).not.toMatch(/^import .*ThreeThemeComponentLab/m);
    expect(navigator).toMatch(/\{__DEV__\s*&&\s*\([\s\S]*name="ThreeThemeComponentLab"[\s\S]*getComponent=/);
    expect(lab).toContain('if (!__DEV__) return null;');
  });
});
