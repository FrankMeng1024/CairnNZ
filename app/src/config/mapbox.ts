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
          ?? 'mapbox://styles/mapbox/standard';
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
  // R21-v3 (2026-08-30 user 三主题适配): dark-v11 for pure 2D dark map
  // (used by Hike/Routes/etc in night state). navigation-night-v1
  // retained above for legacy callers.
  darkV11: 'mapbox://styles/mapbox/dark-v11',
  // Standard style — 3D basemap that supports lightPreset config
  // (day/dusk/night). Used by Plant/PinAdjust to give the cairn-planting
  // flow a "ritual" 3D feel that reads the same across day/sunset/night.
  standard: 'mapbox://styles/mapbox/standard',
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

/**
 * R21-v3 (2026-08-30) — three-state theme applied to every mapbox surface.
 * Values match `ScenicTimeOfDay` from utils/scenicTime.ts so callers can
 * pipe `useScenicTimeState().timeOfDay` straight through.
 */
export type MapTheme = 'day' | 'sunset' | 'night';

/**
 * R21-v3 (2026-08-30) — Standard style lightPreset ids for Plant/PinAdjust.
 * Rendered by the <StyleImport id="basemap"> child inside the MapView.
 * Only meaningful when the loaded styleURL is Standard (mapbox/standard).
 */
export type StandardLightPreset = 'day' | 'dusk' | 'night';

export function themeToStandardPreset(theme: MapTheme): StandardLightPreset {
  if (theme === 'sunset') return 'dusk';
  if (theme === 'night') return 'night';
  return 'day';
}

/**
 * R21-v3 v2 (2026-08-30) — StyleImport config for Standard style in
 * "flat top-down" mode. User explicitly requested no 3D pitch and no
 * 3D buildings/landmarks, so we disable every `show3d*` flag Standard
 * exposes (all default `true` per Mapbox spec). Terrain is intrinsic
 * to Standard and cannot be disabled via config — pitch=0 hides it
 * effectively (only shading remains, no elevation parallax).
 *
 * Values are typed as `string` because rnmapbox's StyleImport config
 * dictionary is `{ [key: string]: string }` — booleans are coerced by
 * the native side.
 */
export function buildStandardConfig(theme: MapTheme): { [key: string]: string } {
  return {
    lightPreset: themeToStandardPreset(theme),
    show3dObjects: 'false',
    show3dBuildings: 'false',
    show3dFacades: 'false',
    show3dLandmarks: 'false',
    show3dTrees: 'false',
  };
}

/**
 * Local packaged 2D sunset style. Bundled via metro require() so no network
 * fetch is needed. See app/assets/map-styles/sunset-2d.json for the palette.
 *
 * R21-v3 v2 (2026-08-30): No longer used at runtime — every surface now
 * runs Standard 3D with a `lightPreset` (day/dusk/night) via <StyleImport>.
 * Kept in the codebase as a documented fallback in case Standard proves
 * too heavy on older devices or the 3D look tests badly with users.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SUNSET_STYLE_JSON_OBJ = require('../../assets/map-styles/sunset-2d.json');
const SUNSET_STYLE_JSON_STR = JSON.stringify(SUNSET_STYLE_JSON_OBJ);

export function getSunsetStyleObject(): object {
  return SUNSET_STYLE_JSON_OBJ;
}

export function getSunsetStyleJSONString(): string {
  return SUNSET_STYLE_JSON_STR;
}

/**
 * R21-v3 (2026-08-30) — resolve the effective 2D style for a given theme +
 * layer combination. Returns a tagged union so callers know whether to
 * pass `styleURL` (Mapbox-hosted style) or `styleJSON` (bundled sunset).
 *
 *   day + outdoors  → outdoors-v12 (URL)
 *   day + satellite → satellite (URL)
 *   sunset + outdoors → local sunset-2d.json (inline JSON)
 *   sunset + satellite → satellite (URL) — satellite ignores theme by design
 *   night + outdoors → dark-v11 (URL)
 *   night + satellite → satellite (URL)
 */
/**
 * R21-v3 (2026-08-30 v2) — resolve the effective style for a given theme +
 * layer combination. All non-satellite surfaces now return Mapbox Standard
 * (3D) — the caller pairs the returned styleURL with a `<StyleImport
 * id="basemap" existing config={{lightPreset}} />` child that applies the
 * day/dusk/night light preset. Satellite branch keeps its own imagery,
 * unaffected by theme.
 *
 *   any theme + satellite → satellite-streets-v12 (URL)
 *   any theme + outdoors  → Standard (URL) — preset via StyleImport child
 *
 * Legacy sunset JSON + dark-v11 paths are retired now that every surface
 * runs Standard with a preset.
 */
export type ResolvedMapStyle =
  | { kind: 'url'; url: string }
  | { kind: 'json'; json: string; object: object };

// R21-v3 (2026-08-30 v2): pre-allocated tagged values so `getMapStyleForTheme`
// returns the SAME reference every call. Prevents rnmapbox / react-map-gl
// from perceiving a "new style" prop each render and triggering avoidable
// style reloads — especially bad in list screens (RoutesScreen) that mount
// many map previews.
const RESOLVED_SATELLITE: ResolvedMapStyle = { kind: 'url', url: MAP_STYLES.satellite };
const RESOLVED_STANDARD: ResolvedMapStyle = { kind: 'url', url: MAP_STYLES.standard };

export function getMapStyleForTheme(
  layer: MapLayer,
  _theme: MapTheme,
): ResolvedMapStyle {
  if (layer === 'satellite') return RESOLVED_SATELLITE;
  return RESOLVED_STANDARD;
}

/**
 * R21-v3 (2026-08-30) — Standard 3D style for Plant/PinAdjust regardless
 * of theme. The theme is applied via a separate <StyleImport> child that
 * sets `lightPreset`. Callers do:
 *
 *   <MapView styleURL={getStandardStyleURL()} ...>
 *     <StyleImport id="basemap" existing config={{ lightPreset }} />
 *   </MapView>
 */
export function getStandardStyleURL(): string {
  return MAP_STYLES.standard;
}

export function getMapStyleForLayer(layer: MapLayer, isDark?: boolean): string {
  if (layer === 'satellite') return MAP_STYLES.satellite;
  // R21 (2026-08-17): dark mode support. When user Appearance = Dark (or
  // Auto at night), switch outdoors/streets style to Mapbox's official
  // dark-v11 so map surfaces match the rest of the app's dark theme.
  if (isDark) return MAP_STYLES.dark;
  return getPrimaryMapStyle();
}
