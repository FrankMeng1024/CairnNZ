/**
 * Unit tests — tileEncoder
 *
 * Verifies Web Mercator tile + sub-grid cell math against known
 * reference points. Pure-function module, no fixtures or mocks.
 */

import {
  latLngToTile,
  latLngToSubgridCell,
  tileKey,
  cellKey,
  tileToTopLeftLatLng,
} from '../src/features/memory/services/tileEncoder';

describe('tileEncoder · latLngToTile', () => {
  it('z=0 puts the whole world in tile (0,0,0)', () => {
    expect(latLngToTile(0, 0, 0)).toEqual({ z: 0, x: 0, y: 0 });
  });

  it('z=1 splits into 4 tiles at (lat=0, lng=0) → (1,1,1)', () => {
    // Equator + prime meridian sits at the corner of x=1,y=1 at z=1
    const t = latLngToTile(0, 0, 1);
    expect(t.z).toBe(1);
    expect(t.x).toBe(1);
    expect(t.y).toBe(1);
  });

  it('positive longitude → larger x', () => {
    const a = latLngToTile(40, -100, 5);
    const b = latLngToTile(40, 100, 5);
    expect(b.x).toBeGreaterThan(a.x);
  });

  it('positive latitude (north) → smaller y (TMS-style increases southward)', () => {
    const north = latLngToTile(60, 0, 5);
    const south = latLngToTile(-60, 0, 5);
    expect(north.y).toBeLessThan(south.y);
  });

  it('clamps poles without throwing', () => {
    expect(() => latLngToTile(89.9, 0, 17)).not.toThrow();
    expect(() => latLngToTile(-89.9, 0, 17)).not.toThrow();
  });

  it('zoom 17 puts equator+prime-meridian in a known tile', () => {
    // 2^17 = 131072. Equator+0° lng → x=65536, y=65536
    const t = latLngToTile(0, 0, 17);
    expect(t.x).toBe(65536);
    expect(t.y).toBe(65536);
  });
});

describe('tileEncoder · latLngToSubgridCell', () => {
  it('produces row/col within [0, 127]', () => {
    const cell = latLngToSubgridCell(31.23035, 121.43540);
    expect(cell.row).toBeGreaterThanOrEqual(0);
    expect(cell.row).toBeLessThanOrEqual(127);
    expect(cell.col).toBeGreaterThanOrEqual(0);
    expect(cell.col).toBeLessThanOrEqual(127);
  });

  it('two close points (within ~0.5m) land in the same or adjacent cell', () => {
    const a = latLngToSubgridCell(31.23035, 121.43540);
    const b = latLngToSubgridCell(31.23035, 121.43540 + 0.000005); // ~0.5m east
    expect(a.tile.x).toBe(b.tile.x);
    expect(a.tile.y).toBe(b.tile.y);
    expect(Math.abs(a.col - b.col)).toBeLessThanOrEqual(1);
  });

  it('two distant points land in different tiles', () => {
    const a = latLngToSubgridCell(31.23, 121.43);
    const b = latLngToSubgridCell(31.30, 121.50);
    expect(`${a.tile.x},${a.tile.y}`).not.toEqual(`${b.tile.x},${b.tile.y}`);
  });
});

describe('tileEncoder · key helpers', () => {
  it('tileKey is "z/x/y"', () => {
    expect(tileKey({ z: 17, x: 100, y: 200 })).toBe('17/100/200');
  });

  it('cellKey is "z/x/y:col,row"', () => {
    expect(cellKey({ tile: { z: 17, x: 100, y: 200 }, col: 5, row: 6 })).toBe('17/100/200:5,6');
  });
});

describe('tileEncoder · tileToTopLeftLatLng (round-trip)', () => {
  it('returns lat/lng inside the tile we encode them from', () => {
    const lat = 31.23035, lng = 121.43540;
    const tile = latLngToTile(lat, lng, 17);
    const tl   = tileToTopLeftLatLng(tile);
    const br   = tileToTopLeftLatLng({ ...tile, x: tile.x + 1, y: tile.y + 1 });
    // tl is the NW corner: lat is largest, lng smallest. br is opposite.
    expect(tl.lat).toBeGreaterThanOrEqual(lat);
    expect(br.lat).toBeLessThanOrEqual(lat);
    expect(tl.lng).toBeLessThanOrEqual(lng);
    expect(br.lng).toBeGreaterThanOrEqual(lng);
  });
});
