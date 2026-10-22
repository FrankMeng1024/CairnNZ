type StyleSource = {
  url?: unknown;
  tiles?: unknown;
};

type RenderedFeature = {
  source?: unknown;
};

type WebMapReadinessProbe = {
  getStyle?: () => { sources?: Record<string, StyleSource> } | null;
  queryRenderedFeatures?: () => RenderedFeature[];
};

function isHostedMapboxUrl(value: unknown): boolean {
  return typeof value === 'string'
    && (value.startsWith('mapbox://') || value.startsWith('https://api.mapbox.com/'));
}

export function sourceUsesHostedMapbox(source: StyleSource | null | undefined): boolean {
  if (!source) return false;
  if (isHostedMapboxUrl(source.url)) return true;
  return Array.isArray(source.tiles) && source.tiles.some(isHostedMapboxUrl);
}

/**
 * GL JS v2 can retain immediately-expired-but-renderable vector tiles while
 * waiting for a refresh. In that state `loaded()` and `idle` remain false even
 * though the hosted basemap is already visible. This probe is deliberately
 * stricter than "the canvas rendered": it accepts only a rendered feature
 * whose source is backed by an actual Mapbox URL from the active style.
 */
export function hasRenderedHostedMapboxBasemap(map: WebMapReadinessProbe | null | undefined): boolean {
  if (!map?.getStyle || !map.queryRenderedFeatures) return false;
  try {
    const sources = map.getStyle()?.sources ?? {};
    const hostedSourceIds = new Set(
      Object.entries(sources)
        .filter(([, source]) => sourceUsesHostedMapbox(source))
        .map(([sourceId]) => sourceId),
    );
    if (hostedSourceIds.size === 0) return false;
    return map.queryRenderedFeatures().some(feature => (
      typeof feature?.source === 'string' && hostedSourceIds.has(feature.source)
    ));
  } catch {
    return false;
  }
}
