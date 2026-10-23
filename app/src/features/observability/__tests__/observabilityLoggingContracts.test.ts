import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('pre-OTA observability source contracts', () => {
  test('Memory has no render, camera-frame sampling, or log-only heartbeat timer', () => {
    const screen = read('features/memory/screens/MemoryScreen.tsx');
    const map = read('features/memory/components/MemoryMap.tsx');
    expect(screen).not.toContain("log('v357.memory_screen_render'");
    expect(screen).not.toContain("log('memory.js_heartbeat'");
    expect(map).not.toContain("log('v386.camera_zoom'");
    expect(map).not.toContain("log('v443.map.camera_center'");
    expect(map).not.toContain("log('v443.map.camera_center_missing'");
  });

  test('real Activity segment transitions and historical Mapbox milestones enter the durable ledger', () => {
    const background = read('services/backgroundLocationTask.ts');
    const tracking = read('store/useTrackingStore.ts');
    const history = read('screens/MapHistoryScreen.tsx');
    expect(background).toContain("stage: 'segment-transition'");
    expect(tracking).toContain("stage: 'segment-transition'");
    expect(history).toContain("recordMapMilestone('ACTIVITY_DETAIL_GEOMETRY_COMMITTED'");
    expect(history).toContain("recordMapMilestone('ACTIVITY_DETAIL_MAP_RENDER_FULL'");
    expect(history).toContain('visiblePixelsProven: false');
  });
});
