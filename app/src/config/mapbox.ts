/**
 * Mapbox configuration
 *
 * Access token should be set via environment variable or EAS secrets.
 * Never commit a real token to the repository.
 */
import { Platform } from 'react-native';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

export function initMapbox() {
  if (Platform.OS === 'web') {
    // On web, set token directly on mapbox-gl (async import to avoid SSR issues)
    import('mapbox-gl').then((mapboxgl) => {
      mapboxgl.default.accessToken = MAPBOX_TOKEN;
    });
  } else {
    // Native only: @rnmapbox/maps API
    const Mapbox = require('@rnmapbox/maps').default;
    Mapbox.setAccessToken(MAPBOX_TOKEN);
    Mapbox.setTelemetryEnabled(false);
    // R114/O22 Bug 4: pre-warm the NZ tile cache at app boot. On first
    // launch (or after a fresh install) the map otherwise renders as a
    // blank cream/white canvas for many seconds while tiles download from
    // the Mapbox CDN — especially bad on Chinese networks where the CDN
    // is slow. Kicking off a small (2 city bbox) offline pack in the
    // background means the tiles are already cached by the time the user
    // opens Hike. Silent on failure — the on-map loading overlay covers
    // the worst case.
    try {
      const offline = (Mapbox as any).offlineManager;
      if (offline && typeof offline.createPack === 'function') {
        const styleURL = process.env.EXPO_PUBLIC_CAIRN_TOPO_STYLE_URL
          ?? 'mapbox://styles/mapbox/streets-v12';
        offline.getPack('cairn-nz-warmup').then((pack: unknown) => {
          if (pack) return; // already cached from a previous launch
          void offline.createPack(
            {
              name: 'cairn-nz-warmup',
              styleURL,
              // Rough NZ bbox — Auckland + Wellington + Christchurch corridor.
              // Small enough to fit under Mapbox's 6000-tile free tier
              // limit at zoom 8-12 (~200 km² @ z12).
              bounds: [[166.5, -47.3], [178.6, -34.3]] as [
                [number, number],
                [number, number],
              ],
              minZoom: 5,
              maxZoom: 10,
            },
            () => { /* progress — silent */ },
            () => { /* error — silent, overlay covers UX */ },
          );
        }).catch(() => { /* silent */ });
      }
    } catch { /* silent — offline API may not be present in older builds */ }
  }
}

const MAP_STYLES = {
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',
  streets: 'mapbox://styles/mapbox/streets-v12',
  // R21 (2026-08-18 user "黑色的地球很丑, mapbox没更好看点的夜间模式了么"):
  // navigation-night-v1 replaces dark-v11 as the primary night style — it's
  // Mapbox's dedicated navigation-oriented night palette. Roads stay
  // clearly visible against a deep midnight-blue base (not pitch black),
  // labels remain readable, terrain shading is warmer than dark-v11's
  // flat grey slab. Reads as a proper "night hiking map" instead of
  // a cold city dashboard.
  dark: 'mapbox://styles/mapbox/navigation-night-v1',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
} as const;

type MapStyle = keyof typeof MAP_STYLES;

/**
 * PRD3 E-013 — Cairn Topo style.
 *
 * Custom Mapbox style inspired by NZ Topo50 paper maps:
 *   background  cream  #F7F2E5
 *   contours    sepia  #b5823d  opacity 0.4
 *   vegetation  mint   #c9d9c5  opacity 0.6
 *   water              #8ba8c0
 *   roads       muted (don't compete with terrain)
 *
 * The style is served from Mapbox Studio.  We fall back to
 * `outdoors-v12` if the custom style fails to load (see MapScreen /
 * HikingScreen / RouteEditorScreen).
 *
 * To publish: create a new style in Mapbox Studio, apply the colour
 * tokens above, publish, then replace the placeholder URL below with
 * the real style URL (format: mapbox://styles/<user>/<styleId>).
 *
 * NOTE: Until the Studio style is published, we fall back to
 * `outdoors-v12`.  The constant is exported so all map screens can
 * reference a single source of truth.
 */
const CAIRN_TOPO_STYLE_URL =
  process.env.EXPO_PUBLIC_CAIRN_TOPO_STYLE_URL ?? MAP_STYLES.streets;

/**
 * Resolve the best available map style for primary views.
 * Reads CAIRN_TOPO_STYLE_URL at runtime so that the style can be
 * overridden via environment variable without a code change.
 *
 * v119: default fallback changed from `outdoors-v12` to `streets-v12`.
 * Outdoors emphasizes terrain/contours but hides nearly all street-
 * level POIs and locality names. Users zooming in to find shops, road
 * names, or suburbs were seeing nothing — that's the "I zoomed in but
 * still don't see place names" complaint. Streets-v12 keeps reasonable
 * outdoor coverage (parks, water, terrain shading on zoom out) while
 * surfacing the road + POI labels users actually look for.
 */
export function getPrimaryMapStyle(): string {
  return CAIRN_TOPO_STYLE_URL;
}

/**
 * O18 MAP-01: user-selectable layer switch (outdoors vs satellite).
 * Called by MapScreen / MapHistoryScreen / HikingMap so the same choice
 * applies across every map surface. Plant flow keeps its own inline
 * toggle (per v299 UX) — do NOT wire this to PinAdjustStep.
 */
export type MapLayer = 'outdoors' | 'satellite';

export function getMapStyleForLayer(layer: MapLayer, isDark?: boolean): string {
  if (layer === 'satellite') return MAP_STYLES.satellite;
  // R21 (2026-08-17): dark mode support. When user Appearance = Dark (or
  // Auto at night), switch outdoors/streets style to Mapbox's official
  // dark-v11 so map surfaces match the rest of the app's dark theme.
  if (isDark) return MAP_STYLES.dark;
  return getPrimaryMapStyle();
}
