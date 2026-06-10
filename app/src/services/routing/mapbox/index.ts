/**
 * Re-exports for the Mapbox vector tile junction subsystem.
 */
export {
  extractJunctions,
  type MapboxJunction,
  type MapboxWay,
  type ExtractDiagnostics,
  type ExtractResult,
  type ExtractError,
  type ExtractOptions,
} from './MapboxJunctionExtractor';
export { buildTrailGraphFromMapbox } from './buildTrailGraphFromMapbox';
