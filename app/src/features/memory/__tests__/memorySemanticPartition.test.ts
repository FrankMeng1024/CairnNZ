import area from '@turf/area';
import unionTurf from '@turf/union';
import { featureCollection, multiPolygon } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

import { combinePreparedCoverage } from '../components/FogLayer';

type CoverageFeature = Feature<Polygon | MultiPolygon>;

function square(west: number, south: number, east: number, north: number): CoverageFeature {
  return multiPolygon([[[
    [west, south], [east, south], [east, north], [west, north], [west, south],
  ]]]);
}

function geometry(feature: CoverageFeature): MultiPolygon {
  if (feature.geometry.type === 'MultiPolygon') return feature.geometry;
  return { type: 'MultiPolygon', coordinates: [feature.geometry.coordinates] };
}

function value(feature: CoverageFeature | null): number {
  return feature ? area(feature) : 0;
}

function expectPartition(result: Awaited<ReturnType<typeof combinePreparedCoverage>>, mine: CoverageFeature | null, friends: CoverageFeature[]): void {
  const inputs = [mine, ...friends].filter(Boolean) as CoverageFeature[];
  const expectedUnion = inputs.length === 0
    ? null
    : inputs.length === 1
      ? inputs[0]
      : unionTurf(featureCollection(inputs)) as CoverageFeature;
  const partitionArea = value(result.mineEvidence) + value(result.friendEvidence) + value(result.overlapEvidence);
  const unionArea = value(expectedUnion);
  expect(Math.abs(partitionArea - unionArea)).toBeLessThan(Math.max(0.01, unionArea * 1e-8));
}

describe('Memory semantic Mine/Friends/Both partition', () => {
  test('identical Mine and Friend coverage produces only the warm overlap class', async () => {
    const mine = square(174.7, -41.4, 174.8, -41.3);
    const result = await combinePreparedCoverage(mine, [geometry(mine)]);
    expect(result.mineEvidence).toBeNull();
    expect(result.friendEvidence).toBeNull();
    expect(value(result.overlapEvidence)).toBeGreaterThan(0);
    expectPartition(result, mine, [mine]);
  });

  test.each([
    ['partial overlap', square(174.7, -41.4, 174.8, -41.3), [square(174.75, -41.4, 174.85, -41.3)]],
    ['disjoint', square(174.7, -41.4, 174.75, -41.35), [square(174.8, -41.3, 174.85, -41.25)]],
    ['Mine contains Friend', square(174.7, -41.4, 174.9, -41.2), [square(174.75, -41.35, 174.8, -41.3)]],
    ['Friend contains Mine', square(174.75, -41.35, 174.8, -41.3), [square(174.7, -41.4, 174.9, -41.2)]],
    ['several Friends', square(174.7, -41.4, 174.8, -41.3), [
      square(174.75, -41.4, 174.85, -41.3),
      square(174.8, -41.35, 174.9, -41.25),
    ]],
  ] as Array<[string, CoverageFeature, CoverageFeature[]]>)('%s preserves the disjoint union invariant', async (_name, mine, friends) => {
    const result = await combinePreparedCoverage(mine, friends.map(geometry));
    expectPartition(result, mine, friends);
  });

  test('empty complete sources are a terminal empty result', async () => {
    const result = await combinePreparedCoverage(null, []);
    expect(result).toMatchObject({
      fogShape: expect.anything(),
      mineEvidence: null,
      friendEvidence: null,
      overlapEvidence: null,
    });
  });
});
