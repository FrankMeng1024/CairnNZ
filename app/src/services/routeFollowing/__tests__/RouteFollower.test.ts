/**
 * RouteFollower — pure-logic unit tests.
 *
 * Covers the algorithms Playwright can't easily reach: bearing math, turn
 * classification, projection, waypoint selection, off-route detection.
 * Web/UI behaviour is tested separately in the Playwright spec.
 */

import {
  bearingDeg,
  bearingDeltaDeg,
  classifyTurn,
  projectOnSegment,
  precomputeCumulative,
  findClosestProjection,
  findNextTurn,
  findNextWaypoint,
  computeFollowState,
  RoutePointLite,
  WaypointLite,
} from '../RouteFollower';

describe('bearingDeg', () => {
  it('north = 0', () => {
    expect(Math.round(bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }))).toBe(0);
  });
  it('east = 90', () => {
    expect(Math.round(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }))).toBe(90);
  });
  it('south = 180', () => {
    expect(Math.round(bearingDeg({ lat: 0, lng: 0 }, { lat: -1, lng: 0 }))).toBe(180);
  });
  it('west = 270', () => {
    expect(Math.round(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: -1 }))).toBe(270);
  });
});

describe('bearingDeltaDeg', () => {
  it('same bearing = 0', () => {
    expect(bearingDeltaDeg(45, 45)).toBe(0);
  });
  it('90 CW = +90', () => {
    expect(bearingDeltaDeg(0, 90)).toBe(90);
  });
  it('90 CCW = -90', () => {
    expect(bearingDeltaDeg(90, 0)).toBe(-90);
  });
  it('wraps across 360', () => {
    expect(bearingDeltaDeg(350, 10)).toBe(20);
    expect(bearingDeltaDeg(10, 350)).toBe(-20);
  });
  it('opposite direction = 180 (canonical positive)', () => {
    expect(bearingDeltaDeg(0, 180)).toBe(180);
    expect(bearingDeltaDeg(180, 0)).toBe(180);
  });
});

describe('classifyTurn', () => {
  it('small delta = straight', () => {
    expect(classifyTurn(5)).toBe('straight');
    expect(classifyTurn(-19)).toBe('straight');
  });
  it('moderate right = right', () => {
    expect(classifyTurn(45)).toBe('right');
    expect(classifyTurn(90)).toBe('right');
  });
  it('moderate left = left', () => {
    expect(classifyTurn(-45)).toBe('left');
  });
  it('sharp threshold >= 110', () => {
    expect(classifyTurn(120)).toBe('sharp-right');
    expect(classifyTurn(-115)).toBe('sharp-left');
  });
  it('u-turn > 150', () => {
    expect(classifyTurn(170)).toBe('u-turn');
    expect(classifyTurn(-160)).toBe('u-turn');
  });
});

describe('projectOnSegment', () => {
  it('point on segment midpoint returns t≈0.5, distance≈0', () => {
    const a: RoutePointLite = { lat: 0, lng: 0 };
    const b: RoutePointLite = { lat: 0, lng: 0.001 }; // ~111m east
    const mid: RoutePointLite = { lat: 0, lng: 0.0005 };
    const res = projectOnSegment(mid, a, b);
    expect(res.t).toBeCloseTo(0.5, 2);
    expect(res.distanceM).toBeLessThan(1);
  });
  it('point off to the side gets perpendicular distance', () => {
    const a: RoutePointLite = { lat: 0, lng: 0 };
    const b: RoutePointLite = { lat: 0, lng: 0.001 };
    const off: RoutePointLite = { lat: 0.0005, lng: 0.0005 }; // ~55m north of midpoint
    const res = projectOnSegment(off, a, b);
    expect(res.distanceM).toBeGreaterThan(40);
    expect(res.distanceM).toBeLessThan(70);
  });
  it('point past the end clamps to t=1', () => {
    const a: RoutePointLite = { lat: 0, lng: 0 };
    const b: RoutePointLite = { lat: 0, lng: 0.001 };
    const past: RoutePointLite = { lat: 0, lng: 0.002 };
    const res = projectOnSegment(past, a, b);
    expect(res.t).toBe(1);
  });
});

describe('precomputeCumulative', () => {
  it('cum[0] = 0, cum monotonic increasing', () => {
    const pts: RoutePointLite[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0, lng: 0.002 },
    ];
    const cum = precomputeCumulative(pts);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeGreaterThan(0);
    expect(cum[2]).toBeGreaterThan(cum[1]);
  });
});

describe('findClosestProjection', () => {
  it('picks the closer of two segments', () => {
    const pts: RoutePointLite[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0.001, lng: 0.001 },
    ];
    const cum = precomputeCumulative(pts);
    // Point near the second segment (going north)
    const user: RoutePointLite = { lat: 0.0005, lng: 0.001 };
    const res = findClosestProjection(user, pts, cum);
    expect(res.segmentIndex).toBe(1);
  });
});

describe('findNextTurn', () => {
  const pts: RoutePointLite[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },       // east
    { lat: 0.001, lng: 0.001 },   // 90° left (north)
    { lat: 0.001, lng: 0.002 },   // 90° right (east)
  ];
  const cum = precomputeCumulative(pts);

  it('detects first left turn ahead of user at start', () => {
    const t = findNextTurn(pts, cum, 0, 0, 0);
    expect(t).toBeDefined();
    expect(t?.direction === 'left' || t?.direction === 'sharp-left').toBe(true);
    expect(t?.atIndex).toBe(1);
  });

  it('skips passed turns — once user is on the last segment, no turn ahead', () => {
    // User already on segment 2 (points[2] → points[3]) means they've
    // already passed the turn at vertex 2 (that turn happened when going
    // from seg 1 to seg 2). Result: no upcoming turn.
    const userProgress = cum[1] + 10; // 10m past vertex 1, well into segment 1
    const t = findNextTurn(pts, cum, 1, 0.5, userProgress);
    // Should still find the vertex-2 turn (right turn)
    expect(t?.atIndex).toBe(2);
    expect(t?.direction === 'right' || t?.direction === 'sharp-right').toBe(true);
  });

  it('returns undefined when user is on the final segment (no vertex ahead)', () => {
    const userProgress = cum[2] + 5;
    const t = findNextTurn(pts, cum, 2, 0.1, userProgress);
    expect(t).toBeUndefined();
  });

  it('returns undefined when no turn within lookahead', () => {
    // Straight line — no turns
    const straight: RoutePointLite[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0, lng: 0.002 },
    ];
    const cumS = precomputeCumulative(straight);
    const t = findNextTurn(straight, cumS, 0, 0, 0);
    expect(t).toBeUndefined();
  });
});

describe('findNextWaypoint', () => {
  const pts: RoutePointLite[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.002 }, // ~222m east
  ];
  const cum = precomputeCumulative(pts);
  const wps: WaypointLite[] = [
    { id: 'a', lat: 0, lng: 0.0005, label: 'A', announceOnArrival: true, radiusM: 30 },
    { id: 'b', lat: 0, lng: 0.0015, label: 'B', announceOnArrival: true, radiusM: 30 },
  ];
  it('returns first waypoint ahead when user at start', () => {
    expect(findNextWaypoint(wps, pts, cum, 0)?.id).toBe('a');
  });
  it('skips passed waypoint', () => {
    // User at ~100m in, past waypoint A
    expect(findNextWaypoint(wps, pts, cum, 100)?.id).toBe('b');
  });
  it('returns undefined when past all', () => {
    expect(findNextWaypoint(wps, pts, cum, 500)).toBeUndefined();
  });
});

describe('computeFollowState', () => {
  const pts: RoutePointLite[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0.001, lng: 0.001 },
  ];

  it('user on route: distanceToRouteM ≈ 0, progress advances', () => {
    const state = computeFollowState({
      user: { lat: 0, lng: 0.0005 },
      points: pts,
    });
    expect(state.distanceToRouteM).toBeLessThan(1);
    expect(state.progressM).toBeGreaterThan(30);
    expect(state.progressM).toBeLessThan(80);
    expect(state.progressPct).toBeGreaterThan(0);
    expect(state.progressPct).toBeLessThan(1);
  });

  it('user off route: distanceToRouteM > 0', () => {
    const state = computeFollowState({
      user: { lat: 0.001, lng: 0.0005 }, // ~111m north of route
      points: pts,
    });
    expect(state.distanceToRouteM).toBeGreaterThan(50);
  });

  it('remainingM decreases as user progresses', () => {
    const a = computeFollowState({ user: { lat: 0, lng: 0.0001 }, points: pts });
    const b = computeFollowState({ user: { lat: 0, lng: 0.0009 }, points: pts });
    expect(b.remainingM).toBeLessThan(a.remainingM);
  });

  it('degenerate route (1 point) returns zeroed state', () => {
    const state = computeFollowState({
      user: { lat: 0, lng: 0 },
      points: [{ lat: 0, lng: 0 }],
    });
    expect(state.totalM).toBe(0);
    expect(state.nextTurn).toBeUndefined();
  });
});
