/**
 * One visual contract for the current device location on passive maps.
 * Route endpoints, Point targets and GPS accuracy areas deliberately do not
 * use these styles because they represent different concepts.
 */
export const CURRENT_LOCATION_RING_STYLE = Object.freeze({
  circleRadius: [
    'interpolate', ['linear'], ['zoom'],
    4, 2.5,
    10, 4.5,
    14, 7,
    18, 9,
  ],
  circleColor: '#FFFFFF',
  circlePitchAlignment: 'map',
});

export const CURRENT_LOCATION_DOT_STYLE = Object.freeze({
  circleRadius: [
    'interpolate', ['linear'], ['zoom'],
    4, 1.6,
    10, 3,
    14, 5,
    18, 6.5,
  ],
  circleColor: 'rgba(51, 181, 229, 1)',
  circlePitchAlignment: 'map',
});
