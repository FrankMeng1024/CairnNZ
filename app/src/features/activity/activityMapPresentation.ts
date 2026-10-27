import type { MapTheme } from '../../config/mapbox';
import { mapOrnamentsAbove } from '../../config/mapOrnaments';

export interface ActivityMapPresentation {
  routeColor: string;
  routeCasingColor: string;
  routeWidth: number;
  routeCasingWidth: number;
  routeCasingOpacity: number;
  /** Counteracts Mapbox Standard's 3D lighting without introducing glow. */
  emissiveStrength: number;
  puckHaloColor: string;
  puckRingColor: string;
  puckCoreColor: string;
}

const PALETTES: Record<MapTheme, Record<'hike' | 'run', ActivityMapPresentation>> = {
  day: {
    hike: {
      routeColor: '#1F5B43', routeCasingColor: '#FFF9ED',
      routeWidth: 5.2, routeCasingWidth: 9.4, routeCasingOpacity: 0.94,
      emissiveStrength: 0.42,
      puckHaloColor: '#C87941', puckRingColor: '#FFFDF7', puckCoreColor: '#C26932',
    },
    run: {
      routeColor: '#245F94', routeCasingColor: '#FFF9ED',
      routeWidth: 5.2, routeCasingWidth: 9.4, routeCasingOpacity: 0.94,
      emissiveStrength: 0.42,
      puckHaloColor: '#C87941', puckRingColor: '#FFFDF7', puckCoreColor: '#C26932',
    },
  },
  sunset: {
    hike: {
      routeColor: '#27634D', routeCasingColor: '#FFF2E3',
      routeWidth: 5.2, routeCasingWidth: 9.4, routeCasingOpacity: 0.94,
      emissiveStrength: 0.72,
      puckHaloColor: '#B9663D', puckRingColor: '#FFF2E5', puckCoreColor: '#A95032',
    },
    run: {
      routeColor: '#2E668A', routeCasingColor: '#FFF2E3',
      routeWidth: 5.2, routeCasingWidth: 9.4, routeCasingOpacity: 0.94,
      emissiveStrength: 0.72,
      puckHaloColor: '#B9663D', puckRingColor: '#FFF2E5', puckCoreColor: '#A95032',
    },
  },
  night: {
    hike: {
      routeColor: '#C8DDB0', routeCasingColor: '#162432',
      routeWidth: 5.4, routeCasingWidth: 9.8, routeCasingOpacity: 0.96,
      emissiveStrength: 1,
      puckHaloColor: '#E09B62', puckRingColor: '#F1F3F0', puckCoreColor: '#C86F3D',
    },
    run: {
      routeColor: '#95C6E8', routeCasingColor: '#162432',
      routeWidth: 5.4, routeCasingWidth: 9.8, routeCasingOpacity: 0.96,
      emissiveStrength: 1,
      puckHaloColor: '#E09B62', puckRingColor: '#F1F3F0', puckCoreColor: '#C86F3D',
    },
  },
};

export function activityMapPresentation(
  theme: MapTheme,
  activity: 'hike' | 'run',
): ActivityMapPresentation {
  return PALETTES[theme][activity];
}

/** Keep the split legal controls above the Activity dock's measured height. */
export function activityMapOrnamentsAbove(bottomClearance: number) {
  return mapOrnamentsAbove(bottomClearance);
}
