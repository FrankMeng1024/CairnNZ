import { segmentTrace } from '../../activity/activityContracts';
import { selectActivityRouteImportPoints } from '../activityRouteImport';

const point = (lat: number, lng: number, t: number, segmentId: string) => ({ lat, lng, t, segmentId });

describe('Activity to Route geometry source', () => {
  test('prefers complete canonical accepted points over a reduced selected Final', () => {
    const canonical = [
      point(31.2304, 121.4737, 1, 'a'),
      point(31.2310, 121.4748, 2, 'a'),
      point(31.2321, 121.4741, 3, 'a'),
      point(31.2328, 121.4754, 4, 'a'),
    ];
    const reducedFinal = [canonical[0], canonical.at(-1)!];
    expect(selectActivityRouteImportPoints(canonical, reducedFinal)).toEqual(canonical);
  });

  test('retains canonical multipart order and uses selected Final only when local truth is unavailable', () => {
    const multipart = [
      point(39.9042, 116.4074, 1, 'first'),
      point(39.9050, 116.4082, 2, 'first'),
      { ...point(39.9062, 116.4101, 3, 'second'), segmentStartReason: 'gps-reacquired' as const },
      point(39.9070, 116.4110, 4, 'second'),
    ];
    const selected = selectActivityRouteImportPoints([], multipart);
    expect(segmentTrace(selected).segments.map(segment => segment.map(item => item.segmentId))).toEqual([
      ['first', 'first'],
      ['second', 'second'],
    ]);
  });
});
