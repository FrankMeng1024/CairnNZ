/**
 * useMapTheme — resolves the effective map theme for all mapbox surfaces.
 *
 * Three states drive every map style choice in the app:
 *   day    → outdoors-v12 (Hike/Route/etc), Standard + lightPreset=day (Plant)
 *   sunset → bundled sunset-2d.json (Hike/Route/etc), Standard + dusk (Plant)
 *   night  → dark-v11 (Hike/Route/etc), Standard + night (Plant)
 *
 * The three-state value comes from useScenicTimeState().timeOfDay which
 * already fans out from the same Appearance setting used everywhere else
 * (Home/Settings/Auth). Consumers must NOT reintroduce a binary isDark
 * bool — that lost the sunset state.
 *
 * Consumers:
 *   - HikingMap / MapHistoryScreen / RoutesScreen /
 *     RunningScreen / RouteEditor / MarkerDetail / Memory — pipe theme into
 *     `getMapStyleForTheme(layer, theme)`
 *   - PinAdjustStep — pipes theme into `themeToStandardPreset(theme)` for
 *     Standard style's <StyleImport basemap> child
 */
import { useScenicTimeState } from './useScenicTimeState';
import type { MapTheme } from '../config/mapbox';

export function useMapTheme(): MapTheme {
  const scenicTime = useScenicTimeState();
  return scenicTime.timeOfDay;
}
