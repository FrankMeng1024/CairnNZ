/**
 * Content Filter + Marker Spacing — Unit Tests
 * Sprint 52: Code quality pass
 */
import { filterContent, isCleanContent } from '../../services/contentFilter';
import { checkMarkerSpacing, filterByDensity } from '../../utils/geo';

describe('Content Filter', () => {
  it('passes clean text at friend level', () => {
    const result = filterContent('Beautiful waterfall here', 'friend');
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('always passes at personal level', () => {
    const result = filterContent('fuck this trail', 'personal');
    expect(result.passed).toBe(true); // personal = no filtering
  });

  it('catches profanity at friend level', () => {
    const result = filterContent('what the fuck is this', 'friend');
    expect(result.passed).toBe(false);
    expect(result.violations).toContain('fuck');
    expect(result.filtered).toContain('****');
  });

  it('catches profanity at community level', () => {
    const result = filterContent('shit trail ahead', 'community');
    expect(result.passed).toBe(false);
    expect(result.violations).toContain('shit');
  });

  it('does not false-positive on substrings', () => {
    // "class" contains "ass" but word-boundary should prevent match
    const result = filterContent('classic viewpoint', 'community');
    expect(result.passed).toBe(true);
  });

  it('handles multiple violations', () => {
    const result = filterContent('fuck this shit', 'friend');
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  it('isCleanContent quick check works', () => {
    expect(isCleanContent('nice view', 'community')).toBe(true);
    expect(isCleanContent('fuck off', 'community')).toBe(false);
    expect(isCleanContent('fuck off', 'personal')).toBe(true);
  });
});

describe('checkMarkerSpacing', () => {
  const existingMarkers = [
    { id: '1', lat: -39.200, lng: 175.600 },
    { id: '2', lat: -39.201, lng: 175.610 },
  ];

  it('allows marker far from existing', () => {
    const result = checkMarkerSpacing(
      { lat: -39.205, lng: 175.620 },
      existingMarkers,
      20,
    );
    expect(result.allowed).toBe(true);
  });

  it('rejects marker too close to existing', () => {
    const result = checkMarkerSpacing(
      { lat: -39.20001, lng: 175.60001 }, // ~1m from marker 1
      existingMarkers,
      20,
    );
    expect(result.allowed).toBe(false);
    expect(result.conflictId).toBe('1');
    expect(result.nearestDistM).toBeLessThan(20);
  });

  it('respects custom threshold', () => {
    // ~111m from marker 1
    const pos = { lat: -39.201, lng: 175.600 };
    const strict = checkMarkerSpacing(pos, existingMarkers, 150);
    const loose = checkMarkerSpacing(pos, existingMarkers, 50);
    expect(strict.allowed).toBe(false);
    expect(loose.allowed).toBe(true);
  });

  it('handles empty existing markers', () => {
    const result = checkMarkerSpacing({ lat: -39.2, lng: 175.6 }, [], 20);
    expect(result.allowed).toBe(true);
    expect(result.nearestDistM).toBe(Infinity);
  });
});

describe('filterByDensity', () => {
  it('keeps all markers when spaced apart', () => {
    const markers = [
      { lat: -39.200, lng: 175.600 },
      { lat: -39.201, lng: 175.610 }, // ~900m away
      { lat: -39.202, lng: 175.620 }, // ~900m away
    ];
    const result = filterByDensity(markers, 15);
    expect(result).toHaveLength(3);
  });

  it('filters dense markers keeping earlier ones', () => {
    const markers = [
      { lat: -39.2000, lng: 175.600 },
      { lat: -39.20001, lng: 175.60001 }, // ~1m away — filtered out
      { lat: -39.20002, lng: 175.60002 }, // ~2m away — filtered out
    ];
    const result = filterByDensity(markers, 15);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(markers[0]);
  });

  it('respects custom spacing', () => {
    const markers = [
      { lat: -39.200, lng: 175.600 },
      { lat: -39.2001, lng: 175.600 }, // ~11m away
    ];
    const tight = filterByDensity(markers, 10);
    const wide = filterByDensity(markers, 15);
    expect(tight).toHaveLength(2); // 11m > 10m threshold
    expect(wide).toHaveLength(1); // 11m < 15m threshold
  });
});
