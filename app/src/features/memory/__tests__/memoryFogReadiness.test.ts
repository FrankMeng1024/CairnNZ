import { memoryFogPaintEvidenceReady } from '../services/memoryFogReadiness';

describe('Memory Fog paint readiness', () => {
  test('a warm Web source worker cannot release the veil before exact new-authority features paint', () => {
    expect(memoryFogPaintEvidenceReady({
      hasRenderedLayerProbe: true,
      exactLayersRendered: false,
      fullyRenderedFrame: true,
      sourcesLoaded: true,
    })).toBe(false);
    expect(memoryFogPaintEvidenceReady({
      hasRenderedLayerProbe: true,
      exactLayersRendered: true,
      fullyRenderedFrame: true,
      sourcesLoaded: false,
    })).toBe(true);
  });

  test('native requires a fully rendered frame after correlated geometry is ready', () => {
    expect(memoryFogPaintEvidenceReady({
      hasRenderedLayerProbe: false,
      exactLayersRendered: false,
      fullyRenderedFrame: false,
      sourcesLoaded: true,
    })).toBe(false);
    expect(memoryFogPaintEvidenceReady({
      hasRenderedLayerProbe: false,
      exactLayersRendered: false,
      fullyRenderedFrame: true,
      sourcesLoaded: true,
    })).toBe(true);
  });
});
