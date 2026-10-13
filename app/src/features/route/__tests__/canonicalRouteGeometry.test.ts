import { canonicalRouteBounds, canonicalRouteGeometry, canonicalRouteGeometryFingerprint } from '../canonicalRouteGeometry';
import { createImportedOrderedDraft } from '../orderedRouteDraft';

describe('canonical Route presentation geometry', () => {
  test('preserves curves, retracing, loops and imported gaps as ordered parts', () => {
    const first = [
      { lat: 31.2304, lng: 121.4737 },
      { lat: 31.2312, lng: 121.4748 },
      { lat: 31.2304, lng: 121.4737 },
    ];
    const second = [
      { lat: 31.2330, lng: 121.4770 },
      { lat: 31.2340, lng: 121.4782 },
      { lat: 31.2330, lng: 121.4770 },
    ];
    const draft = createImportedOrderedDraft({ draftId: 'activity:shape', ownerId: 'owner', segments: [first, second] });
    const geometry = canonicalRouteGeometry({ orderedDraft: draft });
    expect(geometry.parts.map(part => part.points)).toEqual([first, second]);
    expect(geometry.gaps).toHaveLength(1);
    expect(geometry.start).toEqual(first[0]);
    expect(geometry.end).toEqual(second.at(-1));
  });

  test('legacy, saved, reopened and received inputs produce the same geometry fingerprint', () => {
    const points = [
      { lat: -41.2865, lng: 174.7762 },
      { lat: -41.2858, lng: 174.7771 },
      { lat: -41.2861, lng: 174.7784 },
    ];
    const first = canonicalRouteGeometry({ points });
    const reopened = canonicalRouteGeometry({ points: points.map(point => ({ ...point })) });
    const receivedSnapshot = canonicalRouteGeometry({ points: points.map(point => ({ ...point })) });
    expect(canonicalRouteGeometryFingerprint(reopened)).toBe(canonicalRouteGeometryFingerprint(first));
    expect(canonicalRouteGeometryFingerprint(receivedSnapshot)).toBe(canonicalRouteGeometryFingerprint(first));
    expect(canonicalRouteBounds(first)).toEqual(canonicalRouteBounds(reopened));
  });

  test('presentation metadata never enters canonical geometry', () => {
    const geometry = canonicalRouteGeometry({ points: [
      { lat: 1, lng: 2 },
      { lat: 1.1, lng: 2.1 },
    ] });
    expect(JSON.stringify(geometry)).not.toMatch(/color|theme|layer|animation|sourceFlag/i);
  });
});
