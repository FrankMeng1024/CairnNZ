import { activityMapPresentation, activityMapOrnamentsAbove } from '../activityMapPresentation';

describe('Activity map presentation', () => {
  test.each(['day', 'sunset', 'night'] as const)('%s keeps Hike and Run hierarchy shared', theme => {
    const hike = activityMapPresentation(theme, 'hike');
    const run = activityMapPresentation(theme, 'run');
    expect(hike.routeWidth).toBe(run.routeWidth);
    expect(hike.routeCasingWidth).toBeGreaterThan(hike.routeWidth);
    expect(hike.puckCoreColor).toBe(run.puckCoreColor);
    expect(hike.routeColor).not.toBe(run.routeColor);
  });

  test('Night uses a dark casing and a warm puck distinct from both routes', () => {
    const hike = activityMapPresentation('night', 'hike');
    const run = activityMapPresentation('night', 'run');
    expect(hike.routeCasingColor).toBe('#162432');
    expect(hike.puckCoreColor).not.toBe(hike.routeColor);
    expect(run.puckCoreColor).not.toBe(run.routeColor);
    expect(hike.emissiveStrength).toBe(1);
  });

  test('legal ornaments remain visible above the Activity dock', () => {
    expect(activityMapOrnamentsAbove(214)).toEqual({
      logoPosition: { bottom: 214, left: 8 },
      attributionPosition: { bottom: 214, right: 8 },
    });
  });
});
